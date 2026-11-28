// What a super account does for the whole municipality (SUP-T-03, SUP-C-01, SUP-S-01, SUP-P-01, SUP-X-02, ACC-05 to ACC-09): decide
// the approvals queue, write the access log, create events, build the export, and manage accounts. Access follows spec 6.2: only a
// super account, for all barangays. These actions reach the server, so they need the connection; writing the access log does not.
// Screens reach these through the wrappers in actions.js; replacing them with calls to a real backend is the only change needed to go live.
import { MONITOR, OFFICE } from '../config/thresholds.js';
import { PROVIDER_ROLES, canDeactivate, hasOpenItems, openItemsOf, temporaryPassword, validateContact, validateNewAccount } from '../lib/accountRules.js';
import { scheduledAt, validateDeclineReason, validateDecision } from '../lib/approvals.js';
import { followUpEnd } from '../lib/consult.js';
import { eventTimes, validateEvent } from '../lib/clinicalRules.js';
import { formatPhone } from '../lib/authRules.js';
import { manilaDate } from '../lib/dates.js';
import { barangayChoiceOf, filterRows, sortOf, sortRows } from '../lib/tracker.js';
import { byId } from './ops.js';
import { profileByIdentifier, profileOf, trackerOf, viewerOf } from './selectors.js';

/** The actions an opening of a patient record is logged under (spec 6.2, SUP-X-02). */
export const ACCESS_ACTIONS = ['view_record', 'view_vitals'];

export function createOffice({ store, core, now = Date.now, random = Math.random }) {
  const state = () => store.getState();
  const account = () => {
    const viewer = viewerOf(state());
    return viewer?.active && viewer.role === 'super' ? viewer : null;
  };
  const activeSupers = () => state().db.profiles.filter((p) => p.role === 'super' && p.active);
  const activeBarangayAccounts = (barangayId) => state().db.profiles.filter((p) => p.role === 'barangay' && p.active && p.barangay_id === barangayId);
  /** The common start of an action: { me } or { error }. */
  function start({ needsConnection = true } = {}) {
    const me = account();
    if (!me) return { error: 'not_allowed' };
    if (needsConnection && !core.isOnline()) return { error: 'offline' };
    return { me };
  }
  const fail = (error, errors) => ({ ok: false, error, ...(errors ? { errors } : {}) });

  // ---------- The access log (SUP-X-02) ----------

  /**
   * A patient record was opened: the account name, the patient and the time go to the access log. `action` is view_record (her profile) or
   * view_vitals (her latest vitals beside the chat). Answers { ok } or { ok: false, error }.
   */
  function openRecord(patientId, action = 'view_record') {
    const found = start({ needsConnection: false });
    if (found.error) return fail(found.error);
    const patient = profileOf(state(), patientId);
    if (!patient || patient.role !== 'patient') return fail('not_found');
    if (!ACCESS_ACTIONS.includes(action)) return fail('not_allowed');
    core.commit([{ op: 'insert', table: 'access_log', row: { id: core.id('acl'), actor_id: found.me.id, patient_id: patientId, action, at: now() } }]);
    return { ok: true };
  }

  // ---------- The approvals queue (SUP-C-01, ACC-05) ----------

  const midwifeThread = (patientId) => state().db.conversations.find((c) => c.patient_id === patientId && c.kind === 'midwife') ?? null;

  /** The midwife thread opens when a teleconsultation is approved and stays open through the visit and 24 hours after it (PAT-C-03). */
  function openMidwifeThread(appointment) {
    const thread = appointment.type === 'teleconsult' ? midwifeThread(appointment.patient_id) : null;
    if (!thread) return [];
    return [{ op: 'update', table: 'conversations', id: thread.id, patch: { appointment_id: appointment.id, assigned_provider_id: appointment.provider_id, unlocked_until: followUpEnd(appointment) } }];
  }

  /** Tell the accounts an appointment concerns: the patient, her barangay's accounts (for their calendar) and the assigned account when it is not the one deciding. */
  function tellAppointment(appointment, deciderId, patientType) {
    const patient = profileOf(state(), appointment.patient_id);
    core.sendPush([appointment.patient_id], patientType, { appointment_id: appointment.id });
    const providers = [...activeBarangayAccounts(patient.barangay_id).map((p) => p.id), ...(appointment.provider_id && appointment.provider_id !== deciderId ? [appointment.provider_id] : [])];
    core.sendPush(providers, 'appointment_approved', { appointment_id: appointment.id, patient_id: appointment.patient_id });
  }

  /** The checks every approval and new time share: the date, the time and the assigned account. Answers { at } or an error result. */
  function checkDecision(values) {
    const at = now();
    const errors = validateDecision(values, { now: at, today: manilaDate(at), activeSuperIds: activeSupers().map((p) => p.id) });
    return Object.keys(errors).length > 0 ? { result: fail('form', errors) } : { at: scheduledAt(values.date, values.time) };
  }

  /**
   * Approve a booking request, or give it another time (SUP-C-01): `values` is { date, time, provider_id }, the date and time of the
   * visit and the super account who becomes the assigned midwife and owns the chat and the call (ACC-05). `mode` is 'approve' (status
   * approved) or 'reschedule' (status rescheduled). The patient, her barangay's accounts and the assigned account are told, and a
   * teleconsultation opens the midwife thread. Answers { ok, appointment } or { ok: false, error, errors? } with error one of not_allowed,
   * offline, not_found, already_handled, form.
   */
  function decideBooking(appointmentId, mode, values) {
    const found = start();
    if (found.error) return fail(found.error);
    const row = byId(state().db.appointments).get(appointmentId);
    if (!row || row.requested_at == null || !['clinic', 'teleconsult'].includes(row.type)) return fail('not_found');
    if (row.status !== 'pending') return fail('already_handled');
    const checked = checkDecision(values);
    if (checked.result) return checked.result;
    const patch = { status: mode === 'reschedule' ? 'rescheduled' : 'approved', provider_id: values.provider_id, scheduled_at: checked.at, handled_by: found.me.id, handled_at: now(), decline_reason: null };
    const appointment = { ...row, ...patch };
    core.commit([{ op: 'update', table: 'appointments', id: row.id, patch }, ...openMidwifeThread(appointment)]);
    tellAppointment(appointment, found.me.id, mode === 'reschedule' ? 'appointment_rescheduled' : 'appointment_approved');
    return { ok: true, appointment };
  }

  /** Decline a booking request with a reason (SUP-C-01): the patient is told. Answers like decideBooking, with error 'reason_required' or 'reason_too_long' for the reason. */
  function declineBooking(appointmentId, { reason } = {}) {
    const found = start();
    if (found.error) return fail(found.error);
    const row = byId(state().db.appointments).get(appointmentId);
    if (!row || row.requested_at == null || !['clinic', 'teleconsult'].includes(row.type)) return fail('not_found');
    if (row.status !== 'pending') return fail('already_handled');
    const note = validateDeclineReason(reason);
    if (!note.ok) return fail('form', { reason: note.error === 'required' ? 'required' : 'tooLong' });
    const patch = { status: 'declined', decline_reason: note.value, handled_by: found.me.id, handled_at: now() };
    core.commit([{ op: 'update', table: 'appointments', id: row.id, patch }]);
    core.sendPush([row.patient_id], 'appointment_declined', { appointment_id: row.id });
    return { ok: true, appointment: { ...row, ...patch } };
  }

  /** The patient, or for a proposal the barangay account that proposed it, hears how a request was decided. */
  function tellDecision(request, status, deciderId) {
    const to = request.kind === 'appointment_proposal' ? request.proposed_by : request.patient_id;
    if (to && to !== deciderId) core.sendPush([to], 'request_decided', { request_id: request.id, kind: request.kind, status, patient_id: request.patient_id });
  }

  /**
   * Approve a request of another kind (SUP-C-01):
   *   reschedule: `values` is { date, time }, the new time of her visit (the assigned account stays);
   *   barangay_change: no values; she moves to the barangay she asked for and her barangay chat moves with her;
   *   appointment_proposal: `values` is { date, time, provider_id }; the visit a barangay account proposed is made and approved.
   * Answers { ok, request } or { ok: false, error, errors? } with error one of not_allowed, offline, not_found, already_handled, form.
   */
  function approveRequest(requestId, values = {}) {
    const found = start();
    if (found.error) return fail(found.error);
    const request = byId(state().db.requests).get(requestId);
    if (!request) return fail('not_found');
    if (request.status !== 'pending') return fail('already_handled');
    const handled = { status: 'approved', handled_by: found.me.id, handled_at: now() };
    const ops = [{ op: 'update', table: 'requests', id: request.id, patch: handled }];

    if (request.kind === 'reschedule') {
      const appointment = byId(state().db.appointments).get(request.appointment_id);
      if (!appointment) return fail('not_found');
      const checked = checkDecision({ ...values, provider_id: appointment.provider_id ?? activeSupers()[0]?.id });
      if (checked.result) return checked.result;
      const moved = { ...appointment, scheduled_at: checked.at };
      ops.push({ op: 'update', table: 'appointments', id: appointment.id, patch: { scheduled_at: checked.at } }, ...(appointment.provider_id ? openMidwifeThread(moved) : []));
    } else if (request.kind === 'barangay_change') {
      const barangayThread = state().db.conversations.find((c) => c.patient_id === request.patient_id && c.kind === 'barangay');
      ops.push({ op: 'update', table: 'profiles', id: request.patient_id, patch: { barangay_id: request.to_barangay_id } });
      if (barangayThread) ops.push({ op: 'update', table: 'conversations', id: barangayThread.id, patch: { barangay_id: request.to_barangay_id } });
    } else if (request.kind === 'appointment_proposal') {
      const checked = checkDecision(values);
      if (checked.result) return checked.result;
      const appointment = {
        id: core.id('apt'),
        patient_id: request.patient_id,
        provider_id: values.provider_id,
        type: request.appointment_type,
        requested_at: request.created_at,
        scheduled_at: checked.at,
        preferred_start: request.preferred_start,
        preferred_end: request.preferred_end,
        location: request.appointment_type === 'teleconsult' ? 'Teleconsultation' : 'Barangay health station',
        status: 'approved',
        reason: request.reason,
        notes: null,
        handled_by: found.me.id,
        handled_at: handled.handled_at,
        decline_reason: null,
        ended_at: null,
        syncState: 'synced',
      };
      ops.push({ op: 'insert', table: 'appointments', row: appointment }, ...openMidwifeThread(appointment));
      core.commit(ops);
      tellAppointment(appointment, found.me.id, 'appointment_approved');
      tellDecision(request, 'approved', found.me.id);
      return { ok: true, request: { ...request, ...handled }, appointment };
    } else {
      return fail('not_found');
    }
    core.commit(ops);
    tellDecision(request, 'approved', found.me.id);
    return { ok: true, request: { ...request, ...handled } };
  }

  /** Decline a request of another kind with a reason (SUP-C-01). Answers like approveRequest. */
  function declineRequest(requestId, { reason } = {}) {
    const found = start();
    if (found.error) return fail(found.error);
    const request = byId(state().db.requests).get(requestId);
    if (!request) return fail('not_found');
    if (request.status !== 'pending') return fail('already_handled');
    const note = validateDeclineReason(reason);
    if (!note.ok) return fail('form', { reason: note.error === 'required' ? 'required' : 'tooLong' });
    const patch = { status: 'declined', decline_reason: note.value, handled_by: found.me.id, handled_at: now() };
    core.commit([{ op: 'update', table: 'requests', id: request.id, patch }]);
    tellDecision(request, 'declined', found.me.id);
    return { ok: true, request: { ...request, ...patch } };
  }

  // ---------- Events for all barangays or one (SUP-S-01) ----------

  /**
   * An event for all barangays or for one: { title, scope: 'all' | 'barangay', barangay_id, date, start, end }. The patients and the barangay
   * accounts it is for are told, and it shows in their calendars. Answers { ok, event, told } or { ok: false, error, errors? } with error
   * one of not_allowed, offline, form.
   */
  function createEvent({ title, scope, barangay_id: barangayId = null, date, start: from, end }) {
    const found = start();
    if (found.error) return fail(found.error);
    const errors = validateEvent({ title, date, start: from, end }, { today: manilaDate(now()) });
    if (scope !== 'all' && scope !== 'barangay') errors.scope = 'required';
    else if (scope === 'barangay' && !barangayId) errors.barangay_id = 'required';
    else if (scope === 'barangay' && !state().db.barangays.some((b) => b.id === barangayId)) errors.barangay_id = 'barangay';
    if (Object.keys(errors).length > 0) return fail('form', errors);
    const forAll = scope === 'all';
    const event = { id: core.id('evt'), title: title.trim(), scope, barangay_id: forAll ? null : barangayId, place: forAll ? OFFICE.eventPlaceAll : MONITOR.eventPlace, ...eventTimes({ date, start: from, end }), created_by: found.me.id };
    core.commit([{ op: 'insert', table: 'events', row: event }]);
    const audience = state().db.profiles.filter((p) => p.active && (p.role === 'patient' || p.role === 'barangay') && (forAll || p.barangay_id === barangayId));
    const told = core.sendPush(audience.map((p) => p.id), 'event_created', { event_id: event.id });
    return { ok: true, event, told: told.length };
  }

  // ---------- The Excel export (SUP-T-03) ----------

  /**
   * export_patients (spec 7.4): the rows of the list as it is filtered and sorted, for the file, and an entry in the export log with the
   * account's name, the filter and how many rows. `omit_contacts` leaves the contact numbers out of the rows. Answers
   * { ok, rows, filter, barangay_id, sort, generated_at, omit_contacts } or { ok: false, error } with error one of not_allowed, offline, not_found.
   */
  function exportPatients({ barangay_id: barangayId = null, sort = 'edd', omit_contacts: omitContacts = false } = {}) {
    const found = start();
    if (found.error) return fail(found.error);
    const barangays = state().db.barangays;
    if (barangayId && barangayChoiceOf(barangayId, barangays) === null) return fail('not_found');
    const at = now();
    const order = sortOf(sort);
    const rows = sortRows(filterRows(trackerOf(state(), found.me, at), barangayId), order).map(({ profile, ...row }) => (omitContacts ? { ...row, contact: null } : row));
    const filter = barangayId ? barangays.find((b) => b.id === barangayId).name : 'All barangays';
    core.commit([{ op: 'insert', table: 'export_log', row: { id: core.id('exl'), actor_id: found.me.id, filter, barangay_id: barangayId, sort: order, contacts_omitted: Boolean(omitContacts), row_count: rows.length, at } }]);
    return { ok: true, rows, filter, barangay_id: barangayId, sort: order, generated_at: at, omit_contacts: Boolean(omitContacts) };
  }

  // ---------- Account management (SUP-P-01, ACC-06, ACC-08, ACC-09) ----------

  /**
   * create_provider (spec 7.4): a barangay or super account, with a temporary password shown once. The account must change it at its first
   * sign-in (AUTH-03). `values`: { role, full_name, email, contact_no, barangay_id, language }. Answers { ok, profile, temporary_password } or
   * { ok: false, error, errors? } with error one of not_allowed, offline, form.
   */
  function createProvider(values) {
    const found = start();
    if (found.error) return fail(found.error);
    const errors = validateNewAccount(values, { barangayIds: state().db.barangays.map((b) => b.id) });
    if (!errors.email && profileByIdentifier(state(), values.email)) errors.email = 'taken';
    if (!errors.contact_no && profileByIdentifier(state(), values.contact_no)) errors.contact_no = 'taken';
    if (Object.keys(errors).length > 0) return fail('form', errors);
    const id = core.id('pro');
    const password = temporaryPassword(random);
    const forBarangay = values.role === 'barangay';
    const profile = {
      id,
      role: values.role,
      full_name: values.full_name.trim().replace(/\s+/g, ' '),
      name_suffix: null,
      title: forBarangay ? 'Barangay health worker' : 'Office staff, Tingloy Municipal Health Office',
      contact_no: formatPhone(values.contact_no),
      email: values.email.trim().toLowerCase(),
      language: values.language,
      photo_url: null,
      avatar_art: null,
      barangay_id: forBarangay ? values.barangay_id : null,
      active: true,
      created_by: found.me.id,
      created_at: now(),
    };
    core.commit([
      { op: 'insert', table: 'profiles', row: profile },
      { op: 'insert', table: 'credentials', row: { id, profile_id: id, password, must_change_password: true } },
    ]);
    return { ok: true, profile, temporary_password: password };
  }

  /** A barangay or super account other than a patient's, or null. */
  const providerTarget = (profileId) => {
    const profile = profileOf(state(), profileId);
    return profile && PROVIDER_ROLES.includes(profile.role) ? profile : null;
  };

  /** Reset a password (SUP-P-01): a new temporary password, shown once, that must be changed at the next sign-in. Answers { ok, temporary_password } or { ok: false, error }. */
  function resetProviderPassword(profileId) {
    const found = start();
    if (found.error) return fail(found.error);
    const target = providerTarget(profileId);
    if (!target) return fail('not_found');
    const password = temporaryPassword(random);
    core.commit([{ op: 'update', table: 'credentials', id: target.id, patch: { password, must_change_password: true, reset_code: null, reset_expires_at: null } }]);
    return { ok: true, temporary_password: password };
  }

  /** Update the contact number of an account (SUP-P-01). A number another account uses is refused. Answers { ok, profile } or { ok: false, error, errors? }. */
  function updateProviderContact(profileId, { contact_no: contact }) {
    const found = start();
    if (found.error) return fail(found.error);
    const target = providerTarget(profileId);
    if (!target) return fail('not_found');
    const errors = validateContact({ contact_no: contact });
    const other = errors.contact_no ? null : profileByIdentifier(state(), contact);
    if (other && other.id !== target.id) errors.contact_no = 'taken';
    if (Object.keys(errors).length > 0) return fail('form', errors);
    const patch = { contact_no: formatPhone(contact) };
    core.commit([{ op: 'update', table: 'profiles', id: target.id, patch }]);
    return { ok: true, profile: { ...target, ...patch } };
  }

  /**
   * Deactivate an account (ACC-06). The last active super account cannot be deactivated and an account does not deactivate itself. Its
   * open chats, alerts and appointments stay visible (ACC-08): the answer says what it left open so the screen can offer to hand it over,
   * and whether its barangay now has no active account (ACC-09). Answers { ok, open, barangay_uncovered } or { ok: false, error } with error
   * one of not_allowed, offline, not_found, inactive, last_super, self.
   */
  function deactivateProvider(profileId) {
    const found = start();
    if (found.error) return fail(found.error);
    const target = providerTarget(profileId);
    const check = canDeactivate(target, found.me.id, state().db.profiles);
    if (!check.ok) return fail(check.error);
    core.commit([{ op: 'update', table: 'profiles', id: target.id, patch: { active: false } }]);
    const open = openItemsOf(target, { now: now(), appointments: state().db.appointments, conversations: state().db.conversations, alerts: state().db.alerts });
    return { ok: true, open, has_open: hasOpenItems(open), barangay_uncovered: target.role === 'barangay' && activeBarangayAccounts(target.barangay_id).length === 0 };
  }

  /**
   * Hand what a deactivated account left open to another active account at the same level (ACC-08): a super account's upcoming appointments
   * and midwife threads, a barangay account's acknowledged alerts (the other account must be of the same barangay). Answers
   * { ok, moved } or { ok: false, error } with error one of not_allowed, offline, not_found, not_active, same_level.
   */
  function reassign(fromId, toId) {
    const found = start();
    if (found.error) return fail(found.error);
    const from = providerTarget(fromId);
    const to = providerTarget(toId);
    if (!from || !to || from.id === to.id) return fail('not_found');
    if (!to.active) return fail('not_active');
    if (from.role !== to.role || (from.role === 'barangay' && from.barangay_id !== to.barangay_id)) return fail('same_level');
    const open = openItemsOf(from, { now: now(), appointments: state().db.appointments, conversations: state().db.conversations, alerts: state().db.alerts });
    core.commit([
      { op: 'updateMany', table: 'appointments', patches: open.appointments.map((id) => ({ id, patch: { provider_id: to.id } })) },
      { op: 'updateMany', table: 'conversations', patches: open.threads.map((id) => ({ id, patch: { assigned_provider_id: to.id } })) },
      { op: 'updateMany', table: 'alerts', patches: open.alerts.map((id) => ({ id, patch: { acknowledged_by: to.id } })) },
    ]);
    return { ok: true, moved: open.appointments.length + open.threads.length + open.alerts.length };
  }

  return {
    openRecord,
    approveBooking: (id, values) => decideBooking(id, 'approve', values),
    rescheduleBooking: (id, values) => decideBooking(id, 'reschedule', values),
    declineBooking,
    approveRequest,
    declineRequest,
    createEvent,
    exportPatients,
    createProvider,
    resetProviderPassword,
    updateProviderContact,
    deactivateProvider,
    reassign,
  };
}

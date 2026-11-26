// What a barangay account does with the patients of its own barangay (BRG-M-04 to BRG-M-06, BRG-K-01, ACC-07): record that a
// record was opened, edit the clinical fields, write a visit note, refer a patient to the midwife, propose an appointment time
// and create an event. Access follows spec 6.2: only patients of the account's own barangay. These actions reach the server, so
// they need the connection; a message written offline is the one thing that waits on the phone (store/consult.js). Screens
// reach these through the wrappers in actions.js; replacing them with calls to a real backend is the only change needed to go live.
import { MONITOR } from '../config/thresholds.js';
import { REASON_MAX, validateNote } from '../lib/alertView.js';
import { validateBooking, preferredRange } from '../lib/consult.js';
import { eddSourceFor, eventTimes, validateClinical, validateEvent, validateVisitNote, visitNoteValues } from '../lib/clinicalRules.js';
import { manilaDate } from '../lib/dates.js';
import { latestVitals } from '../lib/monitor.js';
import { canEditClinical } from '../lib/permissions.js';
import { profileOf, viewerOf } from './selectors.js';

/** The actions an opening of a record is logged under (spec 6.2, ACC-07). */
export const ACCESS_ACTIONS = ['view_record', 'view_vitals'];

export function createBarangay({ store, core, now = Date.now }) {
  const state = () => store.getState();
  const account = () => {
    const viewer = viewerOf(state());
    return viewer?.active && viewer.role === 'barangay' ? viewer : null;
  };
  /** The patient's profile when she is in this account's barangay, otherwise null. */
  const inScope = (me, patientId) => {
    const profile = profileOf(state(), patientId);
    return profile && profile.role === 'patient' && canEditClinical(me, profile) ? profile : null;
  };
  /** The common start of an action on a patient: { me, patient } or { error }. */
  function start(patientId, { needsConnection = true } = {}) {
    const me = account();
    if (!me) return { error: 'not_allowed' };
    const patient = inScope(me, patientId);
    if (!patient) return { error: 'not_found' };
    if (needsConnection && !core.isOnline()) return { error: 'offline' };
    return { me, patient };
  }
  const sessionsOf = (patientId) => state().db.check_sessions.filter((s) => s.patient_id === patientId);

  return {
    /**
     * A record was opened: the account name, the patient and the time go to the access log (ACC-07). `action` is view_record
     * (the patient detail) or view_vitals (her latest vitals in Chat). Answers { ok } or { ok: false, error }.
     */
    openRecord(patientId, action = 'view_record') {
      const found = start(patientId, { needsConnection: false });
      if (found.error) return { ok: false, error: found.error };
      if (!ACCESS_ACTIONS.includes(action)) return { ok: false, error: 'not_allowed' };
      core.commit([{ op: 'insert', table: 'access_log', row: { id: core.id('acl'), actor_id: found.me.id, patient_id: patientId, action, at: now() } }]);
      return { ok: true };
    },

    /**
     * Edit LMP, EDD and risk notes (BRG-M-05). An EDD that is not LMP + 280 days is marked as the provider's own (edd_source
     * 'provider'), and the row keeps who changed it and when. Answers { ok, pregnancy } or { ok: false, error, errors? } with
     * error one of not_allowed, not_found, offline, no_pregnancy, form.
     */
    saveClinical(patientId, { lmp, edd, risk_notes = '' }) {
      const found = start(patientId);
      if (found.error) return { ok: false, error: found.error };
      const pregnancy = state().db.pregnancies.find((p) => p.patient_id === patientId && p.status === 'active');
      if (!pregnancy) return { ok: false, error: 'no_pregnancy' };
      const errors = validateClinical({ lmp, edd, risk_notes }, { today: manilaDate(now()) });
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      const patch = { lmp, edd, edd_source: eddSourceFor(lmp, edd), risk_notes: risk_notes.trim() || null, updated_by: found.me.id, updated_at: now() };
      core.commit([{ op: 'update', table: 'pregnancies', id: pregnancy.id, patch }]);
      return { ok: true, pregnancy: { ...pregnancy, ...patch } };
    },

    /**
     * A visit note: { bp_systolic, bp_diastolic, weight_kg, note, shared } (BRG-M-05). A shared note is one the patient can
     * read. Answers { ok, note } or { ok: false, error, errors? } with error one of not_allowed, not_found, offline, form.
     */
    addVisitNote(patientId, input) {
      const found = start(patientId);
      if (found.error) return { ok: false, error: found.error };
      const errors = validateVisitNote(input);
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      const note = { id: core.id('vn'), patient_id: patientId, author_id: found.me.id, taken_at: now(), ...visitNoteValues(input), shared: input.shared !== false };
      core.commit([{ op: 'insert', table: 'visit_notes', row: note }]);
      return { ok: true, note };
    },

    /**
     * Refer the patient to the midwife with a reason and her latest vitals (BRG-M-06): every active super account is told.
     * Answers { ok, told } or { ok: false, error } with error one of not_allowed, not_found, offline, reason_required,
     * reason_too_long.
     */
    refer(patientId, { reason } = {}) {
      const found = start(patientId);
      if (found.error) return { ok: false, error: found.error };
      const note = validateNote(reason, REASON_MAX);
      if (!note.ok) return { ok: false, error: note.error === 'required' ? 'reason_required' : 'reason_too_long' };
      const supers = state().db.profiles.filter((p) => p.role === 'super' && p.active).map((p) => p.id);
      core.sendPush(supers, 'referral', { patient_id: patientId, reason: note.value, vitals: latestVitals(sessionsOf(patientId)), from_profile_id: found.me.id });
      return { ok: true, told: supers.length };
    },

    /**
     * Propose an appointment time for a patient (spec 6.2: barangay accounts propose times; a super account decides). It waits
     * in the approvals queue as a request of its own kind, one open proposal per patient. Answers { ok, request } or
     * { ok: false, error, errors? } with error one of not_allowed, not_found, offline, form, pending_exists.
     */
    proposeAppointment(patientId, { type, preferred_date, window, reason }) {
      const found = start(patientId);
      if (found.error) return { ok: false, error: found.error };
      const errors = validateBooking({ type, preferred_date, window, reason }, { today: manilaDate(now()) });
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      if (state().db.requests.some((r) => r.kind === 'appointment_proposal' && r.patient_id === patientId && r.status === 'pending')) return { ok: false, error: 'pending_exists' };
      const range = preferredRange(preferred_date, window);
      const request = {
        id: core.id('req'),
        kind: 'appointment_proposal',
        patient_id: patientId,
        proposed_by: found.me.id,
        appointment_type: type,
        preferred_date,
        preferred_start: range.start,
        preferred_end: range.end,
        reason: reason.trim(),
        status: 'pending',
        created_at: now(),
        syncState: 'synced',
        handled_by: null,
        handled_at: null,
        decline_reason: null,
      };
      core.commit([{ op: 'insert', table: 'requests', row: request }]);
      core.sendPush(state().db.profiles.filter((p) => p.role === 'super' && p.active).map((p) => p.id), 'appointment_proposal', { request_id: request.id, patient_id: patientId, proposed_by: found.me.id });
      return { ok: true, request };
    },

    /**
     * An event for the account's own barangay (BRG-K-01): { title, date, start, end }. The patients of the barangay and its
     * other accounts are told. Answers { ok, event, told } or { ok: false, error, errors? } with error one of not_allowed,
     * offline, form.
     */
    createEvent({ title, date, start: from, end }) {
      const me = account();
      if (!me) return { ok: false, error: 'not_allowed' };
      if (!core.isOnline()) return { ok: false, error: 'offline' };
      const errors = validateEvent({ title, date, start: from, end }, { today: manilaDate(now()) });
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      const event = { id: core.id('evt'), title: title.trim(), scope: 'barangay', barangay_id: me.barangay_id, place: MONITOR.eventPlace, ...eventTimes({ date, start: from, end }), created_by: me.id };
      core.commit([{ op: 'insert', table: 'events', row: event }]);
      const audience = state().db.profiles.filter((p) => p.active && p.id !== me.id && (p.role === 'patient' || p.role === 'barangay') && p.barangay_id === me.barangay_id);
      const told = core.sendPush(audience.map((p) => p.id), 'event_created', { event_id: event.id });
      return { ok: true, event, told: told.length };
    },
  };
}

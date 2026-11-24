// Selectors enforce the access rules of spec 6.2, so a patient can never select another patient's data and a barangay
// account never sees another barangay. Screens read the store only through these. Each takes the state and the viewer
// (a profile) and returns an empty list or null when the viewer may not see the data.
import { AUTH, buildThresholds } from '../config/thresholds.js';
import { identifierKey, isMinor } from '../lib/authRules.js';
import { bookingRows, nextTeleconsult, threadLock, unseenFrom } from '../lib/consult.js';
import { manilaDate } from '../lib/dates.js';
import { calendarItems } from '../lib/schedule.js';
import * as access from '../lib/permissions.js';
import { byId } from './ops.js';

const newestFirst = (rows, key) => [...rows].sort((a, b) => b[key] - a[key]);

export const profileOf = (state, id) => byId(state.db.profiles).get(id) ?? null;

/** The signed-in profile, or null. */
export const viewerOf = (state) => (state.session ? profileOf(state, state.session.profile_id) : null);

export const thresholdsOf = (state) => buildThresholds(state.db.thresholds);

/** The patient profile when the viewer may read her, otherwise null. */
function patientInScope(state, viewer, patientId) {
  const profile = profileOf(state, patientId);
  return profile && profile.role === 'patient' && access.canReadPatient(viewer, profile) ? profile : null;
}

/** Providers do not see what a patient's phone has not uploaded yet; the patient sees all her own. */
const visible = (viewer, record) => viewer.role === 'patient' || !access.isQueued(record);

export function patientsInScope(state, viewer) {
  return state.db.profiles.filter((p) => p.role === 'patient' && access.canReadPatient(viewer, p));
}

export function patientRecord(state, viewer, patientId) {
  const profile = patientInScope(state, viewer, patientId);
  if (!profile) return null;
  return {
    profile,
    patient: byId(state.db.patients).get(patientId) ?? null,
    pregnancy: state.db.pregnancies.find((p) => p.patient_id === patientId && p.status === 'active') ?? null,
    devices: state.db.devices.filter((d) => d.patient_id === patientId),
  };
}

export function devicesOf(state, viewer, patientId) {
  return patientInScope(state, viewer, patientId) ? state.db.devices.filter((d) => d.patient_id === patientId) : [];
}

export function checkSessions(state, viewer, patientId) {
  if (!patientInScope(state, viewer, patientId)) return [];
  return newestFirst(
    state.db.check_sessions.filter((s) => s.patient_id === patientId && visible(viewer, s)),
    'started_at',
  );
}

function readingsOf(state, viewer, table, sessionId) {
  const session = byId(state.db.check_sessions).get(sessionId);
  if (!session || !patientInScope(state, viewer, session.patient_id) || !visible(viewer, session)) return [];
  return state.db[table].filter((r) => r.session_id === sessionId && visible(viewer, r)).sort((a, b) => a.taken_at - b.taken_at);
}
export const fetalReadings = (state, viewer, sessionId) => readingsOf(state, viewer, 'fetal_readings', sessionId);
export const maternalReadings = (state, viewer, sessionId) => readingsOf(state, viewer, 'maternal_readings', sessionId);

/** Alerts: a patient her own, a barangay account its barangay's, a super account all. */
export function alertsOf(state, viewer, { patientId = null, status = null } = {}) {
  if (!viewer) return [];
  return newestFirst(
    state.db.alerts.filter((a) => {
      if (patientId && a.patient_id !== patientId) return false;
      if (status && a.status !== status) return false;
      return Boolean(patientInScope(state, viewer, a.patient_id));
    }),
    'created_at',
  );
}

/** One alert when the viewer may read it (a patient her own, a barangay account its barangay's, a super account any). */
export function alertById(state, viewer, alertId) {
  const alert = byId(state.db.alerts).get(alertId) ?? null;
  return alert && viewer && patientInScope(state, viewer, alert.patient_id) ? alert : null;
}

/** Alerts not yet resolved (new or acknowledged), newest first, in the viewer's scope. */
export const openAlertsOf = (state, viewer, { patientId = null } = {}) => alertsOf(state, viewer, { patientId }).filter((a) => a.status !== 'resolved');

/** Visit notes: providers in scope read all; a patient reads only those shared with her. */
export function visitNotesOf(state, viewer, patientId) {
  const patient = patientInScope(state, viewer, patientId);
  if (!patient) return [];
  return newestFirst(
    state.db.visit_notes.filter((n) => n.patient_id === patientId && access.canReadVisitNote(viewer, patient, n)),
    'taken_at',
  );
}

export function appointmentsOf(state, viewer, { patientId = null } = {}) {
  if (!viewer) return [];
  return state.db.appointments
    .filter((a) => (!patientId || a.patient_id === patientId) && patientInScope(state, viewer, a.patient_id) && visible(viewer, a))
    .sort((a, b) => (a.scheduled_at ?? a.requested_at) - (b.scheduled_at ?? b.requested_at));
}

/** Events: all-barangay events plus the viewer's own barangay's; super accounts see every event. */
export function eventsOf(state, viewer) {
  if (!viewer?.active) return [];
  const barangayId = viewer.role === 'patient' ? profileOf(state, viewer.id)?.barangay_id : viewer.barangay_id;
  return state.db.events
    .filter((e) => viewer.role === 'super' || e.scope === 'all' || e.barangay_id === barangayId)
    .sort((a, b) => a.starts_at - b.starts_at);
}

export function conversationsOf(state, viewer) {
  if (!viewer) return [];
  return state.db.conversations.filter((c) => access.canReadConversation(viewer, c, profileOf(state, c.patient_id)));
}

/** Messages made offline stay with their sender until they reach the server. */
export function messagesOf(state, viewer, conversationId) {
  const conversation = byId(state.db.conversations).get(conversationId);
  if (!conversation || !access.canReadConversation(viewer, conversation, profileOf(state, conversation.patient_id))) return [];
  return state.db.messages
    .filter((m) => m.conversation_id === conversationId && (!access.isQueued(m) || m.sender_id === viewer.id))
    .sort((a, b) => a.sent_at - b.sent_at);
}

/** Notifications and the assistant's messages belong to one account. */
export function notificationsOf(state, viewer) {
  if (!viewer) return [];
  return newestFirst(state.db.notifications.filter((n) => n.profile_id === viewer.id), 'created_at');
}
/** How many notifications the viewer has not read yet: the bell's badge (COM-01). */
export const unreadCountOf = (state, viewer) => (viewer ? state.db.notifications.filter((n) => n.profile_id === viewer.id && !n.read_at).length : 0);

/**
 * What a notification text needs besides the notification: the patient's name (only when the viewer may read her) and
 * the event's title (only for events in scope). Used by the notification center and the banners.
 */
export function notificationContext(state, viewer, notification) {
  const p = notification.payload ?? {};
  const alert = p.alert_id ? byId(state.db.alerts).get(p.alert_id) : null;
  const patientId = p.patient_id ?? alert?.patient_id ?? null;
  const patient = patientId ? patientInScope(state, viewer, patientId) : null;
  const event = p.event_id ? eventsOf(state, viewer).find((e) => e.id === p.event_id) : null;
  return { role: viewer.role, patientName: patient?.full_name ?? null, eventTitle: event?.title ?? null };
}

/** The notices her phone showed from its own rules that the server has not made an alert of yet (ALR-02). */
export const phoneNoticesOf = (state, viewer) =>
  viewer?.role === 'patient' ? notificationsOf(state, viewer).filter((n) => n.type === 'alert_notice' && n.payload.local === true && !n.payload.alert_id) : [];

/** The account's push choice (COM-04): 'allowed' with a subscription, 'declined' after Not now, otherwise 'unset'. */
export function pushStateOf(state, profileId) {
  if (state.db.push_subscriptions.some((s) => s.profile_id === profileId)) return 'allowed';
  return profileOf(state, profileId)?.push_declined_at ? 'declined' : 'unset';
}

export const heleMessagesOf = (state, viewer) =>
  viewer ? state.db.hele_messages.filter((m) => m.profile_id === viewer.id).sort((a, b) => a.created_at - b.created_at) : [];

/** Barangay and super accounts, for the super account's account management. */
export function providerAccounts(state, viewer) {
  return access.canManageProviders(viewer) ? state.db.profiles.filter((p) => p.role !== 'patient') : [];
}
export const accessLogOf = (state, viewer) => (access.canReadLogs(viewer) ? newestFirst(state.db.access_log, 'at') : []);
export const exportLogOf = (state, viewer) => (access.canReadLogs(viewer) ? newestFirst(state.db.export_log, 'at') : []);

// ---------- The patient the scenarios act on ----------

const hasBothDevices = (state, patientId) => {
  const types = new Set(state.db.devices.filter((d) => d.patient_id === patientId).map((d) => d.type));
  return types.has('belt') && types.has('band');
};

/** Patients in the viewer's scope that have both devices: who the gear may choose. */
export function focusCandidates(state, viewer) {
  return viewer ? patientsInScope(state, viewer).filter((p) => hasBothDevices(state, p.id)) : [];
}

/**
 * The patient scenarios act on: the signed-in patient herself, otherwise the one chosen in the gear (Maricel until
 * another is chosen), limited to the viewer's scope. Null when nobody qualifies.
 */
export function focusPatientId(state, viewer) {
  const candidates = focusCandidates(state, viewer);
  if (viewer?.role === 'patient') return candidates.length ? viewer.id : null;
  if (candidates.some((p) => p.id === state.meta.focus_patient_id)) return state.meta.focus_patient_id;
  return candidates[0]?.id ?? null;
}

// ---------- Signing in, consent and the steps before the app opens (AUTH-03 to AUTH-06) ----------

/** The 15 barangays, for the sign-up form: readable before anyone is signed in. */
export const barangayChoices = (state) => state.db.barangays;

/** The account a contact number or an email belongs to, or null. */
export function profileByIdentifier(state, identifier) {
  const key = identifierKey(identifier);
  if (!key) return null;
  return state.db.profiles.find((p) => (p.email && p.email.toLowerCase() === key) || (p.contact_no && identifierKey(p.contact_no) === key)) ?? null;
}

const credentialOf = (state, profileId) => byId(state.db.credentials).get(profileId) ?? null;

export const hasAcceptedTerms = (state, profileId) =>
  state.db.consents.some((c) => c.profile_id === profileId && c.document === 'terms_privacy' && c.version === AUTH.termsVersion);

/**
 * What a signed-in person must finish before the app opens: { viewer, step } with step one of 'change-password',
 * 'consent', 'guardian-consent' or null. No viewer (nobody signed in, or the account was deactivated) means nothing.
 */
export function accessGate(state, now = Date.now()) {
  const viewer = viewerOf(state);
  if (!viewer?.active) return { viewer: null, step: null };
  const patient = viewer.role === 'patient' ? byId(state.db.patients).get(viewer.id) : null;
  const step = access.gateStep({
    role: viewer.role,
    mustChangePassword: credentialOf(state, viewer.id)?.must_change_password === true,
    hasConsent: hasAcceptedTerms(state, viewer.id),
    minor: patient ? isMinor(patient.birthdate, manilaDate(now)) : false,
    hasGuardianConsent: state.db.guardian_consents.some((g) => g.profile_id === viewer.id),
    needsPush: pushStateOf(state, viewer.id) === 'unset',
  });
  return { viewer, step, pairing: step === null && viewer.role === 'patient' && needsPairing(state, viewer.id) };
}

/** Where the signed-in person belongs now: the step they must finish, their landing screen, or the sign-in screen. */
export function accessTarget(state, now = Date.now()) {
  const { viewer, step, pairing } = accessGate(state, now);
  if (!viewer) return '/sign-in';
  return step ? access.GATE_PATHS[step] : access.landingPath(viewer.role, { pairing });
}

// ---------- Devices and Home (Prompt 4) ----------

/** A patient with no devices who has not opened the pairing wizard yet (AUTH-07). */
export function needsPairing(state, patientId) {
  const row = byId(state.db.patients).get(patientId);
  return Boolean(row) && !row.pairing_prompted_at && !state.db.devices.some((d) => d.patient_id === patientId);
}

/** The patient's newest completed check, or null. Providers see it only once it has reached the server. */
export const latestCheck = (state, viewer, patientId) => checkSessions(state, viewer, patientId).find((s) => s.status === 'completed') ?? null;

/** How many of the viewer's own checks still wait to be uploaded. */
export const waitingToSync = (state, viewer, patientId) =>
  viewer?.role === 'patient' && viewer.id === patientId ? state.db.check_sessions.filter((s) => s.patient_id === patientId && s.syncState === 'queued').length : 0;

/** The check in progress or just finished on this patient's phone, or null. */
export const liveCheckOf = (state, viewer) => (viewer?.role === 'patient' && state.live.check?.patient_id === viewer.id ? state.live.check : null);

/** The free device of a type that the pairing chooser lists (presenter only: the gear's fill of the wizard's first step). */
export function freeNearbyDevice(state, type) {
  return Object.values(state.hardware).find((h) => h.type === type && h.bound_patient_id === null && (h.advertising || h.connected)) ?? null;
}

// ---------- Schedule and Profile (Prompt 6) ----------

/** A patient's calendar items (PAT-S-01): her appointments with a date and the events for her barangay, by time. Empty for anyone else. */
export function calendarOf(state, viewer) {
  if (viewer?.role !== 'patient') return [];
  return calendarItems({ appointments: appointmentsOf(state, viewer, { patientId: viewer.id }), events: eventsOf(state, viewer) });
}

/**
 * Requests in scope, newest first: a patient her own, a barangay account its barangay's, a super account all. Requests a
 * phone has not sent yet are hidden from providers, like other things made offline.
 */
export function requestsOf(state, viewer, { patientId = null, kind = null } = {}) {
  if (!viewer) return [];
  return newestFirst(
    state.db.requests.filter((r) => (!patientId || r.patient_id === patientId) && (!kind || r.kind === kind) && patientInScope(state, viewer, r.patient_id) && visible(viewer, r)),
    'created_at',
  );
}

/** The open request of a kind (and appointment) of the signed-in patient, or null. */
export const pendingRequestOf = (state, viewer, kind, appointmentId = null) =>
  requestsOf(state, viewer, { patientId: viewer?.id, kind }).find((r) => r.status === 'pending' && (appointmentId === null || r.appointment_id === appointmentId)) ?? null;

/**
 * The patient's own details as her phone shows them: what was saved, with an edit made offline on top of it
 * ({ profile, patient, queued }). Providers keep seeing the saved values until the edit is sent.
 */
export function personalInfoOf(state, viewer) {
  if (viewer?.role !== 'patient') return null;
  const profile = profileOf(state, viewer.id);
  const patient = byId(state.db.patients).get(viewer.id);
  if (!profile || !patient) return null;
  const edit = patient.queued_edit?.values ?? null;
  const merged = edit ? { ...patient, ...edit } : patient;
  return { profile: edit ? { ...profile, ...edit } : profile, patient: merged, queued: Boolean(edit) };
}

/** A provider's name and role as a patient may see it: any super account, and the barangay accounts of her own barangay. */
export function providerOf(state, viewer, providerId) {
  const provider = providerId ? profileOf(state, providerId) : null;
  if (!viewer || !provider || provider.role === 'patient') return null;
  if (viewer.role === 'patient' && provider.role === 'barangay' && provider.barangay_id !== viewer.barangay_id) return null;
  return { id: provider.id, full_name: provider.full_name, role: provider.role };
}

/** The consents of the signed-in account: the terms (latest), the guardian's form (a minor), and the Hele question-logging switch. */
export function consentRecordsOf(state, viewer) {
  if (!viewer) return { terms: null, guardian: null, hele: null };
  const mine = state.db.consents.filter((c) => c.profile_id === viewer.id);
  const latest = (document) => newestFirst(mine.filter((c) => c.document === document), 'accepted_at')[0] ?? null;
  return {
    terms: latest('terms_privacy'),
    guardian: state.db.guardian_consents.find((g) => g.profile_id === viewer.id) ?? null,
    hele: latest('hele_question_logging'),
  };
}

/** Whether she let NurtureLink keep her questions to Hele AI, anonymised (PAT-A-06). Off until she turns it on. */
export const heleLoggingOf = (state, viewer) => {
  const { hele } = consentRecordsOf(state, viewer);
  return Boolean(hele) && !hele.withdrawn_at;
};

// ---------- What the gear fills in (presenter only; nothing here reaches a screen's own text) ----------

/** The contact (an email for providers, a number for patients) and password of an account, for the gear's fill. */
export function signInFillFor(state, profileId) {
  const profile = profileOf(state, profileId);
  const credential = credentialOf(state, profileId);
  if (!profile || !credential) return null;
  return { identifier: profile.email ?? profile.contact_no, password: credential.password };
}

/** The most recent account a super account created (never a seeded one), or null. */
export function newestCreatedProvider(state) {
  return newestFirst(state.db.profiles.filter((p) => p.role !== 'patient' && p.created_by && p.created_at > state.seededAt), 'created_at')[0] ?? null;
}

/** The reset code "sent" to a patient, while it is still valid. */
export function pendingResetCode(state, identifier, now = Date.now()) {
  const profile = profileByIdentifier(state, identifier);
  const credential = profile ? credentialOf(state, profile.id) : null;
  return credential?.reset_code && credential.reset_expires_at > now ? credential.reset_code : null;
}

// ---------- Consult (Prompt 7) ----------

/**
 * A patient's two threads (PAT-C-01), the barangay inbox first: { conversation, last, unread, lock }. `last` is the newest
 * message she can see, `unread` counts what the other side wrote and she has not seen, `lock` is { open, reason }.
 */
export function threadsOf(state, viewer, now = Date.now()) {
  if (viewer?.role !== 'patient') return [];
  const order = { barangay: 0, midwife: 1 };
  return conversationsOf(state, viewer)
    .sort((a, b) => order[a.kind] - order[b.kind])
    .map((conversation) => {
      const messages = messagesOf(state, viewer, conversation.id);
      return { conversation, last: messages[messages.length - 1] ?? null, unread: unseenFrom(messages, viewer.id).length, lock: threadLock(conversation, now) };
    });
}

/** One thread of the signed-in patient with its messages, or null when it is not hers. */
export function threadOf(state, viewer, conversationId, now = Date.now()) {
  return threadsOf(state, viewer, now)
    .map((thread) => ({ ...thread, messages: messagesOf(state, viewer, thread.conversation.id) }))
    .find((thread) => thread.conversation.id === conversationId) ?? null;
}

/**
 * Who wrote what in a thread she can read (ACC-03: every message shows its sender's name): a Map of profile id to
 * { name, role }. Only the senders of messages she can see and the people the thread is with are in it.
 */
export function senderNamesOf(state, viewer, conversationId) {
  const names = new Map();
  for (const message of messagesOf(state, viewer, conversationId)) {
    const sender = profileOf(state, message.sender_id);
    if (sender) names.set(sender.id, { name: sender.full_name, role: sender.role });
  }
  return names;
}

/** The accounts of her barangay's health team and the midwife of her thread, for the thread's heading. */
export function threadPeopleOf(state, viewer, conversation) {
  if (viewer?.role !== 'patient' || !conversation || conversation.patient_id !== viewer.id) return [];
  const people =
    conversation.kind === 'barangay'
      ? state.db.profiles.filter((p) => p.role === 'barangay' && p.barangay_id === conversation.barangay_id && p.active)
      : [profileOf(state, conversation.assigned_provider_id)].filter((p) => p?.active);
  return people.map((p) => ({ id: p.id, name: p.full_name, role: p.role }));
}

/** Her booking requests, newest first, with how each stands (PAT-C-04). Waiting ones made offline show only to her. */
export function bookingsOf(state, viewer, now = Date.now()) {
  return viewer?.role === 'patient' ? bookingRows(appointmentsOf(state, viewer, { patientId: viewer.id }), now) : [];
}

/** The teleconsultation to join or wait for: the one running now, otherwise the next approved one. */
export function teleconsultOf(state, viewer, now = Date.now()) {
  return viewer?.role === 'patient' ? nextTeleconsult(appointmentsOf(state, viewer, { patientId: viewer.id }), now) : null;
}

/** The health account the Call button rings: the first active account of her barangay with a number. Null when there is none. */
export function callTargetOf(state, viewer) {
  if (viewer?.role !== 'patient') return null;
  const own = profileOf(state, viewer.id);
  const account = state.db.profiles.find((p) => p.role === 'barangay' && p.active && p.barangay_id === own?.barangay_id && p.contact_no);
  return account ? { id: account.id, name: account.full_name, contact_no: account.contact_no } : null;
}

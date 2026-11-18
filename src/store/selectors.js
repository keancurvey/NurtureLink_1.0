// Selectors enforce the access rules of spec 6.2, so a patient can never select another patient's data and a barangay
// account never sees another barangay. Screens read the store only through these. Each takes the state and the viewer
// (a profile) and returns an empty list or null when the viewer may not see the data.
import { AUTH, buildThresholds } from '../config/thresholds.js';
import { identifierKey, isMinor } from '../lib/authRules.js';
import { manilaDate } from '../lib/dates.js';
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
    .filter((a) => (!patientId || a.patient_id === patientId) && patientInScope(state, viewer, a.patient_id))
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

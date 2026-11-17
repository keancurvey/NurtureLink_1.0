// Roles and what they may do. This is the one place that maps roles to access (spec 6.2), to their tabs and landing
// screen (spec Appendix A, AUTH-04) and to the presenter gear's actions (CLAUDE.md Section 5, point 3).

export const ROLES = ['patient', 'barangay', 'super'];

// ---------- Tabs and landing (spec Appendix A, AUTH-04) ----------

/** The tabs of each role, in order. The first is where the role lands after sign-in. */
export const TABS = {
  patient: ['home', 'schedule', 'consult', 'hele', 'profile'],
  barangay: ['monitor', 'chat', 'calendar', 'profile'],
  super: ['tracker', 'consult', 'schedule', 'profile'],
};

/** Where a signed-in role lands. (Patients land on the pairing wizard once Prompt 4 adds it, for a first sign-in.) */
export const landingPath = (role) => (TABS[role] ? `/${role}/${TABS[role][0]}` : '/sign-in');

export const isProviderRole = (role) => role === 'barangay' || role === 'super';

/** The screens a signed-in person must finish before the app opens, and their addresses. */
export const GATE_PATHS = {
  'change-password': '/change-password',
  consent: '/consent',
  'guardian-consent': '/guardian-consent',
};

/**
 * The next step before the app opens, or null when the person may go in: a provider's first sign-in forces a new
 * password (AUTH-03), then the terms and consent must be accepted (AUTH-05), then a patient under 18 needs her
 * parent's or guardian's consent (AUTH-06).
 */
export function gateStep({ role, mustChangePassword, hasConsent, minor, hasGuardianConsent }) {
  if (isProviderRole(role) && mustChangePassword) return 'change-password';
  if (!hasConsent) return 'consent';
  if (role === 'patient' && minor && !hasGuardianConsent) return 'guardian-consent';
  return null;
}

// ---------- Access rules of spec 6.2 ----------
// A viewer is a profile: { id, role, barangay_id, active }. Every function answers false for no viewer.

const isProvider = (viewer) => viewer?.active === true && (viewer.role === 'barangay' || viewer.role === 'super');

/** Patient record in scope: a patient sees herself, a barangay account its own barangay, a super account all. */
export function canReadPatient(viewer, patientProfile) {
  if (!viewer?.active || !patientProfile) return false;
  if (viewer.role === 'patient') return viewer.id === patientProfile.id;
  if (viewer.role === 'barangay') return viewer.barangay_id !== null && viewer.barangay_id === patientProfile.barangay_id;
  return viewer.role === 'super';
}

/** Clinical fields (LMP, EDD, risk notes) and visit notes: barangay accounts in their barangay, super accounts everywhere. */
export function canEditClinical(viewer, patientProfile) {
  return isProvider(viewer) && canReadPatient(viewer, patientProfile);
}

/** Acknowledge an alert: a barangay account for its own patients, a super account for any. */
export function canAcknowledge(viewer, patientProfile) {
  return canEditClinical(viewer, patientProfile);
}

/** A patient reads only the visit notes shared with her; providers in scope read all. */
export function canReadVisitNote(viewer, patientProfile, note) {
  if (!canReadPatient(viewer, patientProfile)) return false;
  return viewer.role === 'patient' ? note.shared === true : true;
}

/** Create or reset provider accounts, read the access and export logs, approve bookings, export: super accounts. */
export const canManageProviders = (viewer) => viewer?.active === true && viewer.role === 'super';
export const canReadLogs = canManageProviders;
export const canApproveBookings = canManageProviders;
export const canExportPatients = canManageProviders;

/** Events: a super account for all barangays or one, a barangay account only for its own barangay. */
export function canCreateEvent(viewer, event) {
  if (!viewer?.active) return false;
  if (viewer.role === 'super') return true;
  return viewer.role === 'barangay' && event.scope === 'barangay' && event.barangay_id === viewer.barangay_id;
}

/**
 * Conversations: a patient her own two threads; a barangay account the shared inbox of patients in its barangay;
 * a super account the midwife threads assigned to it.
 */
export function canReadConversation(viewer, conversation, patientProfile) {
  if (!viewer?.active || !conversation) return false;
  if (viewer.role === 'patient') return conversation.patient_id === viewer.id;
  if (viewer.role === 'barangay') return conversation.kind === 'barangay' && canReadPatient(viewer, patientProfile);
  return viewer.role === 'super' && conversation.kind === 'midwife' && conversation.assigned_provider_id === viewer.id;
}

/** Readings and messages made offline stay hidden from providers until they reach the server. */
export const isQueued = (record) => record.syncState === 'queued';

// ---------- The presenter gear (CLAUDE.md Section 5, PLAN.md Section 7) ----------

/**
 * Section 7 lists scenarios by screen and omits four appointment scenarios the run-through uses
 * (appointment-now, appointment-end, followup-close, event-reminder). They are placed with the patient and the super
 * account, who press them in the run-through (Section 9, steps 5 and 6).
 */
const CHECKS = [
  'check-normal',
  'check-adjust-belt',
  'check-rest',
  'check-no-band',
  'check-maternal-signal',
  'check-fhr-out-of-range',
  'check-signal-loss',
  'check-maternal-vitals',
];
const SOS = ['sos-pressed', 'sos-cancelled', 'sos-band-out-of-range'];
const APPOINTMENTS = ['appointment-now', 'appointment-end', 'followup-close', 'event-reminder'];
const SWITCHABLE = ['scenarios', 'devices', 'timing', 'connection', 'switch', 'reset'];

// expireSession: provider accounts get the gear action that shows the session-expired sheet (AUTH-08).
const GEAR_BY_ROLE = {
  // splash and sign-in: nothing is signed in
  none: { sections: ['reset'], groups: {}, devices: false, patientChooser: false, expireSession: false },
  patient: {
    sections: SWITCHABLE,
    groups: { checks: CHECKS, alerts: [...SOS, 'missed-check'], consult: APPOINTMENTS },
    devices: true,
    patientChooser: false,
    expireSession: false,
  },
  barangay: {
    sections: SWITCHABLE,
    groups: { checks: CHECKS, alerts: [...SOS, 'alert-unacknowledged'], consult: ['incoming-message'] },
    devices: true,
    patientChooser: true,
    expireSession: true,
  },
  super: {
    sections: SWITCHABLE,
    groups: {
      alerts: ['alert-unacknowledged'],
      consult: ['booking-request', 'referral', ...APPOINTMENTS, 'video-usage-80'],
    },
    devices: false,
    patientChooser: true,
    expireSession: true,
  },
};

/** What the gear panel offers a role (null when signed out): sections, scenario ids by group, devices, patient chooser. */
export function gearConfigFor(role) {
  return GEAR_BY_ROLE[role] ?? GEAR_BY_ROLE.none;
}

/** The accounts the gear can fill on the sign-in screen and switch to (PLAN.md Section 7, Sign in). */
export const PRESENTER_ACCOUNTS = [
  { id: 'maricel-dimaculangan', role: 'patient' },
  { id: 'shiela-marie-aguila', role: 'patient' },
  { id: 'cherry-mae-dalisay', role: 'patient' },
  { id: 'lourdes-magpantay', role: 'barangay' },
  { id: 'jocelyn-landicho', role: 'barangay' },
  { id: 'nora-marasigan', role: 'barangay' },
  { id: 'rowena-macaraig', role: 'super' },
  { id: 'cynthia-dimayuga', role: 'super' },
];

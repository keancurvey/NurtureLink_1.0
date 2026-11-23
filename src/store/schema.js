// The shape of the stored data (spec 6.1). Bump SCHEMA_VERSION when a table or field changes: a stored copy with
// another version is dropped and the seed is built again.
export const SCHEMA_VERSION = 3; // 2 (Prompt 5): every seeded account holds a push subscription; alerts may carry referred_by and referred_at. 3 (Prompt 6): the requests table

export const DB_NAME = 'nurturelink.v1';
export const SESSION_KEY = 'nurturelink.session';

/** Every entity of spec 6.1. Each row has an id (for profile-keyed tables the id is the profile id). */
export const TABLES = [
  'profiles',
  'barangays',
  'patients',
  'credentials', // the sign-in service's view of an account: password and first-login flag (spec 7.4, Auth)
  'consents',
  'guardian_consents',
  'pregnancies',
  'devices',
  'device_status_log',
  'check_sessions',
  'fetal_readings',
  'maternal_readings',
  'visit_notes',
  'alerts',
  'appointments',
  'requests', // what a patient asks of the office: a barangay change or a new time for an appointment (PLAN.md assumption 8)
  'events',
  'conversations',
  'messages',
  'notifications',
  'push_subscriptions',
  'hele_messages',
  'access_log',
  'export_log',
  'thresholds',
];

export const emptyDb = () => Object.fromEntries(TABLES.map((table) => [table, []]));

/** Notification types. The screens turn a type and its payload into text in the reader's language. */
export const NOTIFICATION_TYPES = [
  'alert', // to barangay and super accounts: payload { alert_id, alert_type, patient_id, escalated?, cancelled? }
  'alert_notice', // to the patient: contact your health worker or midwife (ALR-06); payload { alert_id?, alert_type, session_id?, local? }
  'battery_low', // to the patient: payload { serial, device, pct }
  'booking_request', // to super accounts
  'reschedule_request', // to super accounts and the appointment's provider (PAT-S-05): payload { request_id, appointment_id, patient_id }
  'barangay_change_request', // to super accounts (PAT-P-01): payload { request_id, patient_id }
  'appointment_approved',
  'appointment_reminder', // to the patient, one day and two hours before: payload { appointment_id, lead: 'day' | 'hours', kind }
  'appointment_started',
  'follow_up_open',
  'event_created',
  'event_reminder', // payload { event_id, lead? }
  'message',
  'referral', // to super accounts: payload { patient_id, reason, vitals, from_profile_id, alert_id? }
  'video_usage_warning', // to super accounts
];

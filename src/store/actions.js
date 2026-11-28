// The actions screens call. Each one waits a short, random time (250 to 700 ms) so loading, success and error states look
// like a real network, then does the work on the in-process server (core.js). Names follow the interfaces of spec 7.4.
// Replacing these with calls to a real backend is the only change needed to go live.
import { latency } from '../lib/latency.js';

export function createActions(runtime, { delay = latency } = {}) {
  const { core, auth, devices, alerts, profile, requests, consult, barangay, office } = runtime;
  const isSuper = () => runtime.store.getState().session && runtime.store.getState().db.profiles.find((p) => p.id === runtime.store.getState().session.profile_id)?.role === 'super';
  const slow = (fn) => async (...args) => {
    await delay();
    return fn(...args);
  };
  return {
    /** Edge function ingest_readings: batch insert of check sessions and readings with duplicate removal and alert rules. */
    ingest_readings: slow((batch) => core.ingestReadings(batch)),
    /** Edge function send_push: one notification per recipient. */
    send_push: slow(({ recipients, type, payload }) => core.sendPush(recipients, type, payload)),
    /** Upload what was made offline, oldest first. */
    flush_queue: slow(() => core.flushQueue()),
    // Auth (spec 7.4): each answers { ok: true, ... } or { ok: false, error, errors? } and never throws for a wrong entry.
    sign_in: slow((values) => auth.signIn(values)),
    sign_up: slow((values) => auth.signUp(values)),
    request_password_reset: slow((values) => auth.requestPasswordReset(values)),
    verify_reset_code: slow((values) => auth.verifyResetCode(values)),
    reset_password: slow((values) => auth.resetPassword(values)),
    change_password: slow((values) => auth.changePassword(values)),
    /** Records the acceptance of the terms and data privacy consent (version and time) for the signed-in account. */
    accept_consent: slow(() => auth.acceptConsent()),
    save_guardian_consent: slow((values) => auth.saveGuardianConsent(values)),
    /** Signing out and changing language answer at once, like a page that does not wait for the network. */
    sign_out: () => auth.signOut(),
    save_language: (language) => auth.saveLanguage(language),
    // Devices (spec 3.2, AUTH-07, PAT-H-02, PAT-H-03). Connecting and binding take a moment, like a real link and server;
    // starting a check and closing its result work on the phone and answer at once.
    /** Pairing wizard: connect to the chosen device and read its serial, model and firmware. */
    read_device: slow((serial) => devices.readInfo(serial)),
    /** Pairing wizard: bind the serial to the signed-in patient. Answers { ok, device } or { ok: false, error }. */
    pair_device: slow((serial) => devices.pair(serial)),
    /** Pairing wizard: let go of a device that was connected but not paired. */
    release_device: (serial) => devices.release(serial),
    /** The Connect button of a device row. */
    connect_device: slow((serial) => devices.connect(serial)),
    mark_pairing_seen: () => devices.markPairingSeen(),
    /** Check now: answers { started } or { started: false, reason, device? }. */
    start_check: () => devices.startCheck(),
    stop_check: () => devices.stopCheck(),
    dismiss_check: () => devices.dismissCheck(),
    // Alerts and notifications (spec 4.6, COM-03, COM-04). Acknowledging, resolving and referring reach the server, so they
    // take a moment; reading a notification and the push choice answer at once on the phone.
    /** The first account to acknowledge claims the alert: answers { ok, alert } or { ok: false, error, byName? }. */
    acknowledge_alert: slow((alertId) => alerts.acknowledge(alertId)),
    /** Resolve with an outcome note: { outcome }. */
    resolve_alert: slow((alertId, values) => alerts.resolve(alertId, values)),
    /** A barangay account refers the patient to the midwife: { reason }. */
    refer_alert: slow((alertId, values) => alerts.refer(alertId, values)),
    mark_read: (notificationId) => alerts.markRead(notificationId),
    mark_all_read: () => alerts.markAllRead(),
    allow_push: slow(() => alerts.allowPush()),
    decline_push: () => alerts.declinePush(),
    /** The patient's in-app SOS (after the 2 second hold): answers { ok, state: 'sent' | 'undelivered' }. */
    send_sos: slow(() => alerts.sendSos()),
    // Profile and Schedule (PAT-P-01 to PAT-P-05, PAT-S-05, PAT-A-06). Saving, asking the office and unpairing reach the server, so
    // they take a moment; the photo choice and the Hele switch answer at once on the phone.
    /** Contact number and emergency contact: { contact_no, emergency_name, emergency_relationship, emergency_no }. Answers { ok, queued } or { ok: false, error, errors }. */
    save_personal: slow((values) => profile.savePersonal(values)),
    /** { photo_url } (a small picture made on the phone), { avatar_art } (a drawn avatar) or nothing (the initials). */
    set_photo: (values) => profile.setPhoto(values),
    /** The Hele AI question-logging consent (PAT-A-06). */
    set_hele_logging: (on) => profile.setHeleLogging(on),
    /** A change of barangay, decided by a super account: { barangay_id, reason }. */
    request_barangay_change: slow((values) => requests.requestBarangayChange(values)),
    /** A new time for an upcoming appointment: { appointment_id, reason, preferred_date }. */
    request_reschedule: slow((values) => requests.requestReschedule(values)),
    /** Unpair a device from Profile: answers { ok } or { ok: false, error }. */
    unpair_device: slow((serial) => devices.unpair(serial)),
    /** Settings → Notifications off. */
    disable_push: () => alerts.disablePush(),
    // Consult (PAT-C-02, PAT-C-04, PAT-C-06). Sending and asking the office reach the server, so they take a moment; marking a
    // thread seen answers at once on the phone.
    /** Write to the barangay inbox or the midwife: { conversation_id, body, attachment_url | attachment_art, client_id }. Answers { ok, queued } or { ok: false, error, errors?, reason? }. */
    send_message: slow((values) => consult.sendMessage(values)),
    /** She has this thread open: what the other side wrote is seen. */
    mark_seen: (conversationId) => consult.markSeen(conversationId),
    /** A booking request: { type, preferred_date, window, reason }. Answers { ok, queued } or { ok: false, error, errors? }. */
    request_booking: slow((values) => requests.requestBooking(values)),
    // The barangay account (BRG-M-04 to BRG-M-06, BRG-K-01). Writing to the record reaches the server, so it takes a moment;
    // noting that a record was opened is quiet and answers at once.
    /** A patient record or her latest vitals was opened: written to the access log. */
    open_record: (patientId, action) => (isSuper() ? office : barangay).openRecord(patientId, action),
    /** LMP, EDD and risk notes of a patient: { lmp, edd, risk_notes }. Answers { ok } or { ok: false, error, errors? }. */
    save_clinical: slow((patientId, values) => barangay.saveClinical(patientId, values)),
    /** A visit note: { bp_systolic, bp_diastolic, weight_kg, note, shared }. */
    add_visit_note: slow((patientId, values) => barangay.addVisitNote(patientId, values)),
    /** Refer a patient to the midwife: { reason }. The latest vitals go with it. */
    refer_patient: slow((patientId, values) => barangay.refer(patientId, values)),
    /** Propose an appointment time: { type, preferred_date, window, reason }. */
    propose_appointment: slow((patientId, values) => barangay.proposeAppointment(patientId, values)),
    /** An event for the account's own barangay: { title, date, start, end }. */
    create_event: slow((values) => barangay.createEvent(values)),
    // The super account (SUP-T-03, SUP-C-01, SUP-S-01, SUP-P-01, ACC-05 to ACC-08). Decisions, events, the export and account changes reach the
    // server, so they take a moment.
    /** Approve a booking request: { date, time, provider_id }, the visit and the super account who becomes the assigned midwife. */
    approve_booking: slow((appointmentId, values) => office.approveBooking(appointmentId, values)),
    /** Give a booking request another time: { date, time, provider_id }. */
    reschedule_booking: slow((appointmentId, values) => office.rescheduleBooking(appointmentId, values)),
    /** Decline a booking request: { reason }. */
    decline_booking: slow((appointmentId, values) => office.declineBooking(appointmentId, values)),
    /** Approve a new time, a change of barangay or a time a barangay account proposed: { date, time, provider_id } where it needs them. */
    approve_request: slow((requestId, values) => office.approveRequest(requestId, values)),
    /** Decline one of those requests: { reason }. */
    decline_request: slow((requestId, values) => office.declineRequest(requestId, values)),
    /** An event for all barangays or one: { title, scope, barangay_id, date, start, end }. */
    create_office_event: slow((values) => office.createEvent(values)),
    /** Edge function export_patients: the rows of the filtered list, and an entry in the export log: { barangay_id, sort, omit_contacts }. */
    export_patients: slow((values) => office.exportPatients(values)),
    /** Edge function create_provider: a barangay or super account with a temporary password, shown once. */
    create_provider: slow((values) => office.createProvider(values)),
    reset_provider_password: slow((profileId) => office.resetProviderPassword(profileId)),
    update_provider_contact: slow((profileId, values) => office.updateProviderContact(profileId, values)),
    deactivate_provider: slow((profileId) => office.deactivateProvider(profileId)),
    /** Hand what a deactivated account left open to another account at the same level. */
    reassign_provider: slow((fromId, toId) => office.reassign(fromId, toId)),
    /** Gear: back to the starting records, signed out. */
    reset_data: slow(() => runtime.reset()),
  };
}

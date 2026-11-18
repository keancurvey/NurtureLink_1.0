// The actions screens call. Each one waits a short, random time (250 to 700 ms) so loading, success and error states look
// like a real network, then does the work on the in-process server (core.js). Names follow the interfaces of spec 7.4.
// Replacing these with calls to a real backend is the only change needed to go live.
import { latency } from '../lib/latency.js';

export function createActions(runtime, { delay = latency } = {}) {
  const { core, auth, devices } = runtime;
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
    /** Gear: back to the starting records, signed out. */
    reset_data: slow(() => runtime.reset()),
  };
}

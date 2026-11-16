// The actions screens call. Each one waits a short, random time (250 to 700 ms) so loading, success and error states look
// like a real network, then does the work on the in-process server (core.js). Names follow the interfaces of spec 7.4.
// Replacing these with calls to a real backend is the only change needed to go live.
import { latency } from '../lib/latency.js';

export function createActions(runtime, { delay = latency } = {}) {
  const { core } = runtime;
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
    /** Gear: back to the starting records, signed out. */
    reset_data: slow(() => runtime.reset()),
  };
}

// What a patient asks of the office (PAT-P-01, PAT-S-05): a change of barangay, and a new time for an appointment. Both
// are requests that a super account decides (PLAN.md assumption 8; the approvals screen is Prompt 9), kept in the
// requests table, which spec 6.1 does not list. A request made offline waits on the phone (syncState 'queued'), is hidden
// from providers and reaches them when the connection is back (core.flushQueue). Screens reach these through the wrappers
// in actions.js; replacing them with calls to a real backend is the only change needed to go live.
import { manilaDate } from '../lib/dates.js';
import { validateBarangayChange, validateReschedule } from '../lib/profileRules.js';
import { byId } from './ops.js';
import { viewerOf } from './selectors.js';

export function createRequests({ store, core, now = Date.now }) {
  const state = () => store.getState();
  const patient = () => {
    const viewer = viewerOf(state());
    return viewer?.active && viewer.role === 'patient' ? viewer : null;
  };
  const pending = (kind, patientId, appointmentId = null) =>
    state().db.requests.find((r) => r.kind === kind && r.patient_id === patientId && r.status === 'pending' && (appointmentId === null || r.appointment_id === appointmentId)) ?? null;

  /** Keep the request; tell the accounts it is for now, or when the connection is back. */
  function file(row) {
    const at = now();
    const online = core.isOnline();
    const request = { ...row, id: core.id('req'), status: 'pending', created_at: at, syncState: online ? 'synced' : 'queued', ...(online ? {} : { queued_at: at }), handled_by: null, handled_at: null, decline_reason: null };
    core.commit([{ op: 'insert', table: 'requests', row: request }]);
    if (online) core.deliverRequest(request);
    return { ok: true, queued: !online, request };
  }

  return {
    /**
     * A new time for one of her upcoming appointments. Needs a reason; the date she would like is optional. One open request
     * per appointment. Answers { ok, queued, request } or { ok: false, error, errors? } with error one of form,
     * not_found, not_upcoming, pending_exists.
     */
    requestReschedule({ appointment_id, reason, preferred_date = '' }) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      const appointment = byId(state().db.appointments).get(appointment_id);
      if (!appointment || appointment.patient_id !== me.id) return { ok: false, error: 'not_found' };
      if (appointment.status !== 'approved' || appointment.scheduled_at == null || appointment.scheduled_at <= now()) return { ok: false, error: 'not_upcoming' };
      if (pending('reschedule', me.id, appointment_id)) return { ok: false, error: 'pending_exists' };
      const errors = validateReschedule({ reason, preferred_date }, { today: manilaDate(now()) });
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      return file({ kind: 'reschedule', patient_id: me.id, appointment_id, preferred_date: preferred_date || null, reason: reason.trim() });
    },

    /**
     * A change of barangay (PAT-P-01): her barangay stays as it is until a super account approves. One open request at a
     * time. Answers like requestReschedule, with error one of form, pending_exists.
     */
    requestBarangayChange({ barangay_id, reason = '' }) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      if (pending('barangay_change', me.id)) return { ok: false, error: 'pending_exists' };
      const errors = validateBarangayChange({ barangay_id, reason }, { current: me.barangay_id, barangayIds: state().db.barangays.map((b) => b.id) });
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      return file({ kind: 'barangay_change', patient_id: me.id, from_barangay_id: me.barangay_id, to_barangay_id: barangay_id, reason: reason.trim() });
    },
  };
}

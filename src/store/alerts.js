// What an account does with alerts and notifications (spec 4.6, COM-03, COM-04, ACC-04): acknowledge (the first account
// claims it), resolve with an outcome note, refer to the midwife, mark notifications read, choose push notifications, and
// the patient's in-app SOS. Access follows spec 6.2: a barangay account acts on its own barangay's alerts, a super account
// on all. Screens reach these through the wrappers in actions.js; replacing them with calls to a real backend is the only
// change needed to go live.
import { OUTCOME_MAX, REASON_MAX, validateNote } from '../lib/alertView.js';
import { evaluateSos } from '../lib/alertRules.js';
import * as access from '../lib/permissions.js';
import { byId } from './ops.js';
import { profileOf, viewerOf } from './selectors.js';

export function createAlerts({ store, core, now = Date.now }) {
  const state = () => store.getState();
  const viewer = () => {
    const profile = viewerOf(state());
    return profile?.active ? profile : null;
  };
  const alertOf = (id) => byId(state().db.alerts).get(id) ?? null;
  /** The alert when this viewer may act on it, otherwise the reason she may not. */
  function actable(alertId) {
    const me = viewer();
    const alert = alertOf(alertId);
    if (!me || !alert) return { error: 'not_found' };
    if (!access.canAcknowledge(me, profileOf(state(), alert.patient_id))) return { error: 'not_allowed' };
    return { me, alert };
  }
  const nameOf = (id) => profileOf(state(), id)?.full_name ?? null;

  /** Raise the SOS of the app shortcut for a patient: the same alert the band button makes, marked as sent from the app. */
  function relayApp(patientId) {
    const band = state().db.devices.find((d) => d.patient_id === patientId && d.type === 'band');
    const candidate = evaluateSos({ pressed: true, seq: null, battery: band?.battery_pct ?? null });
    const raised = core.raiseAlert(patientId, { ...candidate, payload: { ...candidate.payload, source: 'app' } });
    store.dispatch({ type: 'live', patch: { sos: { patient_id: patientId, state: 'sent', seq: null, at: now(), source: 'app' } } });
    return { alert: raised.alert };
  }

  return {
    /**
     * Acknowledge (ALR-04): the first account to do it claims the alert. Another account that tries afterwards is told who
     * has it. Answers { ok, alert } or { ok: false, error, by }.
     */
    acknowledge(alertId) {
      const found = actable(alertId);
      if (found.error) return { ok: false, error: found.error };
      const { me, alert } = found;
      if (alert.status === 'resolved') return { ok: false, error: 'resolved' };
      if (alert.status === 'acknowledged') return { ok: false, error: 'already_acknowledged', by: alert.acknowledged_by, byName: nameOf(alert.acknowledged_by) };
      const at = now();
      const patch = { status: 'acknowledged', acknowledged_by: me.id, acknowledged_at: at };
      const mine = state().db.notifications.filter((n) => n.profile_id === me.id && n.payload?.alert_id === alertId && !n.read_at);
      core.commit([
        { op: 'update', table: 'alerts', id: alertId, patch },
        { op: 'updateMany', table: 'notifications', patches: mine.map((n) => ({ id: n.id, patch: { read_at: at } })) },
      ]);
      return { ok: true, alert: { ...alert, ...patch } };
    },

    /**
     * Resolve with an outcome note. Only the account that claimed the alert, or a super account, can close it.
     * Answers { ok, alert } or { ok: false, error } with error one of not_found, not_allowed, not_acknowledged,
     * not_yours, already_resolved, outcome_required, outcome_too_long.
     */
    resolve(alertId, { outcome } = {}) {
      const found = actable(alertId);
      if (found.error) return { ok: false, error: found.error };
      const { me, alert } = found;
      if (alert.status === 'resolved') return { ok: false, error: 'already_resolved' };
      if (alert.status !== 'acknowledged') return { ok: false, error: 'not_acknowledged' };
      if (alert.acknowledged_by !== me.id && me.role !== 'super') return { ok: false, error: 'not_yours', by: alert.acknowledged_by, byName: nameOf(alert.acknowledged_by) };
      const note = validateNote(outcome, OUTCOME_MAX);
      if (!note.ok) return { ok: false, error: note.error === 'required' ? 'outcome_required' : 'outcome_too_long' };
      const patch = { status: 'resolved', resolved_by: me.id, resolved_at: now(), outcome: note.value };
      core.commit([{ op: 'update', table: 'alerts', id: alertId, patch }]);
      return { ok: true, alert: { ...alert, ...patch } };
    },

    /**
     * A barangay account refers the patient to the midwife: every super account gets the reason and her latest vitals
     * (the referral inbox is Prompt 9). Needs the alert to be claimed by this account, and only once.
     */
    refer(alertId, { reason } = {}) {
      const found = actable(alertId);
      if (found.error) return { ok: false, error: found.error };
      const { me, alert } = found;
      if (me.role !== 'barangay') return { ok: false, error: 'not_allowed' };
      if (alert.status === 'resolved') return { ok: false, error: 'already_resolved' };
      if (alert.acknowledged_by !== me.id) return { ok: false, error: 'not_yours' };
      if (alert.referred_at) return { ok: false, error: 'already_referred', by: alert.referred_by, byName: nameOf(alert.referred_by) };
      const note = validateNote(reason, REASON_MAX);
      if (!note.ok) return { ok: false, error: note.error === 'required' ? 'reason_required' : 'reason_too_long' };
      const db = state().db;
      const last = db.check_sessions.filter((s) => s.patient_id === alert.patient_id && s.syncState === 'synced' && s.status === 'completed').sort((a, b) => b.started_at - a.started_at)[0];
      const supers = db.profiles.filter((p) => p.role === 'super' && p.active).map((p) => p.id);
      const at = now();
      core.sendPush(supers, 'referral', {
        patient_id: alert.patient_id,
        alert_id: alertId,
        reason: note.value,
        vitals: last ? { fhr_bpm: last.summary.fhr_bpm, hr_bpm: last.summary.hr_bpm, spo2_pct: last.summary.spo2_pct, skin_temp_c: last.summary.skin_temp_c, at: last.ended_at } : null,
        from_profile_id: me.id,
      });
      core.commit([{ op: 'update', table: 'alerts', id: alertId, patch: { referred_by: me.id, referred_at: at } }]);
      return { ok: true, told: supers.length };
    },

    // ---------- Notifications (COM-03) ----------

    markRead(notificationId) {
      const me = viewer();
      const row = byId(state().db.notifications).get(notificationId);
      if (!me || !row || row.profile_id !== me.id || row.read_at) return { ok: false };
      core.commit([{ op: 'update', table: 'notifications', id: row.id, patch: { read_at: now() } }]);
      return { ok: true };
    },

    markAllRead() {
      const me = viewer();
      if (!me) return { ok: false, count: 0 };
      const unread = state().db.notifications.filter((n) => n.profile_id === me.id && !n.read_at);
      const at = now();
      core.commit([{ op: 'updateMany', table: 'notifications', patches: unread.map((n) => ({ id: n.id, patch: { read_at: at } })) }]);
      return { ok: true, count: unread.length };
    },

    // ---------- Push permission (COM-04): an in-app screen, never the browser's prompt ----------

    /** Allow: the account gets a push subscription for this phone. */
    allowPush() {
      const me = viewer();
      if (!me) return { ok: false };
      const at = now();
      const ops = [{ op: 'update', table: 'profiles', id: me.id, patch: { push_declined_at: null } }];
      if (!state().db.push_subscriptions.some((s) => s.profile_id === me.id)) {
        ops.push({
          op: 'insert',
          table: 'push_subscriptions',
          row: { id: core.id('psh'), profile_id: me.id, endpoint: `https://push.nurturelink.ph/s/${me.id}`, keys: { p256dh: `p256dh-${me.id}`, auth: `auth-${me.id}` }, created_at: at },
        });
      }
      core.commit(ops);
      return { ok: true };
    },

    /** Not now: in-app notifications carry on and a reminder shows. */
    declinePush() {
      const me = viewer();
      if (!me) return { ok: false };
      core.commit([{ op: 'update', table: 'profiles', id: me.id, patch: { push_declined_at: now() } }]);
      return { ok: true };
    },

    // ---------- The patient's own SOS shortcut (assumption 9) ----------

    /**
     * The in-app SOS sends the same alert as the band button. Online it is raised at once; offline it waits on the phone
     * ({ state: 'undelivered' }) and goes out when the connection is back (relayPending).
     */
    sendSos() {
      const me = viewer();
      if (!me || me.role !== 'patient') return { ok: false, error: 'not_allowed' };
      if (!core.isOnline()) {
        store.dispatch({ type: 'live', patch: { sos: { patient_id: me.id, state: 'undelivered', seq: null, source: 'app' } } });
        return { ok: true, state: 'undelivered' };
      }
      return { ok: true, state: 'sent', ...relayApp(me.id) };
    },

    /** The connection is back: an SOS that waited on the phone goes out. */
    relayPending() {
      const sos = state().live.sos;
      if (sos?.source === 'app' && sos.state === 'undelivered' && core.isOnline()) return relayApp(sos.patient_id);
      return null;
    },
  };
}

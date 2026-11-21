import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import * as sel from '../src/store/selectors.js';
import { alertFacts, alertTimeline, validateNote } from '../src/lib/alertView.js';
import { describeNotification, notificationPath, stackBanners, unreadCount, signalKind } from '../src/lib/notifications.js';
import { createAlertSignals } from '../src/lib/alertSignals.js';
import { MS_MINUTE } from '../src/lib/dates.js';

const LOURDES = 'lourdes-magpantay';
const JOCELYN = 'jocelyn-landicho';
const ROWENA = 'rowena-macaraig';
const CYNTHIA = 'cynthia-dimayuga';
const FHR = { type: 'fhr_out_of_range', severity: 'critical', payload: { direction: 'low', sustained_seconds: 36, extreme_bpm: 101 } };

const as = (rt, id) => {
  rt.auth.signInAs(id);
  return rt;
};
const raise = (rt, patient = MARICEL, candidate = FHR) => rt.core.raiseAlert(patient, candidate).alert;

// ---------- Claiming, resolving, referring (ALR-04, ACC-04) ----------

test('the first account to acknowledge claims the alert; the next one is told who has it', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  as(rt, LOURDES);
  const first = rt.alerts.acknowledge(alert.id);
  assert.equal(first.ok, true);
  const stored = rt.db().alerts.find((a) => a.id === alert.id);
  assert.deepEqual([stored.status, stored.acknowledged_by, stored.acknowledged_at], ['acknowledged', LOURDES, NOW]);
  as(rt, JOCELYN);
  const second = rt.alerts.acknowledge(alert.id);
  assert.deepEqual([second.ok, second.error, second.byName], [false, 'already_acknowledged', 'Lourdes Magpantay']);
  assert.equal(rt.db().alerts.find((a) => a.id === alert.id).acknowledged_by, LOURDES, 'the claim did not move');
});

test('acknowledging marks her own notification of that alert as read and leaves the others unread', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  as(rt, LOURDES);
  rt.alerts.acknowledge(alert.id);
  const mine = rt.inbox(LOURDES).find((n) => n.payload.alert_id === alert.id);
  const hers = rt.inbox(JOCELYN).find((n) => n.payload.alert_id === alert.id);
  assert.notEqual(mine.read_at, null);
  assert.equal(hers.read_at, null);
});

test('access: a barangay account acts only on its own barangay, a patient never, a super account on any', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  const otherBarangay = raise(rt, 'jenny-rose-villanueva', { ...FHR, type: 'signal_loss', severity: 'warning', payload: { consecutive_checks: 3 } });
  as(rt, 'nora-marasigan'); // San Isidro
  assert.equal(rt.alerts.acknowledge(alert.id).error, 'not_allowed');
  as(rt, MARICEL);
  assert.equal(rt.alerts.acknowledge(alert.id).error, 'not_allowed');
  assert.equal(rt.alerts.resolve(alert.id, { outcome: 'ok' }).error, 'not_allowed');
  as(rt, ROWENA);
  assert.equal(rt.alerts.acknowledge(otherBarangay.id).ok, true);
  assert.equal(rt.alerts.acknowledge('alt_missing').error, 'not_found');
  rt.auth.signOut();
  assert.equal(rt.alerts.acknowledge(alert.id).error, 'not_found', 'nobody signed in');
});

test('resolve needs a claim, an outcome note, and the claimer or a super account', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  as(rt, LOURDES);
  assert.equal(rt.alerts.resolve(alert.id, { outcome: 'Called her' }).error, 'not_acknowledged');
  rt.alerts.acknowledge(alert.id);
  assert.equal(rt.alerts.resolve(alert.id, { outcome: '   ' }).error, 'outcome_required');
  assert.equal(rt.alerts.resolve(alert.id, { outcome: 'x'.repeat(501) }).error, 'outcome_too_long');
  as(rt, JOCELYN);
  const refused = rt.alerts.resolve(alert.id, { outcome: 'Took over' });
  assert.deepEqual([refused.error, refused.byName], ['not_yours', 'Lourdes Magpantay']);
  rt.advanceClock(5 * MS_MINUTE);
  as(rt, LOURDES);
  const done = rt.alerts.resolve(alert.id, { outcome: '  Visited the house; baby moving well.  ' });
  assert.equal(done.ok, true);
  const stored = rt.db().alerts.find((a) => a.id === alert.id);
  assert.deepEqual([stored.status, stored.resolved_by, stored.resolved_at, stored.outcome], ['resolved', LOURDES, NOW + 5 * MS_MINUTE, 'Visited the house; baby moving well.']);
  assert.equal(rt.alerts.resolve(alert.id, { outcome: 'again' }).error, 'already_resolved');
  assert.equal(rt.alerts.acknowledge(alert.id).error, 'resolved');
});

test('a super account can close an alert a barangay account claimed', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  as(rt, LOURDES);
  rt.alerts.acknowledge(alert.id);
  as(rt, ROWENA);
  assert.equal(rt.alerts.resolve(alert.id, { outcome: 'Midwife called the patient.' }).ok, true);
  assert.equal(rt.db().alerts.find((a) => a.id === alert.id).resolved_by, ROWENA);
});

test('refer: the claiming barangay account sends the reason and her latest vitals to every super account, once', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  as(rt, LOURDES);
  assert.equal(rt.alerts.refer(alert.id, { reason: 'Please advise' }).error, 'not_yours', 'claim it first');
  rt.alerts.acknowledge(alert.id);
  assert.equal(rt.alerts.refer(alert.id, { reason: '' }).error, 'reason_required');
  assert.equal(rt.alerts.refer(alert.id, { reason: 'x'.repeat(281) }).error, 'reason_too_long');
  const sent = rt.alerts.refer(alert.id, { reason: 'Baby heart rate low twice today' });
  assert.deepEqual([sent.ok, sent.told], [true, 2]);
  for (const id of [ROWENA, CYNTHIA]) {
    const referral = rt.inbox(id).find((n) => n.type === 'referral' && n.payload.alert_id === alert.id);
    assert.equal(referral.payload.reason, 'Baby heart rate low twice today');
    assert.equal(referral.payload.from_profile_id, LOURDES);
    assert.equal(referral.payload.patient_id, MARICEL);
    assert.ok(referral.payload.vitals.fhr_bpm > 0, 'her latest check goes with it');
  }
  const stored = rt.db().alerts.find((a) => a.id === alert.id);
  assert.deepEqual([stored.referred_by, stored.referred_at], [LOURDES, NOW]);
  assert.equal(rt.alerts.refer(alert.id, { reason: 'again' }).error, 'already_referred');
  as(rt, ROWENA);
  assert.equal(rt.alerts.refer(alert.id, { reason: 'self' }).error, 'not_allowed', 'a super account has no one to refer to');
});

// ---------- Delivery (ALR-03, ACC-04, ACC-09) ----------

test('an alert reaches every active account of the barangay, and a barangay with none goes to the super accounts', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  const told = rt.db().notifications.filter((n) => n.type === 'alert' && n.payload.alert_id === alert.id).map((n) => n.profile_id).sort();
  assert.deepEqual(told, [JOCELYN, LOURDES], 'both accounts of Barangay 14, no super account for an ordinary alert');
  rt.core.commit([LOURDES, JOCELYN].map((id) => ({ op: 'update', table: 'profiles', id, patch: { active: false } })));
  const next = raise(rt, 'rosalinda-ramos', { ...FHR, type: 'maternal_vitals', payload: { metrics: [{ metric: 'spo2', value: 92, direction: 'low' }] } });
  const routed = rt.db().notifications.filter((n) => n.type === 'alert' && n.payload.alert_id === next.id).map((n) => n.profile_id).sort();
  assert.deepEqual(routed, [CYNTHIA, ROWENA]);
});

test('every alert gives the patient one notice, and a duplicate gives none', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  raise(rt);
  const notices = rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice' && n.payload.alert_id === alert.id);
  assert.equal(notices.length, 1);
  assert.equal(rt.db().alerts.find((a) => a.id === alert.id).merged_count, 1);
});

// ---------- The phone's own rules (ALR-02) ----------

function runCheck(rt, scenario, patientId = MARICEL, extra = {}) {
  rt.engine.start(scenario, { patientId, actorId: patientId, actorRole: 'patient', ...extra });
  for (let i = 0; i < 400 && rt.engine.isRunning(); i += 1) rt.sched.advance(1000);
}

test('a check that crosses a rule gives the patient her notice on the phone, even offline, and the server later attaches the alert to it', () => {
  const rt = makeRuntime();
  rt.setConnection('offline');
  runCheck(rt, 'check-fhr-out-of-range');
  const local = rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice' && n.payload.local === true);
  assert.equal(local.length, 1, 'her notice is there at once');
  assert.equal(local[0].payload.alert_id, undefined);
  assert.equal(rt.db().alerts.filter((a) => a.patient_id === MARICEL).length, 0, 'no alert and no provider notice while offline');
  assert.equal(rt.inbox(LOURDES).filter((n) => n.payload.patient_id === MARICEL && n.type === 'alert').length, 0);
  rt.setConnection('online');
  const alerts = rt.db().alerts.filter((a) => a.patient_id === MARICEL);
  assert.equal(alerts.length, 1, 'the server path raised it when the data arrived');
  const notices = rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice');
  assert.equal(notices.length, 1, 'still one notice');
  assert.equal(notices[0].id, local[0].id);
  assert.equal(notices[0].payload.alert_id, alerts[0].id);
  assert.equal(rt.inbox(LOURDES).filter((n) => n.type === 'alert' && n.payload.alert_id === alerts[0].id).length, 1);
});

test('online, the same check gives her one notice too, and a normal check gives none', () => {
  const rt = makeRuntime();
  runCheck(rt, 'check-normal');
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice').length, 0);
  runCheck(rt, 'check-fhr-out-of-range');
  const notices = rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice');
  assert.equal(notices.length, 1);
  assert.ok(notices[0].payload.alert_id);
});

test('a kind she already has open makes no second notice from the phone', () => {
  const rt = makeRuntime();
  runCheck(rt, 'check-fhr-out-of-range');
  runCheck(rt, 'check-fhr-out-of-range');
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice').length, 1);
  assert.equal(rt.db().alerts.filter((a) => a.patient_id === MARICEL)[0].merged_count, 1);
});

// ---------- Escalation (ALR-05) ----------

test('the sweep escalates an unacknowledged alert at the escalation time, once, to all super accounts', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  assert.equal(rt.core.sweepEscalations(), 0);
  rt.advanceClock(59 * 1000);
  assert.equal(rt.core.sweepEscalations(), 0, 'Quick timing is 60 seconds');
  rt.advanceClock(1000);
  assert.equal(rt.core.sweepEscalations(), 1);
  assert.equal(rt.core.sweepEscalations(), 0, 'only once');
  const supers = rt.db().notifications.filter((n) => n.payload.alert_id === alert.id && n.payload.escalated === true).map((n) => n.profile_id).sort();
  assert.deepEqual(supers, [CYNTHIA, ROWENA]);
  assert.equal(rt.db().alerts.find((a) => a.id === alert.id).escalated_at, NOW + 60000);
});

test('Realistic timing waits five minutes, and an acknowledged alert is never escalated', () => {
  const rt = makeRuntime();
  rt.setTiming('realistic');
  const waiting = raise(rt);
  const claimed = raise(rt, 'rosalinda-ramos');
  as(rt, JOCELYN);
  rt.alerts.acknowledge(claimed.id);
  rt.advanceClock(4 * MS_MINUTE);
  assert.equal(rt.core.sweepEscalations(), 0);
  rt.advanceClock(MS_MINUTE);
  assert.equal(rt.core.sweepEscalations(), 1);
  assert.ok(rt.db().alerts.find((a) => a.id === waiting.id).escalated_at);
  assert.equal(rt.db().alerts.find((a) => a.id === claimed.id).escalated_at, null);
});

test('the sweep leaves the alerts the seed made as history alone, and never touches a resolved or cancelled one', () => {
  const rt = makeRuntime();
  const seededNew = rt.db().alerts.find((a) => a.status === 'new');
  assert.ok(seededNew, 'the seeded new alert (Jenny Rose)');
  rt.advanceClock(60 * MS_MINUTE);
  assert.equal(rt.core.sweepEscalations(), 0);
  assert.equal(rt.db().alerts.find((a) => a.id === seededNew.id).escalated_at, null);
});

test('the unacknowledged scenario reports an escalation the sweep already made', () => {
  const rt = makeRuntime();
  rt.setTiming('quick');
  rt.engine.start('alert-unacknowledged', { patientId: MARICEL, actorId: LOURDES, actorRole: 'barangay' });
  rt.advanceClock(61000);
  rt.core.sweepEscalations(); // the sweep got there first
  rt.sched.flush();
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.escalated');
});

// ---------- SOS (Section 6, assumption 9) ----------

test('the in-app SOS raises the same alert as the band: barangay accounts and both super accounts, the patient told', () => {
  const rt = as(makeRuntime(), MARICEL);
  const result = rt.alerts.sendSos();
  assert.deepEqual([result.ok, result.state], [true, 'sent']);
  const alert = rt.db().alerts.find((a) => a.type === 'sos' && a.patient_id === MARICEL);
  assert.equal(alert.payload.source, 'app');
  const told = rt.db().notifications.filter((n) => n.type === 'alert' && n.payload.alert_id === alert.id).map((n) => n.profile_id).sort();
  assert.deepEqual(told, [CYNTHIA, JOCELYN, LOURDES, ROWENA]);
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice' && n.payload.alert_id === alert.id).length, 1);
  assert.equal(rt.state().live.sos.state, 'sent');
  assert.equal(rt.alerts.sendSos().ok, true);
  assert.equal(rt.db().alerts.filter((a) => a.type === 'sos' && a.patient_id === MARICEL).length, 1, 'a second press merges');
});

test('offline the in-app SOS waits on the phone and goes out when the connection is back', () => {
  const rt = as(makeRuntime(), MARICEL);
  rt.setConnection('offline');
  assert.equal(rt.alerts.sendSos().state, 'undelivered');
  assert.equal(rt.state().live.sos.state, 'undelivered');
  assert.equal(rt.db().alerts.filter((a) => a.type === 'sos' && a.patient_id === MARICEL).length, 0);
  rt.setConnection('online');
  assert.equal(rt.db().alerts.filter((a) => a.type === 'sos' && a.patient_id === MARICEL).length, 1);
  assert.equal(rt.state().live.sos.state, 'sent');
});

test('only a patient can send an SOS from the app', () => {
  const rt = as(makeRuntime(), LOURDES);
  assert.equal(rt.alerts.sendSos().ok, false);
});

test('SOS: band out of range tells the patient it was not delivered, then the stored SOS is relayed on reconnect', () => {
  const rt = as(makeRuntime(), MARICEL);
  rt.engine.start('sos-band-out-of-range', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  rt.sched.advance(1500);
  assert.equal(rt.state().live.sos.state, 'undelivered');
  assert.equal(rt.db().alerts.filter((a) => a.type === 'sos' && a.patient_id === MARICEL).length, 0);
  for (let i = 0; i < 40 && rt.engine.isRunning(); i += 1) rt.sched.advance(1000);
  assert.equal(rt.db().alerts.filter((a) => a.type === 'sos' && a.patient_id === MARICEL).length, 1);
  assert.equal(rt.state().live.sos.state, 'sent');
});

// ---------- Notifications and the push choice (COM-03, COM-04) ----------

test('mark one and mark all: only the viewer\'s own notifications, newest first in the selector', () => {
  const rt = as(makeRuntime(), MARICEL);
  const [a, b] = rt.inbox(MARICEL);
  rt.core.commit(rt.inbox(MARICEL).map((n) => ({ op: 'update', table: 'notifications', id: n.id, patch: { read_at: null } })));
  assert.equal(rt.alerts.markRead(a.id).ok, true);
  assert.equal(rt.alerts.markRead(a.id).ok, false, 'already read');
  assert.equal(sel.unreadCountOf(rt.state(), sel.viewerOf(rt.state())), rt.inbox(MARICEL).length - 1);
  const others = rt.inbox(LOURDES).map((n) => n.read_at);
  assert.equal(rt.alerts.markRead(rt.inbox(LOURDES)[0].id).ok, false, 'not hers');
  assert.equal(rt.alerts.markAllRead().count, rt.inbox(MARICEL).length - 1);
  assert.equal(sel.unreadCountOf(rt.state(), sel.viewerOf(rt.state())), 0);
  assert.deepEqual(rt.inbox(LOURDES).map((n) => n.read_at), others, 'nobody else\'s changed');
  const list = sel.notificationsOf(rt.state(), sel.viewerOf(rt.state()));
  assert.deepEqual(list.map((n) => n.created_at), [...list.map((n) => n.created_at)].sort((x, y) => y - x));
  assert.ok(b);
});

test('the bell counts exactly the unread notifications of the account', () => {
  const rt = makeRuntime();
  assert.equal(unreadCount(rt.db().notifications, LOURDES), rt.inbox(LOURDES).filter((n) => !n.read_at).length);
  assert.ok(unreadCount(rt.db().notifications, LOURDES) >= 1, 'a real count at the start');
});

test('push choice: seeded accounts have chosen; a new account is asked; Not now shows a reminder state; Allow subscribes', () => {
  const rt = makeRuntime();
  for (const p of rt.db().profiles) assert.equal(sel.pushStateOf(rt.state(), p.id), 'allowed', p.id);
  rt.core.commit([{ op: 'insert', table: 'profiles', row: { ...rt.db().profiles[0], id: 'pro_x', role: 'patient' } }]);
  assert.equal(sel.pushStateOf(rt.state(), 'pro_x'), 'unset');
  rt.setSession({ profile_id: 'pro_x', signed_in_at: NOW, last_active_at: NOW });
  rt.alerts.declinePush();
  assert.equal(sel.pushStateOf(rt.state(), 'pro_x'), 'declined');
  assert.equal(rt.db().push_subscriptions.filter((s) => s.profile_id === 'pro_x').length, 0);
  rt.alerts.allowPush();
  rt.alerts.allowPush();
  assert.equal(sel.pushStateOf(rt.state(), 'pro_x'), 'allowed');
  assert.equal(rt.db().push_subscriptions.filter((s) => s.profile_id === 'pro_x').length, 1, 'one subscription');
});

// ---------- Access in the selectors ----------

test('alertById follows the access rules; open alerts leave out the resolved ones', () => {
  const rt = makeRuntime();
  const alert = raise(rt);
  const view = (id) => sel.viewerOf({ ...rt.state(), session: { profile_id: id } });
  assert.equal(sel.alertById(rt.state(), view(MARICEL), alert.id)?.id, alert.id);
  assert.equal(sel.alertById(rt.state(), view(LOURDES), alert.id)?.id, alert.id);
  assert.equal(sel.alertById(rt.state(), view('nora-marasigan'), alert.id), null);
  assert.equal(sel.alertById(rt.state(), view('rosalinda-ramos'), alert.id), null, 'another patient');
  assert.equal(sel.alertById(rt.state(), null, alert.id), null);
  const open = sel.openAlertsOf(rt.state(), view(ROWENA));
  assert.ok(open.every((a) => a.status !== 'resolved'));
  assert.ok(open.some((a) => a.id === alert.id));
});

// ---------- Pure helpers ----------

test('notifications open the screen they are about, for each role', () => {
  const n = (type, payload = {}) => ({ type, payload, read_at: null });
  assert.equal(notificationPath('patient', n('alert_notice', { alert_id: 'a1' })), '/alerts/a1');
  assert.equal(notificationPath('barangay', n('alert', { alert_id: 'a2' })), '/alerts/a2');
  assert.equal(notificationPath('patient', n('alert_notice', { alert_type: 'sos' })), '/patient/home', 'a phone notice before the alert exists');
  assert.equal(notificationPath('patient', n('battery_low')), '/patient/home');
  assert.equal(notificationPath('super', n('booking_request')), '/super/consult');
  assert.equal(notificationPath('super', n('referral')), '/super/consult');
  assert.equal(notificationPath('barangay', n('message')), '/barangay/chat');
  assert.equal(notificationPath('patient', n('message')), '/patient/consult');
  assert.equal(notificationPath('patient', n('appointment_approved')), '/patient/schedule');
  assert.equal(notificationPath('barangay', n('event_created')), '/barangay/calendar');
  assert.equal(notificationPath('super', n('event_reminder')), '/super/schedule');
  assert.equal(notificationPath('super', n('video_usage_warning')), '/super/profile');
});

test('every notification type has a text and every path stays inside the role\'s tabs', () => {
  const tabs = { patient: ['home', 'schedule', 'consult', 'hele', 'profile'], barangay: ['monitor', 'chat', 'calendar', 'profile'], super: ['tracker', 'consult', 'schedule', 'profile'] };
  const types = ['alert', 'alert_notice', 'battery_low', 'booking_request', 'appointment_approved', 'appointment_started', 'follow_up_open', 'event_created', 'event_reminder', 'message', 'referral', 'video_usage_warning'];
  for (const role of Object.keys(tabs)) {
    for (const type of types) {
      const view = describeNotification({ type, payload: { alert_id: 'a1', alert_type: 'sos', device: 'band', pct: 8, used: 8000, limit: 10000 }, read_at: null }, { role, patientName: 'Maricel Dimaculangan' });
      assert.ok(view.titleKey.startsWith('notification.'), `${role} ${type}`);
      assert.ok(view.path.startsWith('/alerts/') || tabs[role].some((t) => view.path === `/${role}/${t}`), `${role} ${type}: ${view.path}`);
    }
  }
});

test('the patient\'s notice never uses the technical wording and tells her to contact her provider', () => {
  const patient = describeNotification({ type: 'alert_notice', payload: { alert_type: 'fhr_out_of_range' }, read_at: null }, { role: 'patient' });
  assert.equal(patient.values.typeKey, 'type.fhr_out_of_range.patient');
  assert.equal(patient.bodyKey, 'notification.alert_notice_body');
  const provider = describeNotification({ type: 'alert', payload: { alert_type: 'fhr_out_of_range', escalated: true }, read_at: null }, { role: 'super', patientName: 'Maricel Dimaculangan' });
  assert.equal(provider.values.typeKey, 'type.fhr_out_of_range.provider');
  assert.equal(provider.titleKey, 'notification.alert.escalated');
  assert.equal(provider.tone, 'alert');
});

test('alert facts and the timeline carry the numbers, the names and the order of events', () => {
  assert.deepEqual(alertFacts(FHR).map((f) => [f.key, f.values.limit, f.values.seconds, f.values.bpm]), [['fact.fhr_low', 110, 36, 101]]);
  assert.equal(alertFacts({ type: 'fhr_out_of_range', payload: { direction: 'high', sustained_seconds: 32, extreme_bpm: 171 } })[0].key, 'fact.fhr_high');
  assert.deepEqual(alertFacts({ type: 'maternal_vitals', payload: { metrics: [{ metric: 'spo2', value: 92 }, { metric: 'heart_rate', value: 118, direction: 'high' }, { metric: 'skin_temperature', value: 38.4 }] } }).map((f) => f.key), ['fact.spo2', 'fact.heart_rate_high', 'fact.skin_temperature']);
  assert.equal(alertFacts({ type: 'sos', payload: { source: 'app' } })[0].key, 'fact.sos_app');
  assert.equal(alertFacts({ type: 'battery_critical', payload: { device: 'band', pct: 8 } })[0].key, 'fact.battery_band');
  const timeline = alertTimeline({ created_at: 1, last_seen_at: 9, merged_count: 2, escalated_at: 5, acknowledged_at: 6, acknowledged_by: 'x', referred_at: 7, referred_by: 'x', status: 'resolved', resolved_at: 8, resolved_by: 'y' });
  assert.deepEqual(timeline.map((s) => s.key), ['raised', 'escalated', 'acknowledged', 'referred', 'resolved', 'merged']);
  assert.equal(alertTimeline({ created_at: 1, status: 'resolved', cancelled_at: 3, resolved_by: 'p' }).at(-1).key, 'cancelled');
  assert.deepEqual(validateNote(' a ', 10), { ok: false, error: 'required' });
  assert.deepEqual(validateNote(' ok ', 10), { ok: true, value: 'ok' });
});

test('banners stack newest first and fold the older ones into one group', () => {
  const banner = (id, expiresAt = 100) => ({ id, expiresAt });
  assert.deepEqual(stackBanners([banner('a'), banner('b')]).map((b) => b.id), ['a', 'b']);
  const folded = stackBanners([banner('a'), banner('b'), banner('c', 300), banner('d', 200), banner('e')], 3);
  assert.deepEqual(folded.map((b) => b.id), ['a', 'b', 'group']);
  assert.deepEqual([folded[2].group, folded[2].count, folded[2].expiresAt], [true, 3, 300]);
  const again = stackBanners([banner('n'), folded[0], folded[1], folded[2]], 3);
  assert.equal(again.at(-1).count, 4, 'a group already folded keeps its count');
});

test('sound and vibration: both for alerts and SOS, nothing before the person has used the page, nothing where unsupported', () => {
  const log = [];
  const node = (name) => ({ type: '', frequency: { value: 0 }, gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start: () => log.push(`${name}.start`), stop() {} });
  class FakeAudio {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; log.push('context'); }
    createOscillator() { return node('osc'); }
    createGain() { return node('gain'); }
  }
  const nav = { userActivation: { hasBeenActive: true }, vibrate: (pattern) => { log.push(`vibrate ${pattern.length}`); return true; } };
  const signals = createAlertSignals({ AudioContext: FakeAudio, navigator: nav });
  assert.deepEqual(signals.play('alert'), { sound: true, vibration: true });
  assert.deepEqual(log.filter((x) => x.startsWith('vibrate')), ['vibrate 3']);
  assert.equal(log.filter((x) => x === 'osc.start').length, 2);
  assert.equal(log.filter((x) => x === 'context').length, 1);
  signals.play('sos');
  assert.equal(log.filter((x) => x === 'osc.start').length, 5, 'three more tones for an SOS');
  assert.equal(log.filter((x) => x === 'context').length, 1, 'one audio context is reused');
  assert.deepEqual(log.filter((x) => x.startsWith('vibrate')), ['vibrate 3', 'vibrate 5']);

  const idle = createAlertSignals({ AudioContext: FakeAudio, navigator: { ...nav, userActivation: { hasBeenActive: false } } });
  assert.deepEqual(idle.play('alert'), { sound: false, vibration: false });
  assert.deepEqual(createAlertSignals({ AudioContext: undefined, navigator: {} }).play('alert'), { sound: false, vibration: false });
  assert.deepEqual(createAlertSignals({ AudioContext: class { constructor() { throw new Error('blocked'); } }, navigator: nav }).play('alert').sound, false);
  assert.equal(signals.play('nothing').sound, false);
});

test('only alert notifications make a sound, and an SOS makes the long one', () => {
  assert.equal(signalKind({ type: 'message', payload: {} }), null);
  assert.equal(signalKind({ type: 'alert_notice', payload: { alert_type: 'fhr_out_of_range' } }), 'alert');
  assert.equal(signalKind({ type: 'alert', payload: { alert_type: 'sos' } }), 'sos');
});

test('start() sweeps at once and then every second, and the stop function ends it', async () => {
  const { createRuntime, buildState } = await import('../src/store/runtime.js');
  let clock = NOW;
  const repeats = [];
  const cleared = [];
  const rt = createRuntime({
    state: buildState({ now: NOW }),
    now: () => clock,
    setTimer: () => 0,
    clearTimer: () => {},
    setRepeat: (fn, ms) => { repeats.push({ fn, ms }); return repeats.length; },
    clearRepeat: (handle) => cleared.push(handle),
  });
  const alert = rt.core.raiseAlert(MARICEL, FHR).alert;
  const stop = rt.start();
  assert.deepEqual(repeats.map((r) => r.ms).sort((a, b) => a - b), [1000, 30000], 'the sweep every second, the devices\' heartbeat every 30 s');
  clock += 61000;
  repeats.find((r) => r.ms === 1000).fn();
  assert.ok(rt.store.getState().db.alerts.find((a) => a.id === alert.id).escalated_at, 'the timer\'s tick escalated it');
  stop();
  assert.equal(cleared.length, 2);
});

// ---------- Every alert scenario of Section 6 reaches the right accounts ----------

const ALERT_SCENARIOS = {
  'check-fhr-out-of-range': { type: 'fhr_out_of_range', supers: false },
  'check-maternal-vitals': { type: 'maternal_vitals', supers: false },
  'check-signal-loss': { type: 'signal_loss', supers: false },
  'sos-pressed': { type: 'sos', supers: true },
  'sos-cancelled': { type: 'sos', supers: true },
  'sos-band-out-of-range': { type: 'sos', supers: true },
  'alert-unacknowledged': { type: null, supers: true },
  'missed-check': { type: 'missed_check', supers: false },
  'device-battery': { type: 'battery_critical', supers: false },
};

for (const [scenario, expect] of Object.entries(ALERT_SCENARIOS)) {
  test(`scenario ${scenario}: the patient gets one plain notice and the right accounts are told`, () => {
    const rt = makeRuntime();
    const before = new Set(rt.db().alerts.map((a) => a.id));
    runCheck(rt, scenario, MARICEL, scenario === 'device-battery' ? { device: 'belt', pct: 8 } : {});
    rt.advanceClock(61000);
    rt.core.sweepEscalations(); // the sweep runs on its own timer in the app
    const made = rt.db().alerts.filter((a) => !before.has(a.id) && a.patient_id === MARICEL);
    const alert = made.find((a) => expect.type === null || a.type === expect.type);
    assert.ok(alert, `${scenario} made an alert`);
    const told = (id) => rt.db().notifications.some((n) => n.type === 'alert' && n.profile_id === id && n.payload.alert_id === alert.id);
    // The patient: one notice, plain wording, tied to the alert.
    const notices = rt.inbox(MARICEL).filter((n) => n.type === 'alert_notice' && n.payload.alert_id === alert.id);
    assert.equal(notices.length, 1, 'one notice');
    // Her barangay's active accounts, and no other barangay.
    assert.ok(told(LOURDES) && told(JOCELYN), 'both accounts of Barangay 14');
    assert.ok(!told('nora-marasigan'), 'not another barangay');
    // The super accounts: SOS and escalated alerts only.
    const escalated = Boolean(alert.escalated_at);
    assert.equal(told(ROWENA) && told(CYNTHIA), expect.supers || escalated, `super accounts for ${scenario}`);
    if (!expect.supers && !escalated) assert.ok(!told(ROWENA) && !told(CYNTHIA));
    // They can all open it, and no one else can.
    const state = rt.state();
    const who = (id) => sel.viewerOf({ ...state, session: { profile_id: id } });
    for (const id of [MARICEL, LOURDES, JOCELYN, ROWENA, CYNTHIA]) assert.ok(sel.alertById(state, who(id), alert.id), `${id} can open it`);
    assert.equal(sel.alertById(state, who('nora-marasigan'), alert.id), null);
  });
}

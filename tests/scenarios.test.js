import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { createSeed } from '../src/sim/seed.js';
import { snapshotOf } from '../src/store/store.js';
import { MS_DAY, MS_HOUR, manilaDate, addDays } from '../src/lib/dates.js';
import { evaluateMissedCheck } from '../src/lib/alertRules.js';

const SECOND = 1000;
const BELT = 'NLB-2026-0412';
const BAND = 'NLW-2026-0412';
const ACTOR = { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' };

function run(rt, id, params = {}) {
  rt.engine.start(id, { ...ACTOR, ...params });
  rt.engine.finishNow();
  assert.equal(rt.failed().length, 0, `scenario ${id} failed: ${rt.failed()[0]?.error?.message}`);
  assert.equal(rt.engine.isRunning(), false);
  return rt.finished().at(-1).summary;
}
const sessionsOf = (rt, id = MARICEL) => rt.db().check_sessions.filter((s) => s.patient_id === id).sort((a, b) => a.started_at - b.started_at);
const alertsOf = (rt, id = MARICEL) => rt.db().alerts.filter((a) => a.patient_id === id);
const told = (rt, alertId, type = 'alert') => rt.db().notifications.filter((n) => n.type === type && n.payload.alert_id === alertId).map((n) => n.profile_id).sort();

// ---------- Checks ----------

test('Check: normal saves a verified check with no alert', () => {
  const rt = makeRuntime();
  const before = sessionsOf(rt).length;
  const summary = run(rt, 'check-normal');
  const added = sessionsOf(rt).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].syncState, 'synced');
  assert.equal(added[0].summary.unverified, false);
  assert.equal(alertsOf(rt).length, 0);
  assert.equal(summary.key, 'presenter:done.check');
  assert.deepEqual([summary.values.name, summary.values.valid, summary.values.total], ['Maricel Dimaculangan', 30, 30]);
  assert.ok(summary.values.fhr >= 140 && summary.values.fhr <= 148);
  assert.equal(rt.state().meta.run, null);
});

test('while a check runs the gear can show it, and the run is stored', () => {
  const rt = makeRuntime();
  rt.engine.start('check-normal', ACTOR);
  assert.equal(rt.engine.isRunning(), true);
  assert.equal(rt.engine.describe().labelKey, 'presenter:scenario.checkNormal');
  assert.equal(rt.state().meta.run.scenarioId, 'check-normal');
  assert.equal(rt.state().live.check.phase, 'starting');
  rt.sched.advance(60 * SECOND);
  assert.equal(rt.state().live.check.phase, 'acquiring');
  assert.equal(rt.engine.isRunning(), true);
  rt.engine.finishNow();
  assert.equal(rt.engine.isRunning(), false);
  assert.equal(rt.state().live.check.phase, 'complete');
});

test('Check: adjust belt shows the prompt, then recovers and completes', () => {
  const rt = makeRuntime();
  rt.engine.start('check-adjust-belt', ACTOR);
  rt.sched.advance(2 * SECOND);
  assert.equal(rt.state().live.check.prompt, 'adjust_belt');
  rt.sched.advance(8 * SECOND);
  assert.equal(rt.state().live.check.prompt, null);
  rt.engine.finishNow();
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.check');
  assert.equal(rt.finished().at(-1).summary.values.valid, 30);
});

test('Check: rest shows the rest prompt and leaves out the motion windows', () => {
  const rt = makeRuntime();
  rt.engine.start('check-rest', ACTOR);
  rt.sched.advance(32 * SECOND);
  assert.equal(rt.state().live.check.prompt, 'rest');
  rt.engine.finishNow();
  assert.deepEqual([rt.finished().at(-1).summary.values.valid, rt.finished().at(-1).summary.values.total], [26, 30]);
});

test('Check: no band completes and marks the FHR unverified (PAT-H-05)', () => {
  const rt = makeRuntime();
  const summary = run(rt, 'check-no-band');
  assert.equal(summary.key, 'presenter:done.checkUnverified');
  assert.equal(sessionsOf(rt).at(-1).band_serial, null);
});

test('Check: maternal signal flags the windows near the band rate and raises no alert', () => {
  const rt = makeRuntime();
  run(rt, 'check-maternal-signal');
  const saved = sessionsOf(rt).at(-1);
  assert.ok(saved.summary.maternal_excluded >= 3);
  assert.ok(saved.summary.valid_windows < 30);
  assert.equal(alertsOf(rt).length, 0);
});

test('Check: FHR out of range raises an alert that reaches her barangay accounts', () => {
  const rt = makeRuntime();
  const summary = run(rt, 'check-fhr-out-of-range');
  const [alert] = alertsOf(rt);
  assert.equal(alert.type, 'fhr_out_of_range');
  assert.deepEqual(told(rt, alert.id), ['jocelyn-landicho', 'lourdes-magpantay']);
  assert.deepEqual(told(rt, alert.id, 'alert_notice'), [MARICEL]);
  assert.equal(summary.key, 'presenter:done.checkAlert');
  assert.deepEqual(summary.values, { name: 'Maricel Dimaculangan', type: 't:presenter:alertType.fhr_out_of_range', count: 2 });
});

test('Check: repeated signal loss runs three short checks and raises the alert on the third', () => {
  const rt = makeRuntime();
  const before = sessionsOf(rt).length;
  rt.engine.start('check-signal-loss', ACTOR);
  assert.equal(rt.engine.describe().stepIndex, 0);
  rt.engine.finishNow();
  const added = sessionsOf(rt).slice(before);
  assert.equal(added.length, 3);
  assert.ok(added.every((s) => s.summary.valid_windows === 0 && s.summary.total_windows === 10));
  const [alert] = alertsOf(rt);
  assert.equal(alert.type, 'signal_loss');
  assert.equal(alert.reading_ref, added[2].id, 'raised by the third check');
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.checkAlert');
});

test('Check: maternal vitals raises the alert (SpO2 by default; heart rate and temperature as variants)', () => {
  const metric = (variant) => {
    const rt = makeRuntime();
    run(rt, 'check-maternal-vitals', variant ? { variant } : {});
    return alertsOf(rt)[0].payload.metrics[0];
  };
  assert.deepEqual([metric().metric, metric().value], ['spo2', 92]);
  assert.deepEqual([metric('heart_rate').metric, metric('heart_rate').value], ['heart_rate', 118]);
  assert.deepEqual([metric('temperature').metric, metric('temperature').value], ['skin_temperature', 38.4]);
});

test('a check that is refused ends at once and says why', () => {
  const rt = makeRuntime();
  rt.control.fillExposure(BELT);
  rt.engine.start('check-normal', ACTOR);
  assert.equal(rt.sched.size() <= 1, true, 'no long wait for a check that did not start');
  rt.engine.finishNow();
  assert.deepEqual(rt.finished().at(-1).summary, {
    key: 'presenter:done.checkRefused',
    values: { name: 'Maricel Dimaculangan', reason: 't:presenter:reason.exposure_cap' },
  });
  assert.equal(sessionsOf(rt).filter((s) => s.queued_at).length, 0);
});

test('a check for a patient whose belt is charging is refused with the reason charging', () => {
  const rt = makeRuntime();
  rt.control.setCharging(BELT, true);
  run(rt, 'check-normal');
  assert.equal(rt.finished().at(-1).summary.values.reason, 't:presenter:reason.charging');
});

test('Quick runs a check in about a third of the time; Realistic in real time', () => {
  // the belt's summary packet is due 122.1 s after the start in device time
  const quick = makeRuntime();
  quick.engine.start('check-normal', ACTOR);
  assert.ok(quick.delays.includes(40700), `Quick: ${quick.delays.slice(0, 40).join(', ')}`);
  assert.ok(!quick.delays.includes(122100));
  const realistic = makeRuntime();
  realistic.setTiming('realistic');
  realistic.engine.start('check-normal', ACTOR);
  assert.ok(realistic.delays.includes(122100), `Realistic: ${realistic.delays.slice(0, 40).join(', ')}`);
  assert.ok(!realistic.delays.includes(40700));
});

// ---------- Alerts and SOS ----------

test('SOS pressed: reaches the barangay accounts and all super accounts', () => {
  const rt = makeRuntime();
  const summary = run(rt, 'sos-pressed');
  const [alert] = alertsOf(rt);
  assert.equal(alert.type, 'sos');
  assert.deepEqual(told(rt, alert.id), ['cynthia-dimayuga', 'jocelyn-landicho', 'lourdes-magpantay', 'rowena-macaraig']);
  assert.deepEqual(summary, { key: 'presenter:done.sos', values: { name: 'Maricel Dimaculangan', count: 4 } });
});

test('SOS pressed while the band is disconnected connects it first', () => {
  const rt = makeRuntime();
  rt.link.disconnect(BAND);
  run(rt, 'sos-pressed');
  assert.equal(alertsOf(rt).length, 1);
});

test('SOS pressed with the phone offline is reported as not delivered', () => {
  const rt = makeRuntime();
  rt.setConnection('offline');
  const summary = run(rt, 'sos-pressed');
  assert.equal(summary.key, 'presenter:done.sosUndelivered');
  assert.equal(alertsOf(rt).length, 0);
});

test('SOS cancelled marks the alert cancelled by the patient', () => {
  const rt = makeRuntime();
  rt.engine.start('sos-cancelled', ACTOR);
  assert.equal(rt.engine.isRunning(), true);
  assert.equal(alertsOf(rt)[0].status, 'new');
  rt.engine.finishNow();
  const [alert] = alertsOf(rt);
  assert.equal(alert.status, 'resolved');
  assert.equal(alert.outcome_code, 'cancelled_by_patient');
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.sosCancelled');
});

test('SOS with the band out of range is stored and relayed when the band is back', () => {
  const rt = makeRuntime();
  rt.engine.start('sos-band-out-of-range', ACTOR);
  assert.equal(rt.db().devices.find((d) => d.serial === BAND).link_state, 'disconnected');
  rt.sched.advance(2 * SECOND);
  assert.equal(alertsOf(rt).length, 0, 'not delivered while apart');
  assert.equal(rt.state().hardware[BAND].sos.acked, false);
  rt.engine.finishNow();
  assert.equal(alertsOf(rt).length, 1);
  assert.equal(rt.state().hardware[BAND].sos.acked, true);
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.sos');
});

test('Alert left unacknowledged: an alert is created, waits the escalation time and reaches all super accounts', () => {
  const rt = makeRuntime();
  rt.engine.start('alert-unacknowledged', ACTOR);
  const [alert] = alertsOf(rt);
  assert.equal(alert.status, 'new');
  assert.equal(alert.escalated_at, null);
  assert.deepEqual(told(rt, alert.id), ['jocelyn-landicho', 'lourdes-magpantay'], 'her barangay first');
  rt.engine.finishNow();
  const after = alertsOf(rt)[0];
  assert.ok(after.escalated_at);
  const escalated = rt.db().notifications.filter((n) => n.payload.alert_id === alert.id && n.payload.escalated === true).map((n) => n.profile_id).sort();
  assert.deepEqual(escalated, ['cynthia-dimayuga', 'rowena-macaraig']);
  assert.deepEqual(rt.finished().at(-1).summary, { key: 'presenter:done.escalated', values: { name: 'Maricel Dimaculangan', count: 2 } });
});

test('the escalation wait is 60 seconds in Quick and 5 minutes in Realistic, in real time', () => {
  const quick = makeRuntime();
  quick.engine.start('alert-unacknowledged', ACTOR);
  assert.deepEqual(quick.delays, [60000]);
  const realistic = makeRuntime();
  realistic.setTiming('realistic');
  realistic.engine.start('alert-unacknowledged', ACTOR);
  assert.deepEqual(realistic.delays, [300000]);
});

test('an alert acknowledged before the escalation time is not escalated', () => {
  const rt = makeRuntime();
  rt.engine.start('alert-unacknowledged', ACTOR);
  const [alert] = alertsOf(rt);
  rt.core.commit([{ op: 'update', table: 'alerts', id: alert.id, patch: { status: 'acknowledged', acknowledged_by: 'lourdes-magpantay', acknowledged_at: NOW } }]);
  rt.engine.finishNow();
  assert.equal(alertsOf(rt)[0].escalated_at, null);
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.notEscalated');
  assert.equal(rt.db().notifications.filter((n) => n.payload.escalated === true && n.payload.alert_id === alert.id).length, 0);
});

test('Alert left unacknowledged uses an alert that is already open instead of making another', () => {
  const rt = makeRuntime();
  run(rt, 'check-fhr-out-of-range');
  const [open] = alertsOf(rt);
  run(rt, 'alert-unacknowledged');
  assert.equal(alertsOf(rt).length, 1);
  assert.ok(alertsOf(rt)[0].escalated_at);
  assert.equal(alertsOf(rt)[0].id, open.id);
});

test('Missed check: her last check is moved back past 24 hours and the alert follows', () => {
  const rt = makeRuntime();
  const before = Math.max(...sessionsOf(rt).map((s) => s.ended_at));
  assert.ok(NOW - before < 24 * MS_HOUR, 'she had a recent check');
  const summary = run(rt, 'missed-check');
  const last = Math.max(...sessionsOf(rt).map((s) => s.ended_at));
  assert.ok(NOW - last >= 24 * MS_HOUR, 'now over a day old');
  assert.ok(NOW - last < 26 * MS_HOUR);
  const [alert] = alertsOf(rt);
  assert.equal(alert.type, 'missed_check');
  assert.equal(alert.status, 'new');
  assert.deepEqual(told(rt, alert.id), ['jocelyn-landicho', 'lourdes-magpantay']);
  assert.deepEqual(summary, { key: 'presenter:done.missedCheck', values: { name: 'Maricel Dimaculangan', count: 2 } });
  // the readings moved with their sessions: none is newer than the newest session
  const sessionIds = new Set(sessionsOf(rt).map((s) => s.id));
  for (const reading of rt.db().fetal_readings.filter((r) => sessionIds.has(r.session_id))) assert.ok(reading.taken_at <= last + 1000);
  // the rule agrees with what the screens would show
  const device = rt.db().devices.find((d) => d.serial === BELT);
  assert.equal(evaluateMissedCheck({ lastCompletedAt: last, pairedAt: device.paired_at, now: NOW }).type, 'missed_check');
  // and running it again is harmless
  run(rt, 'missed-check');
  assert.equal(alertsOf(rt).length, 1);
});

// ---------- Devices ----------

test('Devices: connect and disconnect each device', () => {
  const rt = makeRuntime();
  const link = (serial) => rt.db().devices.find((d) => d.serial === serial).link_state;
  assert.equal(run(rt, 'device-connection', { device: 'belt', connected: false }).key, 'presenter:done.deviceDisconnected');
  assert.equal(link(BELT), 'disconnected');
  assert.equal(link(BAND), 'connected');
  assert.equal(run(rt, 'device-connection', { device: 'belt', connected: true }).key, 'presenter:done.deviceConnected');
  assert.equal(link(BELT), 'connected');
  run(rt, 'device-connection', { device: 'band', connected: false });
  assert.equal(link(BAND), 'disconnected');
});

test('Devices: battery 80, 18, 8 and 4 give normal, low, critical and cutoff behaviour', () => {
  const rt = makeRuntime();
  const battery = (pct) => run(rt, 'device-battery', { device: 'belt', pct });
  assert.deepEqual(battery(80), { key: 'presenter:done.battery', values: { device: 't:presenter:devices.belt', pct: 80 } });
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'battery_low').length, 0);
  battery(18);
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'battery_low').length, 1);
  assert.equal(alertsOf(rt).length, 0);
  battery(8);
  assert.equal(alertsOf(rt)[0].type, 'battery_critical');
  battery(4);
  run(rt, 'check-normal');
  assert.equal(rt.finished().at(-1).summary.values.reason, 't:presenter:reason.low_battery', 'Check now is refused at cutoff');
  assert.equal(alertsOf(rt).length, 1);
});

test('Devices: charging on stops checks, off brings them back', () => {
  const rt = makeRuntime();
  run(rt, 'device-charging', { device: 'band', on: true });
  assert.equal(rt.db().devices.find((d) => d.serial === BAND).charging, true);
  run(rt, 'check-normal');
  assert.equal(rt.finished().at(-1).summary.key, 'presenter:done.checkUnverified', 'the band refuses, the belt check goes on without it');
  assert.equal(sessionsOf(rt).at(-1).summary.unverified, true);
  run(rt, 'device-charging', { device: 'band', on: false });
  assert.equal(rt.db().devices.find((d) => d.serial === BAND).charging, false);
});

test('Devices: exposure cap reached disables the next check with its reason', () => {
  const rt = makeRuntime();
  run(rt, 'exposure-cap');
  assert.equal(rt.state().hardware[BELT].exposure.at(-1).s, 360);
  run(rt, 'check-normal');
  assert.equal(rt.finished().at(-1).summary.values.reason, 't:presenter:reason.exposure_cap');
});

test('Devices: checks while apart syncs three records, with no duplicates', () => {
  const rt = makeRuntime();
  const before = sessionsOf(rt).length;
  rt.engine.start('checks-while-apart', ACTOR);
  assert.equal(rt.db().devices.find((d) => d.serial === BELT).link_state, 'disconnected');
  rt.engine.finishNow();
  const stored = sessionsOf(rt).filter((s) => s.source === 'stored');
  assert.equal(stored.length, 3);
  assert.equal(sessionsOf(rt).length, before + 3);
  assert.ok(stored.every((s) => s.syncState === 'synced' && !s.summary.unverified));
  assert.equal(rt.finished().at(-1).summary.values.count, 3);
  const keys = rt.db().fetal_readings.map((r) => `${rt.db().check_sessions.find((s) => s.id === r.session_id).belt_serial}:${r.device_seq}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(rt.state().hardware[BELT].ring.length, 0);
  assert.equal(rt.db().devices.find((d) => d.serial === BELT).link_state, 'connected');
});

// ---------- Schedule and consult ----------

test('Incoming booking request: a pending teleconsultation for the chosen patient, super accounts told', () => {
  const rt = makeRuntime();
  const before = rt.db().appointments.length;
  const summary = run(rt, 'booking-request', { patientId: 'rosalinda-ramos', actorId: 'rowena-macaraig', actorRole: 'super' });
  const added = rt.db().appointments.slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual([added[0].patient_id, added[0].status, added[0].type, added[0].scheduled_at], ['rosalinda-ramos', 'pending', 'teleconsult', null]);
  assert.equal(manilaDate(added[0].preferred_start), addDays(manilaDate(NOW), 1));
  assert.ok(added[0].preferred_end > added[0].preferred_start && added[0].reason);
  const asked = rt.db().notifications.filter((n) => n.type === 'booking_request' && n.payload.appointment_id === added[0].id).map((n) => n.profile_id).sort();
  assert.deepEqual(asked, ['cynthia-dimayuga', 'rowena-macaraig']);
  assert.deepEqual(summary, { key: 'presenter:done.bookingRequest', values: { name: 'Rosalinda Ramos', count: 2 } });
});

test('Bring next appointment to now: the approved teleconsultation starts and the midwife thread stays open', () => {
  const rt = makeRuntime();
  const analyn = { patientId: 'analyn-gonzales', actorId: 'cynthia-dimayuga', actorRole: 'super' };
  const tele = () => rt.db().appointments.find((a) => a.patient_id === 'analyn-gonzales' && a.type === 'teleconsult');
  assert.ok(tele().scheduled_at > NOW + 12 * MS_HOUR, 'tomorrow');
  const summary = run(rt, 'appointment-now', analyn);
  assert.equal(tele().scheduled_at, NOW);
  assert.equal(tele().status, 'approved');
  const thread = rt.db().conversations.find((c) => c.id === 'conv-midwife-analyn-gonzales');
  assert.ok(thread.unlocked_until > NOW + 24 * MS_HOUR);
  assert.equal(thread.assigned_provider_id, 'cynthia-dimayuga');
  assert.deepEqual(rt.db().notifications.filter((n) => n.type === 'appointment_started').map((n) => n.profile_id).sort(), ['analyn-gonzales', 'cynthia-dimayuga']);
  assert.equal(summary.key, 'presenter:done.appointmentNow');
});

test('Bring next appointment to now does nothing when no teleconsultation is approved', () => {
  const rt = makeRuntime();
  const before = JSON.stringify(rt.db().appointments);
  const summary = run(rt, 'appointment-now');
  assert.equal(JSON.stringify(rt.db().appointments), before);
  assert.equal(summary.key, 'presenter:done.noAppointment');
  assert.equal(rt.db().conversations.find((c) => c.id === 'conv-midwife-maricel-dimaculangan').unlocked_until, null);
});

test('End appointment opens the 24-hour follow-up window; Close follow-up window locks the thread again', () => {
  const rt = makeRuntime();
  const analyn = { patientId: 'analyn-gonzales', actorId: 'cynthia-dimayuga', actorRole: 'super' };
  assert.equal(run(rt, 'appointment-end', analyn).key, 'presenter:done.noAppointment', 'nothing has started yet');
  run(rt, 'appointment-now', analyn);
  const summary = run(rt, 'appointment-end', analyn);
  assert.equal(summary.key, 'presenter:done.appointmentEnd');
  const tele = rt.db().appointments.find((a) => a.patient_id === 'analyn-gonzales' && a.type === 'teleconsult');
  assert.deepEqual([tele.status, tele.ended_at], ['attended', NOW]);
  const thread = () => rt.db().conversations.find((c) => c.id === 'conv-midwife-analyn-gonzales');
  assert.equal(thread().unlocked_until, NOW + 24 * MS_HOUR);
  assert.equal(rt.db().notifications.filter((n) => n.type === 'follow_up_open').length, 1);

  assert.equal(run(rt, 'followup-close', analyn).key, 'presenter:done.followupClose');
  assert.equal(thread().unlocked_until, NOW);
  assert.ok(thread().unlocked_until <= NOW, 'locked');
  assert.equal(run(rt, 'followup-close', analyn).key, 'presenter:done.nothingToClose');
});

test('Event reminder reaches the patient and the accounts of her barangay', () => {
  const rt = makeRuntime();
  const summary = run(rt, 'event-reminder');
  const reminders = rt.db().notifications.filter((n) => n.type === 'event_reminder');
  assert.deepEqual(reminders.map((n) => n.profile_id).sort(), ['jocelyn-landicho', 'lourdes-magpantay', MARICEL]);
  const event = rt.db().events.find((e) => e.id === reminders[0].payload.event_id);
  assert.equal(event.title, 'Prenatal check-up day');
  assert.deepEqual(summary, { key: 'presenter:done.eventReminder', values: { title: 'Prenatal check-up day', count: 3 } });
});

test('Incoming message: the patient hears from her barangay account; the barangay account hears from the patient', () => {
  const rt = makeRuntime();
  const thread = 'conv-barangay-maricel-dimaculangan';
  const before = rt.db().messages.filter((m) => m.conversation_id === thread).length;
  const mine = rt.db().messages.filter((m) => m.conversation_id === thread && m.sender_id === MARICEL);
  mine.forEach((m) => rt.core.commit([{ op: 'update', table: 'messages', id: m.id, patch: { seen_at: null } }]));

  run(rt, 'incoming-message', { actorId: MARICEL, actorRole: 'patient' });
  let messages = rt.db().messages.filter((m) => m.conversation_id === thread);
  assert.equal(messages.length, before + 1);
  const reply = messages.at(-1);
  assert.ok(['lourdes-magpantay', 'jocelyn-landicho'].includes(reply.sender_id));
  assert.equal(reply.syncState, 'synced');
  assert.equal(reply.seen_at, null);
  assert.ok(messages.filter((m) => m.sender_id === MARICEL).every((m) => m.seen_at), 'seen follows');
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'message' && n.created_at === NOW).length, 1, 'the patient is told about the new message');

  run(rt, 'incoming-message', { actorId: 'lourdes-magpantay', actorRole: 'barangay' });
  messages = rt.db().messages.filter((m) => m.conversation_id === thread);
  assert.equal(messages.at(-1).sender_id, MARICEL);
  assert.equal(rt.inbox('lourdes-magpantay').filter((n) => n.type === 'message' && n.created_at === NOW).length, 1);
});

test('Incoming message for a super account uses the midwife thread when it is open', () => {
  const rt = makeRuntime();
  const cynthia = { patientId: 'analyn-gonzales', actorId: 'cynthia-dimayuga', actorRole: 'super' };
  const before = rt.db().messages.filter((m) => m.conversation_id === 'conv-midwife-analyn-gonzales').length;
  run(rt, 'incoming-message', cynthia);
  const after = rt.db().messages.filter((m) => m.conversation_id === 'conv-midwife-analyn-gonzales');
  assert.equal(after.length, before + 1);
  assert.equal(after.at(-1).sender_id, 'analyn-gonzales');
});

test('Referral from BHW: all super accounts get the reason and the latest readings', () => {
  const rt = makeRuntime();
  const summary = run(rt, 'referral', { patientId: 'divina-perez', actorId: 'rowena-macaraig', actorRole: 'super' });
  const referrals = rt.db().notifications.filter((n) => n.type === 'referral' && n.created_at === NOW);
  assert.deepEqual(referrals.map((n) => n.profile_id).sort(), ['cynthia-dimayuga', 'rowena-macaraig']);
  const { payload } = referrals[0];
  assert.equal(payload.patient_id, 'divina-perez');
  assert.equal(payload.from_profile_id, 'josefina-ocampo');
  assert.ok(payload.reason.length > 10);
  assert.ok(payload.vitals.fhr_bpm >= 125 && payload.vitals.spo2_pct >= 96);
  assert.deepEqual(summary, { key: 'presenter:done.referral', values: { name: 'Divina Perez', count: 2 } });
});

test('Raise video usage to 80% warns the super accounts, once', () => {
  const rt = makeRuntime();
  assert.deepEqual(rt.state().meta.video_usage, { used: 6420, limit: 10000 });
  const summary = run(rt, 'video-usage-80', { actorId: 'rowena-macaraig', actorRole: 'super' });
  assert.deepEqual(rt.state().meta.video_usage, { used: 8000, limit: 10000 });
  assert.equal(summary.key, 'presenter:done.videoUsage');
  assert.deepEqual(rt.db().notifications.filter((n) => n.type === 'video_usage_warning').map((n) => n.profile_id).sort(), ['cynthia-dimayuga', 'rowena-macaraig']);
  assert.equal(run(rt, 'video-usage-80').key, 'presenter:done.videoUsageAlready');
  assert.equal(rt.db().notifications.filter((n) => n.type === 'video_usage_warning').length, 2);
});

// ---------- Runs that outlive the screen ----------

test('a reload in the middle of a check finishes it at once; the check is saved once', () => {
  const first = makeRuntime();
  const before = sessionsOf(first).length;
  first.engine.start('check-normal', ACTOR);
  first.sched.advance(30 * SECOND);
  assert.equal(first.state().live.check.phase, 'acquiring');
  assert.ok(first.state().meta.run);
  const stored = snapshotOf(first.state()); // what IndexedDB holds when the page closes

  assert.equal(first.state().meta.run.stepIndex, 1, 'stored while it waits for the check');
  const second = makeRuntime({ snapshot: JSON.parse(JSON.stringify(stored)) });
  assert.equal(second.state().live.check, null, 'live state is not stored');
  second.start();
  assert.equal(second.state().meta.run, null);
  assert.equal(sessionsOf(second).length, before + 1);
  assert.equal(sessionsOf(second).at(-1).syncState, 'synced');
  assert.equal(second.state().hardware[BELT].ring.length, 0, 'the unfinished windows were cleared with the new check');
  assert.equal(second.state().hardware[BELT].state, 'ACTIVE_IDLE');
  assert.equal(second.finished().at(-1).summary.key, 'presenter:done.check');
});

test('a reload while apart finishes the whole run and syncs the three checks once', () => {
  const first = makeRuntime();
  first.engine.start('checks-while-apart', ACTOR);
  first.sched.advance(2 * SECOND); // belt and band are apart, the three checks are stored
  assert.equal(first.state().hardware[BELT].ring.length, 93);
  const second = makeRuntime({ snapshot: JSON.parse(JSON.stringify(snapshotOf(first.state()))) });
  second.start();
  assert.equal(sessionsOf(second).filter((s) => s.source === 'stored').length, 3);
  assert.equal(second.state().hardware[BELT].ring.length, 0);
});

test('Reset data in the middle of a run stops it and brings back the starting records', () => {
  const rt = makeRuntime();
  rt.engine.start('check-normal', ACTOR);
  rt.setSession({ profile_id: MARICEL });
  rt.sched.advance(20 * SECOND);
  rt.reset();
  assert.equal(rt.engine.isRunning(), false);
  assert.equal(rt.sched.size(), 0);
  assert.equal(rt.state().session, null);
  assert.equal(rt.state().live.check, null);
  assert.deepEqual(rt.state().db, createSeed({ now: NOW }).db);
  assert.deepEqual(rt.state().hardware, createSeed({ now: NOW }).hardware);
  rt.sched.flush();
  assert.deepEqual(rt.state().db, createSeed({ now: NOW }).db, 'nothing left over');
  rt.engine.start('check-normal', ACTOR);
  rt.engine.finishNow();
  assert.equal(rt.failed().length, 0, 'a new run works after a reset');
});

test('a run goes on when the account is switched or signed out', () => {
  const rt = makeRuntime({ session: { profile_id: MARICEL } });
  rt.engine.start('check-fhr-out-of-range', ACTOR);
  rt.sched.advance(20 * SECOND);
  rt.setSession({ profile_id: 'lourdes-magpantay' });
  rt.sched.advance(20 * SECOND);
  rt.setSession(null);
  rt.engine.finishNow();
  assert.equal(alertsOf(rt)[0].type, 'fhr_out_of_range');
  assert.equal(rt.engine.isRunning(), false);
});

test('starting another run while one is running first needs the first to be finished', () => {
  const rt = makeRuntime();
  rt.engine.start('check-normal', ACTOR);
  assert.throws(() => rt.engine.start('sos-cancelled', ACTOR), /in progress/);
  rt.engine.finishNow();
  rt.engine.start('sos-cancelled', ACTOR);
  rt.engine.finishNow();
  assert.equal(alertsOf(rt).at(-1).type, 'sos');
});

test('an SOS can be pressed in the middle of a check: it goes out at once and the check goes on', () => {
  const rt = makeRuntime();
  rt.engine.start('check-normal', ACTOR);
  rt.sched.advance(30 * SECOND);
  assert.equal(rt.engine.isInstant('sos-pressed', ACTOR), true);
  rt.engine.start('sos-pressed', ACTOR);
  assert.equal(alertsOf(rt).length, 1);
  assert.equal(rt.state().meta.run.scenarioId, 'check-normal');
  rt.engine.finishNow();
  assert.equal(rt.state().live.check.phase, 'complete');
  assert.equal(rt.engine.isRunning(), false);
  assert.equal(rt.failed().length, 0);
});

test('the heartbeat keeps last-seen fresh for connected devices and leaves disconnected ones alone', () => {
  const rt = makeRuntime();
  rt.link.disconnect(BAND);
  rt.advanceClock(10 * 60 * 1000);
  rt.control.heartbeat();
  const belt = rt.db().devices.find((d) => d.serial === BELT);
  const band = rt.db().devices.find((d) => d.serial === BAND);
  assert.equal(belt.last_seen_at, NOW + 10 * 60 * 1000);
  assert.ok(band.last_seen_at < NOW + MS_DAY && band.last_seen_at !== NOW + 10 * 60 * 1000);
  assert.equal(band.link_state, 'disconnected');
});

test('a reload while the band reconnects after an SOS finishes the run: the stored SOS is relayed', () => {
  const first = makeRuntime();
  first.engine.start('sos-band-out-of-range', ACTOR);
  first.sched.advance(9500); // the band came back and the replay is on its way
  const second = makeRuntime({ snapshot: JSON.parse(JSON.stringify(snapshotOf(first.state()))) });
  second.start();
  assert.equal(alertsOf(second).filter((a) => a.type === 'sos').length, 1);
  assert.equal(second.state().hardware[BAND].sos.acked, true);
  assert.equal(second.state().meta.run, null);
});

test('starting up uploads what was still queued when the page closed, but only when online', () => {
  const first = makeRuntime();
  first.engine.start('check-normal', ACTOR);
  first.sched.advance(122.4 * SECOND); // the check is saved on the phone, the upload is 0.6 s away
  assert.equal(sessionsOf(first).at(-1).syncState, 'queued');
  const stored = JSON.parse(JSON.stringify(snapshotOf(first.state())));

  const online = makeRuntime({ snapshot: JSON.parse(JSON.stringify(stored)) });
  online.start();
  assert.equal(sessionsOf(online).at(-1).syncState, 'synced');

  const offlineState = JSON.parse(JSON.stringify(stored));
  offlineState.meta.connection = 'offline';
  const offline = makeRuntime({ snapshot: offlineState });
  offline.start();
  assert.equal(sessionsOf(offline).at(-1).syncState, 'queued');
});

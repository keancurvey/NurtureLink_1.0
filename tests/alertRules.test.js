import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SEVERITY, ALERT_TYPES, escalationMs, evaluateBattery, evaluateFhr, evaluateMaternalVitals,
  evaluateMissedCheck, evaluateSignalLoss, evaluateSos, findDuplicate, mergePatch, shouldEscalate,
} from '../src/lib/alertRules.js';
import { THRESHOLDS, buildThresholds, flattenThresholds } from '../src/config/thresholds.js';
import { FHR_FLAG, VITALS_FLAG } from '../src/lib/packets.js';
import { MS_HOUR } from '../src/lib/dates.js';

const T0 = Date.parse('2026-11-08T02:00:00Z');
const win = (i, fhr, extra = {}) => ({ taken_at: T0 + i * 4000, fhr_bpm: fhr, confidence: 85, sqi: 80, flags: 0, maternal_match: false, ...extra });
const run = (count, fhr, start = 0) => Array.from({ length: count }, (_, i) => win(start + i, fhr));

test('the six alert types of ALR-01 each have a severity', () => {
  assert.equal(ALERT_TYPES.length, 6);
  for (const type of ALERT_TYPES) assert.ok(['critical', 'warning'].includes(ALERT_SEVERITY[type]), type);
});

test('FHR: 8 low windows (32 s) alert, 7 windows (28 s) do not (sustained 30 s)', () => {
  assert.equal(evaluateFhr(run(7, 100)), null);
  const alert = evaluateFhr(run(8, 100));
  assert.equal(alert.type, 'fhr_out_of_range');
  assert.equal(alert.severity, 'critical');
  assert.deepEqual(alert.payload, { direction: 'low', sustained_seconds: 32, extreme_bpm: 100 });
});

test('FHR: the range limits themselves are normal (110 and 160); 109 and 161 are out', () => {
  assert.equal(evaluateFhr(run(20, 110)), null);
  assert.equal(evaluateFhr(run(20, 160)), null);
  assert.equal(evaluateFhr(run(8, 109)).payload.direction, 'low');
  const high = evaluateFhr(run(8, 161));
  assert.equal(high.payload.direction, 'high');
  assert.equal(high.payload.extreme_bpm, 161);
});

test('FHR: one in-range valid window breaks the run', () => {
  const windows = [...run(5, 100), win(5, 130), ...run(5, 100, 6)];
  assert.equal(evaluateFhr(windows), null);
});

test('FHR: discarded windows neither count nor break the run', () => {
  const windows = [...run(4, 100), win(4, 0, { flags: FHR_FLAG.MOTION }), win(5, 99, { flags: FHR_FLAG.POOR_CONTACT }), ...run(4, 100, 6)];
  const alert = evaluateFhr(windows);
  assert.equal(alert.payload.sustained_seconds, 32);
  // windows flagged as maternal signal are not valid windows either
  assert.equal(evaluateFhr(run(8, 100).map((w) => ({ ...w, maternal_match: true }))), null);
});

test('FHR: a change of direction starts a new run and the extreme is tracked', () => {
  const windows = [...run(4, 100), ...run(4, 170, 4)];
  assert.equal(evaluateFhr(windows), null);
  const low = evaluateFhr([win(0, 105), win(1, 98), win(2, 104), ...run(5, 107, 3)]);
  assert.equal(low.payload.extreme_bpm, 98);
});

test('FHR: the sustained time and range come from configuration', () => {
  const tight = buildThresholds([{ key: 'fhr.sustainedSeconds', value: 16 }, { key: 'fhr.min', value: 120 }]);
  assert.equal(evaluateFhr(run(4, 119), tight).type, 'fhr_out_of_range');
  assert.equal(evaluateFhr(run(4, 119)), null);
});

test('signal loss: the latest three checks with no valid window alert; two or a recovery do not', () => {
  const none = { valid_windows: 0 };
  const some = { valid_windows: 12 };
  assert.equal(evaluateSignalLoss([none, none, none]).type, 'signal_loss');
  assert.equal(evaluateSignalLoss([some, none, none, none]).payload.consecutive_checks, 3);
  assert.equal(evaluateSignalLoss([none, none]), null);
  assert.equal(evaluateSignalLoss([none, none, some]), null);
  assert.equal(evaluateSignalLoss([none, some, none, none]), null);
});

test('maternal vitals: limits are normal at the limit and alert beyond it', () => {
  const ok = { hr_bpm: 80, spo2_pct: 98, skin_temp_c: 36.7, flags: 0 };
  assert.equal(evaluateMaternalVitals(ok), null);
  assert.equal(evaluateMaternalVitals({ ...ok, hr_bpm: 50 }), null);
  assert.equal(evaluateMaternalVitals({ ...ok, hr_bpm: 110 }), null);
  assert.equal(evaluateMaternalVitals({ ...ok, hr_bpm: 49 }).payload.metrics[0].direction, 'low');
  assert.equal(evaluateMaternalVitals({ ...ok, hr_bpm: 111 }).payload.metrics[0].direction, 'high');
  assert.equal(evaluateMaternalVitals({ ...ok, hr_bpm: 118 }).payload.metrics[0].value, 118);
  assert.equal(evaluateMaternalVitals({ ...ok, spo2_pct: 95 }), null);
  assert.equal(evaluateMaternalVitals({ ...ok, spo2_pct: 94 }).payload.metrics[0].metric, 'spo2');
  assert.equal(evaluateMaternalVitals({ ...ok, spo2_pct: 92 }).severity, 'critical');
  assert.equal(evaluateMaternalVitals({ ...ok, skin_temp_c: 38.0 }), null);
  assert.equal(evaluateMaternalVitals({ ...ok, skin_temp_c: 38.1 }).payload.metrics[0].metric, 'skin_temperature');
  assert.equal(evaluateMaternalVitals({ ...ok, skin_temp_c: 38.4 }).payload.metrics[0].value, 38.4);
});

test('maternal vitals: several out-of-range values in one reading come back together; no value is skipped', () => {
  const both = evaluateMaternalVitals({ hr_bpm: 120, spo2_pct: 93, skin_temp_c: 38.5, flags: 0 });
  assert.deepEqual(both.payload.metrics.map((m) => m.metric), ['heart_rate', 'spo2', 'skin_temperature']);
  // zero means the band had no value
  assert.equal(evaluateMaternalVitals({ hr_bpm: 0, spo2_pct: 0, skin_temp_c: 36.6, flags: 0 }), null);
  assert.equal(evaluateMaternalVitals({ hr_bpm: 80, spo2_pct: 98, skin_temp_c: null, flags: 0 }), null);
});

test('maternal vitals: a rejected, weak or partial band reading is not used', () => {
  const low = { hr_bpm: 80, spo2_pct: 88, skin_temp_c: 36.7 };
  assert.equal(evaluateMaternalVitals({ ...low, flags: VITALS_FLAG.WEAK_SIGNAL }), null);
  assert.equal(evaluateMaternalVitals({ ...low, flags: VITALS_FLAG.MOTION_REJECTED }), null);
  assert.equal(evaluateMaternalVitals({ ...low, flags: VITALS_FLAG.PARTIAL }), null);
  assert.equal(evaluateMaternalVitals({ ...low, flags: VITALS_FLAG.ABNORMAL }).type, 'maternal_vitals');
});

test('maternal ranges come from configuration', () => {
  const custom = buildThresholds([{ key: 'maternalHr.max', value: 120 }, { key: 'spo2.min', value: 92 }]);
  assert.equal(evaluateMaternalVitals({ hr_bpm: 118, spo2_pct: 93, skin_temp_c: 36.7, flags: 0 }, custom), null);
});

test('SOS: pressed alerts, cancelled does not', () => {
  const alert = evaluateSos({ pressed: true, cancelled: false, seq: 12, battery: 55 });
  assert.equal(alert.type, 'sos');
  assert.equal(alert.severity, 'critical');
  assert.deepEqual(alert.payload, { seq: 12, battery: 55 });
  assert.equal(evaluateSos({ pressed: false, cancelled: true, seq: 13, battery: 55 }), null);
});

test('battery: alert at critical and cutoff, none at low or normal, none while charging', () => {
  const dev = { serial: 'NLB-2026-0412', deviceType: 'belt', charging: false };
  assert.equal(evaluateBattery({ ...dev, pct: 18 }), null);
  assert.equal(evaluateBattery({ ...dev, pct: 11 }), null);
  assert.equal(evaluateBattery({ ...dev, pct: 10 }).payload.level, 'critical');
  assert.equal(evaluateBattery({ ...dev, pct: 8 }).payload.level, 'critical');
  assert.equal(evaluateBattery({ ...dev, pct: 4 }).payload.level, 'cutoff');
  assert.equal(evaluateBattery({ ...dev, pct: 60, vcellMv: 3340 }).payload.level, 'cutoff');
  assert.equal(evaluateBattery({ ...dev, pct: 8, charging: true }), null);
  assert.equal(evaluateBattery({ ...dev, pct: 8 }).payload.serial, 'NLB-2026-0412');
});

test('missed check: 24 hours without a completed check; 23 hours is still fine', () => {
  const now = T0 + 100 * MS_HOUR;
  const base = { pairedAt: now - 30 * 24 * MS_HOUR, now };
  assert.equal(evaluateMissedCheck({ ...base, lastCompletedAt: now - 23 * MS_HOUR }), null);
  const alert = evaluateMissedCheck({ ...base, lastCompletedAt: now - 24 * MS_HOUR });
  assert.equal(alert.type, 'missed_check');
  assert.equal(alert.payload.hours, 24);
  assert.equal(evaluateMissedCheck({ ...base, lastCompletedAt: now - 30 * MS_HOUR }).payload.hours, 30);
});

test('missed check: counted from pairing when there has been no check, and not for a device paired under 24 h ago', () => {
  const now = T0 + 100 * MS_HOUR;
  assert.equal(evaluateMissedCheck({ lastCompletedAt: null, pairedAt: now - 2 * MS_HOUR, now }), null);
  assert.equal(evaluateMissedCheck({ lastCompletedAt: null, pairedAt: now - 48 * MS_HOUR, now }).type, 'missed_check');
  assert.equal(evaluateMissedCheck({ lastCompletedAt: null, pairedAt: null, now }), null);
});

test('missed check hours come from configuration', () => {
  const now = T0 + 100 * MS_HOUR;
  const custom = buildThresholds([{ key: 'missedCheck.hours', value: 12 }]);
  assert.equal(evaluateMissedCheck({ lastCompletedAt: now - 13 * MS_HOUR, pairedAt: now - 99 * MS_HOUR, now }, custom).type, 'missed_check');
});

test('duplicates: an open alert of the same type for the same patient absorbs a new one', () => {
  const alerts = [
    { id: 'a1', patient_id: 'p1', type: 'fhr_out_of_range', status: 'resolved' },
    { id: 'a2', patient_id: 'p1', type: 'fhr_out_of_range', status: 'acknowledged' },
    { id: 'a3', patient_id: 'p2', type: 'fhr_out_of_range', status: 'new' },
  ];
  const next = { type: 'fhr_out_of_range', payload: {} };
  assert.equal(findDuplicate(alerts, 'p1', next).id, 'a2');
  assert.equal(findDuplicate(alerts, 'p2', next).id, 'a3');
  assert.equal(findDuplicate(alerts, 'p3', next), null);
  assert.equal(findDuplicate(alerts, 'p1', { type: 'sos', payload: {} }), null);
  // once resolved, the next one is a new alert
  assert.equal(findDuplicate([alerts[0]], 'p1', next), null);
});

test('duplicates: battery alerts are kept apart per device', () => {
  const alerts = [{ id: 'b1', patient_id: 'p1', type: 'battery_critical', status: 'new', payload: { serial: 'BELT' } }];
  assert.equal(findDuplicate(alerts, 'p1', { type: 'battery_critical', payload: { serial: 'BELT' } }).id, 'b1');
  assert.equal(findDuplicate(alerts, 'p1', { type: 'battery_critical', payload: { serial: 'BAND' } }), null);
});

test('merging counts the duplicate and records when it was last seen', () => {
  assert.deepEqual(mergePatch({ id: 'a' }, 500), { merged_count: 1, last_seen_at: 500 });
  assert.deepEqual(mergePatch({ id: 'a', merged_count: 2 }, 900), { merged_count: 3, last_seen_at: 900 });
});

test('escalation time: 5 minutes, 60 seconds in Quick', () => {
  assert.equal(escalationMs(THRESHOLDS, 'realistic'), 300000);
  assert.equal(escalationMs(THRESHOLDS, 'quick'), 60000);
});

test('escalation: only a new, unacknowledged, not yet escalated alert past the time', () => {
  const alert = { status: 'new', created_at: 1000, escalated_at: null };
  assert.equal(shouldEscalate(alert, 1000 + 299999, 300000), false);
  assert.equal(shouldEscalate(alert, 1000 + 300000, 300000), true);
  assert.equal(shouldEscalate({ ...alert, status: 'acknowledged' }, 1000 + 400000, 300000), false);
  assert.equal(shouldEscalate({ ...alert, status: 'resolved' }, 1000 + 400000, 300000), false);
  assert.equal(shouldEscalate({ ...alert, escalated_at: 1000 + 301000 }, 1000 + 400000, 300000), false);
  assert.equal(shouldEscalate(alert, 1000 + 60000, 60000), true, 'Quick timing');
});

test('thresholds round trip through the table rows and rows override the defaults', () => {
  const rows = flattenThresholds(THRESHOLDS);
  assert.ok(rows.some((row) => row.key === 'fhr.min' && row.value === 110));
  assert.ok(rows.some((row) => row.key === 'battery.cutoffVoltageMv' && row.value === 3350));
  assert.deepEqual(buildThresholds(rows), THRESHOLDS);
  assert.equal(buildThresholds([{ key: 'fhr.max', value: 165 }]).fhr.max, 165);
  assert.equal(THRESHOLDS.fhr.max, 160, 'the defaults are not changed');
});

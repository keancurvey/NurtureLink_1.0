import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS } from '../src/config/thresholds.js';
import { checkStatuses, fhrStatus, maternalHrStatus, skinTempStatus, spo2Status, worstStatus } from '../src/lib/vitalStatus.js';

const summary = (over = {}) => ({ fhr_bpm: 144, confidence: 88, sqi: 80, valid_windows: 28, total_windows: 30, hr_bpm: 84, spo2_pct: 98, skin_temp_c: 36.7, unverified: false, ...over });

test('a normal check is normal in every reading (PAT-H-01)', () => {
  const s = checkStatuses(summary());
  assert.deepEqual([s.fhr, s.hr, s.spo2, s.temp, s.overall], ['normal', 'normal', 'normal', 'normal', 'normal']);
});

test('FHR: outside 110 to 160 is an alert, close to a limit or low confidence needs attention', () => {
  assert.equal(fhrStatus(summary({ fhr_bpm: 109 })), 'alert');
  assert.equal(fhrStatus(summary({ fhr_bpm: 161 })), 'alert');
  assert.equal(fhrStatus(summary({ fhr_bpm: 110 })), 'attention');
  assert.equal(fhrStatus(summary({ fhr_bpm: 114 })), 'attention');
  assert.equal(fhrStatus(summary({ fhr_bpm: 115 })), 'normal');
  assert.equal(fhrStatus(summary({ fhr_bpm: 155 })), 'normal');
  assert.equal(fhrStatus(summary({ fhr_bpm: 156 })), 'attention');
  assert.equal(fhrStatus(summary({ confidence: 59 })), 'attention');
  assert.equal(fhrStatus(summary({ confidence: 60 })), 'normal');
});

test('FHR without a band reading is unverified and needs attention, never rejected (PAT-H-05)', () => {
  assert.equal(fhrStatus(summary({ unverified: true, hr_bpm: null, spo2_pct: null, skin_temp_c: null })), 'attention');
  const s = checkStatuses(summary({ unverified: true, hr_bpm: null, spo2_pct: null, skin_temp_c: null }));
  assert.equal(s.hr, null, 'a reading the band did not give has no status');
  assert.equal(s.overall, 'attention');
});

test('FHR with no usable window needs attention, and a check that was never made has no status', () => {
  assert.equal(fhrStatus(summary({ fhr_bpm: 0, confidence: 0 })), 'attention');
  assert.equal(fhrStatus(null), null);
  assert.equal(checkStatuses(null).overall, null);
});

test('FHR: a sustained low run in the windows is an alert even when the median is in range', () => {
  const windows = Array.from({ length: 10 }, (_, i) => ({ fhr_bpm: 100, confidence: 80, sqi: 80, flags: 0, maternal_match: false, taken_at: i * 4000 }));
  assert.equal(fhrStatus(summary(), THRESHOLDS, windows), 'alert');
  assert.equal(fhrStatus(summary(), THRESHOLDS, windows.slice(0, 5)), 'normal', 'under 30 seconds is not sustained');
});

test('maternal heart rate: 50 to 110, attention within 5 bpm of a limit', () => {
  assert.equal(maternalHrStatus(49), 'alert');
  assert.equal(maternalHrStatus(118), 'alert');
  assert.equal(maternalHrStatus(54), 'attention');
  assert.equal(maternalHrStatus(106), 'attention');
  assert.equal(maternalHrStatus(70), 'normal');
  assert.equal(maternalHrStatus(null), null);
});

test('SpO2 below 95 is an alert, 95 needs attention, 96 and above is normal', () => {
  assert.equal(spo2Status(92), 'alert');
  assert.equal(spo2Status(94), 'alert');
  assert.equal(spo2Status(95), 'attention');
  assert.equal(spo2Status(96), 'normal');
  assert.equal(spo2Status(99), 'normal');
  assert.equal(spo2Status(null), null);
});

test('skin temperature above 38.0 is an alert, within 0.3 of it needs attention', () => {
  assert.equal(skinTempStatus(38.4), 'alert');
  assert.equal(skinTempStatus(38.0), 'attention');
  assert.equal(skinTempStatus(37.8), 'attention');
  assert.equal(skinTempStatus(37.7), 'normal');
  assert.equal(skinTempStatus(36.7), 'normal');
});

test('the overall status is the most serious one, and the limits come from the thresholds given', () => {
  assert.equal(worstStatus('normal', null, 'alert', 'attention'), 'alert');
  assert.equal(worstStatus(null, null), null);
  assert.equal(checkStatuses(summary({ spo2_pct: 92 })).overall, 'alert');
  const stricter = { ...THRESHOLDS, fhr: { ...THRESHOLDS.fhr, max: 150 } };
  assert.equal(fhrStatus(summary({ fhr_bpm: 152 }), stricter), 'alert');
});

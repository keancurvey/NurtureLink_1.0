import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagMaternalMatches, isUsableVitals, isValidWindow, median, summarizeCheck } from '../src/lib/readings.js';
import { FHR_FLAG, VITALS_FLAG } from '../src/lib/packets.js';

const T0 = Date.parse('2026-11-08T02:00:00Z');
const win = (second, fhr, extra = {}) => ({ taken_at: T0 + second * 1000, fhr_bpm: fhr, confidence: 85, sqi: 80, flags: 0, maternal_match: false, ...extra });
const band = (second, hr, extra = {}) => ({ taken_at: T0 + second * 1000, hr_bpm: hr, spo2_pct: 98, skin_temp_c: 36.7, flags: 0, ...extra });

test('a window is valid only with a rate and no discard flag or maternal match', () => {
  assert.equal(isValidWindow(win(0, 140)), true);
  assert.equal(isValidWindow(win(0, 0)), false);
  assert.equal(isValidWindow(win(0, 140, { flags: FHR_FLAG.MOTION })), false);
  assert.equal(isValidWindow(win(0, 140, { flags: FHR_FLAG.POOR_CONTACT })), false);
  assert.equal(isValidWindow(win(0, 140, { flags: FHR_FLAG.LOW_SIGNAL })), false);
  assert.equal(isValidWindow(win(0, 140, { flags: FHR_FLAG.PARTIAL })), false);
  assert.equal(isValidWindow(win(0, 140, { maternal_match: true })), false);
  // out of range is a result, not a discard reason
  assert.equal(isValidWindow(win(0, 100, { flags: FHR_FLAG.OUT_OF_RANGE })), true);
});

test('median handles odd, even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('maternal match: within 5 bpm and within 10 s, both limits inclusive', () => {
  const vitals = [band(30, 84)];
  const flagged = flagMaternalMatches(
    [win(20, 89), win(20, 90), win(40, 79), win(41, 84), win(30, 140), win(0, 85)],
    vitals,
  ).map((w) => w.maternal_match);
  // 89 is 5 away at 10 s: match. 90 is 6 away: no. 79 is 5 away at 10 s: match. 41 is 11 s away: no. 140: no. 0 s is 30 s away: no.
  assert.deepEqual(flagged, [true, false, true, false, false, false]);
});

test('maternal match ignores a band reading that was rejected, weak or partial, and windows with no rate', () => {
  const windows = [win(30, 84), win(30, 0)];
  assert.equal(flagMaternalMatches(windows, [band(30, 84, { flags: VITALS_FLAG.WEAK_SIGNAL })])[0].maternal_match, false);
  assert.equal(flagMaternalMatches(windows, [band(30, 84, { flags: VITALS_FLAG.MOTION_REJECTED })])[0].maternal_match, false);
  assert.equal(flagMaternalMatches(windows, [band(30, 84, { flags: VITALS_FLAG.PARTIAL })])[0].maternal_match, false);
  assert.equal(flagMaternalMatches(windows, [band(30, 0)])[0].maternal_match, false);
  assert.equal(flagMaternalMatches(windows, [band(30, 84)])[1].maternal_match, false, 'no rate, nothing to compare');
  assert.equal(isUsableVitals(band(1, 80)), true);
});

test('the input windows are not changed', () => {
  const windows = [win(30, 84)];
  flagMaternalMatches(windows, [band(30, 84)]);
  assert.equal(windows[0].maternal_match, false);
});

test('summary: median of valid windows, share of valid windows, band values, verified', () => {
  const windows = [win(4, 140), win(8, 144), win(12, 148), win(16, 0), win(20, 150, { flags: FHR_FLAG.MOTION })];
  const summary = summarizeCheck({ windows, vitals: [band(30, 84)] });
  assert.equal(summary.fhr_bpm, 144);
  assert.equal(summary.valid_windows, 3);
  assert.equal(summary.total_windows, 5);
  assert.equal(summary.confidence, 60);
  assert.equal(summary.sqi, 80);
  assert.equal(summary.hr_bpm, 84);
  assert.equal(summary.spo2_pct, 98);
  assert.equal(summary.skin_temp_c, 36.7);
  assert.equal(summary.unverified, false);
});

test('summary: with no usable band reading the FHR is unverified, not rejected (PAT-H-05)', () => {
  const summary = summarizeCheck({ windows: [win(4, 142), win(8, 146)], vitals: [] });
  assert.equal(summary.fhr_bpm, 144);
  assert.equal(summary.unverified, true);
  assert.equal(summary.hr_bpm, null);
  assert.equal(summary.spo2_pct, null);
});

test('summary: windows excluded as maternal signal are counted and left out of the rate', () => {
  const windows = flagMaternalMatches([win(26, 85), win(30, 83), win(34, 142), win(38, 146)], [band(30, 84)]);
  const summary = summarizeCheck({ windows, vitals: [band(30, 84)] });
  assert.equal(summary.maternal_excluded, 2);
  assert.equal(summary.valid_windows, 2);
  assert.equal(summary.fhr_bpm, 144);
});

test('summary of a check with no valid window has rate zero and zero confidence', () => {
  const summary = summarizeCheck({ windows: [win(4, 0), win(8, 0, { flags: FHR_FLAG.LOW_SIGNAL })], vitals: [band(10, 80)] });
  assert.equal(summary.fhr_bpm, 0);
  assert.equal(summary.confidence, 0);
  assert.equal(summary.valid_windows, 0);
  assert.equal(summarizeCheck({ windows: [], vitals: [] }).confidence, 0);
});

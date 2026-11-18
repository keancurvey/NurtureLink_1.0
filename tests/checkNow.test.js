import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNowState } from '../src/lib/checkNow.js';

const belt = (over = {}) => ({ type: 'belt', link_state: 'connected', charging: false, battery_pct: 76, exposure_left_s: 360, ...over });
const band = (over = {}) => ({ type: 'band', link_state: 'connected', charging: false, battery_pct: 64, ...over });
const why = (devices, extra = {}) => checkNowState({ devices, ...extra });

test('both devices connected, charged and allowed: Check now is on (PAT-H-03)', () => {
  assert.deepEqual(why([belt(), band()]), { allowed: true });
});

test('no belt paired: off, with the reason no_belt', () => {
  assert.deepEqual(why([]).reason, { code: 'no_belt' });
  assert.deepEqual(why([band()]).reason, { code: 'no_belt' });
});

test('a belt without a band can still check: the result is unverified instead', () => {
  assert.deepEqual(why([belt()]), { allowed: true });
});

test('a disconnected device turns it off and names the device', () => {
  assert.deepEqual(why([belt({ link_state: 'disconnected' }), band()]).reason, { code: 'disconnected', device: 'belt' });
  assert.deepEqual(why([belt(), band({ link_state: 'disconnected' })]).reason, { code: 'disconnected', device: 'band' });
});

test('charging turns it off, for either device', () => {
  assert.deepEqual(why([belt({ charging: true }), band()]).reason, { code: 'charging', device: 'belt' });
  assert.deepEqual(why([belt(), band({ charging: true })]).reason, { code: 'charging', device: 'band' });
});

test('battery cutoff (5% or less) turns it off; low and critical do not', () => {
  assert.deepEqual(why([belt({ battery_pct: 4 }), band()]).reason, { code: 'cutoff', device: 'belt' });
  assert.deepEqual(why([belt(), band({ battery_pct: 5 })]).reason, { code: 'cutoff', device: 'band' });
  assert.equal(why([belt({ battery_pct: 18 }), band({ battery_pct: 8 })]).allowed, true);
});

test('the belt exposure cap turns it off when fewer seconds are left than a check needs', () => {
  assert.deepEqual(why([belt({ exposure_left_s: 0 }), band()]).reason, { code: 'exposure_cap' });
  assert.deepEqual(why([belt({ exposure_left_s: 119 }), band()]).reason, { code: 'exposure_cap' });
  assert.equal(why([belt({ exposure_left_s: 120 }), band()]).allowed, true);
  assert.equal(why([belt({ exposure_left_s: undefined }), band()]).allowed, true, 'unknown means the full allowance');
});

test('a check in progress is busy; the reasons come in the order the patient can fix them', () => {
  assert.deepEqual(why([belt(), band()], { checking: true }).reason, { code: 'busy' });
  const all = [belt({ link_state: 'disconnected', charging: true, battery_pct: 3, exposure_left_s: 0 }), band()];
  assert.equal(why(all).reason.code, 'disconnected');
  assert.equal(why([belt({ charging: true, battery_pct: 3, exposure_left_s: 0 }), band()]).reason.code, 'charging');
  assert.equal(why([belt({ battery_pct: 3, exposure_left_s: 0 }), band()]).reason.code, 'cutoff');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batteryLevel, voltageForPct } from '../src/lib/battery.js';

test('levels follow spec 9.5', () => {
  assert.equal(batteryLevel(100), 'normal');
  assert.equal(batteryLevel(21), 'normal');
  assert.equal(batteryLevel(20), 'low');
  assert.equal(batteryLevel(11), 'low');
  assert.equal(batteryLevel(10), 'critical');
  assert.equal(batteryLevel(6), 'critical');
  assert.equal(batteryLevel(5), 'cutoff');
  assert.equal(batteryLevel(0), 'cutoff');
});

test('the scenario values land in the intended levels (80, 18, 8, 4)', () => {
  assert.deepEqual([80, 18, 8, 4].map((pct) => batteryLevel(pct)), ['normal', 'low', 'critical', 'cutoff']);
});

test('a cell voltage at or below 3.35 V is cutoff whatever the percentage', () => {
  assert.equal(batteryLevel(60, 3350), 'cutoff');
  assert.equal(batteryLevel(60, 3351), 'normal');
  assert.equal(batteryLevel(60, null), 'normal');
});

test('voltage follows the cell curve and falls as the charge falls', () => {
  assert.equal(voltageForPct(100), 4200);
  assert.equal(voltageForPct(50), 3800);
  assert.equal(voltageForPct(5), 3500);
  assert.equal(voltageForPct(0), 3300);
  assert.ok(voltageForPct(76) > voltageForPct(64));
  assert.ok(voltageForPct(4) > 3350, 'cutoff at 4% comes from the percentage, not the voltage');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcEdd, gestationalAge, trimester, countdown, isNearDue, NAEGELE_DAYS } from '../src/lib/pregnancy.js';
import { addDays, daysBetween, manilaDate, manilaDayStart, manilaTime } from '../src/lib/dates.js';

test('EDD is LMP + 280 days (Naegele)', () => {
  assert.equal(NAEGELE_DAYS, 280);
  assert.equal(calcEdd('2026-01-01'), '2026-10-08');
  assert.equal(calcEdd('2024-03-01'), '2024-12-06'); // across a leap day
  assert.equal(daysBetween('2026-01-01', calcEdd('2026-01-01')), 280);
});

test('gestational age is whole weeks and days', () => {
  assert.deepEqual(gestationalAge('2026-01-01', '2026-01-01'), { totalDays: 0, weeks: 0, days: 0 });
  assert.deepEqual(gestationalAge('2026-01-01', '2026-01-07'), { totalDays: 6, weeks: 0, days: 6 });
  assert.deepEqual(gestationalAge('2026-01-01', '2026-01-08'), { totalDays: 7, weeks: 1, days: 0 });
  // 31 weeks 2 days = 219 days
  const lmp = addDays('2026-11-08', -219);
  assert.deepEqual(gestationalAge(lmp, '2026-11-08'), { totalDays: 219, weeks: 31, days: 2 });
});

test('an LMP in the future gives zero, never a negative age', () => {
  assert.deepEqual(gestationalAge('2026-02-01', '2026-01-01'), { totalDays: 0, weeks: 0, days: 0 });
});

test('trimester boundaries: 13w6d is first, 14w0d second, 27w6d second, 28w0d third', () => {
  assert.equal(trimester(13 * 7 + 6), 1);
  assert.equal(trimester(14 * 7), 2);
  assert.equal(trimester(27 * 7 + 6), 2);
  assert.equal(trimester(28 * 7), 3);
  assert.equal(trimester(0), 1);
});

test('countdown counts days to the EDD and flags a passed EDD', () => {
  assert.deepEqual(countdown('2026-11-18', '2026-11-08'), { days: 10, weeks: 1, remainderDays: 3, overdue: false });
  assert.deepEqual(countdown('2026-11-08', '2026-11-08'), { days: 0, weeks: 0, remainderDays: 0, overdue: false });
  assert.deepEqual(countdown('2026-11-05', '2026-11-08'), { days: -3, weeks: 0, remainderDays: 3, overdue: true });
});

test('near-due means the EDD is today or within 14 days', () => {
  assert.equal(isNearDue('2026-11-22', '2026-11-08'), true); // 14 days
  assert.equal(isNearDue('2026-11-23', '2026-11-08'), false); // 15 days
  assert.equal(isNearDue('2026-11-08', '2026-11-08'), true);
  assert.equal(isNearDue('2026-11-07', '2026-11-08'), false); // already past
  assert.equal(isNearDue('2026-11-30', '2026-11-08', 30), true); // window comes from configuration
});

test('38 weeks 0 days is exactly 14 days before the EDD', () => {
  const lmp = addDays('2026-11-08', -(38 * 7));
  assert.equal(countdown(calcEdd(lmp), '2026-11-08').days, 14);
  assert.equal(isNearDue(calcEdd(lmp), '2026-11-08'), true);
});

test('Manila calendar dates and day starts', () => {
  // 16:00 UTC on Nov 8 is midnight on Nov 9 in Manila
  assert.equal(manilaDate(Date.parse('2026-11-08T15:59:00Z')), '2026-11-08');
  assert.equal(manilaDate(Date.parse('2026-11-08T16:00:00Z')), '2026-11-09');
  assert.equal(manilaDayStart('2026-11-09'), Date.parse('2026-11-08T16:00:00Z'));
  assert.equal(manilaTime('2026-11-09', 8, 30), Date.parse('2026-11-09T00:30:00Z'));
});

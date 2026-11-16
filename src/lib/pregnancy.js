// Pregnancy dates (PAT-P-02). EDD is LMP + 280 days (Naegele's rule); gestational age is shown as weeks and days.
import { THRESHOLDS } from '../config/thresholds.js';
import { addDays, daysBetween } from './dates.js';

export const NAEGELE_DAYS = 280;

/** Expected date of delivery from the last menstrual period. */
export function calcEdd(lmp) {
  return addDays(lmp, NAEGELE_DAYS);
}

/** Gestational age on a given day: { totalDays, weeks, days }. Negative totals (LMP in the future) are clamped to zero. */
export function gestationalAge(lmp, today) {
  const totalDays = Math.max(0, daysBetween(lmp, today));
  return { totalDays, weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
}

/** First trimester up to 13w6d, second up to 27w6d, third from 28w0d. */
export function trimester(totalDays) {
  const weeks = Math.floor(totalDays / 7);
  if (weeks < 14) return 1;
  if (weeks < 28) return 2;
  return 3;
}

/** Days until the EDD (negative once it has passed) and the same as weeks and days. */
export function countdown(edd, today) {
  const days = daysBetween(today, edd);
  const abs = Math.abs(days);
  return { days, weeks: Math.floor(abs / 7), remainderDays: abs % 7, overdue: days < 0 };
}

/** Near-due: the EDD is today or within the window (default 14 days, PLAN.md Section 5.9). */
export function isNearDue(edd, today, windowDays = THRESHOLDS.nearDueDays) {
  const { days } = countdown(edd, today);
  return days >= 0 && days <= windowDays;
}

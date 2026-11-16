// Date helpers for the Asia/Manila calendar. Pure dates are 'YYYY-MM-DD' strings; instants are epoch milliseconds.
// Manila has no daylight saving time, so its offset from UTC is a constant 8 hours.
import { TIME_ZONE } from './time.js';

export const MS_MINUTE = 60 * 1000;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;
const MANILA_OFFSET_MS = 8 * MS_HOUR;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Manila calendar date of an instant, for example '2026-11-08'. */
export function manilaDate(ms) {
  return dayFormat.format(new Date(ms));
}

function dateToUtcMs(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date, days) {
  return new Date(dateToUtcMs(date) + days * MS_DAY).toISOString().slice(0, 10);
}

/** Whole days from date a to date b (b minus a). */
export function daysBetween(a, b) {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / MS_DAY);
}

/** The instant a Manila calendar day starts. */
export function manilaDayStart(date) {
  return dateToUtcMs(date) - MANILA_OFFSET_MS;
}

/** The instant of a given hour and minute on a Manila calendar day. */
export function manilaTime(date, hour, minute = 0) {
  return manilaDayStart(date) + hour * MS_HOUR + minute * MS_MINUTE;
}

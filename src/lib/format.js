// Dates and times for the screens. Always Asia/Manila, 12-hour, through Intl (CLAUDE.md, Locale).
import { TIME_ZONE } from './time.js';

const LOCALES = { en: 'en-PH', fil: 'fil-PH' };
const localeOf = (lang) => LOCALES[lang] ?? LOCALES.en;

/** For example "Nov 18, 3:45 pm". */
export function formatDateTime(ms, lang = 'en') {
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ms));
}

/** "now", "5 min. ago", "2 hr. ago"; older than a day falls back to the date and time. */
export function formatRelative(ms, nowMs, lang = 'en') {
  const seconds = Math.max(0, Math.round((nowMs - ms) / 1000));
  const format = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto', style: 'short' });
  if (seconds < 45) return format.format(0, 'second');
  if (seconds < 3600) return format.format(-Math.max(1, Math.round(seconds / 60)), 'minute');
  if (seconds < 24 * 3600) return format.format(-Math.round(seconds / 3600), 'hour');
  return formatDateTime(ms, lang);
}

/** Time of day only, for example "3:45 pm". */
export function formatTime(ms, lang = 'en') {
  return new Intl.DateTimeFormat(localeOf(lang), { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
}

/** A Manila calendar date ('YYYY-MM-DD') in full, for example "Friday, November 27". With year: "Friday, November 27, 2026". */
export function formatDateLong(date, lang = 'en', { year = false } = {}) {
  return new Intl.DateTimeFormat(localeOf(lang), { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }).format(new Date(`${date}T12:00:00Z`));
}

/** A date without the weekday, for example "Nov 27, 2026". */
export function formatDateShort(date, lang = 'en') {
  return new Intl.DateTimeFormat(localeOf(lang), { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

/** "today", "tomorrow", "in 3 days" (days remaining) through Intl. */
export function formatDaysAway(days, lang = 'en') {
  return new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' }).format(days, 'day');
}

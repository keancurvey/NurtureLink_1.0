// Schedule rules (PAT-S-01 to PAT-S-03): what goes on the calendar, which dates are marked, the month grid, the
// upcoming list and the days remaining. Pure: the screens turn kinds, statuses and numbers into text.
import { isConfirmed } from './consult.js';
import { addDays, daysBetween, manilaDate } from './dates.js';

/** The kinds of item on a calendar, in the order their marks are drawn. An appointment's kind is its type. */
export const KINDS = ['clinic', 'hospital', 'teleconsult', 'event'];

/** An appointment sits on the calendar once it has a date: approved, or finished as attended, missed or rescheduled. */
const ON_CALENDAR = ['approved', 'attended', 'missed', 'rescheduled'];

/**
 * Calendar items from appointment and event rows: { key, source, id, kind, status, startsAt, endsAt, date, row }.
 * Requests still waiting for approval and declined ones have no date, so they are not on the calendar (they live
 * under Consult). Events have no status.
 */
export function calendarItems({ appointments = [], events = [] }) {
  const items = [];
  for (const row of appointments) {
    if (row.scheduled_at == null || !ON_CALENDAR.includes(row.status)) continue;
    items.push({ key: `apt:${row.id}`, source: 'appointment', id: row.id, kind: row.type, status: row.status, startsAt: row.scheduled_at, endsAt: null, date: manilaDate(row.scheduled_at), row });
  }
  for (const row of events) {
    items.push({ key: `evt:${row.id}`, source: 'event', id: row.id, kind: 'event', status: null, startsAt: row.starts_at, endsAt: row.ends_at ?? null, date: manilaDate(row.starts_at), row });
  }
  return items.sort((a, b) => a.startsAt - b.startsAt || a.key.localeCompare(b.key));
}

/** The kinds that mark each date: Map of 'YYYY-MM-DD' to kinds, in KINDS order. */
export function markersByDate(items) {
  const marks = new Map();
  for (const item of items) {
    const set = marks.get(item.date) ?? new Set();
    set.add(item.kind);
    marks.set(item.date, set);
  }
  return new Map([...marks].map(([date, kinds]) => [date, KINDS.filter((kind) => kinds.has(kind))]));
}

export const itemsOn = (items, date) => items.filter((item) => item.date === date);

/** Whole days from today to a date (0 today, 1 tomorrow, negative in the past). */
export const daysRemaining = (date, today) => daysBetween(today, date);

/**
 * The upcoming list (PAT-S-03), in date order. An approved appointment stays on it for the rest of its day, and until
 * it is marked attended; an event stays until it ends. Each entry carries its days remaining.
 */
export function upcomingItems(items, now) {
  const today = manilaDate(now);
  return items
    .filter((item) => (item.source === 'appointment' ? isConfirmed(item.row) && item.date >= today : (item.endsAt ?? item.startsAt) >= now))
    .map((item) => ({ ...item, days: daysRemaining(item.date, today) }));
}

// ---------- The month grid (PAT-S-01) ----------

/** { year, month } of a 'YYYY-MM-DD' date; month is 1 to 12. */
export const monthOf = (date) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

export function shiftMonth({ year, month }, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const pad = (n) => String(n).padStart(2, '0');
export const firstOfMonth = ({ year, month }) => `${year}-${pad(month)}-01`;

/**
 * The weeks to draw for a month: arrays of seven { date, inMonth }, starting on Sunday (weekStart 0) or Monday (1).
 * Days of the neighbouring months fill the first and last week.
 */
export function monthGrid({ year, month }, weekStart = 0) {
  const first = firstOfMonth({ year, month });
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const lead = (weekday - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((lead + length) / 7);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: 7 }, (_, col) => {
      const date = addDays(start, row * 7 + col);
      return { date, inMonth: date.slice(0, 7) === `${year}-${pad(month)}` };
    }),
  );
}

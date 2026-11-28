// The approvals queue of the super accounts (SUP-C-01, ACC-05): which requests are in it, how a decision is checked, and the
// time a decision stands for. Pure: the screens turn the kinds, statuses and codes into text.
import { CHAT } from '../config/thresholds.js';
import { REASON_MAX, validateNote } from './alertView.js';
import { MS_MINUTE, daysBetween, manilaDate, manilaDayStart, manilaTime } from './dates.js';

/** The kinds of request in the queue: a booking, a new time for a visit, a change of barangay, a time proposed by a barangay account. */
export const REQUEST_KINDS = ['booking', 'reschedule', 'barangay_change', 'appointment_proposal'];

const isBooking = (a) => (a.type === 'clinic' || a.type === 'teleconsult') && a.requested_at != null && ['pending', 'approved', 'declined', 'rescheduled'].includes(a.status) && (a.status === 'pending' || Boolean(a.handled_by));

/**
 * Everything the queue shows, as items { key, kind, id, patient_id, status, at, handled_by, handled_at, row }. A booking is an
 * appointment a patient asked for (the seeded check-ups were never asked for, so they have no handler and are left out). Requests
 * still waiting on a phone (syncState 'queued') are not in the queue yet.
 */
export function approvalItems({ appointments, requests }) {
  const items = [];
  for (const row of appointments) {
    if (!isBooking(row) || row.syncState === 'queued') continue;
    items.push({ key: `apt:${row.id}`, kind: 'booking', id: row.id, patient_id: row.patient_id, status: row.status, at: row.requested_at, handled_by: row.handled_by ?? null, handled_at: row.handled_at ?? null, row });
  }
  for (const row of requests) {
    if (!REQUEST_KINDS.includes(row.kind) || row.syncState === 'queued') continue;
    items.push({ key: `req:${row.id}`, kind: row.kind, id: row.id, patient_id: row.patient_id, status: row.status, at: row.created_at, handled_by: row.handled_by ?? null, handled_at: row.handled_at ?? null, row });
  }
  return items;
}

/** The ones still waiting, oldest first (the one waiting longest is on top). */
export const pendingItems = (items) => items.filter((item) => item.status === 'pending').sort((a, b) => a.at - b.at);

/** The ones decided, newest decision first. */
export const handledItems = (items) => items.filter((item) => item.status !== 'pending').sort((a, b) => (b.handled_at ?? b.at) - (a.handled_at ?? a.at));

/** The instant a date ('YYYY-MM-DD') and a time ('HH:MM') stand for in Manila time, or null when either is missing or wrong. */
export function scheduledAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '')) return null;
  return manilaTime(date, Number(time.slice(0, 2)), Number(time.slice(3)));
}

/** The time of day of an instant in Manila, as 'HH:MM' (what a time field holds). */
export function timeOf(ms) {
  const minutes = Math.floor((ms - manilaDayStart(manilaDate(ms))) / MS_MINUTE);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * What the approval form starts with: the date and time she asked for (the start of her preferred range, or the visit's own time for a
 * new time), and the account deciding as the assigned midwife (spec 3.3: the approving account becomes the assigned midwife).
 * `reschedule` mode starts empty so the new time is chosen, not copied.
 */
export function decisionDefaults(item, { viewerId, appointment = null, mode = 'approve' }) {
  const row = item.row;
  const from = item.kind === 'reschedule' ? appointment?.scheduled_at : row.preferred_start;
  const date = item.kind === 'reschedule' ? row.preferred_date ?? (from ? manilaDate(from) : '') : from ? manilaDate(from) : '';
  return mode === 'reschedule' ? { date: '', time: '', provider_id: viewerId } : { date, time: from ? timeOf(from) : '', provider_id: viewerId };
}

/**
 * The form of an approval or a new time: the date, the time and the super account who becomes the assigned midwife. Codes: required,
 * invalid, past, tooFar (more than CHAT.bookingHorizonDays ahead) and provider (not an active super account).
 */
export function validateDecision({ date, time, provider_id: providerId }, { now, today, activeSuperIds }) {
  const errors = {};
  if (!date) errors.date = 'required';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.date = 'invalid';
  else if (date < today) errors.date = 'past';
  else if (daysBetween(today, date) > CHAT.bookingHorizonDays) errors.date = 'tooFar';
  if (!time) errors.time = 'required';
  else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = 'invalid';
  if (!errors.date && !errors.time && scheduledAt(date, time) < now) errors.time = 'past';
  if (!providerId || !activeSuperIds.includes(providerId)) errors.provider_id = 'provider';
  return errors;
}

/** The reason for declining: needed, at most REASON_MAX characters. Answers { ok, value } or { ok: false, error: 'required' | 'too_long' }. */
export const validateDeclineReason = (reason) => validateNote(reason, REASON_MAX);
export { REASON_MAX };

// Consult rules (PAT-C-01 to PAT-C-06, ACC-03, D-01, D-02). Pure: the screens turn codes and numbers into text.
import { CHAT, THRESHOLDS } from '../config/thresholds.js';
import { MS_MINUTE, addDays, daysBetween, manilaTime } from './dates.js';
import { REASON_MAX } from './profileRules.js';

export const BOOKING_TYPES = ['clinic', 'teleconsult'];
/** The time ranges a patient can prefer, as [from hour, to hour] in Manila time. */
export const BOOKING_WINDOWS = { any: [8, 17], morning: [8, 12], afternoon: [13, 17] };
/** The drawn pictures the gear can attach (the picker attaches her own pictures). */
export const ATTACHMENT_ARTS = ['meal', 'booklet', 'crib'];
/** The statuses a booking request shows (PAT-C-04). */
export const BOOKING_STATUSES = ['pending', 'approved', 'declined', 'rescheduled'];

// ---------- Threads (PAT-C-01, PAT-C-03) ----------

/**
 * Whether a thread takes messages. The barangay inbox is always open (ACC-03). The midwife thread is open until
 * `unlocked_until`: from the approval, through the appointment and 24 hours after it (D-02). Locked, it says why:
 * 'no_appointment' (nothing approved yet) or 'follow_up_over' (the window after the appointment has passed).
 */
export function threadLock(conversation, now) {
  if (conversation.kind === 'barangay') return { open: true, reason: null };
  const until = conversation.unlocked_until ?? null;
  if (until && until > now) return { open: true, reason: null, until };
  return { open: false, reason: until ? 'follow_up_over' : 'no_appointment' };
}

/**
 * Where a message has got to (PAT-C-02): 'sending' (made offline, still on the phone), 'sent' (the server has it),
 * 'delivered' (it reached the other phone) or 'seen'. Delivery and seen times may lie a moment ahead of the clock.
 */
export function messageState(message, now) {
  if (message.syncState === 'queued') return 'sending';
  if (message.seen_at && message.seen_at <= now) return 'seen';
  if (message.delivered_at && message.delivered_at <= now) return 'delivered';
  return 'sent';
}

/** Messages that came from someone else and have not been seen yet. */
export const unseenFrom = (messages, viewerId) => messages.filter((m) => m.sender_id !== viewerId && !m.seen_at);

/** What a message says in a list: its text, or a note that it holds a photo. */
export const hasPhoto = (message) => Boolean(message.attachment_url || message.attachment_art);

// ---------- Messages ----------

/** A message needs words or a photo, and at most CHAT.messageMax characters. Answers an error code or null. */
export function validateMessage({ body = '', attachment = false } = {}) {
  const text = body.trim();
  if (!text && !attachment) return 'empty';
  if (text.length > CHAT.messageMax) return 'tooLong';
  return null;
}

/** A picture kept with a message: a small JPEG made on the phone, or the name of a drawn picture. */
export function validAttachment({ attachment_url = null, attachment_art = null } = {}) {
  if (attachment_url !== null && attachment_art !== null) return false;
  if (attachment_art !== null) return ATTACHMENT_ARTS.includes(attachment_art);
  if (attachment_url === null) return true;
  return typeof attachment_url === 'string' && attachment_url.length <= CHAT.photoMaxChars && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(attachment_url);
}

/** A client id for a message made on this phone; the server removes duplicates by it (spec 3.2). */
export const newClientId = (now = Date.now(), random = Math.random) => `cid_${now.toString(36)}${Math.floor(random() * 36 ** 6).toString(36)}`;

// ---------- Booking (PAT-C-04, D-01) ----------

/** The instants a preferred date and time range stand for. */
export function preferredRange(date, window) {
  const [from, to] = BOOKING_WINDOWS[window] ?? BOOKING_WINDOWS.any;
  return { start: manilaTime(date, from), end: manilaTime(date, to) };
}

/**
 * The form of a booking request: { type, preferred_date, window, reason }. Answers { field: code } with codes required,
 * invalid, past, tooFar and tooLong, empty when all is well.
 */
export function validateBooking({ type, preferred_date, window, reason }, { today }) {
  const errors = {};
  if (!BOOKING_TYPES.includes(type)) errors.type = 'required';
  if (!preferred_date) errors.preferred_date = 'required';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred_date) || Number.isNaN(Date.parse(preferred_date))) errors.preferred_date = 'invalid';
  else if (preferred_date < today) errors.preferred_date = 'past';
  else if (daysBetween(today, preferred_date) > CHAT.bookingHorizonDays) errors.preferred_date = 'tooFar';
  if (!Object.keys(BOOKING_WINDOWS).includes(window)) errors.window = 'required';
  const text = (reason ?? '').trim();
  if (!text) errors.reason = 'required';
  else if (text.length > REASON_MAX) errors.reason = 'tooLong';
  return errors;
}

export const latestBookingDate = (today) => addDays(today, CHAT.bookingHorizonDays);

/**
 * The patient's booking requests, newest first: the ones still waiting, the ones declined, and the ones a super account
 * approved or gave a new time, for as long as the visit is ahead or running. A check-up the seed made for her is not a
 * request, and a visit that is over lives in her check-up history (Profile).
 */
export function bookingRows(appointments, now) {
  const th = THRESHOLDS.videoJoin;
  return appointments
    .filter((a) => {
      if (!BOOKING_STATUSES.includes(a.status)) return false;
      if (a.status === 'pending' || a.status === 'declined') return true;
      if (!a.handled_by) return false;
      return a.scheduled_at == null || a.scheduled_at + th.afterMinutes * MS_MINUTE > now;
    })
    .sort((a, b) => (b.requested_at ?? 0) - (a.requested_at ?? 0));
}

// ---------- Joining the video call (PAT-C-05, VID-02) ----------

/**
 * Whether the Join video button works for an appointment: 'early' (opens at `opens`), 'open' (until `closes`), 'over', or
 * 'unavailable' for anything that is not an approved teleconsultation with a time. The window is 10 minutes before to 60
 * minutes after the scheduled time.
 */
export function joinState(appointment, now, th = THRESHOLDS) {
  if (!appointment || appointment.type !== 'teleconsult' || appointment.status !== 'approved' || appointment.scheduled_at == null) return { state: 'unavailable' };
  const opens = appointment.scheduled_at - th.videoJoin.beforeMinutes * MS_MINUTE;
  const closes = appointment.scheduled_at + th.videoJoin.afterMinutes * MS_MINUTE;
  if (now < opens) return { state: 'early', opens };
  if (now > closes) return { state: 'over', closes };
  return { state: 'open', opens, closes };
}

/** The approved teleconsultation to show first: the one running now, otherwise the next one. Null when there is none. */
export function nextTeleconsult(appointments, now) {
  return (
    appointments
      .filter((a) => joinState(a, now).state === 'open' || joinState(a, now).state === 'early')
      .sort((a, b) => a.scheduled_at - b.scheduled_at)[0] ?? null
  );
}

// Account management of the super accounts (SUP-P-01, ACC-06, ACC-08, ACC-09): the form of a new account, the temporary password,
// who may be deactivated, what is left open when an account is, and which barangays have no active account. Pure: the screens turn
// the codes into text.
import { isEmail, isPhoneNumber } from './authRules.js';

/** The roles a super account can create (ACC-06). */
export const PROVIDER_ROLES = ['barangay', 'super'];
export const LANGUAGES = ['en', 'fil'];

/**
 * A new barangay or super account: role, full name (two words), email, contact number, language and, for a barangay account, its
 * barangay. Codes: required, fullName, email, phone, barangay. Whether the email or number is already used is checked by the service.
 */
export function validateNewAccount({ role, full_name, email, contact_no, barangay_id, language }, { barangayIds }) {
  const errors = {};
  if (!PROVIDER_ROLES.includes(role)) errors.role = 'required';
  if (!String(full_name ?? '').trim()) errors.full_name = 'required';
  else if (String(full_name).trim().split(/\s+/).length < 2) errors.full_name = 'fullName';
  if (!String(email ?? '').trim()) errors.email = 'required';
  else if (!isEmail(email)) errors.email = 'email';
  if (!String(contact_no ?? '').trim()) errors.contact_no = 'required';
  else if (!isPhoneNumber(contact_no)) errors.contact_no = 'phone';
  if (role === 'barangay') {
    if (!barangay_id) errors.barangay_id = 'required';
    else if (!barangayIds.includes(barangay_id)) errors.barangay_id = 'barangay';
  }
  if (!LANGUAGES.includes(language)) errors.language = 'required';
  return errors;
}

/** The contact number of an existing account. Codes: required, phone. */
export function validateContact({ contact_no }) {
  if (!String(contact_no ?? '').trim()) return { contact_no: 'required' };
  return isPhoneNumber(contact_no) ? {} : { contact_no: 'phone' };
}

const WORDS = ['Lakbay', 'Bayanihan', 'Tahanan', 'Bulaklak', 'Sinag', 'Pagmamahal', 'Kalinga', 'Ligaya', 'Tanglaw', 'Ginhawa'];

/**
 * A temporary password the account must change at its first sign-in (AUTH-03): two words, a number and a dash, for example
 * "Kalinga-Sinag-4827". It always meets the password rules (a capital, a small letter, a number, at least 8 characters).
 */
export function temporaryPassword(random = Math.random) {
  const pick = () => WORDS[Math.floor(random() * WORDS.length)];
  const first = pick();
  let second = pick();
  if (second === first) second = WORDS[(WORDS.indexOf(first) + 1) % WORDS.length];
  return `${first}-${second}-${1000 + Math.floor(random() * 9000)}`;
}

/**
 * Whether an account may be deactivated now. Answers { ok: true } or { ok: false, error } with error one of:
 *   not_found (no such barangay or super account), inactive (already deactivated), last_super (the last active super account
 *   cannot be deactivated, ACC-06) and self (an account does not deactivate itself; another super account does it).
 */
export function canDeactivate(target, viewerId, profiles) {
  if (!target || !PROVIDER_ROLES.includes(target.role)) return { ok: false, error: 'not_found' };
  if (!target.active) return { ok: false, error: 'inactive' };
  if (target.role === 'super' && profiles.filter((p) => p.role === 'super' && p.active).length <= 1) return { ok: false, error: 'last_super' };
  if (target.id === viewerId) return { ok: false, error: 'self' };
  return { ok: true };
}

/** The barangays that have no active barangay account (ACC-09), in the order given. */
export function uncoveredBarangays(profiles, barangays) {
  return barangays.filter((b) => !profiles.some((p) => p.role === 'barangay' && p.active && p.barangay_id === b.id));
}

/**
 * What an account leaves open (ACC-08): for a super account its upcoming appointments and its midwife threads, for a barangay
 * account the alerts it acknowledged and has not resolved. Input: the profile, `now`, and the tables. Answers
 * { appointments, threads, alerts } as lists of ids (an empty list means nothing to hand over).
 */
export function openItemsOf(profile, { now, appointments, conversations, alerts }) {
  if (profile.role === 'super') {
    return {
      appointments: appointments.filter((a) => a.provider_id === profile.id && a.scheduled_at != null && a.scheduled_at > now && ['approved', 'rescheduled'].includes(a.status)).map((a) => a.id),
      threads: conversations.filter((c) => c.kind === 'midwife' && c.assigned_provider_id === profile.id).map((c) => c.id),
      alerts: [],
    };
  }
  return { appointments: [], threads: [], alerts: alerts.filter((a) => a.status === 'acknowledged' && a.acknowledged_by === profile.id).map((a) => a.id) };
}

/** Whether anything is left open. */
export const hasOpenItems = (open) => open.appointments.length + open.threads.length + open.alerts.length > 0;

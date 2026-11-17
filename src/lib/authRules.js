// Pure rules for the signed-out screens: contact numbers, passwords, birthdates, and what each form must hold.
// A validator returns { field: code } and an empty object when the form is fine; screens turn the code into text
// (auth:error.<code>), so the same rule serves the screen and the in-process sign-in service.
import { AUTH } from '../config/thresholds.js';
import { daysBetween } from './dates.js';

/** The ten digits after the leading 0 of a Philippine mobile number, or null when it is not one. Accepts 09xx, 9xx and +63. */
function mobileDigits(raw) {
  const digits = String(raw ?? '').replace(/[\s().-]/g, '').replace(/^\+/, '');
  const match = /^(?:63|0)?(9\d{9})$/.exec(digits);
  return match ? match[1] : null;
}

export const isPhoneNumber = (raw) => mobileDigits(raw) !== null;

/** The number as it is stored and shown: 0917 555 0201. Anything that is not a mobile number comes back trimmed. */
export function formatPhone(raw) {
  const ten = mobileDigits(raw);
  return ten ? `0${ten.slice(0, 3)} ${ten.slice(3, 6)} ${ten.slice(6)}` : String(raw ?? '').trim();
}

/** The key two spellings of one number share, or an email in lower case. Used to find an account and to count failed attempts. */
export function identifierKey(raw) {
  const text = String(raw ?? '').trim();
  if (text.includes('@')) return text.toLowerCase();
  const ten = mobileDigits(text);
  return ten ? `0${ten}` : text.toLowerCase();
}

export const isEmail = (raw) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw ?? '').trim());

/** Whole years on a given Manila date ('YYYY-MM-DD'). */
export function ageOn(birthdate, today) {
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export const isMinor = (birthdate, today) => ageOn(birthdate, today) < 18;

const isRealDate = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text ?? '') && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;

/** The rules a password must meet, each with whether it does: [{ id, ok }]. Shown as a checklist while typing. */
export function passwordChecks(password = '') {
  return [
    { id: 'length', ok: password.length >= AUTH.minPasswordLength },
    { id: 'upper', ok: /[A-Z]/.test(password) },
    { id: 'lower', ok: /[a-z]/.test(password) },
    { id: 'number', ok: /\d/.test(password) },
  ];
}
export const isStrongPassword = (password) => passwordChecks(password).every((rule) => rule.ok);

// ---------- Forms ----------

export function validateSignIn({ identifier, password }) {
  const errors = {};
  if (!String(identifier ?? '').trim()) errors.identifier = 'required';
  else if (!isEmail(identifier) && !isPhoneNumber(identifier)) errors.identifier = 'identifier';
  if (!password) errors.password = 'required';
  return errors;
}

export function validateSignUp({ full_name, birthdate, contact_no, barangay_id, password, language }, { today, barangayIds }) {
  const errors = {};
  if (!String(full_name ?? '').trim()) errors.full_name = 'required';
  else if (String(full_name).trim().split(/\s+/).length < 2) errors.full_name = 'fullName';
  if (!birthdate) errors.birthdate = 'required';
  else if (!isRealDate(birthdate)) errors.birthdate = 'date';
  else if (daysBetween(today, birthdate) >= 0 || ageOn(birthdate, today) > 100) errors.birthdate = 'birthdate';
  if (!String(contact_no ?? '').trim()) errors.contact_no = 'required';
  else if (!isPhoneNumber(contact_no)) errors.contact_no = 'phone';
  if (!barangay_id) errors.barangay_id = 'required';
  else if (!barangayIds.includes(barangay_id)) errors.barangay_id = 'barangay';
  if (!password) errors.password = 'required';
  else if (!isStrongPassword(password)) errors.password = 'weak';
  if (!['en', 'fil'].includes(language)) errors.language = 'required';
  return errors;
}

export function validateGuardian({ guardian_name, relationship, contact, acknowledged }) {
  const errors = {};
  if (!String(guardian_name ?? '').trim()) errors.guardian_name = 'required';
  else if (String(guardian_name).trim().split(/\s+/).length < 2) errors.guardian_name = 'fullName';
  if (!relationship) errors.relationship = 'required';
  if (!String(contact ?? '').trim()) errors.contact = 'required';
  else if (!isPhoneNumber(contact)) errors.contact = 'phone';
  if (!acknowledged) errors.acknowledged = 'acknowledge';
  return errors;
}

/** Relationships the guardian form offers; the stored value is the key. */
export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'grandmother', 'grandfather', 'aunt', 'uncle', 'legal_guardian'];

export function validateNewPassword({ password }, { current = null } = {}) {
  if (!password) return { password: 'required' };
  if (!isStrongPassword(password)) return { password: 'weak' };
  if (current !== null && password === current) return { password: 'same' };
  return {};
}

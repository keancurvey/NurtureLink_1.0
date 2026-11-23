// Pure rules for the patient's Profile and Schedule forms (PAT-P-01, PAT-S-05). A validator returns { field: code } and an
// empty object when the form is fine; screens turn the code into text (profile:error.<code>), so the same rule serves the
// screen and the in-process service.
import { isPhoneNumber, validateNewPassword } from './authRules.js';
import { daysBetween } from './dates.js';

/** Who the emergency contact is; the stored value is the key. */
export const EMERGENCY_RELATIONSHIPS = ['husband', 'partner', 'mother', 'father', 'sister', 'brother', 'other'];
/** The drawn avatars a patient can choose instead of a photo (the SoftArt names the seeded avatars use). */
export const AVATAR_CHOICES = ['heart', 'shield', 'calendar', 'chat', 'bell'];

export const NAME_MAX = 60;
export const REASON_MAX = 300;

const text = (value) => String(value ?? '').trim();

export function validatePersonal({ contact_no, emergency_name, emergency_relationship, emergency_no }) {
  const errors = {};
  if (!text(contact_no)) errors.contact_no = 'required';
  else if (!isPhoneNumber(contact_no)) errors.contact_no = 'phone';
  if (!text(emergency_name)) errors.emergency_name = 'required';
  else if (text(emergency_name).split(/\s+/).length < 2) errors.emergency_name = 'fullName';
  else if (text(emergency_name).length > NAME_MAX) errors.emergency_name = 'tooLong';
  if (!EMERGENCY_RELATIONSHIPS.includes(emergency_relationship)) errors.emergency_relationship = 'required';
  if (!text(emergency_no)) errors.emergency_no = 'required';
  else if (!isPhoneNumber(emergency_no)) errors.emergency_no = 'phone';
  return errors;
}

/** A reschedule request: a reason, and optionally the date she would like instead (after today). */
export function validateReschedule({ reason, preferred_date }, { today }) {
  const errors = {};
  if (!text(reason)) errors.reason = 'required';
  else if (text(reason).length > REASON_MAX) errors.reason = 'tooLong';
  if (preferred_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) errors.preferred_date = 'date';
    else if (daysBetween(today, preferred_date) < 1) errors.preferred_date = 'future';
  }
  return errors;
}

/** A barangay change request: another barangay, and an optional reason. */
export function validateBarangayChange({ barangay_id, reason }, { current, barangayIds }) {
  const errors = {};
  if (!barangay_id) errors.barangay_id = 'required';
  else if (!barangayIds.includes(barangay_id)) errors.barangay_id = 'barangay';
  else if (barangay_id === current) errors.barangay_id = 'same_barangay';
  if (text(reason).length > REASON_MAX) errors.reason = 'tooLong';
  return errors;
}

/** Change password from Settings: the current password, a strong new one that is different, and the same again. */
export function validateChangePassword({ current, password, confirm }) {
  const errors = {};
  if (!current) errors.current = 'required';
  Object.assign(errors, validateNewPassword({ password }, { current: current || null }));
  if (!errors.password && password !== confirm) errors.confirm = 'mismatch';
  return errors;
}

// The forms of a barangay account (BRG-M-05, BRG-K-01): the clinical fields of a patient, a visit note and an event. Pure:
// each validator answers { field: code } (empty when all is well) and the screens turn the codes into text.
import { MONITOR } from '../config/thresholds.js';
import { addDays, daysBetween, manilaTime } from './dates.js';
import { calcEdd } from './pregnancy.js';

const isDate = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text ?? '') && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
const isTime = (text) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text ?? '');
const blank = (value) => value === undefined || value === null || String(value).trim() === '';

/** How far a provider's EDD may differ from the one the LMP gives (Naegele), in days. */
export const EDD_OVERRIDE_DAYS = 30;

/** 'naegele' when the EDD is the one the LMP gives, otherwise 'provider' (the override is marked, PAT-P-02). */
export const eddSourceFor = (lmp, edd) => (edd === calcEdd(lmp) ? 'naegele' : 'provider');

/**
 * LMP, EDD and risk notes (BRG-M-05). Codes: required, invalid, future (LMP), tooOld (LMP), farFromLmp (EDD, more than 30
 * days from LMP + 280 days) and tooLong (risk notes).
 */
export function validateClinical({ lmp, edd, risk_notes: riskNotes = '' }, { today }) {
  const errors = {};
  if (blank(lmp)) errors.lmp = 'required';
  else if (!isDate(lmp)) errors.lmp = 'invalid';
  else if (lmp > today) errors.lmp = 'future';
  else if (daysBetween(lmp, today) > MONITOR.maxGestationDays) errors.lmp = 'tooOld';
  if (blank(edd)) errors.edd = 'required';
  else if (!isDate(edd)) errors.edd = 'invalid';
  else if (!errors.lmp && Math.abs(daysBetween(calcEdd(lmp), edd)) > EDD_OVERRIDE_DAYS) errors.edd = 'farFromLmp';
  if (String(riskNotes ?? '').trim().length > MONITOR.noteMax) errors.risk_notes = 'tooLong';
  return errors;
}

const toNumber = (text) => (blank(text) ? null : Number(String(text).trim()));

/** The numbers of a visit note form: { bp_systolic, bp_diastolic, weight_kg, note } with the note trimmed. */
export function visitNoteValues({ bp_systolic, bp_diastolic, weight_kg, note = '' }) {
  return { bp_systolic: toNumber(bp_systolic), bp_diastolic: toNumber(bp_diastolic), weight_kg: toNumber(weight_kg), note: String(note ?? '').trim() };
}

/**
 * A visit note (BRG-M-05): blood pressure, weight and what she observed. Codes: required, invalid (not a whole number or
 * not a number), range, diastolicHigher (the second blood pressure number must be the lower), tooLong and tooShort (note).
 */
export function validateVisitNote(input) {
  const v = visitNoteValues(input);
  const errors = {};
  const whole = (value) => Number.isInteger(value);
  if (v.bp_systolic === null) errors.bp_systolic = 'required';
  else if (!whole(v.bp_systolic)) errors.bp_systolic = 'invalid';
  else if (v.bp_systolic < MONITOR.bp.systolic[0] || v.bp_systolic > MONITOR.bp.systolic[1]) errors.bp_systolic = 'range';
  if (v.bp_diastolic === null) errors.bp_diastolic = 'required';
  else if (!whole(v.bp_diastolic)) errors.bp_diastolic = 'invalid';
  else if (v.bp_diastolic < MONITOR.bp.diastolic[0] || v.bp_diastolic > MONITOR.bp.diastolic[1]) errors.bp_diastolic = 'range';
  else if (!errors.bp_systolic && v.bp_diastolic >= v.bp_systolic) errors.bp_diastolic = 'diastolicHigher';
  if (v.weight_kg === null) errors.weight_kg = 'required';
  else if (!Number.isFinite(v.weight_kg)) errors.weight_kg = 'invalid';
  else if (v.weight_kg < MONITOR.weightKg[0] || v.weight_kg > MONITOR.weightKg[1]) errors.weight_kg = 'range';
  if (v.note.length < 2) errors.note = 'required';
  else if (v.note.length > MONITOR.noteMax) errors.note = 'tooLong';
  return errors;
}

/** An event of the barangay (BRG-K-01): title, date, start and end time. Codes: required, tooLong, invalid, past, tooFar, endBeforeStart. */
export function validateEvent({ title = '', date, start, end }, { today }) {
  const errors = {};
  const name = String(title ?? '').trim();
  if (name.length < 2) errors.title = 'required';
  else if (name.length > MONITOR.eventTitleMax) errors.title = 'tooLong';
  if (blank(date)) errors.date = 'required';
  else if (!isDate(date)) errors.date = 'invalid';
  else if (date < today) errors.date = 'past';
  else if (daysBetween(today, date) > 365) errors.date = 'tooFar';
  if (blank(start)) errors.start = 'required';
  else if (!isTime(start)) errors.start = 'invalid';
  if (blank(end)) errors.end = 'required';
  else if (!isTime(end)) errors.end = 'invalid';
  else if (!errors.start && end <= start) errors.end = 'endBeforeStart';
  return errors;
}

/** The instants of an event's date and times (Manila). */
export function eventTimes({ date, start, end }) {
  const at = (time) => manilaTime(date, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  return { starts_at: at(start), ends_at: at(end) };
}

export const latestEventDate = (today) => addDays(today, 365);

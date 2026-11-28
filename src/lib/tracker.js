// The Pregnancy Tracker of a super account (SUP-T-01 to SUP-T-04): one row for each patient, the barangay filter, the sort order
// and the two flags. The list carries no vitals (SUP-T-02). Pure: the screens turn the numbers and codes into text.
import { isConfirmed } from './consult.js';
import { ageOn } from './authRules.js';
import { manilaDate } from './dates.js';
import { isOverdue } from './monitor.js';
import { gestationalAge, isNearDue } from './pregnancy.js';

/** How the list can be sorted (SUP-T-01): by due date (soonest first), by name (A to Z) or by gestational age (furthest along first). */
export const SORTS = ['edd', 'name', 'ga'];

/**
 * The row of one patient: { id, name, age, barangayId, barangayName, contact, lmp, edd, weeks, days, totalDays, nextVisit, nearDue,
 * overdue, profile }. `nextVisit` is the next appointment with a time ahead of now that the office has fixed ({ at, type }) or null.
 */
export function trackerRow({ profile, patient, pregnancy, appointments, barangayName, now, nearDueDays }) {
  const today = manilaDate(now);
  const age = pregnancy ? gestationalAge(pregnancy.lmp, today) : null;
  const next = appointments
    .filter((a) => isConfirmed(a) && a.scheduled_at != null && a.scheduled_at > now)
    .sort((a, b) => a.scheduled_at - b.scheduled_at)[0];
  return {
    id: profile.id,
    name: profile.full_name,
    age: patient ? ageOn(patient.birthdate, today) : null,
    barangayId: profile.barangay_id,
    barangayName,
    contact: profile.contact_no ?? null,
    lmp: pregnancy?.lmp ?? null,
    edd: pregnancy?.edd ?? null,
    weeks: age?.weeks ?? null,
    days: age?.days ?? null,
    totalDays: age?.totalDays ?? null,
    nextVisit: next ? { at: next.scheduled_at, type: next.type } : null,
    nearDue: pregnancy ? isNearDue(pregnancy.edd, today, nearDueDays) : false,
    overdue: isOverdue(appointments, now),
    profile,
  };
}

/** The rows of one barangay, or all of them for a null or empty choice (SUP-T-01). */
export const filterRows = (rows, barangayId) => (barangayId ? rows.filter((row) => row.barangayId === barangayId) : rows);

/** The rows in the chosen order. A patient with no pregnancy record comes last; ties go by name. */
export function sortRows(rows, by = 'edd') {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const order = {
    edd: (a, b) => (a.edd ?? '9999-12-31').localeCompare(b.edd ?? '9999-12-31') || byName(a, b),
    name: byName,
    ga: (a, b) => (b.totalDays ?? -1) - (a.totalDays ?? -1) || byName(a, b),
  };
  return [...rows].sort(order[by] ?? order.edd);
}

/** The sort to use for any value: an unknown one falls back to the due date. */
export const sortOf = (value) => (SORTS.includes(value) ? value : 'edd');

/** The barangay choice for any value: an id of one of the barangays, otherwise null (all barangays). */
export const barangayChoiceOf = (value, barangays) => (barangays.some((b) => b.id === value) ? value : null);

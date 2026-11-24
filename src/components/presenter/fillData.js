// What the gear types into the forms (PLAN.md Sections 5.4 and 7). Presenter content only: nothing here reaches a screen
// on its own. The accounts of the sign-in fills come from lib/permissions.js (PRESENTER_ACCOUNTS) and their contact and
// password from the store; the text of each button is in the presenter namespace.
import { addDays, manilaDate } from '../../lib/dates.js';

export const FILL_PASSWORD = 'Tingloy-Care-2026';

/** The text of each sign-in fill button, by account. */
export const FILL_LABELS = {
  'maricel-dimaculangan': 'presenter:fill.patientMaricel',
  'shiela-marie-aguila': 'presenter:fill.patientShiela',
  'cherry-mae-dalisay': 'presenter:fill.patientCherry',
  'lourdes-magpantay': 'presenter:fill.barangayLourdes',
  'jocelyn-landicho': 'presenter:fill.barangayJocelyn',
  'nora-marasigan': 'presenter:fill.barangayNora',
  'rowena-macaraig': 'presenter:fill.superRowena',
  'cynthia-dimayuga': 'presenter:fill.superCynthia',
};

// The two women who sign up during the run-through (PLAN.md Section 5.4): these accounts do not exist until the form is sent.
export const SIGN_UP_FILLS = {
  adult: { labelKey: 'presenter:fill.signUpAdult', full_name: 'Angelica Panganiban', age: 24, contact_no: '0917 555 0242', barangay_id: 'san-jose' },
  minor: { labelKey: 'presenter:fill.signUpMinor', full_name: 'Kristine Joy Ilagan', age: 16, contact_no: '0917 555 0243', barangay_id: 'papaya' },
};

export const GUARDIAN_FILL = { guardian_name: 'Teresita Ilagan', relationship: 'mother', contact: '0917 555 0244' };

/** A birthdate that makes her exactly this age today (she turned it about three months ago). */
export function birthdateForAge(age, now = Date.now()) {
  const today = manilaDate(now);
  const monthDay = today.slice(5) === '02-29' ? '02-28' : today.slice(5);
  return addDays(`${Number(today.slice(0, 4)) - age}-${monthDay}`, -90);
}

/** What the gear types into the booking form (PLAN.md Section 7: Fill request): a teleconsultation tomorrow afternoon. */
export const BOOKING_FILL = {
  type: 'teleconsult',
  window: 'afternoon',
  daysAhead: 1,
  reason: {
    en: 'Questions about my last check-up and my schedule',
    fil: 'May mga tanong po tungkol sa huling check-up at sa iskedyul ko',
  },
};

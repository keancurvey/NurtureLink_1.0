// The Monitor tab and the patient detail of a barangay account (BRG-M-01 to BRG-M-04): the status of each patient, the
// counts at the top, the search and filters, the overdue rule and the series behind the charts. Pure: the screens turn the
// codes and numbers into text.
import { MONITOR, THRESHOLDS } from '../config/thresholds.js';
import { toneOf } from './alertView.js';
import { ageOn } from './authRules.js';
import { MS_DAY, manilaDate } from './dates.js';
import { countdown, gestationalAge, trimester } from './pregnancy.js';
import { fhrStatus, maternalHrStatus, skinTempStatus, spo2Status, worstStatus } from './vitalStatus.js';

const CHECKUP_TYPES = ['clinic', 'hospital'];

/**
 * Whether a patient has an overdue check-up (BRG-M-01, BRG-M-02): her latest check-up that is over was missed, it was within
 * the last MONITOR.overdueDays days and she has not attended one since.
 */
export function isOverdue(appointments, now, days = MONITOR.overdueDays) {
  const past = appointments
    .filter((a) => CHECKUP_TYPES.includes(a.type) && a.scheduled_at != null && a.scheduled_at <= now && ['attended', 'missed'].includes(a.status))
    .sort((a, b) => b.scheduled_at - a.scheduled_at);
  const latest = past[0];
  return Boolean(latest) && latest.status === 'missed' && now - latest.scheduled_at <= days * MS_DAY;
}

/** What a card says about the patient's state: the worst of her open alerts and her latest check. Null when she has neither. */
export function cardStatus({ openAlerts, summary, thresholds = THRESHOLDS }) {
  const fromAlerts = openAlerts.length === 0 ? null : openAlerts.some((a) => toneOf(a) === 'alert') ? 'alert' : 'attention';
  const fromCheck = summary
    ? worstStatus(
        fhrStatus(summary, thresholds),
        maternalHrStatus(summary.hr_bpm, thresholds),
        spo2Status(summary.spo2_pct, thresholds),
        skinTempStatus(summary.skin_temp_c, thresholds),
      )
    : null;
  return worstStatus(fromAlerts, fromCheck);
}

/**
 * The card of one patient: { id, name, age, weeks, days, totalDays, trimester, edd, daysToEdd, status, lastCheckAt,
 * openAlerts, emergency, overdue }. `emergency` is the newest alert nobody has acknowledged that is critical (BRG-M-03).
 * Input: the profile, her patient row, her active pregnancy (or null), her newest completed check (or null), her alerts
 * and appointments, and the time.
 */
export function patientCard({ profile, patient, pregnancy, latest, alerts, appointments, now, thresholds = THRESHOLDS }) {
  const today = manilaDate(now);
  const openAlerts = alerts.filter((a) => a.status !== 'resolved').sort((a, b) => b.created_at - a.created_at);
  const age = pregnancy ? gestationalAge(pregnancy.lmp, today) : null;
  return {
    id: profile.id,
    name: profile.full_name,
    age: patient ? ageOn(patient.birthdate, today) : null,
    weeks: age?.weeks ?? null,
    days: age?.days ?? null,
    totalDays: age?.totalDays ?? null,
    trimester: age ? trimester(age.totalDays) : null,
    edd: pregnancy?.edd ?? null,
    daysToEdd: pregnancy ? countdown(pregnancy.edd, today).days : null,
    status: cardStatus({ openAlerts, summary: latest?.summary ?? null, thresholds }),
    lastCheckAt: latest?.ended_at ?? null,
    openAlerts,
    emergency: openAlerts.find((a) => a.status === 'new' && toneOf(a) === 'alert') ?? null,
    overdue: isOverdue(appointments, now),
    profile,
  };
}

/** The numbers at the top of the Monitor tab (BRG-M-01): patients, active alerts, overdue check-ups, due dates this month. */
export function monitorCounts(cards, now) {
  const month = manilaDate(now).slice(0, 7);
  return {
    patients: cards.length,
    activeAlerts: cards.reduce((sum, card) => sum + card.openAlerts.length, 0),
    overdue: cards.filter((card) => card.overdue).length,
    dueThisMonth: cards.filter((card) => card.edd && card.edd.slice(0, 7) === month).length,
  };
}

/** The order of the cards: an emergency first, then any open alert, then the nearest due date, then by name. */
export function sortCards(cards) {
  return [...cards].sort(
    (a, b) =>
      Number(Boolean(b.emergency)) - Number(Boolean(a.emergency)) ||
      Number(b.openAlerts.length > 0) - Number(a.openAlerts.length > 0) ||
      (a.edd ?? '9999-12-31').localeCompare(b.edd ?? '9999-12-31') ||
      a.name.localeCompare(b.name),
  );
}

/** Search by name and the filters of BRG-M-02: trimester (1, 2, 3 or null for all), alerts only, overdue only. */
export function filterCards(cards, { query = '', trimester: tri = null, alertsOnly = false, overdueOnly = false } = {}) {
  const needle = query.trim().toLowerCase();
  return cards.filter(
    (card) =>
      (!needle || card.name.toLowerCase().includes(needle)) &&
      (tri === null || card.trimester === Number(tri)) &&
      (!alertsOnly || card.openAlerts.length > 0) &&
      (!overdueOnly || card.overdue),
  );
}

// ---------- Readings history (BRG-M-04) ----------

/** The measures the charts show, with where each lives in a check summary and which status rule judges it. */
export const MEASURES = {
  fhr: { field: 'fhr_bpm', status: (v, th) => fhrStatus({ fhr_bpm: v, confidence: 100, unverified: false }, th) },
  hr: { field: 'hr_bpm', status: (v, th) => maternalHrStatus(v, th) },
  spo2: { field: 'spo2_pct', status: (v, th) => spo2Status(v, th) },
  temp: { field: 'skin_temp_c', status: (v, th) => skinTempStatus(v, th) },
};

/** The normal range of a measure, for the band on its chart: { min, max } with a missing end meaning no limit on that side. */
export function measureRange(measure, thresholds = THRESHOLDS) {
  if (measure === 'fhr') return { min: thresholds.fhr.min, max: thresholds.fhr.max };
  if (measure === 'hr') return { min: thresholds.maternalHr.min, max: thresholds.maternalHr.max };
  if (measure === 'spo2') return { min: thresholds.spo2.min, max: 100 };
  return { min: null, max: thresholds.skinTemp.maxC };
}

/**
 * The points of one chart, oldest first: [{ at, value, outOfRange }] from completed checks of the last `days` days. A check
 * without that reading (no band, no signal) leaves no point. `outOfRange` is true when the value is outside the limits.
 */
export function readingSeries(sessions, measure, { days, now, thresholds = THRESHOLDS }) {
  const { field, status } = MEASURES[measure];
  const since = now - days * MS_DAY;
  return sessions
    .filter((s) => s.status === 'completed' && s.ended_at >= since && s.summary && s.summary[field] > 0)
    .map((s) => ({ at: s.ended_at, value: s.summary[field], outOfRange: status(s.summary[field], thresholds) === 'alert' }))
    .sort((a, b) => a.at - b.at);
}

/** Lowest, highest and latest value of a series, and how many points fall outside the limits; null for an empty series. */
export function seriesFacts(points) {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  return { count: points.length, min: Math.min(...values), max: Math.max(...values), latest: points[points.length - 1].value, outOfRange: points.filter((p) => p.outOfRange).length };
}

/** The latest vitals a referral carries (BRG-M-06): the newest completed check that reached the server, or null. */
export function latestVitals(sessions) {
  const last = sessions.filter((s) => s.syncState === 'synced' && s.status === 'completed').sort((a, b) => b.started_at - a.started_at)[0];
  if (!last) return null;
  const { summary } = last;
  return { fhr_bpm: summary.fhr_bpm, hr_bpm: summary.hr_bpm, spo2_pct: summary.spo2_pct, skin_temp_c: summary.skin_temp_c, at: last.ended_at };
}

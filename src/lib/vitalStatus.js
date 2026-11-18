// Status of each reading on Home (PAT-H-01): normal, needs attention or alert. Pure, driven by the thresholds in
// config/thresholds.js (PLAN.md Section 5.9). "Within" a margin means closer than the margin, so a value exactly one
// margin away from a limit is still normal. A reading the device did not give has no status (null).
import { THRESHOLDS } from '../config/thresholds.js';
import { evaluateFhr } from './alertRules.js';

const RANK = { normal: 0, attention: 1, alert: 2 };

/** The most serious of several statuses; null entries are ignored, and nothing at all gives null. */
export function worstStatus(...statuses) {
  return statuses.filter(Boolean).reduce((worst, status) => (worst === null || RANK[status] > RANK[worst] ? status : worst), null);
}

const has = (value) => value !== null && value !== undefined;

/**
 * Fetal heart rate of a check summary. Alert when the median is outside the range, or when the windows of the check
 * stayed outside it for the sustained time. Needs attention when it is close to a limit, when fewer than the minimum
 * share of windows were usable, or when it could not be checked against the band (unverified, PAT-H-05).
 */
export function fhrStatus(summary, thresholds = THRESHOLDS, windows = []) {
  if (!summary || !(summary.fhr_bpm > 0)) return summary ? 'attention' : null;
  const { min, max } = thresholds.fhr;
  const { hrBpm, confidenceMin } = thresholds.attention;
  if (summary.fhr_bpm < min || summary.fhr_bpm > max) return 'alert';
  if (windows.length > 0 && evaluateFhr(windows, thresholds)) return 'alert';
  if (summary.fhr_bpm - min < hrBpm || max - summary.fhr_bpm < hrBpm) return 'attention';
  if (summary.confidence < confidenceMin || summary.unverified) return 'attention';
  return 'normal';
}

export function maternalHrStatus(hr, thresholds = THRESHOLDS) {
  if (!has(hr) || hr <= 0) return null;
  const { min, max } = thresholds.maternalHr;
  if (hr < min || hr > max) return 'alert';
  const margin = thresholds.attention.hrBpm;
  return hr - min < margin || max - hr < margin ? 'attention' : 'normal';
}

export function spo2Status(spo2, thresholds = THRESHOLDS) {
  if (!has(spo2) || spo2 <= 0) return null;
  const { min } = thresholds.spo2;
  if (spo2 < min) return 'alert';
  return spo2 - min < thresholds.attention.spo2Points ? 'attention' : 'normal';
}

export function skinTempStatus(tempC, thresholds = THRESHOLDS) {
  if (!has(tempC)) return null;
  const { maxC } = thresholds.skinTemp;
  if (tempC > maxC) return 'alert';
  // Rounded so that 38.0 - 37.7 is 0.3, not 0.2999999999999972.
  return Math.round((maxC - tempC) * 100) / 100 < thresholds.attention.tempC ? 'attention' : 'normal';
}

/** The four statuses of a check and the most serious of them. `windows` are the per-window rows, when the app still holds them. */
export function checkStatuses(summary, thresholds = THRESHOLDS, windows = []) {
  const statuses = {
    fhr: fhrStatus(summary, thresholds, windows),
    hr: summary ? maternalHrStatus(summary.hr_bpm, thresholds) : null,
    spo2: summary ? spo2Status(summary.spo2_pct, thresholds) : null,
    temp: summary ? skinTempStatus(summary.skin_temp_c, thresholds) : null,
  };
  return { ...statuses, overall: worstStatus(...Object.values(statuses)) };
}

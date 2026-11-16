// Reading helpers used by the check flow: which belt windows count, the maternal-reference comparison
// (spec 3.2, PAT-H-05) and the summary of a check. Records use the entity field names of spec 6.1.
import { THRESHOLDS } from '../config/thresholds.js';
import { FHR_FLAG, VITALS_FLAG } from './packets.js';

const DISCARD_FLAGS = FHR_FLAG.MOTION | FHR_FLAG.POOR_CONTACT | FHR_FLAG.LOW_SIGNAL | FHR_FLAG.PARTIAL;
const UNUSABLE_VITALS = VITALS_FLAG.MOTION_REJECTED | VITALS_FLAG.WEAK_SIGNAL | VITALS_FLAG.PARTIAL;

/** A window is valid when it has a rate and was not discarded for motion, contact, signal or a maternal match. */
export function isValidWindow(window) {
  return window.fhr_bpm > 0 && (window.flags & DISCARD_FLAGS) === 0 && !window.maternal_match;
}

/** A band reading can serve as the maternal reference when it has a rate and was not rejected. */
export function isUsableVitals(vitals) {
  return vitals.hr_bpm > 0 && (vitals.flags & UNUSABLE_VITALS) === 0;
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Flag windows whose rate is within `bpm` of a band heart rate taken within `seconds` of the window.
 * Those windows are probable maternal signal and are excluded from the result. Returns new window objects.
 */
export function flagMaternalMatches(windows, vitals, match = THRESHOLDS.maternalMatch) {
  const references = vitals.filter(isUsableVitals);
  return windows.map((window) => {
    if (!(window.fhr_bpm > 0)) return { ...window, maternal_match: false };
    const matched = references.some(
      (ref) =>
        Math.abs(ref.taken_at - window.taken_at) <= match.seconds * 1000 &&
        Math.abs(ref.hr_bpm - window.fhr_bpm) <= match.bpm,
    );
    return { ...window, maternal_match: matched };
  });
}

/**
 * Summary of one check. FHR is the median of the valid windows and confidence is the share of valid windows,
 * as in the belt's own summary (spec 7.2); maternal values come from the band. With no usable band reading the FHR
 * is marked unverified instead of being rejected (PAT-H-05).
 */
export function summarizeCheck({ windows, vitals = [] }) {
  const valid = windows.filter(isValidWindow);
  const reference = [...vitals].reverse().find(isUsableVitals) ?? null;
  return {
    fhr_bpm: valid.length ? Math.round(median(valid.map((w) => w.fhr_bpm))) : 0,
    confidence: windows.length ? Math.round((100 * valid.length) / windows.length) : 0,
    sqi: valid.length ? Math.round(valid.reduce((sum, w) => sum + w.sqi, 0) / valid.length) : 0,
    valid_windows: valid.length,
    total_windows: windows.length,
    maternal_excluded: windows.filter((w) => w.maternal_match).length,
    hr_bpm: reference ? reference.hr_bpm : null,
    spo2_pct: reference && reference.spo2_pct > 0 ? reference.spo2_pct : null,
    skin_temp_c: reference ? reference.skin_temp_c : null,
    unverified: reference === null,
  };
}

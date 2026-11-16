// Alert rules of ALR-01, pure and driven by the thresholds in config/thresholds.js.
// The client runs them for immediacy and the server path runs them as the authority (ALR-02).
// Alerts tell the user to contact a provider and never diagnose (ALR-06).
import { THRESHOLDS, DEVICE_DEFAULTS } from '../config/thresholds.js';
import { MS_HOUR } from './dates.js';
import { batteryLevel } from './battery.js';
import { VITALS_FLAG } from './packets.js';
import { isValidWindow } from './readings.js';

export const ALERT_TYPES = ['fhr_out_of_range', 'signal_loss', 'maternal_vitals', 'sos', 'battery_critical', 'missed_check'];

/** Critical alerts add the pulsing ring in the screens; warnings are amber. */
export const ALERT_SEVERITY = {
  sos: 'critical',
  fhr_out_of_range: 'critical',
  maternal_vitals: 'critical',
  signal_loss: 'warning',
  battery_critical: 'warning',
  missed_check: 'warning',
};

function candidate(type, payload) {
  return { type, severity: ALERT_SEVERITY[type], payload };
}

/**
 * FHR outside the range for a sustained period: valid windows below the minimum (or above the maximum)
 * adding up to the sustained time with no in-range valid window in between. Discarded windows (motion, contact,
 * signal, maternal match) neither count nor break the run. Windows must be in time order.
 */
export function evaluateFhr(windows, thresholds = THRESHOLDS, windowSeconds = DEVICE_DEFAULTS.belt.windowS) {
  const { min, max, sustainedSeconds } = thresholds.fhr;
  let direction = null;
  let seconds = 0;
  let extreme = 0;
  for (const window of windows) {
    if (!isValidWindow(window)) continue;
    const rate = window.fhr_bpm;
    if (rate >= min && rate <= max) {
      direction = null;
      seconds = 0;
      continue;
    }
    const side = rate < min ? 'low' : 'high';
    if (side !== direction) {
      direction = side;
      seconds = 0;
      extreme = rate;
    }
    seconds += windowSeconds;
    extreme = side === 'low' ? Math.min(extreme, rate) : Math.max(extreme, rate);
    if (seconds >= sustainedSeconds) {
      return candidate('fhr_out_of_range', { direction, sustained_seconds: seconds, extreme_bpm: extreme });
    }
  }
  return null;
}

/** Repeated signal loss: the latest N checks (oldest first) all had no valid window. */
export function evaluateSignalLoss(summaries, thresholds = THRESHOLDS) {
  const needed = thresholds.signalLoss.consecutiveChecks;
  const recent = summaries.slice(-needed);
  if (recent.length < needed) return null;
  return recent.every((summary) => summary.valid_windows === 0)
    ? candidate('signal_loss', { consecutive_checks: needed })
    : null;
}

/**
 * Maternal vitals outside the configured ranges. Readings the band flagged as rejected, weak or partial are not
 * used. A value of zero or null means the band had no value and is skipped.
 */
export function evaluateMaternalVitals(reading, thresholds = THRESHOLDS) {
  const unusable = VITALS_FLAG.MOTION_REJECTED | VITALS_FLAG.WEAK_SIGNAL | VITALS_FLAG.PARTIAL;
  if ((reading.flags ?? 0) & unusable) return null;
  const metrics = [];
  const hr = reading.hr_bpm;
  if (hr > 0 && (hr < thresholds.maternalHr.min || hr > thresholds.maternalHr.max)) {
    metrics.push({ metric: 'heart_rate', value: hr, direction: hr < thresholds.maternalHr.min ? 'low' : 'high' });
  }
  const spo2 = reading.spo2_pct;
  if (spo2 > 0 && spo2 < thresholds.spo2.min) metrics.push({ metric: 'spo2', value: spo2, direction: 'low' });
  const temp = reading.skin_temp_c;
  if (temp !== null && temp !== undefined && temp > thresholds.skinTemp.maxC) {
    metrics.push({ metric: 'skin_temperature', value: temp, direction: 'high' });
  }
  return metrics.length ? candidate('maternal_vitals', { metrics }) : null;
}

/** SOS: a pressed packet raises the alert; a cancelled packet does not (it closes the open one). */
export function evaluateSos(packet) {
  return packet.pressed ? candidate('sos', { seq: packet.seq, battery: packet.battery }) : null;
}

/** Device battery critical (6 to 10%) or at cutoff. A charging device is not alerted. */
export function evaluateBattery({ pct, vcellMv = null, charging, serial, deviceType }, thresholds = THRESHOLDS) {
  if (charging) return null;
  const level = batteryLevel(pct, vcellMv, thresholds);
  if (level !== 'critical' && level !== 'cutoff') return null;
  return candidate('battery_critical', { serial, device: deviceType, pct, level });
}

/**
 * Missed check: no completed check in the configured hours. Counted from the last completed check, or from
 * pairing when there has been none. A device paired less than that long ago cannot have missed a check yet.
 */
export function evaluateMissedCheck({ lastCompletedAt, pairedAt, now }, thresholds = THRESHOLDS) {
  const limit = thresholds.missedCheck.hours * MS_HOUR;
  if (pairedAt !== null && pairedAt !== undefined && now - pairedAt < limit) return null;
  const since = lastCompletedAt ?? pairedAt;
  if (since === null || since === undefined) return null;
  if (now - since < limit) return null;
  return candidate('missed_check', { hours: Math.floor((now - since) / MS_HOUR), last_check_at: lastCompletedAt ?? null });
}

/**
 * An open alert (new or acknowledged) of the same type for the same patient absorbs a new one, so a patient never
 * has two open alerts for the same thing. Battery alerts are kept apart per device.
 */
export function findDuplicate(alerts, patientId, next) {
  return (
    [...alerts]
      .reverse()
      .find(
        (alert) =>
          alert.patient_id === patientId &&
          alert.type === next.type &&
          alert.status !== 'resolved' &&
          (next.type !== 'battery_critical' || alert.payload?.serial === next.payload?.serial),
      ) ?? null
  );
}

/** What changes on an alert that absorbs a duplicate. */
export function mergePatch(alert, now) {
  return { merged_count: (alert.merged_count ?? 0) + 1, last_seen_at: now };
}

/** Escalation time in milliseconds for the timing mode (5 minutes, 60 seconds in Quick; PLAN.md Section 5.9). */
export function escalationMs(thresholds = THRESHOLDS, timing = 'realistic') {
  return timing === 'quick' ? thresholds.escalation.quickSeconds * 1000 : thresholds.escalation.minutes * 60 * 1000;
}

/** An alert nobody has acknowledged, not yet escalated, that has waited the escalation time. */
export function shouldEscalate(alert, now, ms) {
  return alert.status === 'new' && !alert.escalated_at && now - alert.created_at >= ms;
}

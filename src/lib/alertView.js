// What an alert says, in terms the screens turn into text (ALR-04, ALR-06, ALR-07). Pure: no React, no i18n.
// Providers read the technical facts; the patient reads a plain notice and never a diagnosis (ALR-06).
import { ALERT_SEVERITY } from './alertRules.js';
import { THRESHOLDS } from '../config/thresholds.js';

export const isOpen = (alert) => alert.status !== 'resolved';

/** The status a critical alert shows is "alert" and a warning is "needs attention" (never colour alone: icon and text too). */
export const toneOf = (alert) => (alert.escalated_at || ALERT_SEVERITY[alert.type] === 'critical' ? 'alert' : 'attention');

/** The tone of an alert type by its severity, for a notification that only knows the type. */
export const toneOfType = (type, escalated = false) => (escalated || ALERT_SEVERITY[type] === 'critical' ? 'alert' : 'attention');

/** The alerts a patient's notice card shows: open ones, not the SOS (the SOS has its own status line). */
export const patientNoticeAlerts = (alerts) => alerts.filter((alert) => isOpen(alert) && alert.type !== 'sos');

/**
 * The facts behind an alert for providers: a list of { key, values } where key is a text under alerts:fact.*.
 * Separate keys for each direction and device keep the sentences natural in both languages.
 */
export function alertFacts(alert, thresholds = THRESHOLDS) {
  const p = alert.payload ?? {};
  switch (alert.type) {
    case 'fhr_out_of_range':
      return [
        p.direction === 'high'
          ? { key: 'fact.fhr_high', values: { limit: thresholds.fhr.max, seconds: p.sustained_seconds, bpm: p.extreme_bpm } }
          : { key: 'fact.fhr_low', values: { limit: thresholds.fhr.min, seconds: p.sustained_seconds, bpm: p.extreme_bpm } },
      ];
    case 'signal_loss':
      return [{ key: 'fact.signal_loss', values: { count: p.consecutive_checks } }];
    case 'maternal_vitals':
      return (p.metrics ?? []).map((m) => {
        if (m.metric === 'spo2') return { key: 'fact.spo2', values: { value: m.value, limit: thresholds.spo2.min } };
        if (m.metric === 'skin_temperature') return { key: 'fact.skin_temperature', values: { value: m.value, limit: thresholds.skinTemp.maxC } };
        return { key: m.direction === 'low' ? 'fact.heart_rate_low' : 'fact.heart_rate_high', values: { value: m.value, limit: m.direction === 'low' ? thresholds.maternalHr.min : thresholds.maternalHr.max } };
      });
    case 'sos':
      if (p.source === 'app') return [{ key: 'fact.sos_app', values: {} }];
      return [{ key: p.battery === null || p.battery === undefined ? 'fact.sos_band_nobattery' : 'fact.sos_band', values: { battery: p.battery } }];
    case 'battery_critical':
      return [{ key: p.device === 'band' ? 'fact.battery_band' : 'fact.battery_belt', values: { pct: p.pct } }];
    case 'missed_check':
      return [{ key: 'fact.missed_check', values: { hours: p.hours } }];
    default:
      return [];
  }
}

/**
 * The record of what happened to an alert, oldest first (ALR-04: each step with the account name and time):
 * [{ key, at, values }] where key is a text under alerts:timeline.*. Account ids come back as `by` for the screen to name.
 */
export function alertTimeline(alert) {
  const steps = [{ key: 'raised', at: alert.created_at, by: null }];
  if (alert.merged_count > 0) steps.push({ key: 'merged', at: alert.last_seen_at, by: null, values: { count: alert.merged_count } });
  if (alert.escalated_at) steps.push({ key: 'escalated', at: alert.escalated_at, by: null });
  if (alert.acknowledged_at) steps.push({ key: 'acknowledged', at: alert.acknowledged_at, by: alert.acknowledged_by });
  if (alert.referred_at) steps.push({ key: 'referred', at: alert.referred_at, by: alert.referred_by });
  if (alert.status === 'resolved') {
    steps.push(
      alert.cancelled_at
        ? { key: 'cancelled', at: alert.cancelled_at, by: alert.resolved_by }
        : { key: 'resolved', at: alert.resolved_at, by: alert.resolved_by },
    );
  }
  return steps.sort((a, b) => a.at - b.at);
}

export const OUTCOME_MAX = 500;
export const REASON_MAX = 280;

/** A required note (the outcome of an alert, the reason for a referral): trimmed text, or an error code. */
export function validateNote(text, max) {
  const value = String(text ?? '').trim();
  if (value.length < 2) return { ok: false, error: 'required' };
  if (value.length > max) return { ok: false, error: 'too_long' };
  return { ok: true, value };
}

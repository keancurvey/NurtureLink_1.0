// Whether Check now may start, and if not, why (PAT-H-03). Pure: the screen shows the reason, and the device service
// asks the same question before it starts a check, so the rule cannot be skipped by calling the action directly.
import { DEVICE_DEFAULTS, THRESHOLDS } from '../config/thresholds.js';
import { batteryLevel } from './battery.js';

/**
 * devices: the patient's device records. Returns { allowed: true } or { allowed: false, reason: { code, device? } } with
 * code one of no_belt, busy, disconnected, charging, cutoff, exposure_cap. The first reason found is the one shown:
 * what the patient can fix first comes first.
 */
export function checkNowState({ devices, checking = false, thresholds = THRESHOLDS }) {
  const belt = devices.find((d) => d.type === 'belt') ?? null;
  const band = devices.find((d) => d.type === 'band') ?? null;
  if (!belt) return { allowed: false, reason: { code: 'no_belt' } };
  if (checking) return { allowed: false, reason: { code: 'busy' } };
  const paired = [belt, band].filter(Boolean);
  const blocked = (code) => paired.find((d) => code(d));
  let found = blocked((d) => d.link_state !== 'connected');
  if (found) return { allowed: false, reason: { code: 'disconnected', device: found.type } };
  found = blocked((d) => d.charging);
  if (found) return { allowed: false, reason: { code: 'charging', device: found.type } };
  found = blocked((d) => batteryLevel(d.battery_pct, null, thresholds) === 'cutoff');
  if (found) return { allowed: false, reason: { code: 'cutoff', device: found.type } };
  // The belt tells the app how many transmit seconds are left in the rolling hour; unknown means the full allowance.
  const left = belt.exposure_left_s ?? DEVICE_DEFAULTS.belt.exposureCapS;
  if (left < DEVICE_DEFAULTS.belt.checkDurationS) return { allowed: false, reason: { code: 'exposure_cap' } };
  return { allowed: true };
}

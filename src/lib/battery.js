// Battery levels (spec 9.5): Normal above 20%, Low 11 to 20%, Critical 6 to 10%, Cutoff 5% or less,
// and a cell voltage at or below about 3.35 V counts as cutoff whatever the percentage says.
import { THRESHOLDS } from '../config/thresholds.js';

/** 'normal' | 'low' | 'critical' | 'cutoff'. Charging is a separate flag, not a level. */
export function batteryLevel(pct, vcellMv = null, thresholds = THRESHOLDS) {
  const b = thresholds.battery;
  if (vcellMv !== null && vcellMv <= b.cutoffVoltageMv) return 'cutoff';
  if (pct <= b.cutoffMax) return 'cutoff';
  if (pct <= b.criticalMax) return 'critical';
  if (pct <= b.lowMax) return 'low';
  return 'normal';
}

// Typical single-cell Li-ion points from spec 9.7 (4.20 V = 100%, 3.95 = 75%, 3.80 = 50%, 3.70 = 25%, 3.50 = 5%).
const CURVE = [
  [0, 3300],
  [5, 3500],
  [25, 3700],
  [50, 3800],
  [75, 3950],
  [100, 4200],
];

/** Cell voltage in millivolts for a state of charge, by straight lines between the points above. */
export function voltageForPct(pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  for (let i = 1; i < CURVE.length; i += 1) {
    const [p1, v1] = CURVE[i];
    if (clamped <= p1) {
      const [p0, v0] = CURVE[i - 1];
      return Math.round(v0 + ((v1 - v0) * (clamped - p0)) / (p1 - p0));
    }
  }
  return CURVE[CURVE.length - 1][1];
}

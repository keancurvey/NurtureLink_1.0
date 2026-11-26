// Every rule value, schedule and escalation time (spec 6.3, 8.1 and 9.5; PLAN.md Section 5.9).
// Values marked "proposed" or "starting" in the plan are to be confirmed with the midwife and doctor.
// Components and rules read these through the store's thresholds table, never as literals.
export const THRESHOLDS = {
  fhr: { min: 110, max: 160, sustainedSeconds: 30 },
  signalLoss: { consecutiveChecks: 3 },
  maternalMatch: { bpm: 5, seconds: 10 },
  missedCheck: { hours: 24 },
  escalation: { minutes: 5, quickSeconds: 60 },
  battery: { lowMin: 11, lowMax: 20, criticalMin: 6, criticalMax: 10, cutoffMax: 5, cutoffVoltageMv: 3350 },
  maternalHr: { min: 50, max: 110 },
  spo2: { min: 95 },
  skinTemp: { maxC: 38.0 },
  attention: { hrBpm: 5, spo2Points: 1, tempC: 0.3, confidenceMin: 60 },
  nearDueDays: 14,
  providerSession: { timeoutMinutes: 15, warnAfterMinutes: 14 },
  videoJoin: { beforeMinutes: 10, afterMinutes: 60 },
  followUpChatHours: 24,
  reminders: { dayBeforeHours: 24, hoursBefore: 2 }, // PAT-S-04: proposed one day and two hours before
};

// Device defaults (spec 8.1).
export const DEVICE_DEFAULTS = {
  belt: {
    checkIntervalMin: 60,
    checkDurationS: 120,
    windowS: 4,
    exposureCapS: 360,
    exposureWindowMin: 60,
    contactTimeoutS: 30,
  },
  band: { burstIntervalS: 300, burstLengthS: 30, sosHoldS: 2, sosRepeatS: 10 },
};

// Timing toggle in the gear: Quick is about three times faster (PLAN.md Section 6).
export const TIMING = { quick: { speed: 3 }, realistic: { speed: 1 } };
export const DEFAULT_TIMING = 'quick';

// Video usage this month (VID-09, PLAN.md Section 5.8).
export const VIDEO_USAGE = { limitMinutes: 10000, usedMinutes: 6420, warnAt: 0.8 };

/** Nested object -> table rows [{ key: 'fhr.min', value: 110 }] (spec 6.1 thresholds table). */
export function flattenThresholds(tree, prefix = '') {
  const rows = [];
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (value !== null && typeof value === 'object') rows.push(...flattenThresholds(value, key));
    else rows.push({ key, value });
  }
  return rows;
}

/** Table rows -> nested object. Rows override the defaults, so an edited row takes effect everywhere. */
export function buildThresholds(rows = []) {
  const tree = structuredClone(THRESHOLDS);
  for (const { key, value } of rows) {
    const path = key.split('.');
    let node = tree;
    for (let i = 0; i < path.length - 1; i += 1) {
      node[path[i]] ??= {};
      node = node[path[i]];
    }
    node[path[path.length - 1]] = value;
  }
  return tree;
}

// Sign-in rules (AUTH-05, AUTH-08, spec 10). The terms version is what a consent record must match to count; the seed's
// consent records carry the same version. Throttling and the reset code are proposed values, like the other rules.
export const AUTH = {
  termsVersion: '1.0',
  maxFailedSignIns: 5,
  lockSeconds: 30,
  resetCodeMinutes: 10,
  minPasswordLength: 8,
  heleLoggingVersion: '1.0', // the consent the Hele question-logging switch records (PAT-A-06)
};

// Consult rules (PAT-C-02, PAT-C-04). Proposed values, like the other rules: how long a sent message takes to reach the other
// phone, the longest message, the size of a photo made on the phone, and how far ahead a visit may be asked for.
export const CHAT = {
  deliveryMs: 1200,
  messageMax: 1000,
  photoMaxSide: 800,
  photoQuality: 0.75,
  photoMaxChars: 400000,
  bookingHorizonDays: 90,
};

// Barangay account rules (BRG-M-01 to BRG-M-06). Proposed values, like the other rules: when a missed check-up counts as
// overdue, how many days of readings the charts open with, and the limits the forms accept.
export const MONITOR = {
  overdueDays: 30,
  chartDays: { short: 7, long: 21 },
  noteMax: 500,
  eventTitleMax: 80,
  eventPlace: 'Barangay health station', // where an event of the barangay is held (a generic place, no street names)
  bp: { systolic: [60, 260], diastolic: [30, 160] },
  weightKg: [25, 200],
  maxGestationDays: 301, // an LMP more than 43 weeks before today is refused
};

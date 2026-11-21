// The seed (PLAN.md Section 5): barangays, accounts, patients, devices, 21 days of checks, alerts, appointments, chats,
// notifications and logs. Everything is generated relative to `now` with a seeded generator, so each reset gives the
// same believable history and it always looks recent. Records use the entity names of spec 6.1.
import { createRng } from './prng.js';
import { DEFAULT_TIMING, DEVICE_DEFAULTS, THRESHOLDS, VIDEO_USAGE, flattenThresholds } from '../config/thresholds.js';
import { MS_DAY, MS_HOUR, MS_MINUTE, addDays, manilaDate, manilaTime } from '../lib/dates.js';
import { calcEdd } from '../lib/pregnancy.js';
import { advertisedName, FHR_FLAG } from '../lib/packets.js';
import { voltageForPct } from '../lib/battery.js';
import { ALERT_SEVERITY } from '../lib/alertRules.js';
import { summarizeCheck } from '../lib/readings.js';
import { SCHEMA_VERSION, emptyDb } from '../store/schema.js';
import * as data from './seedData.js';

const SECOND = 1000;
const HISTORY_DAYS = 21; // checks over the last 21 days (5.6)
const WINDOW_ROWS_DAYS = 3; // per-window rows only for the last 3 days (5.6)
const WINDOWS_PER_CHECK = DEVICE_DEFAULTS.belt.checkDurationS / DEVICE_DEFAULTS.belt.windowS;
const AVATAR_ART = ['heart', 'shield', 'calendar', 'chat', 'bell'];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const phone = (n) => `0917 555 ${String(n).padStart(4, '0')}`;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function createSeed({ now = Date.now(), seed = 20261108 } = {}) {
  const rng = createRng(seed);
  const today = manilaDate(now);
  const db = emptyDb();
  const hardware = {};
  const counters = {};
  const id = (prefix) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}-${counters[prefix].toString(36)}`;
  };
  const profileById = new Map();
  const barangayName = new Map(data.BARANGAYS.map((b) => [b.id, b.name]));
  const lang = (profileId) => profileById.get(profileId).language;
  const text = (pool, language) => pool[language] ?? pool.en;

  // ---------- Barangays, thresholds ----------
  db.barangays.push(...data.BARANGAYS.map((b) => ({ ...b })));
  db.thresholds.push(...flattenThresholds(THRESHOLDS).map((row) => ({ id: row.key, ...row, updated_by: null, updated_at: now })));

  // ---------- Profiles ----------
  function addProfile(profile) {
    db.profiles.push(profile);
    profileById.set(profile.id, profile);
    db.credentials.push({ id: profile.id, profile_id: profile.id, password: data.PASSWORD, must_change_password: false });
    db.consents.push({
      id: id('con'),
      profile_id: profile.id,
      document: 'terms_privacy',
      version: '1.0',
      accepted_at: profile.created_at + 3 * MS_MINUTE,
    });
    return profile;
  }
  const emailOf = (name) => {
    const parts = name.split(' ');
    return `${slug(parts[0])}.${slug(parts[parts.length - 1])}@${data.EMAIL_DOMAIN}`;
  };

  data.SUPERS.forEach((entry, index) => {
    addProfile({
      id: slug(entry.name),
      role: 'super',
      full_name: entry.name,
      name_suffix: entry.suffix,
      title: entry.title,
      contact_no: phone(401 + index),
      email: emailOf(entry.name),
      language: entry.language,
      photo_url: null,
      avatar_art: null,
      barangay_id: null,
      active: true,
      created_by: null,
      created_at: now - 120 * MS_DAY,
    });
  });

  data.BHWS.forEach((entry, index) => {
    const prng = rng.fork(`bhw:${entry.name}`);
    addProfile({
      id: slug(entry.name),
      role: 'barangay',
      full_name: entry.name,
      name_suffix: null,
      title: 'Barangay health worker',
      contact_no: phone(301 + index),
      email: emailOf(entry.name),
      language: entry.language,
      photo_url: null,
      avatar_art: prng.chance(0.3) ? prng.pick(AVATAR_ART) : null,
      barangay_id: entry.barangay,
      active: true,
      created_by: 'rowena-macaraig',
      created_at: now - prng.int(60, 100) * MS_DAY,
    });
  });
  const bhwsOf = (barangayId) => db.profiles.filter((p) => p.role === 'barangay' && p.barangay_id === barangayId);
  const supers = db.profiles.filter((p) => p.role === 'super');

  // ---------- Patients, pregnancies, consents ----------
  const patients = []; // working records for the generators below
  data.PATIENTS.forEach((entry, index) => {
    const prng = rng.fork(`patient:${entry.name}`);
    const pid = slug(entry.name);
    const language = entry.language ?? (prng.chance(0.65) ? 'fil' : 'en');
    const days = entry.days ?? prng.int(0, 6);
    const lmp = addDays(today, -(entry.weeks * 7 + days));
    const createdAt = now - prng.int(25, 90) * MS_DAY;

    // Birthdate so that today's age matches the table: a date up to 360 days before the last birthday-aligned date.
    const monthDay = today.slice(5) === '02-29' ? '02-28' : today.slice(5);
    const birthdate = addDays(`${Number(today.slice(0, 4)) - entry.age}-${monthDay}`, -prng.int(0, 360));

    const profile = addProfile({
      id: pid,
      role: 'patient',
      full_name: entry.name,
      name_suffix: null,
      title: null,
      contact_no: phone(201 + index),
      email: null,
      language,
      photo_url: null,
      avatar_art: prng.chance(0.4) ? prng.pick(AVATAR_ART) : null,
      barangay_id: entry.barangay,
      active: true,
      created_by: null,
      created_at: createdAt,
    });
    const surname = entry.name.split(' ').pop();
    const relationship = prng.pick(['husband', 'husband', 'mother', 'sister']);
    const contactFirst = prng.pick(data.CONTACT_FIRST_NAMES[relationship]);
    db.patients.push({
      id: pid,
      profile_id: pid,
      birthdate,
      address: `Purok ${prng.int(1, 7)}, ${barangayName.get(entry.barangay)}`,
      civil_status: relationship === 'husband' ? 'married' : prng.pick(['single', 'partnered']),
      emergency_name: `${contactFirst} ${surname}`,
      emergency_relationship: relationship,
      emergency_no: phone(501 + index),
    });
    const risk = pid === 'divina-perez' ? text(data.RISK_NOTE, language) : null;
    db.pregnancies.push({
      id: `preg-${pid}`,
      patient_id: pid,
      lmp,
      edd: calcEdd(lmp),
      edd_source: 'naegele',
      risk_notes: risk,
      status: 'active',
      delivered_at: null,
    });
    if (entry.guardian) {
      db.guardian_consents.push({
        id: id('gcon'),
        profile_id: pid,
        guardian_name: entry.guardian.name,
        relationship: entry.guardian.relationship,
        contact: phone(510),
        signed_at: createdAt + 2 * MS_MINUTE,
      });
    }
    patients.push({ entry, id: pid, profile, prng, language, createdAt, weeks: entry.weeks, devices: null, base: null });
  });
  const patientById = new Map(patients.map((p) => [p.id, p]));

  // ---------- Devices (5.5) ----------
  function batteryAt(at, now_pct, drainPerHour, nowMs = now) {
    const period = 85 / drainPerHour; // hours from 100% down to 15%
    const sinceChargeNow = (100 - now_pct) / drainPerHour;
    const hoursAgo = (nowMs - at) / MS_HOUR;
    const raw = sinceChargeNow - hoursAgo;
    const since = ((raw % period) + period) % period;
    return clamp(Math.round(100 - since * drainPerHour), 8, 100);
  }
  function addDevicePair(patient, hasBoth) {
    if (!hasBoth) return;
    const { entry, id: pid, prng } = patient;
    const nowPct = { belt: pid === 'maricel-dimaculangan' ? 76 : prng.int(35, 95), band: pid === 'maricel-dimaculangan' ? 64 : prng.int(30, 92) };
    const drain = { belt: 1.1, band: 0.6 };
    patient.devices = {};
    for (const type of ['belt', 'band']) {
      const serial = `${type === 'belt' ? 'NLB' : 'NLW'}-2026-${entry.suffix}`;
      const name = advertisedName(type, serial);
      const fw = `1.2.${prng.int(0, 3)}`;
      const lastSeen = now - prng.int(5, 90) * SECOND;
      const pairedAt = patient.createdAt + MS_DAY;
      patient.devices[type] = { serial, name, fw, nowPct: nowPct[type], drain: drain[type], seq: prng.int(100, 900) };
      db.devices.push({
        id: `dev-${serial}`,
        patient_id: pid,
        type,
        serial,
        name,
        model: type === 'belt' ? 'NurtureLink belt' : 'NurtureLink wrist band',
        fw_version: fw,
        paired_at: pairedAt,
        last_seen_at: lastSeen,
        battery_pct: nowPct[type],
        charging: false,
        battery_updated_at: lastSeen,
        link_state: 'connected',
        last_seq: 0, // set after the history is generated
      });
      for (const hoursAgo of [60, 48, 36, 24, 12, 1]) {
        const at = now - hoursAgo * MS_HOUR;
        const pct = batteryAt(at, nowPct[type], drain[type]);
        db.device_status_log.push({
          id: id('dsl'),
          device_id: `dev-${serial}`,
          at,
          battery_pct: pct,
          vcell_mv: voltageForPct(pct),
          charging: false,
          state: type === 'belt' ? 'ACTIVE_IDLE' : 'CONNECTED_IDLE',
        });
      }
    }
  }
  patients.forEach((p) => addDevicePair(p, p.entry.devices));

  // ---------- Check sessions (5.6) ----------
  const alertPlan = data.ALERT_PLAN.map((plan) => ({ ...plan }));
  const planFor = (pid) => alertPlan.filter((plan) => plan.patient === pid);

  // Session specs per patient: { start, anomaly? }. Anomalies make the check that raised an alert (5.7).
  function sessionSpecs(patient) {
    const { id: pid, prng } = patient;
    const specs = [];
    // A gap day has no checks, so it never falls on the day of a check that raised an alert.
    const alertDays = new Set(planFor(pid).map((plan) => plan.daysAgo));
    const gapDays = new Set();
    while (gapDays.size < 2) {
      const day = prng.int(3, 20);
      if (!alertDays.has(day)) gapDays.add(day);
    }
    const jennyEnd = now - 24 * MS_HOUR - 3 * MS_MINUTE; // her last completed check: 24 hours and 3 minutes ago (5.7)
    const michelleGapStart = now - 6.3 * MS_DAY;
    const michelleGapEnd = michelleGapStart + 40 * MS_HOUR;

    for (let daysAgo = HISTORY_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
      if (gapDays.has(daysAgo)) continue;
      const date = addDays(today, -daysAgo);
      const count = prng.int(3, 6);
      for (let i = 0; i < count; i += 1) {
        const hour = 6 + Math.floor((i * 16) / count) + prng.int(0, 2);
        const start = manilaTime(date, hour, prng.int(0, 59));
        if (start > now - 10 * MS_MINUTE) continue;
        specs.push({ start });
      }
    }
    let kept = specs;
    if (pid === 'jenny-rose-villanueva') kept = kept.filter((s) => s.start + 124 * SECOND < jennyEnd);
    if (pid === 'michelle-tabora') kept = kept.filter((s) => s.start <= michelleGapStart || s.start > michelleGapEnd);

    const forced = [];
    for (const plan of planFor(pid)) {
      if (!['fhr_out_of_range', 'maternal_vitals', 'signal_loss'].includes(plan.type)) continue;
      const base =
        plan.minutesAgo !== undefined
          ? now - plan.minutesAgo * MS_MINUTE - 144 * SECOND
          : manilaTime(addDays(today, -plan.daysAgo), plan.hour, plan.minute);
      if (plan.type === 'fhr_out_of_range') forced.push({ start: base, anomaly: plan.direction === 'high' ? 'fhr_high' : 'fhr_low', plan });
      if (plan.type === 'maternal_vitals') forced.push({ start: base, anomaly: plan.metric, value: plan.value, plan });
      if (plan.type === 'signal_loss') {
        for (let k = 2; k >= 0; k -= 1) forced.push({ start: base - k * 30 * MS_MINUTE, anomaly: 'no_signal', plan: k === 0 ? plan : null });
        kept = kept.filter((s) => s.start < base - 2 * 30 * MS_MINUTE - 5 * MS_MINUTE || s.start > base + 5 * MS_MINUTE);
      }
    }
    if (pid === 'jenny-rose-villanueva') forced.push({ start: jennyEnd - 124 * SECOND });
    return [...kept, ...forced].sort((a, b) => a.start - b.start);
  }

  function windowRows(spec, patient, start, vitals, prng) {
    const { base } = patient;
    const contactDelay = prng.int(2, 6);
    const windows = [];
    for (let k = 1; k <= WINDOWS_PER_CHECK; k += 1) {
      const takenAt = start + contactDelay * SECOND + k * DEVICE_DEFAULTS.belt.windowS * SECOND;
      let fhr = clamp(Math.round(base.fhr + (prng.next() - prng.next()) * 8), 125, 155);
      let flags = 0;
      let confidence = prng.int(60, 95);
      let sqi = prng.int(55, 95);
      let maternal = false;
      if (spec.anomaly === 'no_signal') {
        fhr = 0;
        flags = FHR_FLAG.LOW_SIGNAL;
        confidence = prng.int(0, 20);
        sqi = prng.int(10, 30);
      } else if ((spec.anomaly === 'fhr_low' || spec.anomaly === 'fhr_high') && k >= 9 && k <= 23) {
        fhr = spec.anomaly === 'fhr_low' ? prng.int(96, 106) : prng.int(163, 171);
        flags = FHR_FLAG.OUT_OF_RANGE;
      } else {
        const roll = prng.next();
        if (roll < 0.03) {
          fhr = 0;
          flags = FHR_FLAG.MOTION;
        } else if (roll < 0.05) {
          fhr = 0;
          flags = FHR_FLAG.POOR_CONTACT;
        } else if (roll < 0.07) {
          fhr = 0;
          flags = FHR_FLAG.LOW_SIGNAL;
        } else if (roll < 0.085 && Math.abs(takenAt - vitals.taken_at) <= 10 * SECOND) {
          // probable maternal signal: close to the band rate (within 5 bpm) and close in time (within 10 s)
          fhr = vitals.hr_bpm + prng.int(-3, 3);
          maternal = true;
        }
        if (flags !== 0) {
          confidence = prng.int(20, 50);
          sqi = prng.int(20, 45);
        }
      }
      windows.push({ taken_at: takenAt, fhr_bpm: fhr, confidence, sqi, element: prng.int(1, 3), flags, maternal_match: maternal });
    }
    return { windows, contactDelay };
  }

  const sessionsOf = new Map(); // patient id -> sessions (oldest first), used for alerts and the missed-check gap
  for (const patient of patients) {
    if (!patient.devices) continue;
    patient.base = {
      fhr: patient.prng.int(136, 148),
      hr: patient.prng.int(72, 88),
      spo2: patient.prng.int(97, 98),
      temp: 36.4 + patient.prng.int(0, 4) / 10,
    };
    const prng = patient.prng.fork('history');
    const { belt, band } = patient.devices;
    const rows = [];
    let deviceSession = prng.int(1, 3000);
    for (const spec of sessionSpecs(patient)) {
      const vitalsAt = spec.start + 30 * SECOND;
      const sid = id('chk');
      deviceSession += 1;

      // Band burst at the start of the check: normal values, or the value that raised an alert.
      const vitals = {
        taken_at: vitalsAt,
        hr_bpm: clamp(patient.base.hr + prng.int(-4, 6), 70, 95),
        spo2_pct: clamp(patient.base.spo2 + prng.int(-1, 1), 96, 99),
        skin_temp_c: Math.round((patient.base.temp + prng.int(-1, 4) / 10) * 10) / 10,
        flags: 0,
      };
      if (spec.anomaly === 'spo2') vitals.spo2_pct = spec.value;
      if (spec.anomaly === 'heart_rate') vitals.hr_bpm = spec.value;
      if (spec.anomaly === 'skin_temperature') vitals.skin_temp_c = spec.value;
      vitals.skin_temp_c = clamp(vitals.skin_temp_c, 36.2, spec.anomaly === 'skin_temperature' ? 40 : 37.0);
      const { windows, contactDelay } = windowRows(spec, patient, spec.start, vitals, prng);
      const endedAt = spec.start + (contactDelay + DEVICE_DEFAULTS.belt.checkDurationS + 1) * SECOND;

      // The belt spends one sequence number per window and one on the summary; the band one per burst.
      const firstBeltSeq = belt.seq + 1;
      belt.seq += WINDOWS_PER_CHECK + 1;
      band.seq += 1;
      const recent = isRecentStart(spec.start);
      const summary = summarizeCheck({ windows, vitals: [vitals] });
      db.check_sessions.push({
        id: sid,
        patient_id: patient.id,
        started_at: spec.start,
        ended_at: endedAt,
        source: prng.chance(0.7) ? 'scheduled' : 'on_demand',
        belt_serial: belt.serial,
        band_serial: band.serial,
        battery_belt_pct: batteryAt(spec.start, belt.nowPct, belt.drain),
        battery_band_pct: batteryAt(spec.start, band.nowPct, band.drain),
        device_session_id: deviceSession,
        status: 'completed',
        summary,
        syncState: 'synced',
        client_id: null,
      });
      rows.push({ id: sid, started_at: spec.start, ended_at: endedAt, summary, spec });
      if (recent) {
        windows.forEach((w, index) => {
          db.fetal_readings.push({
            id: id('fr'),
            session_id: sid,
            device_seq: firstBeltSeq + index,
            taken_at: w.taken_at,
            fhr_bpm: w.fhr_bpm,
            confidence: w.confidence,
            sqi: w.sqi,
            element: w.element,
            flags: w.flags,
            maternal_match: w.maternal_match,
            syncState: 'synced',
          });
        });
        db.maternal_readings.push({
          id: id('mr'),
          session_id: sid,
          device_seq: band.seq,
          taken_at: vitalsAt,
          hr_bpm: vitals.hr_bpm,
          spo2_pct: vitals.spo2_pct,
          skin_temp_c: vitals.skin_temp_c,
          flags: 0,
          syncState: 'synced',
        });
      }
    }
    sessionsOf.set(patient.id, rows);
    // The app holds everything up to these sequence numbers; the devices start with empty ring buffers.
    for (const type of ['belt', 'band']) {
      const device = patient.devices[type];
      const row = db.devices.find((d) => d.serial === device.serial);
      row.last_seq = device.seq;
      hardware[device.serial] = {
        serial: device.serial,
        type,
        name: device.name,
        bound_patient_id: patient.id,
        advertising: device.serial.endsWith('-0099') && type === 'belt',
        connected: true,
        state: type === 'belt' ? 'ACTIVE_IDLE' : 'CONNECTED_IDLE',
        battery: device.nowPct,
        charging: false,
        exposure: [],
        ring: [],
        next_seq: device.seq + 1,
        session_counter: deviceSession,
        clock_synced: true,
        fault: 0,
        fw_version: device.fw,
        signal: null,
        sos: null,
      };
    }
  }
  function isRecentStart(start) {
    return now - start <= WINDOW_ROWS_DAYS * MS_DAY;
  }

  // Unpaired devices that show in the pairing chooser (5.5).
  for (const type of ['belt', 'band']) {
    const serial = `${type === 'belt' ? 'NLB' : 'NLW'}-2026-${data.NEARBY_FREE_SUFFIX}`;
    hardware[serial] = {
      serial,
      type,
      name: advertisedName(type, serial),
      bound_patient_id: null,
      advertising: true,
      connected: false,
      state: type === 'belt' ? 'DEEP_SLEEP' : 'ADVERTISING',
      battery: type === 'belt' ? 88 : 83,
      charging: false,
      exposure: [],
      ring: [],
      next_seq: 1,
      session_counter: 0,
      clock_synced: false,
      fault: 0,
      fw_version: '1.2.0',
      signal: null,
      sos: null,
    };
  }

  // ---------- Notifications helper ----------
  function notify(profileId, type, payload, at, unread) {
    db.notifications.push({
      id: id('ntf'),
      profile_id: profileId,
      type,
      payload,
      created_at: at,
      read_at: unread ? null : Math.min(at + rng.int(1, 60) * MS_MINUTE, now), // never read in the future
    });
  }

  // ---------- Alerts (5.7) ----------
  for (const plan of alertPlan) {
    const pid = plan.patient;
    const patient = patientById.get(pid);
    const sessions = sessionsOf.get(pid) ?? [];
    const prng = rng.fork(`alert:${pid}:${plan.type}`);
    let createdAt;
    let readingRef = null;
    let payload;

    if (plan.type === 'missed_check') {
      if (plan.status === 'new') {
        createdAt = now - 3 * MS_MINUTE; // 24 hours after her last completed check
      } else {
        const before = [...sessions].reverse().find((s) => s.started_at <= now - plan.gapDaysAgo * MS_DAY);
        createdAt = before.ended_at + 24 * MS_HOUR + 3 * MS_MINUTE;
      }
      const lastCheck = [...sessions].reverse().find((s) => s.ended_at <= createdAt);
      payload = { hours: 24, last_check_at: lastCheck ? lastCheck.ended_at : null };
    } else if (plan.type === 'sos') {
      createdAt = manilaTime(addDays(today, -plan.daysAgo), plan.hour, plan.minute);
      payload = { seq: prng.int(1, 40), battery: 55 };
    } else if (plan.type === 'battery_critical') {
      createdAt = manilaTime(addDays(today, -plan.daysAgo), plan.hour, plan.minute);
      payload = { serial: patient.devices[plan.device].serial, device: plan.device, pct: plan.pct, level: 'critical' };
    } else {
      const raised = sessions.find((s) => s.spec.plan === plan);
      readingRef = raised.id;
      createdAt = raised.ended_at + 20 * SECOND;
      if (plan.type === 'fhr_out_of_range') {
        payload = { direction: plan.direction, sustained_seconds: 60, extreme_bpm: plan.direction === 'low' ? 96 : 171 };
      } else if (plan.type === 'signal_loss') {
        payload = { consecutive_checks: THRESHOLDS.signalLoss.consecutiveChecks };
      } else {
        payload = { metrics: [{ metric: plan.metric, value: plan.value, direction: plan.metric === 'spo2' ? 'low' : 'high' }] };
      }
    }

    const alert = {
      id: id('alt'),
      patient_id: pid,
      type: plan.type,
      severity: ALERT_SEVERITY[plan.type],
      reading_ref: readingRef,
      created_at: createdAt,
      last_seen_at: createdAt,
      merged_count: 0,
      status: 'new',
      acknowledged_by: null,
      acknowledged_at: null,
      escalated_at: null,
      resolved_by: null,
      resolved_at: null,
      outcome: null,
      outcome_code: null,
      cancelled_at: null,
      payload,
    };
    if (plan.status !== 'new') {
      alert.acknowledged_by = plan.ack;
      alert.acknowledged_at = createdAt + (plan.escalated ? 7 : prng.int(1, 6)) * MS_MINUTE;
      alert.status = 'acknowledged';
    }
    if (plan.escalated) alert.escalated_at = createdAt + THRESHOLDS.escalation.minutes * MS_MINUTE;
    if (plan.status !== 'new' && plan.status !== 'acknowledged') {
      alert.status = 'resolved';
      alert.resolved_by = plan.ack;
      alert.resolved_at = alert.acknowledged_at + prng.int(8, 40) * MS_MINUTE;
      const key = plan.escalated ? 'fhr_escalated' : plan.type;
      alert.outcome = text(data.OUTCOMES[key], lang(plan.ack));
    }
    db.alerts.push(alert);

    // Delivery (ALR-03): the barangay's accounts, the patient's own notice, and all super accounts for SOS and escalations.
    const unread = alert.status !== 'resolved';
    for (const bhw of bhwsOf(patient.entry.barangay)) {
      notify(bhw.id, 'alert', { alert_id: alert.id, alert_type: alert.type, patient_id: pid }, createdAt, unread && bhw.id !== alert.acknowledged_by);
    }
    notify(pid, 'alert_notice', { alert_id: alert.id, alert_type: alert.type }, createdAt, unread);
    if (plan.type === 'sos') {
      for (const s of supers) notify(s.id, 'alert', { alert_id: alert.id, alert_type: 'sos', patient_id: pid }, createdAt, false);
    }
    if (plan.escalated) {
      for (const s of supers) {
        notify(s.id, 'alert', { alert_id: alert.id, alert_type: alert.type, patient_id: pid, escalated: true }, alert.escalated_at, false);
      }
    }
  }

  // ---------- Appointments (5.8) ----------
  const hourOf = (date, hour, minute = 0) => manilaTime(date, hour, minute);
  const clinicProvider = (barangayId) => bhwsOf(barangayId)[0].id;
  function addAppointment(row) {
    const appointment = {
      id: id('apt'),
      provider_id: null,
      type: 'clinic',
      requested_at: null,
      scheduled_at: null,
      preferred_start: null,
      preferred_end: null,
      location: 'Barangay health station',
      status: 'approved',
      reason: null,
      notes: null,
      handled_by: null,
      handled_at: null,
      decline_reason: null,
      ended_at: null,
      ...row,
    };
    db.appointments.push(appointment);
    return appointment;
  }
  patients.forEach((patient, index) => {
    const pid = patient.id;
    const provider = clinicProvider(patient.entry.barangay);
    const past = [
      { daysAgo: 14 + (index % 5), status: 'attended' },
      { daysAgo: 42 + (index % 4), status: 'attended' },
    ];
    if (pid === 'lovely-ann-castillo') past[0].status = 'missed';
    if (pid === 'grace-anne-mercado') past[1].status = 'missed';
    if (pid === 'joanna-marie-soriano') past[1].status = 'rescheduled';
    if (pid === 'michelle-tabora') past.unshift({ daysAgo: 5, status: 'missed' });
    for (const item of past) {
      const at = hourOf(addDays(today, -item.daysAgo), 9 + (index % 3));
      addAppointment({ patient_id: pid, provider_id: provider, scheduled_at: at, requested_at: at - 3 * MS_DAY, status: item.status });
    }
    const daysAhead = pid === 'maricel-dimaculangan' ? 6 : pid === 'michelle-tabora' ? 3 : 8 + ((index * 3) % 20);
    const at = hourOf(addDays(today, daysAhead), 9 + (index % 3));
    // fixed at the last visit, a few days ago
    addAppointment({ patient_id: pid, provider_id: provider, scheduled_at: at, requested_at: now - (2 + (index % 6)) * MS_DAY });
  });

  for (const patient of patients) {
    const upcoming = db.appointments.find((a) => a.patient_id === patient.id && a.type === 'clinic' && a.status === 'approved' && a.scheduled_at > now);
    notify(patient.id, 'appointment_approved', { appointment_id: upcoming.id }, upcoming.requested_at + 2 * MS_HOUR, false);
    for (const bhw of bhwsOf(patient.entry.barangay)) {
      notify(bhw.id, 'appointment_approved', { appointment_id: upcoming.id, patient_id: patient.id }, upcoming.requested_at + 2 * MS_HOUR, false);
    }
  }

  const pendingRequests = [
    { patient: 'lovely-ann-castillo', type: 'teleconsult', hoursAgo: 26, daysAhead: 3 },
    { patient: 'maribel-lopez', type: 'clinic', hoursAgo: 5, daysAhead: 4 },
    { patient: 'mary-joy-cabrera', type: 'teleconsult', hoursAgo: 2, daysAhead: 5 },
  ];
  pendingRequests.forEach((request, index) => {
    const patient = patientById.get(request.patient);
    const date = addDays(today, request.daysAhead);
    const appointment = addAppointment({
      patient_id: request.patient,
      type: request.type,
      location: request.type === 'clinic' ? 'Barangay health station' : 'Teleconsultation',
      requested_at: now - request.hoursAgo * MS_HOUR,
      preferred_start: hourOf(date, 13),
      preferred_end: hourOf(date, 17),
      status: 'pending',
      reason: data.BOOKING_REASONS[patient.language][index],
    });
    for (const s of supers) notify(s.id, 'booking_request', { appointment_id: appointment.id, patient_id: request.patient }, appointment.requested_at, true);
  });

  const analyn = patientById.get('analyn-gonzales');
  const tomorrow = addDays(today, 1);
  const teleconsult = addAppointment({
    patient_id: 'analyn-gonzales',
    provider_id: 'cynthia-dimayuga',
    type: 'teleconsult',
    location: 'Teleconsultation',
    requested_at: now - 2 * MS_DAY,
    scheduled_at: hourOf(tomorrow, 10),
    status: 'approved',
    reason: text(data.APPROVED_REASON, analyn.language),
    handled_by: 'rowena-macaraig',
    handled_at: now - 2 * MS_DAY + 3 * MS_HOUR,
  });
  notify('analyn-gonzales', 'appointment_approved', { appointment_id: teleconsult.id }, teleconsult.handled_at, false);
  for (const bhw of bhwsOf('pisa')) notify(bhw.id, 'appointment_approved', { appointment_id: teleconsult.id, patient_id: 'analyn-gonzales' }, teleconsult.handled_at, false);

  const rhea = patientById.get('rhea-mae-fajardo');
  addAppointment({
    patient_id: 'rhea-mae-fajardo',
    type: 'teleconsult',
    location: 'Teleconsultation',
    requested_at: now - 3 * MS_DAY,
    preferred_start: hourOf(addDays(today, -1), 13),
    preferred_end: hourOf(addDays(today, -1), 17),
    status: 'declined',
    reason: data.BOOKING_REASONS[rhea.language][1],
    handled_by: 'cynthia-dimayuga',
    handled_at: now - 3 * MS_DAY + 5 * MS_HOUR,
    decline_reason: text(data.DECLINE_REASON, rhea.language),
  });
  addAppointment({
    patient_id: 'divina-perez',
    provider_id: null,
    type: 'hospital',
    location: 'Referral hospital, Batangas City',
    requested_at: now - 6 * MS_DAY,
    scheduled_at: hourOf(addDays(today, 9), 8),
    status: 'approved',
  });
  for (const s of supers) {
    notify(
      s.id,
      'referral',
      { patient_id: 'divina-perez', reason: text(data.REFERRAL_REASON, s.language), from_profile_id: 'josefina-ocampo' },
      now - 6 * MS_DAY,
      false,
    );
  }

  // ---------- Events (5.8) ----------
  const eventSpecs = [
    { title: 'Prenatal check-up day', scope: 'barangay', barangay: 'brgy-14', days: 3, from: [8, 12], by: 'lourdes-magpantay', ago: 4 },
    { title: 'Pregnancy class', scope: 'barangay', barangay: 'pisa', days: 5, from: [14, 16], by: 'lilia-comia', ago: 3 },
    { title: 'Tetanus vaccination day', scope: 'all', barangay: null, days: 9, from: [8, 15], by: 'rowena-macaraig', ago: 2 },
    { title: 'Nutrition and breastfeeding talk', scope: 'barangay', barangay: 'talahib', days: 12, from: [9, 11], by: 'benjamin-lat', ago: 1 },
  ];
  for (const spec of eventSpecs) {
    const date = addDays(today, spec.days);
    const event = {
      id: id('evt'),
      title: spec.title,
      scope: spec.scope,
      barangay_id: spec.barangay,
      place: spec.scope === 'all' ? data.EVENT_PLACE.all : data.EVENT_PLACE.barangay,
      starts_at: hourOf(date, spec.from[0]),
      ends_at: hourOf(date, spec.from[1]),
      created_by: spec.by,
    };
    db.events.push(event);
    const createdAt = now - spec.ago * MS_DAY;
    const audience = db.profiles.filter(
      (p) => p.role !== 'super' && (spec.scope === 'all' || p.barangay_id === spec.barangay),
    );
    for (const person of audience) {
      notify(person.id, 'event_created', { event_id: event.id }, createdAt, spec.ago <= 1.5 || person.id === 'maricel-dimaculangan' || person.id === 'lourdes-magpantay');
    }
  }

  // ---------- Conversations and messages (5.8) ----------
  const barangayThreadOf = new Map();
  patients.forEach((patient, index) => {
    const pid = patient.id;
    const bhws = bhwsOf(patient.entry.barangay);
    const conversation = {
      id: `conv-barangay-${pid}`,
      patient_id: pid,
      kind: 'barangay',
      barangay_id: patient.entry.barangay,
      assigned_provider_id: null,
      appointment_id: null,
      unlocked_until: null,
    };
    db.conversations.push(conversation);
    barangayThreadOf.set(pid, conversation);
    const midwife = {
      id: `conv-midwife-${pid}`,
      patient_id: pid,
      kind: 'midwife',
      barangay_id: null,
      assigned_provider_id: null,
      appointment_id: null,
      unlocked_until: null,
    };
    if (pid === 'analyn-gonzales') {
      midwife.assigned_provider_id = 'cynthia-dimayuga';
      midwife.appointment_id = teleconsult.id;
      midwife.unlocked_until =
        teleconsult.scheduled_at + (THRESHOLDS.videoJoin.afterMinutes * MS_MINUTE) + THRESHOLDS.followUpChatHours * MS_HOUR;
      const sentAt = teleconsult.handled_at + 10 * MS_MINUTE;
      db.messages.push({
        id: id('msg'),
        conversation_id: midwife.id,
        sender_id: 'cynthia-dimayuga',
        body: text(data.CHAT_MIDWIFE, patient.language),
        attachment_art: null,
        sent_at: sentAt,
        delivered_at: sentAt + 2 * SECOND,
        seen_at: sentAt + 40 * MS_MINUTE,
        client_id: null,
        syncState: 'synced',
      });
    }
    db.conversations.push(midwife);

    if (!patient.devices) return; // a barangay thread with messages for each paired patient
    const prng = patient.prng.fork('chat');
    const count = pid === 'rosalinda-ramos' ? 3 : prng.int(3, 4);
    let at = now - prng.int(30, 100) * MS_HOUR;
    for (let i = 0; i < count; i += 1) {
      const fromPatient = i % 2 === 0;
      const sender = fromPatient ? pid : bhws[(index + i) % bhws.length].id;
      const pool = fromPatient ? data.CHAT_PATIENT : data.CHAT_BHW;
      const language = fromPatient ? patient.language : lang(sender);
      const body = pool[language][(index + i) % pool[language].length];
      at += prng.int(20, 300) * MS_MINUTE;
      const last = i === count - 1;
      const unseen = last && fromPatient && (pid === 'rosalinda-ramos' || index % 4 === 1);
      db.messages.push({
        id: id('msg'),
        conversation_id: conversation.id,
        sender_id: sender,
        body,
        attachment_art: null,
        sent_at: at,
        delivered_at: at + 2 * SECOND,
        seen_at: unseen ? null : at + prng.int(1, 30) * MS_MINUTE,
        client_id: null,
        syncState: 'synced',
      });
      const audience = fromPatient ? bhws.map((bhw) => bhw.id) : [pid];
      for (const profileId of audience) notify(profileId, 'message', { conversation_id: conversation.id, patient_id: pid }, at, unseen);
    }
  });

  // ---------- Visit notes (5.8) ----------
  patients.forEach((patient, index) => {
    const bhws = bhwsOf(patient.entry.barangay);
    const prng = patient.prng.fork('visits');
    const count = patient.id === 'maricel-dimaculangan' ? 3 : prng.int(2, 3); // her third note is for providers only
    for (let i = 0; i < count; i += 1) {
      const author = bhws[(index + i) % bhws.length];
      const language = author.language;
      db.visit_notes.push({
        id: id('vn'),
        patient_id: patient.id,
        author_id: author.id,
        taken_at: now - (6 + i * 14 + prng.int(0, 6)) * MS_DAY,
        bp_systolic: prng.int(100, 122),
        bp_diastolic: prng.int(62, 78),
        weight_kg: Math.round((50 + patient.weeks * 0.3 + prng.int(0, 12) + prng.next()) * 10) / 10,
        note: data.VISIT_NOTES[language][(index + i) % data.VISIT_NOTES[language].length],
        shared: i !== 2,
      });
    }
  });

  // ---------- Logs (5.8) ----------
  for (let i = 0; i < 18; i += 1) {
    const prng = rng.fork(`access:${i}`);
    const actor = prng.pick(db.profiles.filter((p) => p.role !== 'patient'));
    const inScope = patients.filter((p) => actor.role === 'super' || p.entry.barangay === actor.barangay_id);
    if (inScope.length === 0) continue;
    db.access_log.push({
      id: id('acl'),
      actor_id: actor.id,
      patient_id: prng.pick(inScope).id,
      action: 'view_record',
      at: now - prng.int(1, 20 * 24) * MS_HOUR,
    });
  }
  db.access_log.sort((a, b) => a.at - b.at);

  // Push notifications (COM-04): every seeded account chose them on this phone long ago, so only a new sign-up is asked.
  for (const profile of db.profiles) {
    db.push_subscriptions.push({
      id: id('psh'),
      profile_id: profile.id,
      endpoint: `https://push.nurturelink.ph/s/${profile.id}`,
      keys: { p256dh: `p256dh-${profile.id}`, auth: `auth-${profile.id}` },
      created_at: now - 20 * MS_DAY,
    });
  }
  db.export_log.push(
    { id: id('exl'), actor_id: 'rowena-macaraig', filter: 'All barangays', row_count: 20, at: now - 12 * MS_DAY },
    { id: id('exl'), actor_id: 'cynthia-dimayuga', filter: 'Barangay 14 (Poblacion 2)', row_count: 3, at: now - 6 * MS_DAY },
    { id: id('exl'), actor_id: 'rowena-macaraig', filter: 'Talahib', row_count: 2, at: now - 2 * MS_DAY },
  );

  for (const profile of db.profiles) {
    const newest = db.notifications.filter((n) => n.profile_id === profile.id).sort((a, b) => b.created_at - a.created_at);
    for (const n of newest.slice(0, 1 + (profile.id.length % 2))) if (now - n.created_at < 6 * MS_DAY) n.read_at = null;
  }
  db.notifications.sort((a, b) => a.created_at - b.created_at);

  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: now,
    db,
    hardware,
    meta: {
      connection: 'online',
      timing: DEFAULT_TIMING,
      focus_patient_id: 'maricel-dimaculangan',
      last_synced_at: now,
      video_usage: { used: VIDEO_USAGE.usedMinutes, limit: VIDEO_USAGE.limitMinutes },
      run: null,
    },
    session: null,
    live: { check: null, sos: null },
  };
}

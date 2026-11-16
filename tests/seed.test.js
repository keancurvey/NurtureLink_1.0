import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/sim/seed.js';
import { THRESHOLDS, flattenThresholds } from '../src/config/thresholds.js';
import { MS_DAY, MS_HOUR, addDays, manilaDate } from '../src/lib/dates.js';
import { calcEdd, gestationalAge, isNearDue } from '../src/lib/pregnancy.js';
import { evaluateFhr, evaluateMaternalVitals, evaluateMissedCheck, evaluateSignalLoss } from '../src/lib/alertRules.js';
import { advertisedName } from '../src/lib/packets.js';
import { dedupeKey } from '../src/lib/offlineQueue.js';
import { PATIENTS } from '../src/sim/seedData.js';
import { PRESENTER_ACCOUNTS } from '../src/lib/permissions.js';

const NOW = Date.parse('2026-11-08T08:00:00Z'); // 4:00 PM in Manila
const TODAY = manilaDate(NOW);
const seed = createSeed({ now: NOW });
const { db, hardware, meta } = seed;
const byId = (table, id) => db[table].find((row) => row.id === id);
const profile = (id) => byId('profiles', id);
const countBy = (rows, key) => rows.reduce((acc, row) => ({ ...acc, [row[key]]: (acc[row[key]] ?? 0) + 1 }), {});
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function ageOn(birthdate, today) {
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

test('accounts: 2 super, 20 barangay, 20 patients, 15 barangays', () => {
  assert.deepEqual(countBy(db.profiles, 'role'), { super: 2, barangay: 20, patient: 20 });
  assert.equal(db.barangays.length, 15);
  assert.equal(db.patients.length, 20);
  assert.equal(db.pregnancies.length, 20);
});

test('barangay health workers per barangay follow the plan; Marikaban has one and no patients', () => {
  const bhws = countBy(db.profiles.filter((p) => p.role === 'barangay'), 'barangay_id');
  assert.deepEqual(bhws, {
    corona: 1, gamao: 1, makawayan: 2, marikaban: 1, papaya: 1, pisa: 2, 'brgy-13': 1, 'brgy-14': 2, 'brgy-15': 1,
    'san-isidro': 1, 'san-jose': 2, 'san-juan': 1, 'san-pedro': 1, 'santo-tomas': 1, talahib: 2,
  });
  const patients = countBy(db.profiles.filter((p) => p.role === 'patient'), 'barangay_id');
  assert.equal(patients.marikaban, undefined);
  assert.equal(patients['brgy-14'], 3);
  assert.equal(Object.keys(patients).length, 14);
  for (const barangay of db.barangays) assert.ok(db.profiles.some((p) => p.role === 'barangay' && p.barangay_id === barangay.id), barangay.id);
});

test('phone numbers are in the fictional range, unique, in the plan order; providers have email, patients do not', () => {
  const all = db.profiles.map((p) => p.contact_no);
  assert.equal(new Set(all).size, all.length);
  for (const number of all) assert.match(number, /^0917 555 0\d{3}$/);
  assert.equal(profile('maricel-dimaculangan').contact_no, '0917 555 0201');
  assert.equal(profile('noemi-quizon').contact_no, '0917 555 0219');
  assert.equal(profile('gemma-salazar').contact_no, '0917 555 0220');
  assert.equal(profile('teresita-hernandez').contact_no, '0917 555 0301');
  assert.equal(profile('benjamin-lat').contact_no, '0917 555 0320');
  assert.equal(profile('rowena-macaraig').contact_no, '0917 555 0401');
  assert.equal(profile('cynthia-dimayuga').contact_no, '0917 555 0402');
  assert.equal(profile('lourdes-magpantay').email, 'lourdes.magpantay@nurturelink.ph');
  assert.equal(profile('rowena-macaraig').email, 'rowena.macaraig@nurturelink.ph');
  for (const p of db.profiles) assert.equal(p.email === null, p.role === 'patient', p.id);
});

test('super accounts: Rowena is the registered midwife; the office accounts have a role line', () => {
  const rowena = profile('rowena-macaraig');
  assert.equal(rowena.name_suffix, 'RM');
  assert.equal(rowena.title, 'Registered Midwife, Tingloy Municipal Health Office');
  assert.equal(rowena.language, 'en');
  assert.equal(profile('cynthia-dimayuga').language, 'fil');
});

test('every account has accepted the terms and changed its first password; one password for all', () => {
  assert.equal(db.credentials.length, 42);
  for (const credential of db.credentials) {
    assert.equal(credential.password, 'NurtureLink2026!');
    assert.equal(credential.must_change_password, false);
  }
  assert.equal(db.consents.length, 42);
  for (const consent of db.consents) {
    assert.equal(consent.document, 'terms_privacy');
    assert.equal(consent.version, '1.0');
  }
});

test('Cherry Mae is 17 and the only account with a guardian consent', () => {
  assert.equal(db.guardian_consents.length, 1);
  const guardian = db.guardian_consents[0];
  assert.equal(guardian.profile_id, 'cherry-mae-dalisay');
  assert.equal(guardian.guardian_name, 'Luzviminda Dalisay');
  assert.equal(guardian.relationship, 'mother');
  const under18 = db.patients.filter((p) => ageOn(p.birthdate, TODAY) < 18);
  assert.deepEqual(under18.map((p) => p.id), ['cherry-mae-dalisay']);
});

test('ages and gestational weeks match the table of Section 5.4 today', () => {
  for (const entry of PATIENTS) {
    const id = slug(entry.name).replace(/-$/, '');
    const patient = byId('patients', id);
    assert.equal(ageOn(patient.birthdate, TODAY), entry.age, `${entry.name} age`);
    const pregnancy = db.pregnancies.find((p) => p.patient_id === id);
    const ga = gestationalAge(pregnancy.lmp, TODAY);
    assert.equal(ga.weeks, entry.weeks, `${entry.name} weeks`);
    assert.equal(pregnancy.edd, calcEdd(pregnancy.lmp), `${entry.name} EDD is LMP + 280 days`);
    assert.equal(pregnancy.edd_source, 'naegele');
    assert.equal(pregnancy.status, 'active');
  }
  const maricel = db.pregnancies.find((p) => p.patient_id === 'maricel-dimaculangan');
  assert.deepEqual(gestationalAge(maricel.lmp, TODAY), { totalDays: 219, weeks: 31, days: 2 });
});

test('Analyn is the near-due patient; Jenny Rose at 36 weeks cannot be within 14 days of an LMP-based EDD', () => {
  const nearDue = db.pregnancies.filter((p) => isNearDue(p.edd, TODAY)).map((p) => p.patient_id);
  assert.deepEqual(nearDue, ['analyn-gonzales']);
});

test('addresses are purok level with no street names; emergency contacts are text fields', () => {
  for (const patient of db.patients) {
    assert.match(patient.address, /^Purok [1-7], /);
    assert.ok(patient.emergency_name && patient.emergency_relationship);
    assert.match(patient.emergency_no, /^0917 555 05\d{2}$/);
  }
});

test('14 patients have both devices and 6 have none; Maricel and the pairing chooser match Section 5.5', () => {
  const perPatient = countBy(db.devices, 'patient_id');
  assert.equal(Object.keys(perPatient).length, 14);
  for (const count of Object.values(perPatient)) assert.equal(count, 2);
  const without = db.patients.filter((p) => !perPatient[p.id]).map((p) => p.id).sort();
  assert.deepEqual(without, ['beverly-ann-navarro', 'cherry-mae-dalisay', 'gemma-salazar', 'grace-anne-mercado', 'liezl-santos', 'shiela-marie-aguila']);

  const belt = db.devices.find((d) => d.patient_id === 'maricel-dimaculangan' && d.type === 'belt');
  const band = db.devices.find((d) => d.patient_id === 'maricel-dimaculangan' && d.type === 'band');
  assert.equal(belt.name, 'NL-BELT-0412');
  assert.equal(band.name, 'NL-BAND-0412');
  assert.equal(belt.battery_pct, 76);
  assert.equal(band.battery_pct, 64);
  assert.equal(belt.link_state, 'connected');
  assert.equal(band.link_state, 'connected');
  assert.match(belt.fw_version, /^1\.2\.\d$/);

  const serials = db.devices.map((d) => d.serial);
  assert.equal(new Set(serials).size, serials.length);
  for (const device of db.devices) assert.equal(device.name, advertisedName(device.type, device.serial));
  assert.equal(db.devices.find((d) => d.name === 'NL-BELT-0099').patient_id, 'rosalinda-ramos');

  const advertising = Object.values(hardware).filter((h) => h.advertising).map((h) => h.name).sort();
  assert.deepEqual(advertising, ['NL-BAND-0555', 'NL-BELT-0099', 'NL-BELT-0555']);
  assert.equal(hardware['NLB-2026-0555'].bound_patient_id, null);
  assert.equal(hardware['NLB-2026-0099'].bound_patient_id, 'rosalinda-ramos');
});

test('hardware matches the devices: same battery, empty ring buffers, sequence numbers carry on', () => {
  for (const device of db.devices) {
    const hw = hardware[device.serial];
    assert.equal(hw.battery, device.battery_pct, device.serial);
    assert.equal(hw.bound_patient_id, device.patient_id);
    assert.deepEqual(hw.ring, []);
    assert.equal(hw.next_seq, device.last_seq + 1, `${device.serial} next sequence`);
    assert.equal(hw.connected, true);
  }
});

test('check history: 3 to 6 completed sessions on most days over 21 days, a few gap days', () => {
  const start = NOW - 21 * MS_DAY;
  // Alerts span 30 days but history 21, so the one alert older than that (Noemi, 22 days ago) keeps its reading.
  const alertReadings = new Set(db.alerts.map((a) => a.reading_ref).filter(Boolean));
  const outside = db.check_sessions.filter((s) => s.started_at < start);
  assert.deepEqual(outside.map((s) => s.patient_id), ['noemi-quizon']);
  assert.ok(alertReadings.has(outside[0].id));
  for (const patientId of [...new Set(db.devices.map((d) => d.patient_id))]) {
    if (patientId === 'jenny-rose-villanueva' || patientId === 'michelle-tabora') continue; // built with gaps for their missed-check alerts
    const sessions = db.check_sessions.filter((s) => s.patient_id === patientId);
    const perDay = countBy(sessions, 'started_at');
    assert.ok(Object.keys(perDay).length > 0);
    const days = new Map();
    for (const s of sessions.filter((x) => x.started_at >= start)) {
      assert.ok(s.started_at >= start - 2 * MS_DAY && s.started_at < NOW, 'inside the history');
      if (s.started_at < start) continue;
      const day = manilaDate(s.started_at);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    const complete = [...days.entries()].filter(([day]) => day !== TODAY);
    assert.ok(complete.length >= 17 && complete.length <= 19, `${patientId} has ${complete.length} active days`);
    for (const [, n] of complete) assert.ok(n >= 3 && n <= 6 + 3, `3 to 6 sessions a day (got ${n})`);
    for (const s of sessions) {
      assert.equal(s.status, 'completed');
      assert.equal(s.syncState, 'synced');
      assert.equal(s.ended_at - s.started_at >= 120000, true);
    }
  }
});

test('per-window rows exist only for the last 3 days; each such session has 30 windows and a band reading', () => {
  const sessionById = new Map(db.check_sessions.map((s) => [s.id, s]));
  for (const row of db.fetal_readings) {
    assert.ok(NOW - sessionById.get(row.session_id).started_at <= 3 * MS_DAY);
    assert.equal(row.syncState, 'synced');
    assert.equal(row.serial, undefined, 'the serial is on the session (spec 6.1)');
  }
  const recent = db.check_sessions.filter((s) => NOW - s.started_at <= 3 * MS_DAY);
  assert.ok(recent.length > 150);
  const windowsPer = countBy(db.fetal_readings, 'session_id');
  const vitalsPer = countBy(db.maternal_readings, 'session_id');
  for (const s of recent) {
    assert.equal(windowsPer[s.id], 30, s.id);
    assert.equal(vitalsPer[s.id], 1, s.id);
  }
  const older = db.check_sessions.filter((s) => NOW - s.started_at > 3 * MS_DAY);
  assert.ok(older.length > 900);
  for (const s of older) assert.equal(windowsPer[s.id], undefined);
});

test('sequence numbers are unique per device and run in time order', () => {
  const serialOf = new Map(db.check_sessions.map((s) => [s.id, s.belt_serial]));
  const seen = new Set();
  let previous = new Map();
  for (const row of [...db.fetal_readings].sort((a, b) => a.taken_at - b.taken_at)) {
    const key = dedupeKey(row, serialOf.get(row.session_id));
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
    const serial = serialOf.get(row.session_id);
    assert.ok(row.device_seq > (previous.get(serial) ?? -1));
    previous.set(serial, row.device_seq);
  }
});

test('the history is believable: normal readings stay inside the thresholds unless an alert explains them', () => {
  const explained = new Set(db.alerts.map((a) => a.reading_ref).filter(Boolean));
  const sessionsBy = new Map();
  for (const s of db.check_sessions) sessionsBy.set(s.patient_id, [...(sessionsBy.get(s.patient_id) ?? []), s]);
  const windowsBy = new Map();
  for (const w of db.fetal_readings) windowsBy.set(w.session_id, [...(windowsBy.get(w.session_id) ?? []), w]);
  const vitalsBy = new Map(db.maternal_readings.map((m) => [m.session_id, m]));

  for (const s of db.check_sessions) {
    const windows = (windowsBy.get(s.id) ?? []).sort((a, b) => a.taken_at - b.taken_at);
    if (windows.length) {
      const fired = evaluateFhr(windows);
      assert.equal(fired !== null, explained.has(s.id) && s.summary.fhr_bpm !== undefined && fired !== null, `FHR rule on ${s.id}`);
      if (fired) assert.ok(explained.has(s.id), `an unexplained FHR alert condition in ${s.id}`);
    }
    const vitals = vitalsBy.get(s.id);
    if (vitals) {
      const fired = evaluateMaternalVitals(vitals);
      if (fired) assert.ok(explained.has(s.id), `an unexplained vitals condition in ${s.id}`);
    }
  }
  // signal loss: only where an alert says so
  for (const sessions of sessionsBy.values()) {
    sessions.sort((a, b) => a.started_at - b.started_at);
    sessions.forEach((s, index) => {
      const fired = evaluateSignalLoss(sessions.slice(0, index + 1).map((x) => x.summary));
      if (fired) assert.ok(explained.has(s.id), `an unexplained signal loss at ${s.id}`);
    });
  }
});

test('normal values (5.6): FHR 125 to 155, confidence 60 to 95, SQI 55 to 95, heart rate 70 to 95, SpO2 96 to 99, skin 36.2 to 37.0', () => {
  // the checks that raised alerts, and the two before each repeated-signal-loss alert (it takes three in a row)
  const explained = new Set(db.alerts.map((a) => a.reading_ref).filter(Boolean));
  for (const alert of db.alerts.filter((a) => a.type === 'signal_loss')) {
    const own = db.check_sessions.filter((s) => s.patient_id === alert.patient_id).sort((a, b) => a.started_at - b.started_at);
    const at = own.findIndex((s) => s.id === alert.reading_ref);
    explained.add(own[at - 1].id);
    explained.add(own[at - 2].id);
  }
  let counted = 0;
  for (const w of db.fetal_readings) {
    if (explained.has(w.session_id) || w.flags !== 0 || w.maternal_match) continue; // flagged windows and the checks that raised alerts
    counted += 1;
    assert.ok(w.fhr_bpm >= 125 && w.fhr_bpm <= 155, `FHR ${w.fhr_bpm}`);
    assert.ok(w.confidence >= 60 && w.confidence <= 95, `confidence ${w.confidence}`);
    assert.ok(w.sqi >= 55 && w.sqi <= 95, `SQI ${w.sqi}`);
  }
  assert.ok(counted > 4000);
  for (const m of db.maternal_readings) {
    if (explained.has(m.session_id)) continue;
    assert.ok(m.hr_bpm >= 70 && m.hr_bpm <= 95, `heart rate ${m.hr_bpm}`);
    assert.ok(m.spo2_pct >= 96 && m.spo2_pct <= 99, `SpO2 ${m.spo2_pct}`);
    assert.ok(m.skin_temp_c >= 36.2 && m.skin_temp_c <= 37.0, `skin ${m.skin_temp_c}`);
  }
  for (const s of db.check_sessions) {
    if (explained.has(s.id)) continue;
    assert.ok(s.summary.valid_windows >= 15, `valid windows ${s.summary.valid_windows}`);
    assert.ok(s.battery_belt_pct >= 8 && s.battery_belt_pct <= 100 && s.battery_band_pct >= 8 && s.battery_band_pct <= 100);
  }
  // a few windows are flagged motion, poor contact or maternal match
  assert.ok(db.fetal_readings.some((w) => w.flags & 1) && db.fetal_readings.some((w) => w.flags & 2) && db.fetal_readings.some((w) => w.maternal_match));
  assert.ok(db.fetal_readings.filter((w) => w.flags !== 0 || w.maternal_match).length < db.fetal_readings.length * 0.15, 'only a few');
});

test('alerts: 14 in total, by type and status, as in Section 5.7', () => {
  assert.equal(db.alerts.length, 14);
  assert.deepEqual(countBy(db.alerts, 'type'), {
    fhr_out_of_range: 4, signal_loss: 2, maternal_vitals: 3, sos: 1, battery_critical: 2, missed_check: 2,
  });
  assert.deepEqual(countBy(db.alerts, 'status'), { resolved: 12, acknowledged: 1, new: 1 });
  assert.equal(db.alerts.filter((a) => a.patient_id === 'maricel-dimaculangan').length, 0, 'nothing is active for Maricel');
  const rosalinda = db.alerts.filter((a) => a.patient_id === 'rosalinda-ramos');
  assert.equal(rosalinda.length, 1);
  assert.equal(rosalinda[0].type, 'fhr_out_of_range');
  assert.equal(rosalinda[0].status, 'resolved');
});

test('the acknowledged alert is Maribel Lopez, acknowledged by Esperanza Macatangay; the new one is Jenny Rose, missed check', () => {
  const acknowledged = db.alerts.find((a) => a.status === 'acknowledged');
  assert.equal(acknowledged.patient_id, 'maribel-lopez');
  assert.equal(acknowledged.acknowledged_by, 'esperanza-macatangay');
  assert.equal(acknowledged.type, 'maternal_vitals');
  assert.equal(acknowledged.resolved_at, null);
  const fresh = db.alerts.find((a) => a.status === 'new');
  assert.equal(fresh.patient_id, 'jenny-rose-villanueva');
  assert.equal(fresh.type, 'missed_check');
  assert.equal(profile(fresh.patient_id).barangay_id, 'talahib');
  assert.equal(fresh.acknowledged_by, null);
});

test('one alert was escalated to Rowena Macaraig and resolved by her', () => {
  const escalated = db.alerts.filter((a) => a.escalated_at);
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0].patient_id, 'imelda-rivera');
  assert.equal(escalated[0].resolved_by, 'rowena-macaraig');
  assert.equal(escalated[0].status, 'resolved');
  assert.equal(escalated[0].escalated_at - escalated[0].created_at, 5 * 60 * 1000);
  assert.ok(escalated[0].outcome.length > 0);
});

test('each resolved alert was acknowledged and resolved in order by an account that may act on it', () => {
  for (const alert of db.alerts.filter((a) => a.status === 'resolved')) {
    assert.ok(alert.acknowledged_at > alert.created_at, alert.id);
    assert.ok(alert.resolved_at > alert.acknowledged_at, alert.id);
    assert.ok(alert.outcome && alert.outcome_code === null);
    const actor = profile(alert.resolved_by);
    const patient = profile(alert.patient_id);
    assert.ok(actor.role === 'super' || actor.barangay_id === patient.barangay_id, `${actor.id} for ${patient.id}`);
    assert.ok(alert.resolved_at < NOW);
  }
});

test('missed-check alerts agree with the rule: Jenny Rose is past 24 hours now; Michelle had a gap', () => {
  const sessions = (id) => db.check_sessions.filter((s) => s.patient_id === id).sort((a, b) => a.started_at - b.started_at);
  const jenny = sessions('jenny-rose-villanueva');
  const device = db.devices.find((d) => d.patient_id === 'jenny-rose-villanueva');
  const last = jenny[jenny.length - 1];
  const fired = evaluateMissedCheck({ lastCompletedAt: last.ended_at, pairedAt: device.paired_at, now: NOW });
  assert.equal(fired.type, 'missed_check');
  assert.ok(NOW - last.ended_at >= 24 * MS_HOUR && NOW - last.ended_at < 24.1 * MS_HOUR);

  const michelleAlert = db.alerts.find((a) => a.patient_id === 'michelle-tabora' && a.type === 'missed_check');
  const michelle = sessions('michelle-tabora');
  const before = michelle.filter((s) => s.ended_at <= michelleAlert.created_at);
  const after = michelle.filter((s) => s.started_at > michelleAlert.created_at);
  assert.ok(michelleAlert.created_at - before[before.length - 1].ended_at >= 24 * MS_HOUR);
  assert.ok(after[0].started_at > michelleAlert.created_at, 'she resumed after the alert');

  // everyone else has a recent check
  for (const patientId of [...new Set(db.devices.map((d) => d.patient_id))]) {
    if (patientId === 'jenny-rose-villanueva') continue;
    const list = sessions(patientId);
    assert.ok(NOW - list[list.length - 1].ended_at < 24 * MS_HOUR, patientId);
  }
});

test('signal-loss alerts sit on three consecutive checks with no valid window', () => {
  for (const alert of db.alerts.filter((a) => a.type === 'signal_loss')) {
    const sessions = db.check_sessions.filter((s) => s.patient_id === alert.patient_id).sort((a, b) => a.started_at - b.started_at);
    const index = sessions.findIndex((s) => s.id === alert.reading_ref);
    assert.ok(index >= 2);
    assert.equal(evaluateSignalLoss(sessions.slice(0, index + 1).map((s) => s.summary)).type, 'signal_loss');
  }
});

test('Maribel Lopez\'s open alert has a reading the rule flags: SpO2 93', () => {
  const alert = db.alerts.find((a) => a.patient_id === 'maribel-lopez');
  const vitals = db.maternal_readings.find((m) => m.session_id === alert.reading_ref);
  assert.equal(vitals.spo2_pct, 93);
  assert.equal(evaluateMaternalVitals(vitals).payload.metrics[0].metric, 'spo2');
  assert.ok(NOW - alert.created_at > 40 * 60000 && NOW - alert.created_at < 42 * 60000);
});

test('appointments: Maricel has a clinic check-up in 6 days; Analyn an approved teleconsultation tomorrow with Cynthia', () => {
  const maricel = db.appointments.filter((a) => a.patient_id === 'maricel-dimaculangan' && a.scheduled_at > NOW && a.status === 'approved');
  assert.equal(maricel.length, 1);
  assert.equal(maricel[0].type, 'clinic');
  assert.equal(manilaDate(maricel[0].scheduled_at), addDays(TODAY, 6));

  const tele = db.appointments.find((a) => a.patient_id === 'analyn-gonzales' && a.type === 'teleconsult');
  assert.equal(tele.status, 'approved');
  assert.equal(manilaDate(tele.scheduled_at), addDays(TODAY, 1));
  assert.equal(tele.provider_id, 'cynthia-dimayuga');
  assert.equal(tele.handled_by, 'rowena-macaraig');

  const hospital = db.appointments.filter((a) => a.type === 'hospital');
  assert.equal(hospital.length, 1);
  assert.equal(hospital[0].patient_id, 'divina-perez');
  assert.equal(hospital[0].location, 'Referral hospital, Batangas City');
});

test('approvals queue: three pending requests, one approved by Rowena, one declined by Cynthia with a reason', () => {
  const pending = db.appointments.filter((a) => a.status === 'pending').map((a) => a.patient_id).sort();
  assert.deepEqual(pending, ['lovely-ann-castillo', 'maribel-lopez', 'mary-joy-cabrera']);
  for (const a of db.appointments.filter((x) => x.status === 'pending')) {
    assert.equal(a.scheduled_at, null);
    assert.ok(a.preferred_start && a.preferred_end > a.preferred_start && a.reason);
  }
  const declined = db.appointments.filter((a) => a.status === 'declined');
  assert.equal(declined.length, 1);
  assert.equal(declined[0].handled_by, 'cynthia-dimayuga');
  assert.ok(declined[0].decline_reason.length > 10);
});

test('every patient has past check-ups and an upcoming one; a few were missed or rescheduled; Michelle is overdue', () => {
  for (const patient of db.patients) {
    const own = db.appointments.filter((a) => a.patient_id === patient.id && a.type === 'clinic');
    assert.ok(own.some((a) => a.status === 'attended'), patient.id);
    assert.ok(own.some((a) => a.status === 'approved' && a.scheduled_at > NOW), patient.id);
  }
  const statuses = countBy(db.appointments.filter((a) => a.scheduled_at && a.scheduled_at < NOW), 'status');
  assert.ok(statuses.missed >= 3 && statuses.rescheduled >= 1);
  const michelle = db.appointments.filter((a) => a.patient_id === 'michelle-tabora' && a.status === 'missed');
  assert.ok(michelle.some((a) => NOW - a.scheduled_at < 6 * MS_DAY));
});

test('events: Barangay 14, Pisa and Talahib events and a tetanus day for all barangays', () => {
  assert.equal(db.events.length, 4);
  const titles = Object.fromEntries(db.events.map((e) => [e.title, e]));
  assert.equal(titles['Prenatal check-up day'].barangay_id, 'brgy-14');
  assert.equal(titles['Pregnancy class'].barangay_id, 'pisa');
  assert.equal(titles['Nutrition and breastfeeding talk'].barangay_id, 'talahib');
  assert.equal(titles['Tetanus vaccination day'].scope, 'all');
  assert.equal(titles['Tetanus vaccination day'].created_by, 'rowena-macaraig');
  assert.equal(manilaDate(titles['Prenatal check-up day'].starts_at), addDays(TODAY, 3));
  assert.equal(manilaDate(titles['Pregnancy class'].starts_at), addDays(TODAY, 5));
  for (const e of db.events) assert.ok(e.ends_at > e.starts_at && e.starts_at > NOW);
});

test('conversations: two threads per patient; Maricel\'s midwife thread is locked, Analyn\'s is unlocked', () => {
  assert.equal(db.conversations.length, 40);
  const kinds = countBy(db.conversations, 'kind');
  assert.deepEqual(kinds, { barangay: 20, midwife: 20 });
  const locked = (patientId) => db.conversations.find((c) => c.patient_id === patientId && c.kind === 'midwife');
  assert.equal(locked('maricel-dimaculangan').unlocked_until, null);
  const analyn = locked('analyn-gonzales');
  assert.ok(analyn.unlocked_until > NOW);
  assert.equal(analyn.assigned_provider_id, 'cynthia-dimayuga');
  assert.equal(analyn.appointment_id, db.appointments.find((a) => a.type === 'teleconsult' && a.status === 'approved').id);
  const unlocked = db.conversations.filter((c) => c.kind === 'midwife' && c.unlocked_until);
  assert.equal(unlocked.length, 1);
});

test('each paired patient has a barangay thread with a few messages from named accounts of her barangay', () => {
  for (const patientId of new Set(db.devices.map((d) => d.patient_id))) {
    const thread = db.conversations.find((c) => c.patient_id === patientId && c.kind === 'barangay');
    const messages = db.messages.filter((m) => m.conversation_id === thread.id);
    assert.ok(messages.length >= 3, patientId);
    for (const m of messages) {
      assert.ok(m.sent_at < NOW);
      const sender = profile(m.sender_id);
      assert.ok(sender.id === patientId || (sender.role === 'barangay' && sender.barangay_id === thread.barangay_id), `${m.sender_id} in ${thread.id}`);
      assert.equal(m.syncState, 'synced');
    }
  }
  const rosalindaThread = db.messages.filter((m) => m.conversation_id === 'conv-barangay-rosalinda-ramos');
  assert.equal(rosalindaThread[rosalindaThread.length - 1].seen_at, null, 'her last message is unread by the barangay accounts');
});

test('visit notes: a few per patient with blood pressure and weight, written by a worker of her barangay', () => {
  for (const patient of db.patients) {
    const notes = db.visit_notes.filter((n) => n.patient_id === patient.id);
    assert.ok(notes.length >= 2, patient.id);
    for (const note of notes) {
      assert.equal(profile(note.author_id).barangay_id, profile(patient.id).barangay_id);
      assert.ok(note.bp_systolic >= 100 && note.bp_systolic <= 122);
      assert.ok(note.bp_diastolic >= 62 && note.bp_diastolic <= 78);
      assert.ok(note.weight_kg > 45 && note.weight_kg < 90);
      assert.ok(note.note.length > 10);
    }
  }
  assert.ok(db.visit_notes.some((n) => n.shared === false), 'some notes are for providers only');
});

test('notifications: a handful per account, some unread, so every bell shows a real count', () => {
  const count = (id) => db.notifications.filter((n) => n.profile_id === id).length;
  const unread = (id) => db.notifications.filter((n) => n.profile_id === id && n.read_at === null).length;
  for (const p of db.profiles) assert.ok(count(p.id) >= 1, p.id);
  for (const { id } of PRESENTER_ACCOUNTS) {
    assert.ok(count(id) >= 2, `${id} has ${count(id)}`);
    assert.ok(unread(id) >= 1, `${id} has no unread`);
  }
  const counts = db.profiles.map((p) => count(p.id));
  assert.ok(counts.reduce((a, b) => a + b, 0) / counts.length >= 4, 'about a handful on average');
  assert.ok(db.profiles.filter((p) => unread(p.id) > 0).length >= 35, 'nearly every account has something unread');
  assert.ok(db.notifications.some((n) => n.type === 'message') && db.notifications.some((n) => n.type === 'appointment_approved'));
  assert.equal(unread('rowena-macaraig'), 3 + 0, 'three booking requests');
  for (const n of db.notifications) assert.ok(n.created_at <= NOW && (n.read_at === null || n.read_at >= n.created_at));
});

test('SOS reaches all accounts of the barangay and all super accounts; escalation reaches the super accounts', () => {
  const sos = db.alerts.find((a) => a.type === 'sos');
  const received = db.notifications.filter((n) => n.payload.alert_id === sos.id && n.type === 'alert').map((n) => n.profile_id).sort();
  assert.deepEqual(received, ['cristina-alcantara', 'cynthia-dimayuga', 'rowena-macaraig']);
  const escalated = db.alerts.find((a) => a.escalated_at);
  const supers = db.notifications.filter((n) => n.payload.alert_id === escalated.id && n.payload.escalated).map((n) => n.profile_id).sort();
  assert.deepEqual(supers, ['cynthia-dimayuga', 'rowena-macaraig']);
});

test('logs: access and export entries for the super account views', () => {
  assert.ok(db.access_log.length >= 15);
  for (const entry of db.access_log) {
    assert.equal(entry.action, 'view_record');
    const actor = profile(entry.actor_id);
    assert.ok(actor.role === 'super' || actor.barangay_id === profile(entry.patient_id).barangay_id);
  }
  assert.equal(db.export_log.length, 3);
});

test('thresholds table mirrors the configuration; video usage is 6,420 of 10,000 minutes', () => {
  assert.equal(db.thresholds.length, flattenThresholds(THRESHOLDS).length);
  assert.equal(db.thresholds.find((t) => t.key === 'fhr.min').value, 110);
  assert.deepEqual(meta.video_usage, { used: 6420, limit: 10000 });
  assert.equal(meta.connection, 'online');
  assert.equal(meta.timing, 'quick');
  assert.equal(meta.focus_patient_id, 'maricel-dimaculangan');
  assert.equal(meta.run, null);
});

test('nothing in the seed happens in the future except what is meant to be scheduled', () => {
  for (const a of db.appointments) {
    assert.ok(a.requested_at <= NOW, `appointment ${a.id} requested in the future`);
    if (a.handled_at !== null) assert.ok(a.handled_at <= NOW && a.handled_at >= a.requested_at, `appointment ${a.id} handled out of order`);
    if (a.status === 'attended' || a.status === 'missed') assert.ok(a.scheduled_at < NOW, a.id);
  }
  for (const n of db.notifications) assert.ok(n.created_at <= NOW && (n.read_at === null || (n.read_at >= n.created_at && n.read_at <= NOW)), `notification ${n.id}`);
  for (const m of db.messages) assert.ok(m.sent_at <= NOW && (m.seen_at === null || (m.seen_at >= m.sent_at && m.seen_at <= NOW)), `message ${m.id}`);
  for (const a of db.alerts) {
    for (const key of ['created_at', 'acknowledged_at', 'escalated_at', 'resolved_at', 'cancelled_at']) if (a[key] !== null) assert.ok(a[key] <= NOW, `alert ${a.id} ${key}`);
  }
  for (const s of db.check_sessions) assert.ok(s.ended_at <= NOW, s.id);
  for (const d of db.devices) assert.ok(d.last_seen_at <= NOW && d.paired_at < d.last_seen_at, d.id);
  for (const e of [...db.access_log, ...db.export_log]) assert.ok(e.at <= NOW);
  for (const v of db.visit_notes) assert.ok(v.taken_at <= NOW);
});

test('the same moment always gives the same seed', () => {
  assert.deepEqual(createSeed({ now: NOW }), seed);
  assert.notDeepEqual(createSeed({ now: NOW + MS_DAY }).db.alerts, db.alerts);
});

test('the seed is small and quick: under 2 MiB at any hour, and well under a second', () => {
  for (const iso of ['2026-11-08T08:00:00Z', '2026-11-08T15:59:00Z', '2026-11-07T16:30:00Z', '2026-11-08T02:00:00Z']) {
    const started = performance.now();
    const built = createSeed({ now: Date.parse(iso) });
    const elapsed = performance.now() - started;
    const bytes = JSON.stringify({ db: built.db, hardware: built.hardware, meta: built.meta }).length;
    assert.ok(bytes < 2 * 1024 * 1024, `${iso}: ${bytes} bytes`);
    assert.ok(elapsed < 1000, `${iso}: ${elapsed} ms`);
  }
});

test('no seeded text contains words the product must never show', () => {
  const banned = /\b(demo|sample|simulated|simulation|fake|mock|dummy|placeholder|lorem ipsum|coming soon|tbd)\b|test data/i;
  const walk = (value, path) => {
    if (typeof value === 'string') assert.doesNotMatch(value, banned, path);
    else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, `${path}.${k}`));
  };
  const { fetal_readings, check_sessions, ...rest } = db;
  walk(rest, 'db');
});

test('the seed holds at any moment: 60 moments over two years, including a leap day, midnight and the new year', () => {
  const moments = [
    '2028-02-29T02:00:00Z', '2028-02-28T16:30:00Z', '2027-01-01T00:30:00Z', '2026-12-31T16:00:00Z', '2027-03-01T15:59:00Z', '2026-11-30T23:59:00Z',
  ].map((iso) => Date.parse(iso));
  for (let i = 0; i < 54; i += 1) moments.push(Date.parse('2026-11-08T00:00:00Z') + Math.floor((i * 731 * 24 * 3600 * 1000) / 54) + i * 7919000);
  for (const when of moments) {
    const label = new Date(when).toISOString();
    const built = createSeed({ now: when });
    const today = manilaDate(when);
    const d = built.db;
    assert.equal(d.profiles.length, 42, label);
    assert.equal(d.alerts.length, 14, label);
    assert.deepEqual(countBy(d.alerts, 'status'), { resolved: 12, acknowledged: 1, new: 1 }, label);
    assert.deepEqual(countBy(d.alerts, 'type'), { fhr_out_of_range: 4, signal_loss: 2, maternal_vitals: 3, sos: 1, battery_critical: 2, missed_check: 2 }, label);
    assert.equal(d.alerts.filter((a) => a.patient_id === 'maricel-dimaculangan').length, 0, label);
    assert.equal(d.devices.length, 28, label);
    assert.equal(d.appointments.filter((a) => a.status === 'pending').length, 3, label);
    for (const entry of PATIENTS) {
      const id = slug(entry.name).replace(/-$/, '');
      assert.equal(ageOn(d.patients.find((p) => p.id === id).birthdate, today), entry.age, `${label} ${entry.name} age`);
      const lmp = d.pregnancies.find((p) => p.patient_id === id).lmp;
      assert.equal(gestationalAge(lmp, today).weeks, entry.weeks, `${label} ${entry.name} weeks`);
    }
    assert.deepEqual(gestationalAge(d.pregnancies.find((p) => p.patient_id === 'maricel-dimaculangan').lmp, today), { totalDays: 219, weeks: 31, days: 2 }, label);
    for (const a of d.appointments) assert.ok(a.requested_at <= when, `${label} appointment`);
    for (const n of d.notifications) assert.ok(n.created_at <= when && (n.read_at === null || n.read_at <= when), `${label} notification`);
    for (const s of d.check_sessions) assert.ok(s.ended_at <= when, `${label} session`);
    for (const a of d.alerts) assert.ok(a.created_at <= when && (a.resolved_at === null || a.resolved_at <= when), `${label} alert ${a.type}`);
    const jenny = d.check_sessions.filter((s) => s.patient_id === 'jenny-rose-villanueva').map((s) => s.ended_at);
    assert.ok(when - Math.max(...jenny) >= 24 * MS_HOUR, `${label} Jenny's last check`);
    const maricelLast = Math.max(...d.check_sessions.filter((s) => s.patient_id === 'maricel-dimaculangan').map((s) => s.ended_at));
    assert.ok(when - maricelLast < 24 * MS_HOUR, `${label} Maricel has a recent check`);
    assert.ok(JSON.stringify({ db: d, hardware: built.hardware, meta: built.meta }).length < 2 * 1024 * 1024, `${label} size`);
  }
});

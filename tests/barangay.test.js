import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { createActions } from '../src/store/actions.js';
import * as sel from '../src/store/selectors.js';
import { MONITOR, THRESHOLDS } from '../src/config/thresholds.js';
import { MS_DAY, MS_HOUR, addDays, manilaDate } from '../src/lib/dates.js';
import { eddSourceFor, eventTimes, validateClinical, validateEvent, validateVisitNote, visitNoteValues } from '../src/lib/clinicalRules.js';
import { MEASURES, cardStatus, filterCards, isOverdue, latestVitals, measureRange, monitorCounts, readingSeries, seriesFacts, sortCards } from '../src/lib/monitor.js';
import { calcEdd } from '../src/lib/pregnancy.js';
import { describeNotification, notificationPath } from '../src/lib/notifications.js';
import { niceTicks } from '../src/lib/chartTicks.js';

const LOURDES = 'lourdes-magpantay';
const JOCELYN = 'jocelyn-landicho';
const NORA = 'nora-marasigan';
const ROWENA = 'rowena-macaraig';
const ROSALINDA = 'rosalinda-ramos';
const TODAY = manilaDate(NOW);
const THREAD = `conv-barangay-${MARICEL}`;
const FHR = { type: 'fhr_out_of_range', severity: 'critical', payload: { direction: 'low', sustained_seconds: 36, extreme_bpm: 101 } };
const instant = async () => {};

const as = (id) => {
  const rt = makeRuntime();
  rt.auth.signInAs(id);
  return rt;
};
const actionsOf = (rt) => createActions(rt, { delay: instant });
const viewer = (rt) => sel.viewerOf(rt.state());
const NOTE = { bp_systolic: '112', bp_diastolic: '72', weight_kg: '62.4', note: 'Feels well and the baby is active.' };

// ---------- Rules of the Monitor (BRG-M-01, BRG-M-02) ----------

test('a missed check-up counts as overdue only when it is the latest one, recent and nothing was attended since', () => {
  const at = (days, status, type = 'clinic') => ({ type, status, scheduled_at: NOW - days * MS_DAY });
  assert.equal(isOverdue([at(5, 'missed')], NOW), true);
  assert.equal(isOverdue([at(5, 'missed'), at(2, 'attended')], NOW), false, 'she came since');
  assert.equal(isOverdue([at(40, 'missed')], NOW), false, 'too long ago to be called overdue');
  assert.equal(isOverdue([at(5, 'missed', 'teleconsult')], NOW), false, 'a teleconsultation is not a check-up');
  assert.equal(isOverdue([{ type: 'clinic', status: 'approved', scheduled_at: NOW + MS_DAY }], NOW), false, 'an upcoming visit is not overdue');
  assert.equal(isOverdue([], NOW), false);
});

test('a card takes the worst of the open alerts and the latest check; a patient with neither has no status', () => {
  const alert = { type: 'fhr_out_of_range', severity: 'critical', status: 'new' };
  const warning = { type: 'missed_check', severity: 'warning', status: 'new' };
  const fine = { fhr_bpm: 140, confidence: 90, unverified: false, hr_bpm: 84, spo2_pct: 98, skin_temp_c: 36.7 };
  const high = { ...fine, fhr_bpm: 190 };
  assert.equal(cardStatus({ openAlerts: [], summary: null }), null);
  assert.equal(cardStatus({ openAlerts: [], summary: fine }), 'normal');
  assert.equal(cardStatus({ openAlerts: [warning], summary: fine }), 'attention');
  assert.equal(cardStatus({ openAlerts: [alert], summary: fine }), 'alert');
  assert.equal(cardStatus({ openAlerts: [], summary: high }), 'alert');
  assert.equal(cardStatus({ openAlerts: [], summary: { ...fine, unverified: true } }), 'attention');
});

test('the cards of a barangay: its own patients only, emergencies first, with the counts and the filters', () => {
  const rt = as(LOURDES);
  const cards = sel.monitorOf(rt.state(), viewer(rt), NOW);
  assert.ok(cards.some((c) => c.id === MARICEL) && cards.some((c) => c.id === ROSALINDA));
  assert.ok(cards.length >= 3 && cards.every((c) => rt.db().profiles.find((p) => p.id === c.id).barangay_id === 'brgy-14'));
  const counts = monitorCounts(cards, NOW);
  assert.equal(counts.patients, cards.length);
  assert.equal(counts.activeAlerts, cards.reduce((n, c) => n + c.openAlerts.length, 0));
  assert.equal(filterCards(cards, { query: 'maricel' }).length, 1);
  assert.equal(filterCards(cards, { query: '  MARICEL ' })[0].id, MARICEL, 'case and spaces do not matter');
  const tri = cards.find((c) => c.id === MARICEL).trimester;
  assert.ok(filterCards(cards, { trimester: tri }).some((c) => c.id === MARICEL));
  assert.equal(filterCards(cards, { trimester: tri === 1 ? 2 : 1 }).some((c) => c.id === MARICEL), false);
  assert.equal(filterCards(cards, { alertsOnly: true }).every((c) => c.openAlerts.length > 0), true);
  assert.deepEqual(filterCards(cards, { overdueOnly: true }), cards.filter((c) => c.overdue));
});

test('a new critical alert puts that patient first with an emergency; once acknowledged the card shows who took it', () => {
  const rt = makeRuntime();
  const alert = rt.core.raiseAlert(MARICEL, FHR).alert;
  for (const id of [LOURDES, JOCELYN]) {
    rt.auth.signInAs(id);
    const cards = sel.monitorOf(rt.state(), viewer(rt), NOW);
    assert.equal(cards[0].id, MARICEL, id);
    assert.equal(cards[0].emergency?.id, alert.id, id);
    assert.equal(cards[0].status, 'alert', id);
  }
  rt.auth.signInAs(LOURDES);
  assert.equal(rt.alerts.acknowledge(alert.id).ok, true);
  rt.auth.signInAs(JOCELYN);
  const card = sel.monitorOf(rt.state(), viewer(rt), NOW).find((c) => c.id === MARICEL);
  assert.equal(card.emergency, null, 'nothing is left to pin once someone has it');
  assert.equal(card.openAlerts[0].acknowledged_by, LOURDES);
  assert.equal(sel.profileOf(rt.state(), card.openAlerts[0].acknowledged_by).full_name, 'Lourdes Magpantay');
});

test('every account of a barangay sees the same patients; another barangay, a patient or a super account sees none of them', () => {
  const lourdes = sel.monitorOf(as(LOURDES).state(), { id: LOURDES, role: 'barangay', barangay_id: 'brgy-14', active: true }, NOW).map((c) => c.id);
  const jocelyn = sel.monitorOf(as(JOCELYN).state(), { id: JOCELYN, role: 'barangay', barangay_id: 'brgy-14', active: true }, NOW).map((c) => c.id);
  assert.deepEqual(lourdes, jocelyn);
  assert.ok(lourdes.includes(MARICEL));
  const rtNora = as(NORA);
  const nora = sel.monitorOf(rtNora.state(), viewer(rtNora), NOW).map((c) => c.id);
  assert.equal(nora.some((id) => lourdes.includes(id)), false);
  for (const id of [MARICEL, ROWENA]) {
    const rt = as(id);
    assert.deepEqual(sel.monitorOf(rt.state(), viewer(rt), NOW), [], id);
    assert.deepEqual(sel.inboxOf(rt.state(), viewer(rt)), [], id);
  }
});

// ---------- Readings history (BRG-M-04) ----------

test('a series holds the completed checks of the period, oldest first, and marks the readings outside the limits', () => {
  const check = (hoursAgo, summary, status = 'completed') => ({ status, ended_at: NOW - hoursAgo * MS_HOUR, summary });
  const sessions = [
    check(1, { fhr_bpm: 142, hr_bpm: 84, spo2_pct: 98, skin_temp_c: 36.7 }),
    check(30, { fhr_bpm: 98, hr_bpm: 130, spo2_pct: 90, skin_temp_c: 38.4 }),
    check(24 * 30, { fhr_bpm: 140 }),
    check(3, { fhr_bpm: 0 }),
    check(5, { fhr_bpm: 150 }, 'cancelled'),
  ];
  const fhr = readingSeries(sessions, 'fhr', { days: 7, now: NOW });
  assert.deepEqual(fhr.map((p) => [p.value, p.outOfRange]), [[98, true], [142, false]]);
  assert.ok(fhr[0].at < fhr[1].at);
  assert.deepEqual(readingSeries(sessions, 'hr', { days: 7, now: NOW }).map((p) => p.outOfRange), [true, false]);
  assert.deepEqual(readingSeries(sessions, 'spo2', { days: 7, now: NOW }).map((p) => p.outOfRange), [true, false]);
  assert.deepEqual(readingSeries(sessions, 'temp', { days: 7, now: NOW }).map((p) => p.outOfRange), [true, false]);
  assert.equal(readingSeries(sessions, 'fhr', { days: 60, now: NOW }).length, 3, 'a longer period reaches further back');
  assert.deepEqual(seriesFacts(fhr), { count: 2, min: 98, max: 142, latest: 142, outOfRange: 1 });
  assert.equal(seriesFacts([]), null);
  assert.deepEqual(Object.keys(MEASURES), ['fhr', 'hr', 'spo2', 'temp']);
  assert.deepEqual(measureRange('fhr'), { min: THRESHOLDS.fhr.min, max: THRESHOLDS.fhr.max });
  assert.deepEqual(measureRange('temp'), { min: null, max: THRESHOLDS.skinTemp.maxC });
});

test('the axis of a chart uses round numbers that cover the values', () => {
  const { ticks } = niceTicks(98, 152);
  assert.ok(ticks[0] <= 98 && ticks.at(-1) >= 152);
  assert.ok(ticks.every((t) => Number.isInteger(t)));
  assert.equal(niceTicks(36.2, 38.4).step < 1, true, 'temperature gets decimals');
});

test('referral vitals are the newest completed check that reached the server', () => {
  const s = (id, started, syncState, status = 'completed') => ({ id, started_at: started, ended_at: started + 1, syncState, status, summary: { fhr_bpm: id, hr_bpm: 80, spo2_pct: 98, skin_temp_c: 36.5 } });
  assert.equal(latestVitals([s(1, 10, 'synced'), s(2, 20, 'queued'), s(3, 30, 'synced', 'cancelled')]).fhr_bpm, 1);
  assert.equal(latestVitals([]), null);
});

test('the order of the cards: emergencies, then open alerts, then the nearest due date', () => {
  const card = (id, emergency, alerts, edd) => ({ id, name: id, emergency, openAlerts: alerts, edd });
  const sorted = sortCards([card('c', null, [], '2027-03-01'), card('b', null, [1], '2027-06-01'), card('a', { id: 'x' }, [1], '2027-09-01'), card('d', null, [], '2027-01-01')]);
  assert.deepEqual(sorted.map((c) => c.id), ['a', 'b', 'd', 'c']);
});

// ---------- Forms (BRG-M-05, BRG-K-01) ----------

test('the clinical fields: LMP and EDD are real, sensible dates; a different EDD is marked as the provider’s own', () => {
  const lmp = addDays(TODAY, -150);
  assert.deepEqual(validateClinical({ lmp, edd: calcEdd(lmp), risk_notes: '' }, { today: TODAY }), {});
  assert.equal(validateClinical({ lmp: '', edd: calcEdd(lmp) }, { today: TODAY }).lmp, 'required');
  assert.equal(validateClinical({ lmp: '2026-02-30', edd: calcEdd(lmp) }, { today: TODAY }).lmp, 'invalid');
  assert.equal(validateClinical({ lmp: addDays(TODAY, 1), edd: calcEdd(lmp) }, { today: TODAY }).lmp, 'future');
  assert.equal(validateClinical({ lmp: addDays(TODAY, -400), edd: addDays(TODAY, -120) }, { today: TODAY }).lmp, 'tooOld');
  assert.equal(validateClinical({ lmp, edd: addDays(calcEdd(lmp), 31) }, { today: TODAY }).edd, 'farFromLmp');
  assert.equal(validateClinical({ lmp, edd: addDays(calcEdd(lmp), 14) }, { today: TODAY }).edd, undefined, 'a due date two weeks off is a normal override');
  assert.equal(validateClinical({ lmp, edd: calcEdd(lmp), risk_notes: 'x'.repeat(MONITOR.noteMax + 1) }, { today: TODAY }).risk_notes, 'tooLong');
  assert.equal(eddSourceFor(lmp, calcEdd(lmp)), 'naegele');
  assert.equal(eddSourceFor(lmp, addDays(calcEdd(lmp), 5)), 'provider');
});

test('a visit note needs both blood pressure numbers, a weight and an observation', () => {
  assert.deepEqual(validateVisitNote(NOTE), {});
  assert.deepEqual(visitNoteValues({ ...NOTE, note: '  fine  ' }), { bp_systolic: 112, bp_diastolic: 72, weight_kg: 62.4, note: 'fine' });
  assert.deepEqual(Object.keys(validateVisitNote({})).sort(), ['bp_diastolic', 'bp_systolic', 'note', 'weight_kg']);
  assert.equal(validateVisitNote({ ...NOTE, bp_systolic: '11x' }).bp_systolic, 'invalid');
  assert.equal(validateVisitNote({ ...NOTE, bp_systolic: '12.5' }).bp_systolic, 'invalid', 'whole numbers only');
  assert.equal(validateVisitNote({ ...NOTE, bp_systolic: '400' }).bp_systolic, 'range');
  assert.equal(validateVisitNote({ ...NOTE, bp_diastolic: '120' }).bp_diastolic, 'diastolicHigher');
  assert.equal(validateVisitNote({ ...NOTE, weight_kg: '5' }).weight_kg, 'range');
  assert.equal(validateVisitNote({ ...NOTE, note: 'x'.repeat(MONITOR.noteMax + 1) }).note, 'tooLong');
});

test('an event needs a name, a date today or later and an end after the start', () => {
  const ok = { title: 'Pregnancy class', date: addDays(TODAY, 2), start: '09:00', end: '11:00' };
  assert.deepEqual(validateEvent(ok, { today: TODAY }), {});
  assert.equal(validateEvent({ ...ok, title: ' ' }, { today: TODAY }).title, 'required');
  assert.equal(validateEvent({ ...ok, title: 'x'.repeat(MONITOR.eventTitleMax + 1) }, { today: TODAY }).title, 'tooLong');
  assert.equal(validateEvent({ ...ok, date: addDays(TODAY, -1) }, { today: TODAY }).date, 'past');
  assert.equal(validateEvent({ ...ok, date: addDays(TODAY, 400) }, { today: TODAY }).date, 'tooFar');
  assert.equal(validateEvent({ ...ok, date: '' }, { today: TODAY }).date, 'required');
  assert.equal(validateEvent({ ...ok, end: '09:00' }, { today: TODAY }).end, 'endBeforeStart');
  assert.equal(validateEvent({ ...ok, start: '25:00' }, { today: TODAY }).start, 'invalid');
  const { starts_at: from, ends_at: to } = eventTimes(ok);
  assert.equal(to - from, 2 * MS_HOUR);
  assert.equal(manilaDate(from), ok.date);
});

// ---------- Opening a record is logged (ACC-07) ----------

test('every opening of a patient record or her vitals is written to the access log with the account name and the time', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const before = rt.db().access_log.length;
  assert.deepEqual(await actions.open_record(MARICEL, 'view_record'), { ok: true });
  assert.deepEqual(await actions.open_record(MARICEL, 'view_record'), { ok: true });
  assert.deepEqual(await actions.open_record(MARICEL, 'view_vitals'), { ok: true });
  const rows = rt.db().access_log.slice(before);
  assert.deepEqual(rows.map((r) => [r.actor_id, r.patient_id, r.action, r.at]), [[LOURDES, MARICEL, 'view_record', NOW], [LOURDES, MARICEL, 'view_record', NOW], [LOURDES, MARICEL, 'view_vitals', NOW]]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  rt.auth.signInAs(JOCELYN);
  await actions.open_record(MARICEL);
  assert.equal(rt.db().access_log.at(-1).actor_id, JOCELYN, 'the log names the account, not the barangay');
});

test('a record outside the barangay, an unknown action or a wrong role is refused and leaves no log entry', () => {
  const rt = as(NORA);
  const before = rt.db().access_log.length;
  assert.equal(rt.barangay.openRecord(MARICEL).error, 'not_found');
  rt.auth.signInAs(LOURDES);
  assert.equal(rt.barangay.openRecord(MARICEL, 'export').error, 'not_allowed');
  assert.equal(rt.barangay.openRecord('nobody').error, 'not_found');
  rt.auth.signInAs(MARICEL);
  assert.equal(rt.barangay.openRecord(MARICEL).error, 'not_allowed');
  rt.auth.signInAs(ROWENA);
  assert.equal(rt.barangay.openRecord(MARICEL).error, 'not_allowed', 'super accounts log through their own service (Prompt 9)');
  assert.equal(rt.db().access_log.length, before);
});

// ---------- Clinical fields, visit notes (BRG-M-05) ----------

test('editing LMP, EDD and risk notes changes the record, marks an override and keeps who changed it', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const lmp = addDays(TODAY, -120);
  const first = await actions.save_clinical(MARICEL, { lmp, edd: calcEdd(lmp), risk_notes: '  Watch her blood pressure  ' });
  assert.equal(first.ok, true);
  let row = rt.db().pregnancies.find((p) => p.patient_id === MARICEL && p.status === 'active');
  assert.deepEqual([row.lmp, row.edd, row.edd_source, row.risk_notes, row.updated_by, row.updated_at], [lmp, calcEdd(lmp), 'naegele', 'Watch her blood pressure', LOURDES, NOW]);
  const own = addDays(calcEdd(lmp), 6);
  await actions.save_clinical(MARICEL, { lmp, edd: own, risk_notes: '' });
  row = rt.db().pregnancies.find((p) => p.patient_id === MARICEL && p.status === 'active');
  assert.deepEqual([row.edd, row.edd_source, row.risk_notes], [own, 'provider', null]);
  rt.auth.signInAs(MARICEL);
  assert.equal(sel.patientRecord(rt.state(), viewer(rt), MARICEL).pregnancy.edd, own, 'she reads what her health worker set');
});

test('a clinical edit with a bad value, outside the barangay or offline changes nothing', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const snapshot = JSON.stringify(rt.db().pregnancies);
  const bad = await actions.save_clinical(MARICEL, { lmp: addDays(TODAY, 3), edd: addDays(TODAY, 280) });
  assert.deepEqual([bad.ok, bad.error, bad.errors.lmp], [false, 'form', 'future']);
  assert.equal((await actions.save_clinical('nobody', { lmp: TODAY, edd: TODAY })).error, 'not_found');
  rt.setConnection('offline');
  const lmp = addDays(TODAY, -100);
  assert.equal((await actions.save_clinical(MARICEL, { lmp, edd: calcEdd(lmp) })).error, 'offline');
  rt.setConnection('online');
  rt.auth.signInAs(NORA);
  assert.equal((await actions.save_clinical(MARICEL, { lmp, edd: calcEdd(lmp) })).error, 'not_found');
  assert.equal(JSON.stringify(rt.db().pregnancies), snapshot);
});

test('a visit note written by Lourdes is read by Jocelyn and, when shared, by the patient; a private one stays with providers', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const shared = await actions.add_visit_note(MARICEL, NOTE);
  const kept = await actions.add_visit_note(MARICEL, { ...NOTE, note: 'Family situation to follow up', shared: false });
  assert.deepEqual([shared.ok, kept.ok], [true, true]);
  assert.deepEqual([shared.note.author_id, shared.note.taken_at, shared.note.bp_systolic, shared.note.weight_kg, shared.note.shared], [LOURDES, NOW, 112, 62.4, true]);
  rt.auth.signInAs(JOCELYN);
  const forJocelyn = sel.visitNotesOf(rt.state(), viewer(rt), MARICEL);
  assert.ok([shared.note.id, kept.note.id].every((id) => forJocelyn.some((n) => n.id === id)));
  rt.auth.signInAs(MARICEL);
  const forMaricel = sel.visitNotesOf(rt.state(), viewer(rt), MARICEL).map((n) => n.id);
  assert.ok(forMaricel.includes(shared.note.id));
  assert.equal(forMaricel.includes(kept.note.id), false);
  rt.auth.signInAs(NORA);
  assert.deepEqual(sel.visitNotesOf(rt.state(), viewer(rt), MARICEL), []);
});

test('a visit note with a missing number, outside the barangay or offline is refused', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const before = rt.db().visit_notes.length;
  const bad = await actions.add_visit_note(MARICEL, { ...NOTE, bp_diastolic: '' });
  assert.deepEqual([bad.error, bad.errors.bp_diastolic], ['form', 'required']);
  rt.setConnection('offline');
  assert.equal((await actions.add_visit_note(MARICEL, NOTE)).error, 'offline');
  rt.setConnection('online');
  rt.auth.signInAs(NORA);
  assert.equal((await actions.add_visit_note(MARICEL, NOTE)).error, 'not_found');
  assert.equal(rt.db().visit_notes.length, before);
});

// ---------- Referral and proposed time (BRG-M-06) ----------

test('a referral reaches every super account with the reason and her latest vitals, and is listed on her record', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const result = await actions.refer_patient(MARICEL, { reason: '  Headache and swollen feet for two days  ' });
  const supers = rt.db().profiles.filter((p) => p.role === 'super' && p.active);
  assert.deepEqual([result.ok, result.told], [true, supers.length]);
  for (const p of supers) {
    const n = rt.inbox(p.id).find((x) => x.type === 'referral' && x.created_at === NOW);
    assert.ok(n, p.id);
    assert.deepEqual([n.payload.patient_id, n.payload.reason, n.payload.from_profile_id], [MARICEL, 'Headache and swollen feet for two days', LOURDES]);
    assert.ok(n.payload.vitals === null || typeof n.payload.vitals.fhr_bpm === 'number');
  }
  const listed = sel.referralsOf(rt.state(), viewer(rt), MARICEL);
  assert.equal(listed.length, 1, 'one referral, however many accounts were told');
  assert.deepEqual([listed[0].by, listed[0].reason], ['Lourdes Magpantay', 'Headache and swollen feet for two days']);
  rt.auth.signInAs(NORA);
  assert.deepEqual(sel.referralsOf(rt.state(), viewer(rt), MARICEL), []);
});

test('a referral needs a reason, a patient of the barangay and a connection', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const before = rt.db().notifications.length;
  assert.equal((await actions.refer_patient(MARICEL, { reason: '  ' })).error, 'reason_required');
  assert.equal((await actions.refer_patient(MARICEL, { reason: 'x'.repeat(2000) })).error, 'reason_too_long');
  rt.setConnection('offline');
  assert.equal((await actions.refer_patient(MARICEL, { reason: 'Needs a visit' })).error, 'offline');
  rt.setConnection('online');
  rt.auth.signInAs(NORA);
  assert.equal((await actions.refer_patient(MARICEL, { reason: 'Needs a visit' })).error, 'not_found');
  assert.equal(rt.db().notifications.length, before);
});

test('a proposed time waits in the approvals queue as a request of its own kind, one at a time for each patient', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const values = { type: 'clinic', preferred_date: addDays(TODAY, 3), window: 'morning', reason: 'Follow-up after the swollen feet' };
  const result = await actions.propose_appointment(MARICEL, values);
  assert.equal(result.ok, true);
  const row = rt.db().requests.find((r) => r.id === result.request.id);
  assert.deepEqual([row.kind, row.patient_id, row.proposed_by, row.status, row.appointment_type, row.preferred_date], ['appointment_proposal', MARICEL, LOURDES, 'pending', 'clinic', values.preferred_date]);
  assert.ok(row.preferred_start < row.preferred_end);
  for (const p of rt.db().profiles.filter((x) => x.role === 'super' && x.active)) assert.ok(rt.inbox(p.id).some((n) => n.type === 'appointment_proposal' && n.payload.request_id === row.id), p.id);
  assert.equal((await actions.propose_appointment(MARICEL, values)).error, 'pending_exists');
  rt.auth.signInAs(JOCELYN);
  assert.equal(sel.requestsOf(rt.state(), viewer(rt), { patientId: MARICEL, kind: 'appointment_proposal' }).length, 1, 'her colleague sees it waiting');
  rt.auth.signInAs(NORA);
  assert.deepEqual(sel.requestsOf(rt.state(), viewer(rt), { patientId: MARICEL, kind: 'appointment_proposal' }), []);
});

test('a proposal with a past date, no reason, outside the barangay or offline is refused', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const ok = { type: 'clinic', preferred_date: addDays(TODAY, 3), window: 'any', reason: 'Follow-up' };
  assert.equal((await actions.propose_appointment(MARICEL, { ...ok, preferred_date: addDays(TODAY, -1) })).errors.preferred_date, 'past');
  assert.equal((await actions.propose_appointment(MARICEL, { ...ok, reason: ' ' })).errors.reason, 'required');
  rt.setConnection('offline');
  assert.equal((await actions.propose_appointment(MARICEL, ok)).error, 'offline');
  rt.setConnection('online');
  rt.auth.signInAs(NORA);
  assert.equal((await actions.propose_appointment(MARICEL, ok)).error, 'not_found');
  assert.equal(rt.db().requests.some((r) => r.kind === 'appointment_proposal'), false);
});

test('a proposal and a referral are described for the bell and open the right screen', () => {
  const n = { type: 'appointment_proposal', payload: { request_id: 'req_1', patient_id: MARICEL, proposed_by: LOURDES }, read_at: null, created_at: NOW };
  assert.equal(describeNotification(n, { role: 'super', patientName: 'Maricel Dimaculangan' }).titleKey, 'notification.appointment_proposal');
  assert.equal(notificationPath('super', n), '/super/consult');
});

// ---------- Events (BRG-K-01) ----------

test('an event for the barangay tells its patients and its other accounts, and only that barangay sees it', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const values = { title: 'Healthy pregnancy talk', date: addDays(TODAY, 2), start: '09:00', end: '11:00' };
  const result = await actions.create_event(values);
  assert.equal(result.ok, true);
  const event = rt.db().events.find((e) => e.id === result.event.id);
  assert.deepEqual([event.scope, event.barangay_id, event.created_by, event.title], ['barangay', 'brgy-14', LOURDES, 'Healthy pregnancy talk']);
  assert.ok(event.ends_at > event.starts_at);
  const brgy14 = rt.db().profiles.filter((p) => p.barangay_id === 'brgy-14' && p.active && (p.role === 'patient' || p.role === 'barangay'));
  const told = rt.db().notifications.filter((n) => n.type === 'event_created' && n.payload.event_id === event.id).map((n) => n.profile_id).sort();
  assert.deepEqual(told, brgy14.filter((p) => p.id !== LOURDES).map((p) => p.id).sort());
  assert.ok(told.includes(JOCELYN) && told.includes(MARICEL) && !told.includes(LOURDES) && !told.includes(ROWENA));
  assert.equal(result.told, told.length);
  for (const [id, sees] of [[LOURDES, true], [JOCELYN, true], [MARICEL, true], [NORA, false]]) {
    rt.auth.signInAs(id);
    assert.equal(sel.eventsOf(rt.state(), viewer(rt)).some((e) => e.id === event.id), sees, id);
  }
  rt.auth.signInAs(JOCELYN);
  assert.ok(sel.providerCalendarOf(rt.state(), viewer(rt)).some((i) => i.key.includes(event.id)));
});

test('an event with a bad form, a wrong role or offline is refused and tells nobody', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const ok = { title: 'Pregnancy class', date: addDays(TODAY, 2), start: '09:00', end: '11:00' };
  const before = [rt.db().events.length, rt.db().notifications.length];
  assert.equal((await actions.create_event({ ...ok, end: '08:00' })).errors.end, 'endBeforeStart');
  rt.setConnection('offline');
  assert.equal((await actions.create_event(ok)).error, 'offline');
  rt.setConnection('online');
  rt.auth.signInAs(MARICEL);
  assert.equal((await actions.create_event(ok)).error, 'not_allowed');
  rt.auth.signInAs(ROWENA);
  assert.equal((await actions.create_event(ok)).error, 'not_allowed', 'super accounts make events through their own screens (Prompt 9)');
  assert.deepEqual([rt.db().events.length, rt.db().notifications.length], before);
});

test('the calendar of a barangay account holds the appointments of its patients and the events for it, none from other barangays', () => {
  const lourdes = as(LOURDES);
  const items = sel.providerCalendarOf(lourdes.state(), viewer(lourdes));
  assert.ok(items.length > 0);
  const own = new Set(lourdes.db().profiles.filter((p) => p.barangay_id === 'brgy-14').map((p) => p.id));
  for (const item of items) {
    if (item.source === 'appointment') assert.ok(own.has(item.row.patient_id), item.key);
    else assert.ok(item.row.scope === 'all' || item.row.barangay_id === 'brgy-14', item.key);
  }
  const nora = as(NORA);
  assert.equal(sel.providerCalendarOf(nora.state(), viewer(nora)).some((i) => i.source === 'appointment' && own.has(i.row.patient_id)), false);
  const patient = as(MARICEL);
  assert.deepEqual(sel.providerCalendarOf(patient.state(), viewer(patient)), []);
});

// ---------- Shared inbox (BRG-C-01, ACC-03) ----------

test('the inbox lists each patient of the barangay with the last message and what is new; nobody else reads it', async () => {
  const rt = as(MARICEL);
  const actions = actionsOf(rt);
  await actions.send_message({ conversation_id: THREAD, body: 'Good morning, may I ask about my vitamins?', client_id: 'p1' });
  rt.auth.signInAs(LOURDES);
  const rows = sel.inboxOf(rt.state(), viewer(rt));
  assert.equal(rows[0].patient.id, MARICEL, 'the newest conversation first');
  assert.equal(rows[0].unread >= 1, true);
  assert.equal(rows[0].last.body, 'Good morning, may I ask about my vitamins?');
  assert.ok(rows.every((r) => rt.db().profiles.find((p) => p.id === r.patient.id).barangay_id === 'brgy-14'));
  assert.equal(sel.inboxThreadOf(rt.state(), viewer(rt), MARICEL).messages.at(-1).body, 'Good morning, may I ask about my vitamins?');
  rt.auth.signInAs(NORA);
  assert.equal(sel.inboxThreadOf(rt.state(), viewer(rt), MARICEL), null);
  assert.equal(sel.inboxOf(rt.state(), viewer(rt)).some((r) => r.patient.id === MARICEL), false);
});

test('Jocelyn’s reply shows her name to Lourdes, tells the patient, and a thread opened by either clears the unread for both', async () => {
  const rt = as(MARICEL);
  const actions = actionsOf(rt);
  await actions.send_message({ conversation_id: THREAD, body: 'Hello po, I have a question', client_id: 'p2' });
  const unreadFor = (id) => rt.inbox(id).filter((n) => n.type === 'message' && n.payload.conversation_id === THREAD && !n.read_at).length;
  assert.ok(unreadFor(LOURDES) >= 1 && unreadFor(JOCELYN) >= 1, 'both accounts were told');

  rt.auth.signInAs(JOCELYN);
  const reply = await actions.send_message({ conversation_id: THREAD, body: 'Hi Maricel, this is Jocelyn. Come by the health station.', client_id: 'j1' });
  assert.equal(reply.ok, true);
  assert.equal(reply.message.sender_id, JOCELYN);

  rt.auth.signInAs(LOURDES);
  const names = sel.senderNamesOf(rt.state(), viewer(rt), THREAD);
  assert.deepEqual(names.get(JOCELYN), { name: 'Jocelyn Landicho', role: 'barangay' }, 'Lourdes sees who wrote it');
  assert.equal(names.get(MARICEL).name, 'Maricel Dimaculangan');
  const thread = sel.inboxThreadOf(rt.state(), viewer(rt), MARICEL);
  assert.equal(thread.messages.at(-1).sender_id, JOCELYN);

  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'message' && n.payload.conversation_id === THREAD && n.created_at === NOW).length, 1, 'the patient is told once');
  assert.equal(rt.inbox(LOURDES).some((n) => n.type === 'message' && n.created_at === NOW && n.payload.from === JOCELYN), false);

  // Lourdes opens the thread: the patient's messages are seen for the whole barangay and both bells clear.
  assert.equal(actions.mark_seen(THREAD).ok, true);
  assert.equal(sel.inboxThreadOf(rt.state(), viewer(rt), MARICEL).unread, 0);
  assert.equal(unreadFor(LOURDES), 0);
  assert.equal(unreadFor(JOCELYN), 0, 'the read state is shared');
  rt.auth.signInAs(JOCELYN);
  assert.equal(sel.inboxOf(rt.state(), viewer(rt)).find((r) => r.patient.id === MARICEL).unread, 0);
});

test('the patient has seen the barangay’s reply once she opens the thread, and the barangay sees that', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  const sent = await actions.send_message({ conversation_id: THREAD, body: 'Please bring your booklet.', client_id: 'l1' });
  assert.equal(sent.message.seen_at ?? null, null);
  rt.auth.signInAs(MARICEL);
  assert.equal(actions.mark_seen(THREAD).ok, true);
  assert.equal(rt.db().messages.find((m) => m.id === sent.message.id).seen_at, NOW);
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'message' && !n.read_at && n.payload.conversation_id === THREAD).length, 0);
});

test('a message from a barangay account written offline waits, is hidden from the patient and goes out once after reconnect', async () => {
  const rt = as(LOURDES);
  const actions = actionsOf(rt);
  rt.setConnection('offline');
  const sent = await actions.send_message({ conversation_id: THREAD, body: 'Offline reply', client_id: 'cid_l' });
  assert.deepEqual([sent.ok, sent.queued], [true, true]);
  assert.equal(sel.messagesOf(rt.state(), viewer(rt), THREAD).some((m) => m.id === sent.message.id), true, 'the sender sees it');
  rt.auth.signInAs(MARICEL);
  assert.equal(sel.messagesOf(rt.state(), viewer(rt), THREAD).some((m) => m.id === sent.message.id), false, 'the patient does not');
  rt.setConnection('online');
  assert.equal(rt.db().messages.filter((m) => m.client_id === 'cid_l').length, 1);
  assert.equal(rt.inbox(MARICEL).filter((n) => n.type === 'message' && n.created_at === NOW && n.payload.conversation_id === THREAD).length, 1);
  assert.equal(sel.messagesOf(rt.state(), viewer(rt), THREAD).some((m) => m.id === sent.message.id), true);
});

test('another barangay’s account can neither read, write nor mark a thread seen', async () => {
  const rt = as(NORA);
  const actions = actionsOf(rt);
  const before = rt.db().messages.length;
  assert.equal((await actions.send_message({ conversation_id: THREAD, body: 'Hello' })).error, 'not_found');
  assert.equal(actions.mark_seen(THREAD).error, 'not_found');
  assert.equal(rt.db().messages.length, before);
  assert.deepEqual(sel.messagesOf(rt.state(), viewer(rt), THREAD), []);
  rt.auth.signInAs(LOURDES);
  assert.equal((await actions.send_message({ conversation_id: `conv-midwife-${MARICEL}`, body: 'Hello' })).error, 'not_found', 'the midwife thread is not the barangay’s');
});

test('the Incoming message scenario from a patient marks what the whole barangay wrote as seen', () => {
  const rt = as(JOCELYN);
  rt.engine.start('incoming-message', { patientId: MARICEL, actorId: JOCELYN, actorRole: 'barangay' });
  const added = rt.db().messages.filter((m) => m.conversation_id === THREAD);
  assert.equal(added.at(-1).sender_id, MARICEL);
  assert.ok(rt.inbox(JOCELYN).some((n) => n.type === 'message' && n.payload.conversation_id === THREAD));
});

// ---------- Office contacts ----------

test('a barangay account reads the active super accounts as the Municipal Health Office contacts', () => {
  const rt = as(LOURDES);
  const office = sel.officeContactsOf(rt.state(), viewer(rt));
  assert.ok(office.length >= 1);
  assert.ok(office.every((p) => rt.db().profiles.find((x) => x.id === p.id).role === 'super' && p.contact_no));
  const patient = as(MARICEL);
  assert.deepEqual(sel.officeContactsOf(patient.state(), viewer(patient)), []);
});

// ---------- The texts of the new screens ----------

const SRC = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, SRC), 'utf8');
const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const keysOf = (lang) => new Set(flat(JSON.parse(read(`i18n/locales/${lang}/monitor.json`))));
const SCREENS = ['features/monitor/Monitor.jsx', 'features/monitor/PatientDetail.jsx', 'features/monitor/ReadingsHistory.jsx', 'features/monitor/Sheets.jsx', 'features/monitor/VisitNoteForm.jsx', 'features/monitor/VitalsGrid.jsx', 'features/monitor/LatestVitals.jsx', 'features/chat/BarangayChat.jsx', 'features/chat/BarangayChatList.jsx', 'features/calendar/BarangayCalendar.jsx', 'features/calendar/EventForm.jsx', 'features/profile/BarangayProfile.jsx'];
const has = (keys, key) => keys.has(key) || keys.has(`${key}_one`) || keys.has(`${key}_other`);

test('every static text key of the barangay screens exists in English and Filipino', () => {
  const en = keysOf('en');
  const fil = keysOf('fil');
  const used = new Set();
  for (const file of SCREENS) for (const [, key] of read(file).matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(key);
  const own = [...used].filter((key) => !key.includes(':'));
  assert.ok(own.length > 80, 'the screens use many keys');
  const missing = [];
  for (const key of own) {
    // texts of the other namespaces (alerts, consult, schedule) are read with their own t and are checked by their own tests
    if (!has(en, key) && !/^(status\.new|threads\.photo|calendar\.(prev|next|today|legend|nothing)|kind\.|upcoming\.|details\.|synced|syncedNever|error\.(empty|tooLong|photo|unreadable))/.test(key)) missing.push(key);
    else if (has(en, key) && !has(fil, key)) missing.push(`fil:${key}`);
  }
  assert.deepEqual(missing, []);
});

test('the texts built from a code exist for every code the forms and actions can answer', () => {
  const en = keysOf('en');
  const codes = {
    'clinical.error': ['required', 'invalid', 'future', 'tooOld', 'farFromLmp', 'tooLong'],
    'note.error': ['required', 'invalid', 'range', 'diastolicHigher', 'tooLong'],
    'event.error': ['required', 'tooLong', 'invalid', 'past', 'tooFar', 'endBeforeStart'],
    'propose.error': ['required', 'invalid', 'past', 'tooFar', 'tooLong'],
    error: ['generic', 'not_allowed', 'not_found', 'offline', 'no_pregnancy', 'form', 'pending_exists', 'reason_required', 'reason_too_long'],
    status: ['normal', 'attention', 'alert', 'none'],
    trimester: ['1', '2', '3'],
    'history.tab': ['fhr', 'hr', 'spo2', 'temp'],
    'history.days': ['short', 'long'],
    'visits.kind': ['clinic', 'hospital', 'teleconsult'],
    vitals: ['fhr', 'hr', 'spo2', 'temp'],
    counts: ['patients', 'alerts', 'overdue', 'due'],
    history: ['upcoming', 'attended', 'missed', 'rescheduled', 'pending', 'declined'],
    note: ['shareOn', 'shareOff', 'sharedBadge', 'privateBadge'],
    pregnancy: ['eddCalculated', 'eddProvider', 'dueIn', 'duePassed', 'toGo', 'passed'],
    propose: ['type_clinic', 'type_teleconsult', 'window_any', 'window_morning', 'window_afternoon'],
    profile: ['pushOn', 'pushOff'],
  };
  const missing = Object.entries(codes).flatMap(([prefix, list]) => list.filter((code) => !has(en, `${prefix}.${code}`)).map((code) => `${prefix}.${code}`));
  assert.deepEqual(missing, []);
  // every error code the services can answer has a text, and so does every code of the validators
  const source = read('store/barangay.js');
  for (const [, code] of source.matchAll(/error: '([a-z_]+)'/g)) assert.ok(has(en, `error.${code}`) || code === 'form', `error.${code}`);
});

test('the barangay screens are reachable: each route is registered and the tabs lead to them', () => {
  const routes = read('routes.jsx');
  for (const path of ['monitor/:patientId', 'monitor/:patientId/note', 'chat/:patientId', 'calendar/new']) assert.ok(routes.includes(`path="${path}"`), path);
  for (const component of ['<Monitor />', '<BarangayChatList />', '<BarangayCalendar />', '<BarangayProfile />']) assert.ok(routes.includes(component), component);
});

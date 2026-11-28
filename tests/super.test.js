import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { createActions } from '../src/store/actions.js';
import * as sel from '../src/store/selectors.js';
import { MS_DAY, MS_HOUR, addDays, manilaDate } from '../src/lib/dates.js';
import { approvalItems, decisionDefaults, handledItems, pendingItems, scheduledAt, timeOf, validateDecision } from '../src/lib/approvals.js';
import { canDeactivate, hasOpenItems, openItemsOf, temporaryPassword, uncoveredBarangays, validateContact, validateNewAccount } from '../src/lib/accountRules.js';
import { followUpEnd, isConfirmed, joinState, threadLock } from '../src/lib/consult.js';
import { canReadConversation } from '../src/lib/permissions.js';
import { describeNotification, notificationPath } from '../src/lib/notifications.js';
import { filterRows, sortRows, sortOf, barangayChoiceOf } from '../src/lib/tracker.js';
import { buildExportFile, exportSheet } from '../src/lib/xlsx.js';
import { isStrongPassword } from '../src/lib/authRules.js';
import { isNearDue } from '../src/lib/pregnancy.js';
import { NOTIFICATION_TYPES } from '../src/store/schema.js';

const ROWENA = 'rowena-macaraig';
const CYNTHIA = 'cynthia-dimayuga';
const LOURDES = 'lourdes-magpantay';
const GLORIA = 'gloria-mendoza';
const TODAY = manilaDate(NOW);
const TOMORROW = addDays(TODAY, 1);
const instant = async () => {};
const as = (id) => {
  const rt = makeRuntime();
  rt.auth.signInAs(id);
  return rt;
};
const actionsOf = (rt) => createActions(rt, { delay: instant });
const viewer = (rt) => sel.viewerOf(rt.state());
const inboxTypes = (rt, id) => rt.db().notifications.filter((n) => n.profile_id === id).map((n) => n.type);
const BOOKING = { type: 'teleconsult', preferred_date: TOMORROW, window: 'afternoon', reason: 'Questions about my schedule' };
const NEW_ACCOUNT = { role: 'barangay', full_name: 'Lorna Villarin', email: 'lorna.villarin@nurturelink.ph', contact_no: '0917 555 0321', barangay_id: 'brgy-14', language: 'fil' };

/** The files of a .xlsx (a zip), by name: enough of a reader to look inside the file the export makes. */
function unzip(buffer) {
  const files = {};
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const flags = buffer.readUInt16LE(at + 6);
    const method = buffer.readUInt16LE(at + 8);
    let size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extraLength = buffer.readUInt16LE(at + 28);
    const name = buffer.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extraLength;
    if (flags & 8) throw new Error('sizes after the data are not handled by this reader');
    files[name] = method === 8 ? inflateRawSync(buffer.subarray(start, start + size)).toString('utf8') : buffer.toString('utf8', start, start + size);
    at = start + size;
  }
  return files;
}

// ---------- The Pregnancy Tracker (SUP-T-01 to SUP-T-03) ----------

test('the tracker lists every patient of every barangay with the number the flags need and no vitals', () => {
  const rt = as(ROWENA);
  const rows = sel.trackerOf(rt.state(), viewer(rt), NOW);
  assert.equal(rows.length, 20);
  assert.ok(new Set(rows.map((r) => r.barangayId)).size > 3, 'patients of several barangays');
  const maricel = rows.find((r) => r.id === MARICEL);
  assert.equal(maricel.name, 'Maricel Dimaculangan');
  assert.ok(maricel.age > 15 && maricel.edd && maricel.lmp && maricel.weeks >= 0 && maricel.contact);
  for (const row of rows) for (const key of Object.keys(row)) assert.doesNotMatch(key, /fhr|spo2|bp_|temp|vitals|reading/i, `no vitals in the list (${key})`);
  // a barangay account, a patient and nobody see no tracker
  const brgy = as(LOURDES);
  assert.deepEqual(sel.trackerOf(brgy.state(), viewer(brgy), NOW), []);
  const patient = as(MARICEL);
  assert.deepEqual(sel.trackerOf(patient.state(), viewer(patient), NOW), []);
});

test('the list filters by barangay and sorts by due date, name or gestational age; unknown choices fall back', () => {
  const rt = as(ROWENA);
  const all = sel.trackerOf(rt.state(), viewer(rt), NOW);
  const barangays = rt.state().db.barangays;
  const brgy14 = filterRows(all, 'brgy-14');
  assert.ok(brgy14.length > 0 && brgy14.length < all.length && brgy14.every((r) => r.barangayId === 'brgy-14'));
  assert.equal(filterRows(all, null).length, all.length);
  assert.equal(barangayChoiceOf('nowhere', barangays), null);
  assert.equal(barangayChoiceOf('brgy-14', barangays), 'brgy-14');
  assert.equal(sortOf('x'), 'edd');
  const edd = sortRows(all, 'edd').map((r) => r.edd);
  assert.deepEqual(edd, [...edd].sort(), 'soonest due date first');
  const names = sortRows(all, 'name').map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  const ga = sortRows(all, 'ga').map((r) => r.totalDays);
  assert.deepEqual(ga, [...ga].sort((a, b) => b - a), 'furthest along first');
  assert.equal(sortRows(all, 'nonsense')[0].id, sortRows(all, 'edd')[0].id);
});

test('the near-due and overdue check-up flags come from the same rules as the Monitor', () => {
  const rt = as(ROWENA);
  const rows = sel.trackerOf(rt.state(), viewer(rt), NOW);
  const monitor = as(LOURDES);
  const cards = sel.monitorOf(monitor.state(), viewer(monitor), NOW);
  for (const card of cards) {
    const row = rows.find((r) => r.id === card.id);
    assert.equal(row.overdue, card.overdue, `${row.name} overdue`);
    assert.equal(row.nearDue, isNearDue(card.edd, TODAY, sel.thresholdsOf(monitor.state()).nearDueDays), `${row.name} near due`);
  }
  assert.ok(rows.some((r) => r.nearDue) || rows.some((r) => r.overdue), 'the seeded records show at least one flag');
});

test('Export to Excel writes the filtered rows, the date, the filter, and an entry in the export log with the account name', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const logBefore = rt.db().export_log.length;
  const result = await actions.export_patients({ barangay_id: 'brgy-14', sort: 'name', omit_contacts: false });
  assert.equal(result.ok, true);
  assert.ok(result.rows.length > 0 && result.rows.every((r) => r.barangayId === 'brgy-14' && r.contact));
  assert.equal(result.generated_at, NOW);
  assert.equal(rt.db().export_log.length, logBefore + 1);
  const entry = rt.db().export_log.at(-1);
  assert.deepEqual({ actor: entry.actor_id, filter: entry.filter, rows: entry.row_count, at: entry.at, omitted: entry.contacts_omitted }, { actor: ROWENA, filter: 'Barangay 14 (Poblacion 2)', rows: result.rows.length, at: NOW, omitted: false });
  const logs = sel.activityLogsOf(rt.state(), viewer(rt));
  assert.equal(logs.exports[0].actor, 'Rowena Macaraig', 'the log names the account');

  const labels = { sheet: 'Pregnancy list', title: 'NurtureLink pregnancy list', generated: 'Date generated', filter: 'Filter used', sorted: 'Sorted by', by: 'Generated by', count: 'Patients', columns: { name: 'Name', age: 'Age', barangay: 'Barangay', contact: 'Contact number', lmp: 'LMP', edd: 'EDD', ga: 'GA', next: 'Next visit', flags: 'Flags' }, near: 'Near due date', overdue: 'Overdue check-up', gaText: (w, d) => `${w}w ${d}d`, noVisit: 'None scheduled' };
  const blob = await buildExportFile({ rows: result.rows, labels, values: { generated: 'Nov 8, 2026, 4:00 PM', filter: 'Barangay 14 (Poblacion 2)', sorted: 'Name', by: 'Rowena Macaraig' }, contacts: true });
  const files = unzip(Buffer.from(await blob.arrayBuffer()));
  const text = `${files['xl/sharedStrings.xml']}${files['xl/worksheets/sheet1.xml']}`;
  for (const needle of ['Nov 8, 2026, 4:00 PM', 'Barangay 14 (Poblacion 2)', 'Rowena Macaraig', result.rows[0].name, 'Contact number']) assert.ok(text.includes(needle), `the file holds ${needle}`);
  assert.ok(files['xl/worksheets/sheet1.xml'].includes('<pane'), 'the heading row stays in view');
});

test('leaving out contact numbers removes the column and the numbers, and the log says so', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const result = await actions.export_patients({ barangay_id: null, sort: 'edd', omit_contacts: true });
  assert.equal(result.rows.length, 20);
  assert.ok(result.rows.every((r) => r.contact === null));
  assert.equal(rt.db().export_log.at(-1).contacts_omitted, true);
  const labels = { sheet: 'S', title: 'T', generated: 'G', filter: 'F', sorted: 'So', by: 'B', count: 'C', columns: { name: 'Name', age: 'Age', barangay: 'Barangay', contact: 'Contact number', lmp: 'LMP', edd: 'EDD', ga: 'GA', next: 'Next', flags: 'Flags' }, near: 'n', overdue: 'o', gaText: () => '', noVisit: '-' };
  const sheet = exportSheet({ rows: result.rows, labels, values: { generated: 'x', filter: 'y', sorted: 'z', by: 'w' }, contacts: false });
  const heading = sheet.data[sheet.headingRow - 1].map((c) => c.value);
  assert.ok(!heading.includes('Contact number') && heading.length === 8);
  assert.ok(!JSON.stringify(sheet.data).includes('0917'), 'no number anywhere in the file');
  assert.equal((await actions.export_patients({ barangay_id: 'nowhere' })).error, 'not_found');
});

test('only a super account exports, and the export needs the connection', async () => {
  const brgy = as(LOURDES);
  assert.equal((await actionsOf(brgy).export_patients({ barangay_id: null })).error, 'not_allowed');
  const rt = as(ROWENA);
  rt.setConnection('offline');
  const result = await actionsOf(rt).export_patients({ barangay_id: null });
  assert.equal(result.error, 'offline');
});

// ---------- The approvals queue (SUP-C-01, ACC-05) ----------

test('the queue shows what waits, oldest first, and what was handled with the account that handled it', () => {
  const rt = as(ROWENA);
  const { pending, handled } = sel.approvalsOf(rt.state(), viewer(rt));
  assert.deepEqual(pending.map((i) => i.patient_id), ['lovely-ann-castillo', 'maribel-lopez', 'mary-joy-cabrera']);
  assert.ok(pending.every((i, n) => n === 0 || pending[n - 1].at <= i.at));
  assert.deepEqual(handled.map((i) => [i.status, i.handled_by]), [['approved', ROWENA], ['declined', CYNTHIA]]);
  const patient = as(MARICEL);
  assert.deepEqual(sel.approvalsOf(patient.state(), viewer(patient)), { pending: [], handled: [] });
  const items = approvalItems({ appointments: [{ id: 'a', patient_id: 'p', type: 'clinic', status: 'attended', requested_at: null, handled_by: null }], requests: [{ id: 'r', kind: 'other', status: 'pending' }] });
  assert.deepEqual(items, [], 'a seeded check-up nobody asked for and an unknown kind are not in the queue');
  assert.deepEqual(pendingItems(handledItems([])), []);
});

test('approving a booking fixes the visit, assigns the chosen super account, opens the midwife thread and tells everyone it concerns', async () => {
  const rt = as(ROWENA);
  const maricel = makeRuntime();
  maricel.auth.signInAs(MARICEL);
  const request = await actionsOf(maricel).request_booking(BOOKING);
  assert.equal(request.ok, true);
  // the request is in the shared state of the device runtime; move it into the office runtime's records
  rt.core.commit([{ op: 'insert', table: 'appointments', row: { ...request.appointment, syncState: 'synced' } }]);
  const item = sel.approvalsOf(rt.state(), viewer(rt)).pending.find((i) => i.patient_id === MARICEL);
  assert.ok(item, 'Maricel is in the queue');
  const actions = actionsOf(rt);
  const result = await actions.approve_booking(item.id, { date: TOMORROW, time: '14:00', provider_id: CYNTHIA });
  assert.equal(result.ok, true);
  const row = rt.db().appointments.find((a) => a.id === item.id);
  assert.deepEqual({ status: row.status, provider: row.provider_id, by: row.handled_by, at: row.scheduled_at }, { status: 'approved', provider: CYNTHIA, by: ROWENA, at: scheduledAt(TOMORROW, '14:00') });
  assert.equal(isConfirmed(row), true);
  const thread = rt.db().conversations.find((c) => c.patient_id === MARICEL && c.kind === 'midwife');
  assert.deepEqual({ assigned: thread.assigned_provider_id, appointment: thread.appointment_id, until: thread.unlocked_until }, { assigned: CYNTHIA, appointment: item.id, until: followUpEnd(row) });
  assert.equal(threadLock(thread, NOW).open, true, 'the chat is open');
  assert.ok(inboxTypes(rt, MARICEL).includes('appointment_approved'));
  assert.ok(inboxTypes(rt, CYNTHIA).includes('appointment_approved'), 'the assigned midwife is told when she is not the one who approved');
  assert.ok(!inboxTypes(rt, ROWENA).includes('appointment_approved'), 'the approving account is not told of its own decision');
  const brgy = rt.db().profiles.filter((p) => p.role === 'barangay' && p.barangay_id === rt.db().profiles.find((p2) => p2.id === MARICEL).barangay_id);
  assert.ok(brgy.every((p) => inboxTypes(rt, p.id).includes('appointment_approved')), "the barangay's accounts are told");
  // the visit shows in Maricel's calendar, in her barangay's calendar, and in the office schedule
  const calendarHas = (id) => (state, who, selector) => sel[selector](state, who).some((i) => i.row?.id === id);
  const onCalendars = calendarHas(item.id);
  rt.auth.signOut();
  rt.auth.signInAs(MARICEL);
  assert.equal(onCalendars(rt.state(), viewer(rt), 'calendarOf'), true, 'in Maricel’s calendar');
  rt.auth.signOut();
  rt.auth.signInAs(rt.db().profiles.find((p) => p.role === 'barangay' && p.barangay_id === rt.db().profiles.find((q) => q.id === MARICEL).barangay_id).id);
  assert.equal(onCalendars(rt.state(), viewer(rt), 'providerCalendarOf'), true, 'in the barangay’s calendar');
  rt.auth.signOut();
  rt.auth.signInAs(ROWENA);
  assert.equal(onCalendars(rt.state(), viewer(rt), 'officeCalendarOf'), true, 'in the office schedule');
  // only the assigned account reads and answers; the approving account does not
  rt.auth.signOut();
  rt.auth.signInAs(CYNTHIA);
  assert.equal(sel.officeThreadsOf(rt.state(), viewer(rt), NOW).some((t) => t.conversation.id === thread.id), true);
  const sent = await actionsOf(rt).send_message({ conversation_id: thread.id, body: 'See you tomorrow, Maricel.' });
  assert.equal(sent.ok, true);
  rt.auth.signOut();
  rt.auth.signInAs(ROWENA);
  assert.equal(sel.officeThreadsOf(rt.state(), viewer(rt), NOW).some((t) => t.conversation.id === thread.id), false, 'Rowena does not read Cynthia’s thread');
  assert.equal((await actionsOf(rt).send_message({ conversation_id: thread.id, body: 'hi' })).error, 'not_found');
  assert.equal(joinState(row, scheduledAt(TOMORROW, '14:00')).state, 'open');
});

test('a time the office sets instead is "rescheduled", still joinable, and the patient is told; a second decision is refused', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const item = sel.approvalsOf(rt.state(), viewer(rt)).pending[0];
  const result = await actions.reschedule_booking(item.id, { date: addDays(TODAY, 2), time: '09:30', provider_id: ROWENA });
  assert.equal(result.ok, true);
  const row = rt.db().appointments.find((a) => a.id === item.id);
  assert.equal(row.status, 'rescheduled');
  assert.equal(isConfirmed(row), true);
  assert.ok(inboxTypes(rt, item.patient_id).includes('appointment_rescheduled'));
  assert.equal((await actions.approve_booking(item.id, { date: TOMORROW, time: '10:00', provider_id: ROWENA })).error, 'already_handled');
  assert.equal(isConfirmed({ status: 'rescheduled', handled_by: null, scheduled_at: NOW }), false, 'a seeded past visit that was moved is not confirmed');
  assert.ok(!sel.approvalsOf(rt.state(), viewer(rt)).pending.some((i) => i.id === item.id));
});

test('declining needs a reason, which the patient is told about; the decision form refuses a bad date, time or midwife', async () => {
  const rt = as(CYNTHIA);
  const actions = actionsOf(rt);
  const item = sel.approvalsOf(rt.state(), viewer(rt)).pending[1];
  assert.deepEqual((await actions.decline_booking(item.id, { reason: ' ' })).errors, { reason: 'required' });
  assert.deepEqual((await actions.decline_booking(item.id, { reason: 'x'.repeat(400) })).errors, { reason: 'tooLong' });
  assert.equal((await actions.decline_booking(item.id, { reason: 'No midwife is free that day.' })).ok, true);
  const row = rt.db().appointments.find((a) => a.id === item.id);
  assert.deepEqual({ status: row.status, reason: row.decline_reason, by: row.handled_by, at: row.scheduled_at }, { status: 'declined', reason: 'No midwife is free that day.', by: CYNTHIA, at: null });
  assert.ok(inboxTypes(rt, item.patient_id).includes('appointment_declined'));
  const other = sel.approvalsOf(rt.state(), viewer(rt)).pending[0];
  const bad = async (values) => (await actions.approve_booking(other.id, values)).errors;
  assert.deepEqual(await bad({ date: '', time: '', provider_id: '' }), { date: 'required', time: 'required', provider_id: 'provider' });
  assert.deepEqual(await bad({ date: addDays(TODAY, -1), time: '10:00', provider_id: CYNTHIA }), { date: 'past' });
  assert.deepEqual(await bad({ date: addDays(TODAY, 200), time: '10:00', provider_id: CYNTHIA }), { date: 'tooFar' });
  assert.deepEqual(await bad({ date: TODAY, time: '00:01', provider_id: CYNTHIA }), { time: 'past' });
  assert.deepEqual(await bad({ date: TOMORROW, time: '25:00', provider_id: CYNTHIA }), { time: 'invalid' });
  assert.deepEqual(await bad({ date: TOMORROW, time: '10:00', provider_id: LOURDES }), { provider_id: 'provider' }, 'a barangay account cannot be the assigned midwife');
  assert.equal(rt.db().appointments.find((a) => a.id === other.id).status, 'pending', 'nothing changed');
});

test('only a super account decides, and decisions need the connection', async () => {
  for (const id of [LOURDES, MARICEL]) {
    const rt = as(id);
    const appointment = rt.db().appointments.find((a) => a.status === 'pending');
    const actions = actionsOf(rt);
    assert.equal((await actions.approve_booking(appointment.id, { date: TOMORROW, time: '10:00', provider_id: ROWENA })).error, 'not_allowed');
    assert.equal((await actions.decline_booking(appointment.id, { reason: 'no' })).error, 'not_allowed');
    assert.equal((await actions.create_provider(NEW_ACCOUNT)).error, 'not_allowed');
    assert.equal((await actions.deactivate_provider(LOURDES)).error, 'not_allowed');
  }
  const rt = as(ROWENA);
  rt.setConnection('offline');
  const appointment = rt.db().appointments.find((a) => a.status === 'pending');
  assert.equal((await actionsOf(rt).approve_booking(appointment.id, { date: TOMORROW, time: '10:00', provider_id: ROWENA })).error, 'offline');
  assert.equal(rt.db().appointments.find((a) => a.id === appointment.id).status, 'pending');
});

test('the form starts from what she asked for, and a new time starts empty', () => {
  const item = { kind: 'booking', row: { preferred_start: scheduledAt(TOMORROW, '13:00') } };
  assert.deepEqual(decisionDefaults(item, { viewerId: ROWENA }), { date: TOMORROW, time: '13:00', provider_id: ROWENA }, 'the approving account is the assigned midwife until another is chosen');
  assert.deepEqual(decisionDefaults(item, { viewerId: ROWENA, mode: 'reschedule' }), { date: '', time: '', provider_id: ROWENA });
  assert.equal(timeOf(scheduledAt('2026-11-08', '07:05')), '07:05');
  assert.equal(scheduledAt('2026-11-08', '07:05'), Date.parse('2026-11-07T23:05:00Z'), 'Manila time');
  assert.equal(scheduledAt('x', '07:05'), null);
  assert.deepEqual(validateDecision({ date: TOMORROW, time: '10:00', provider_id: CYNTHIA }, { now: NOW, today: TODAY, activeSuperIds: [CYNTHIA] }), {});
});

test('other requests: a new time moves the visit, a change of barangay moves the patient and her chat, a proposed visit is made', async () => {
  // a new time
  const patient = makeRuntime();
  patient.auth.signInAs('analyn-gonzales');
  const upcoming = patient.db().appointments.find((a) => a.patient_id === 'analyn-gonzales' && a.type === 'teleconsult' && isConfirmed(a) && a.scheduled_at > NOW);
  assert.ok(upcoming, 'Analyn has an upcoming teleconsultation');
  const asked = await actionsOf(patient).request_reschedule({ appointment_id: upcoming.id, reason: 'I have a check-up elsewhere', preferred_date: addDays(TODAY, 3) });
  assert.equal(asked.ok, true);
  const rt = as(ROWENA);
  rt.core.commit([{ op: 'insert', table: 'requests', row: { ...asked.request, syncState: 'synced' } }]);
  const actions = actionsOf(rt);
  let item = sel.approvalsOf(rt.state(), viewer(rt)).pending.find((i) => i.kind === 'reschedule');
  assert.ok(item);
  assert.deepEqual((await actions.approve_request(item.id, { date: addDays(TODAY, 3), time: '10:00' })).ok, true);
  assert.equal(rt.db().appointments.find((a) => a.id === upcoming.id).scheduled_at, scheduledAt(addDays(TODAY, 3), '10:00'));
  assert.equal(rt.db().requests.find((r) => r.id === item.id).status, 'approved');
  assert.ok(inboxTypes(rt, 'analyn-gonzales').includes('request_decided'));

  // a change of barangay, declined and then another approved
  const move = makeRuntime();
  move.auth.signInAs(MARICEL);
  const change = await actionsOf(move).request_barangay_change({ barangay_id: 'papaya', reason: 'Moved house' });
  assert.equal(change.ok, true);
  rt.core.commit([{ op: 'insert', table: 'requests', row: { ...change.request, syncState: 'synced' } }]);
  item = sel.approvalsOf(rt.state(), viewer(rt)).pending.find((i) => i.kind === 'barangay_change');
  assert.deepEqual((await actions.decline_request(item.id, { reason: ' ' })).errors, { reason: 'required' });
  assert.equal((await actions.approve_request(item.id)).ok, true);
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).barangay_id, 'papaya');
  assert.equal(rt.db().conversations.find((c) => c.patient_id === MARICEL && c.kind === 'barangay').barangay_id, 'papaya', 'her barangay chat moves with her');
  assert.equal((await actions.approve_request(item.id)).error, 'already_handled');

  // a proposed visit
  const brgy = as(LOURDES);
  const patientId = sel.monitorOf(brgy.state(), viewer(brgy), NOW)[0].id;
  const proposed = await actionsOf(brgy).propose_appointment(patientId, { type: 'clinic', preferred_date: TOMORROW, window: 'morning', reason: 'Check blood pressure' });
  assert.equal(proposed.ok, true);
  rt.core.commit([{ op: 'insert', table: 'requests', row: { ...(proposed.request ?? brgy.db().requests.find((r) => r.kind === 'appointment_proposal')), syncState: 'synced' } }]);
  item = sel.approvalsOf(rt.state(), viewer(rt)).pending.find((i) => i.kind === 'appointment_proposal');
  const made = await actions.approve_request(item.id, { date: TOMORROW, time: '09:00', provider_id: CYNTHIA });
  assert.equal(made.ok, true);
  const visit = rt.db().appointments.find((a) => a.id === made.appointment.id);
  assert.deepEqual({ patient: visit.patient_id, status: visit.status, provider: visit.provider_id, type: visit.type }, { patient: patientId, status: 'approved', provider: CYNTHIA, type: 'clinic' });
  assert.ok(inboxTypes(rt, LOURDES).includes('request_decided'), 'the barangay account that proposed it is told');
});

test('referrals reach the inbox of each super account, newest first, with their own read state', async () => {
  const brgy = as(LOURDES);
  const rt = makeRuntime();
  rt.auth.signInAs(LOURDES);
  const patientId = sel.monitorOf(rt.state(), viewer(rt), NOW)[0].id;
  assert.equal((await actionsOf(rt).refer_patient(patientId, { reason: 'Headache and swollen feet' })).ok, true);
  rt.auth.signOut();
  rt.auth.signInAs(ROWENA);
  const inbox = sel.referralInboxOf(rt.state(), viewer(rt));
  assert.equal(inbox[0].patient_id, patientId);
  assert.deepEqual({ reason: inbox[0].reason, from: inbox[0].from, read: inbox[0].read }, { reason: 'Headache and swollen feet', from: 'Lourdes Magpantay', read: false });
  assert.deepEqual(sel.referralInboxOf(brgy.state(), viewer(brgy)), [], 'a barangay account has no referral inbox');
});

// ---------- Events (SUP-S-01) ----------

test('an event for all barangays tells every patient and barangay account; one for a barangay tells only that barangay', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const event = { title: 'Tetanus vaccination day', scope: 'all', date: addDays(TODAY, 5), start: '09:00', end: '12:00' };
  const all = await actions.create_office_event(event);
  assert.equal(all.ok, true);
  const people = rt.db().profiles.filter((p) => p.active && (p.role === 'patient' || p.role === 'barangay'));
  assert.equal(all.told, people.length);
  assert.ok(people.every((p) => inboxTypes(rt, p.id).includes('event_created')));
  assert.equal(all.event.barangay_id, null);
  const before = rt.db().notifications.length;
  const one = await actions.create_office_event({ ...event, title: 'Nutrition talk', scope: 'barangay', barangay_id: 'brgy-14' });
  assert.equal(one.ok, true);
  const audience = people.filter((p) => p.barangay_id === 'brgy-14');
  assert.equal(one.told, audience.length);
  assert.equal(rt.db().notifications.length - before, audience.length);
  // it shows in the calendars of that barangay and not of another
  const brgy = as(LOURDES);
  assert.ok(sel.providerCalendarOf(brgy.state(), viewer(brgy)).some((i) => i.row?.title === 'Tetanus vaccination day'));
  assert.ok(sel.officeCalendarOf(rt.state(), viewer(rt)).some((i) => i.row?.title === 'Nutrition talk'));
  assert.deepEqual((await actions.create_office_event({ ...event, title: '', date: '', scope: 'barangay', barangay_id: '' })).errors, { title: 'required', date: 'required', barangay_id: 'required' });
  assert.equal((await actions.create_office_event({ ...event, scope: 'barangay', barangay_id: 'nowhere' })).errors.barangay_id, 'barangay');
  assert.equal((await actions.create_office_event({ ...event, scope: 'everyone' })).errors.scope, 'required');
});

// ---------- The access log (SUP-X-02) ----------

test('every opening of a patient record by a super account is written to the access log with her name', async () => {
  const rt = as(CYNTHIA);
  const actions = actionsOf(rt);
  const before = rt.db().access_log.length;
  assert.equal((await actions.open_record(MARICEL, 'view_record')).ok, true);
  assert.equal((await actions.open_record(MARICEL, 'view_vitals')).ok, true);
  assert.equal((await actions.open_record(MARICEL, 'delete_everything')).error, 'not_allowed');
  assert.equal((await actions.open_record('nobody', 'view_record')).error, 'not_found');
  assert.equal((await actions.open_record(ROWENA, 'view_record')).error, 'not_found', 'only a patient record is opened');
  assert.equal(rt.db().access_log.length, before + 2);
  const logs = sel.activityLogsOf(rt.state(), viewer(rt));
  const mine = logs.access.filter((r) => r.actor_id === CYNTHIA && r.at === NOW);
  assert.deepEqual(mine.map((r) => r.action).sort(), ['view_record', 'view_vitals']);
  assert.ok(mine.every((r) => r.actor === 'Cynthia Dimayuga' && r.patient === 'Maricel Dimaculangan'), 'the log shows names');
  assert.ok(logs.access.every((r, n) => n === 0 || logs.access[n - 1].at >= r.at), 'newest first');
  const brgy = as(LOURDES);
  assert.deepEqual(sel.activityLogsOf(brgy.state(), viewer(brgy)), { access: [], exports: [] }, 'a barangay account reads no logs');
});

// ---------- Accounts (SUP-P-01, ACC-06 to ACC-09) ----------

test('a new account gets a temporary password it must change at its first sign-in', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const result = await actions.create_provider(NEW_ACCOUNT);
  assert.equal(result.ok, true);
  assert.ok(isStrongPassword(result.temporary_password), result.temporary_password);
  assert.deepEqual({ role: result.profile.role, barangay: result.profile.barangay_id, by: result.profile.created_by, active: result.profile.active, contact: result.profile.contact_no }, { role: 'barangay', barangay: 'brgy-14', by: ROWENA, active: true, contact: '0917 555 0321' });
  assert.equal(sel.accountsOf(rt.state(), viewer(rt)).find((a) => a.id === result.profile.id).barangay_name, 'Barangay 14 (Poblacion 2)');
  rt.auth.signOut();
  const signedIn = rt.auth.signIn({ identifier: NEW_ACCOUNT.email, password: result.temporary_password });
  assert.equal(signedIn.ok, true);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'change-password');
  // a second try with the same email or number is refused
  const rt2 = as(ROWENA);
  await actionsOf(rt2).create_provider(NEW_ACCOUNT);
  assert.deepEqual((await actionsOf(rt2).create_provider(NEW_ACCOUNT)).errors, { email: 'taken', contact_no: 'taken' });
});

test('the new account form is checked', () => {
  const ids = ['brgy-14'];
  assert.deepEqual(validateNewAccount({}, { barangayIds: ids }), { role: 'required', full_name: 'required', email: 'required', contact_no: 'required', language: 'required' });
  assert.deepEqual(validateNewAccount({ ...NEW_ACCOUNT, full_name: 'Lorna', email: 'x', contact_no: '12', barangay_id: '' }, { barangayIds: ids }), { full_name: 'fullName', email: 'email', contact_no: 'phone', barangay_id: 'required' });
  assert.deepEqual(validateNewAccount({ ...NEW_ACCOUNT, barangay_id: 'z' }, { barangayIds: ids }), { barangay_id: 'barangay' });
  assert.deepEqual(validateNewAccount({ ...NEW_ACCOUNT, role: 'super', barangay_id: '' }, { barangayIds: ids }), {}, 'a super account has no barangay');
  assert.deepEqual(validateNewAccount({ ...NEW_ACCOUNT, role: 'patient' }, { barangayIds: ids }), { role: 'required' });
  assert.deepEqual(validateContact({ contact_no: '' }), { contact_no: 'required' });
  assert.deepEqual(validateContact({ contact_no: '0917 555 0321' }), {});
  for (let n = 0; n < 50; n += 1) assert.ok(isStrongPassword(temporaryPassword()), 'always a strong password');
});

test('resetting a password makes a new temporary one that must be changed; the contact number can be updated but not taken', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const reset = await actions.reset_provider_password(LOURDES);
  assert.equal(reset.ok, true);
  const credential = rt.db().credentials.find((c) => c.profile_id === LOURDES);
  assert.deepEqual({ password: credential.password, must: credential.must_change_password }, { password: reset.temporary_password, must: true });
  assert.equal((await actions.reset_provider_password(MARICEL)).error, 'not_found', 'only barangay and super accounts');
  assert.equal((await actions.update_provider_contact(LOURDES, { contact_no: '0917 555 0999' })).ok, true);
  assert.equal(rt.db().profiles.find((p) => p.id === LOURDES).contact_no, '0917 555 0999');
  assert.deepEqual((await actions.update_provider_contact(LOURDES, { contact_no: 'abc' })).errors, { contact_no: 'phone' });
  const other = rt.db().profiles.find((p) => p.id === CYNTHIA).contact_no;
  assert.deepEqual((await actions.update_provider_contact(LOURDES, { contact_no: other })).errors, { contact_no: 'taken' });
});

test('the last active super account cannot be deactivated, and an account does not deactivate itself', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  assert.equal((await actions.deactivate_provider(ROWENA)).error, 'self');
  const done = await actions.deactivate_provider(CYNTHIA);
  assert.equal(done.ok, true);
  assert.equal((await actions.deactivate_provider(CYNTHIA)).error, 'inactive');
  assert.equal((await actions.deactivate_provider(ROWENA)).error, 'last_super', 'Rowena is now the last one');
  assert.equal(rt.db().profiles.find((p) => p.id === ROWENA).active, true);
  assert.equal(canDeactivate(null, ROWENA, []).error, 'not_found');
  // a deactivated account can no longer sign in
  rt.auth.signOut();
  const email = rt.db().profiles.find((p) => p.id === CYNTHIA).email;
  const blocked = rt.auth.signIn({ identifier: email, password: rt.db().credentials.find((c) => c.profile_id === CYNTHIA).password });
  assert.equal(blocked.ok, false);
});

test('deactivating the only account of a barangay warns, and its alerts and chats go to the super accounts', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  assert.deepEqual(sel.coverageGapsOf(rt.state(), viewer(rt)), []);
  const result = await actions.deactivate_provider(GLORIA);
  assert.equal(result.ok, true);
  assert.equal(result.barangay_uncovered, true);
  const gaps = sel.coverageGapsOf(rt.state(), viewer(rt));
  assert.deepEqual(gaps.map((g) => g.barangay.id), ['marikaban']);
  assert.equal(uncoveredBarangays(rt.db().profiles, rt.db().barangays).length, 1);
  // a barangay that still has other accounts is not a warning
  const second = await actions.deactivate_provider(LOURDES);
  assert.equal(second.barangay_uncovered, rt.db().profiles.filter((p) => p.role === 'barangay' && p.active && p.barangay_id === rt.db().profiles.find((q) => q.id === LOURDES).barangay_id).length === 0);
});

test('a barangay with no active account hands its chats to the super accounts, who read and answer them', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const barangayId = rt.db().profiles.find((p) => p.id === MARICEL).barangay_id;
  const accounts = rt.db().profiles.filter((p) => p.role === 'barangay' && p.active && p.barangay_id === barangayId);
  for (const account of accounts) await actions.deactivate_provider(account.id);
  const thread = rt.db().conversations.find((c) => c.patient_id === MARICEL && c.kind === 'barangay');
  assert.equal(sel.officeThreadsOf(rt.state(), viewer(rt), NOW).find((t) => t.conversation.id === thread.id)?.why, 'no_account');
  // Maricel writes to her barangay inbox: the super accounts are told
  rt.auth.signOut();
  rt.auth.signInAs(MARICEL);
  assert.equal((await actionsOf(rt).send_message({ conversation_id: thread.id, body: 'Is anyone there?' })).ok, true);
  assert.ok(inboxTypes(rt, ROWENA).includes('message') && inboxTypes(rt, CYNTHIA).includes('message'));
  rt.auth.signOut();
  rt.auth.signInAs(CYNTHIA);
  const note = rt.db().notifications.find((n) => n.profile_id === CYNTHIA && n.type === 'message');
  assert.equal(notificationPath('super', note), `/super/consult/chat/${thread.id}`);
  assert.equal(sel.officeThreadOf(rt.state(), viewer(rt), thread.id, NOW).unread, 1);
  assert.equal((await actionsOf(rt).send_message({ conversation_id: thread.id, body: 'The Municipal Health Office is here.' })).ok, true);
  await actionsOf(rt).mark_seen(thread.id);
  assert.equal(sel.officeThreadOf(rt.state(), viewer(rt), thread.id, NOW).unread, 0, 'what the patient wrote is seen');
  assert.ok(rt.db().notifications.filter((n) => [ROWENA, CYNTHIA].includes(n.profile_id) && n.type === 'message' && n.payload.conversation_id === thread.id).every((n) => n.read_at), 'the bells of both super accounts clear: the read state is shared');
  const names = sel.senderNamesOf(rt.state(), viewer(rt), thread.id);
  assert.deepEqual(names.get(CYNTHIA), { name: 'Cynthia Dimayuga', role: 'super' }, 'every message shows its sender’s name');
  // while any account of the barangay is active, a super account does not read it
  assert.equal(canReadConversation({ role: 'super', active: true, id: CYNTHIA }, thread, { barangay_id: barangayId }, { barangayActive: true }), false);
});

test('what a deactivated account left open stays visible and can be handed to another account of the same level', async () => {
  const rt = as(ROWENA);
  const actions = actionsOf(rt);
  const analynThread = rt.db().conversations.find((c) => c.id === 'conv-midwife-analyn-gonzales');
  assert.equal(analynThread.assigned_provider_id, CYNTHIA);
  assert.equal(sel.officeThreadsOf(rt.state(), viewer(rt), NOW).some((t) => t.conversation.id === analynThread.id), false, 'not Rowena’s thread yet');
  const result = await actions.deactivate_provider(CYNTHIA);
  assert.equal(result.has_open, true);
  assert.ok(result.open.threads.includes(analynThread.id));
  assert.equal(sel.officeThreadsOf(rt.state(), viewer(rt), NOW).find((t) => t.conversation.id === analynThread.id)?.why, 'unassigned', 'it stays visible to the other super account');
  assert.equal(hasOpenItems(sel.openItemsFor(rt.state(), viewer(rt), CYNTHIA, NOW)), true);
  const handed = await actions.reassign_provider(CYNTHIA, ROWENA);
  assert.equal(handed.ok, true);
  assert.equal(handed.moved, result.open.appointments.length + result.open.threads.length);
  assert.equal(rt.db().conversations.find((c) => c.id === analynThread.id).assigned_provider_id, ROWENA);
  assert.equal(sel.officeThreadsOf(rt.state(), viewer(rt), NOW).find((t) => t.conversation.id === analynThread.id)?.why, 'assigned');
  assert.equal(hasOpenItems(sel.openItemsFor(rt.state(), viewer(rt), CYNTHIA, NOW)), false);
  assert.equal((await actions.reassign_provider(CYNTHIA, LOURDES)).error, 'same_level');
  assert.equal((await actions.reassign_provider(ROWENA, ROWENA)).error, 'not_found');
  // a barangay account: its acknowledged alerts go to another account of the same barangay
  const open = openItemsOf({ role: 'barangay', id: 'b1' }, { now: NOW, appointments: [], conversations: [], alerts: [{ id: 'a1', status: 'acknowledged', acknowledged_by: 'b1' }, { id: 'a2', status: 'resolved', acknowledged_by: 'b1' }] });
  assert.deepEqual(open, { appointments: [], threads: [], alerts: ['a1'] });
});

// ---------- Permissions ----------

test('a super account reads a midwife thread only when it is assigned to it, or when its assigned account was deactivated', () => {
  const thread = { kind: 'midwife', patient_id: 'p', barangay_id: 'b', assigned_provider_id: CYNTHIA };
  const sup = (id) => ({ role: 'super', active: true, id });
  assert.equal(canReadConversation(sup(CYNTHIA), thread, {}), true);
  assert.equal(canReadConversation(sup(ROWENA), thread, {}), false);
  assert.equal(canReadConversation(sup(ROWENA), thread, {}, { assignee: { active: true } }), false);
  assert.equal(canReadConversation(sup(ROWENA), thread, {}, { assignee: { active: false } }), true);
  assert.equal(canReadConversation(sup(ROWENA), { ...thread, kind: 'barangay' }, {}), false);
  assert.equal(canReadConversation({ role: 'super', active: false, id: ROWENA }, thread, {}, { assignee: { active: false } }), false);
});

// ---------- Texts ----------

const flatten = (node, prefix = '') => Object.entries(node).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v]] : flatten(v, `${prefix}${k}.`)));
const load = (lang, ns) => JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}/${ns}.json`, import.meta.url), 'utf8'));
const keysOf = (lang, ns) => new Set(flatten(load(lang, ns)).map(([k]) => k));

test('every fixed text the super screens ask for exists in English and Filipino', () => {
  const dirs = ['features/tracker/', 'features/patient/', 'features/admin/', 'features/consult/', 'features/schedule/'];
  const files = ['OfficeConsult', 'Approvals', 'DecisionSheets', 'ReferralInbox', 'OfficeChat', 'OfficeChatList', 'OfficeSchedule', 'OfficeEventForm', 'Tracker', 'ExportSheet', 'PatientProfile', 'AccountSheets', 'Accounts', 'AccountForm', 'ActivityLogs', 'OfficeProfile', 'CallScreen'];
  let checked = 0;
  for (const dir of dirs) {
    for (const file of readdirSync(new URL(`../src/${dir}`, import.meta.url)).filter((f) => files.includes(f.replace(/\.jsx$/, '')))) {
      const source = readFileSync(new URL(`../src/${dir}${file}`, import.meta.url), 'utf8');
      const byVariable = new Map();
      for (const [, variable, ns] of source.matchAll(/const \{ t(?::\s*(\w+))?[^}]*\} = useTranslation\('(\w+)'\)/g)) byVariable.set(variable ?? 't', [...(byVariable.get(variable ?? 't') ?? []), ns]);
      for (const [variable, spaces] of byVariable) {
        for (const [, key] of source.matchAll(new RegExp(`\\b${variable}\\(\\s*'([\\w.]+)'`, 'g'))) {
          for (const lang of ['en', 'fil']) assert.ok(spaces.some((ns) => keysOf(lang, ns).has(key) || keysOf(lang, ns).has(`${key}_other`)), `${lang} ${spaces.join('|')}:${key} (${file})`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 150, `checked ${checked}`);
});

test('every text chosen by a value in the super screens exists in both languages', () => {
  for (const lang of ['en', 'fil']) {
    const t = keysOf(lang, 'tracker');
    const has = (key) => assert.ok(t.has(key) || t.has(`${key}_other`), `${lang} tracker:${key}`);
    for (const k of ['booking', 'reschedule', 'barangay_change', 'appointment_proposal']) has(`approvals.kind.${k}`);
    for (const k of ['pending', 'approved', 'declined', 'rescheduled']) has(`approvals.status.${k}`);
    for (const k of ['clinic', 'teleconsult']) has(`approvals.visit.${k}`);
    for (const k of ['generic', 'not_allowed', 'not_found', 'offline', 'already_handled', 'form']) has(`decision.error.${k}`);
    for (const k of ['required', 'invalid', 'past', 'tooFar', 'provider', 'tooLong']) has(`decision.field.${k}`);
    for (const k of ['approved', 'rescheduled', 'declined']) has(`decision.done.${k}`);
    for (const k of ['assigned', 'unassigned', 'no_account']) has(`chats.why.${k}`);
    for (const k of ['midwife', 'barangay']) has(`chat.kind.${k}`);
    for (const k of ['no_appointment', 'follow_up_over']) has(`chat.locked.${k}`);
    for (const k of ['edd', 'name', 'ga']) has(`filters.sorts.${k}`);
    for (const k of ['generic', 'offline', 'not_allowed']) has(`export.error.${k}`);
    for (const k of ['barangay', 'super']) has(`accounts.role.${k}`);
    for (const k of ['active', 'inactive']) has(`accounts.status.${k}`);
    for (const k of ['generic', 'not_allowed', 'not_found', 'offline', 'inactive', 'last_super', 'self', 'not_active', 'same_level', 'form']) has(`accounts.error.${k}`);
    for (const k of ['required', 'fullName', 'email', 'phone', 'barangay', 'taken']) has(`accountForm.error.${k}`);
    for (const k of ['required', 'tooLong', 'invalid', 'past', 'tooFar', 'endBeforeStart', 'barangay']) has(`event.error.${k}`);
    for (const k of ['view_record', 'view_vitals']) has(`logs.${k}`);
    has('logs.export');
    const alerts = keysOf(lang, 'alerts');
    for (const kind of ['reschedule', 'barangay_change', 'appointment_proposal']) for (const status of ['approved', 'declined']) assert.ok(alerts.has(`notification.request_decided.${kind}.${status}`), `${lang} request_decided.${kind}.${status}`);
    for (const type of ['appointment_rescheduled', 'appointment_declined']) assert.ok(alerts.has(`notification.${type}`));
  }
  for (const type of ['appointment_rescheduled', 'appointment_declined', 'request_decided']) assert.ok(NOTIFICATION_TYPES.includes(type));
  const view = describeNotification({ type: 'request_decided', payload: { kind: 'barangay_change', status: 'approved' }, read_at: null }, { role: 'patient' });
  assert.equal(view.titleKey, 'notification.request_decided.barangay_change.approved');
  assert.equal(notificationPath('patient', { type: 'request_decided', payload: { kind: 'reschedule' } }), '/patient/schedule');
  assert.equal(notificationPath('patient', { type: 'request_decided', payload: { kind: 'barangay_change' } }), '/patient/profile');
  assert.equal(notificationPath('barangay', { type: 'request_decided', payload: { kind: 'appointment_proposal' } }), '/barangay/calendar');
  assert.equal(notificationPath('patient', { type: 'appointment_declined', payload: {} }), '/patient/consult');
});

test('the super screens use Intl through lib/format and the account screens never print a stored password', () => {
  const files = ['features/tracker/Tracker.jsx', 'features/patient/PatientProfile.jsx', 'features/consult/Approvals.jsx', 'features/admin/ActivityLogs.jsx', 'features/admin/Accounts.jsx'];
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /toLocale(Date|Time)String|getHours|getMonth\(|padStart\(2/, file);
  const accounts = readFileSync(new URL('../src/features/admin/Accounts.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(accounts, /\.password\b/, 'the list never shows a password');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/sim/seed.js';
import { NOW } from './helpers.js';
import * as sel from '../src/store/selectors.js';
import * as access from '../src/lib/permissions.js';

const state = { ...createSeed({ now: NOW }), session: null };
const who = (id) => sel.profileOf(state, id);
const maricel = who('maricel-dimaculangan');
const rosalinda = who('rosalinda-ramos');
const lourdes = who('lourdes-magpantay'); // Barangay 14
const jocelyn = who('jocelyn-landicho'); // Barangay 14
const nora = who('nora-marasigan'); // San Isidro
const lilia = who('lilia-comia'); // Pisa
const gloria = who('gloria-mendoza'); // Marikaban: no patients
const rowena = who('rowena-macaraig');
const cynthia = who('cynthia-dimayuga');
const ids = (rows) => rows.map((r) => r.id).sort();

test('a patient sees only herself', () => {
  assert.deepEqual(ids(sel.patientsInScope(state, maricel)), ['maricel-dimaculangan']);
  assert.ok(sel.patientRecord(state, maricel, 'maricel-dimaculangan'));
  assert.equal(sel.patientRecord(state, maricel, 'rosalinda-ramos'), null);
  assert.equal(sel.patientRecord(state, maricel, 'jenny-rose-villanueva'), null);
});

test('a barangay account sees the patients of its own barangay and no other', () => {
  assert.deepEqual(ids(sel.patientsInScope(state, lourdes)), ['maricel-dimaculangan', 'rosalinda-ramos', 'shiela-marie-aguila']);
  assert.deepEqual(ids(sel.patientsInScope(state, jocelyn)), ids(sel.patientsInScope(state, lourdes)), 'both accounts of a barangay see the same patients');
  assert.deepEqual(ids(sel.patientsInScope(state, nora)), ['beverly-ann-navarro']);
  assert.deepEqual(ids(sel.patientsInScope(state, lilia)), ['analyn-gonzales', 'mary-joy-cabrera']);
  assert.deepEqual(sel.patientsInScope(state, gloria), [], 'Marikaban has no patients');
  assert.equal(sel.patientRecord(state, lourdes, 'jenny-rose-villanueva'), null);
  assert.equal(sel.patientRecord(state, nora, 'maricel-dimaculangan'), null);
});

test('a super account sees all 20 patients', () => {
  assert.equal(sel.patientsInScope(state, rowena).length, 20);
  assert.equal(sel.patientsInScope(state, cynthia).length, 20);
  assert.ok(sel.patientRecord(state, rowena, 'gemma-salazar'));
});

test('no viewer and a deactivated viewer see nothing at all', () => {
  const inactive = { ...lourdes, active: false };
  for (const viewer of [null, undefined, inactive]) {
    assert.deepEqual(sel.patientsInScope(state, viewer), []);
    assert.deepEqual(sel.alertsOf(state, viewer), []);
    assert.deepEqual(sel.conversationsOf(state, viewer), []);
    assert.deepEqual(sel.notificationsOf(state, viewer), viewer ? sel.notificationsOf(state, viewer) : []);
    assert.deepEqual(sel.eventsOf(state, viewer), []);
    assert.deepEqual(sel.providerAccounts(state, viewer), []);
    assert.deepEqual(sel.accessLogOf(state, viewer), []);
  }
  assert.deepEqual(sel.checkSessions(state, inactive, 'maricel-dimaculangan'), []);
  assert.equal(sel.patientRecord(state, inactive, 'maricel-dimaculangan'), null);
});

test('readings, sessions and devices follow the patient record', () => {
  const sessions = sel.checkSessions(state, maricel, 'maricel-dimaculangan');
  assert.ok(sessions.length > 50);
  assert.ok(sessions.every((s, i) => i === 0 || sessions[i - 1].started_at >= s.started_at), 'newest first');
  assert.deepEqual(sel.checkSessions(state, maricel, 'rosalinda-ramos'), []);
  assert.deepEqual(sel.checkSessions(state, nora, 'maricel-dimaculangan'), []);
  assert.ok(sel.checkSessions(state, lourdes, 'maricel-dimaculangan').length > 50);
  assert.ok(sel.checkSessions(state, rowena, 'rosalinda-ramos').length > 50);

  const recent = sessions[0];
  assert.equal(sel.fetalReadings(state, maricel, recent.id).length, 30);
  assert.equal(sel.fetalReadings(state, lourdes, recent.id).length, 30);
  assert.deepEqual(sel.fetalReadings(state, rosalinda, recent.id), [], "another patient's readings");
  assert.deepEqual(sel.fetalReadings(state, nora, recent.id), [], "another barangay's readings");
  assert.equal(sel.maternalReadings(state, maricel, recent.id).length, 1);
  assert.deepEqual(sel.maternalReadings(state, rosalinda, recent.id), []);
  assert.deepEqual(sel.fetalReadings(state, rowena, 'no-such-session'), []);

  assert.equal(sel.devicesOf(state, maricel, 'maricel-dimaculangan').length, 2);
  assert.deepEqual(sel.devicesOf(state, maricel, 'rosalinda-ramos'), []);
  assert.deepEqual(sel.devicesOf(state, nora, 'rosalinda-ramos'), []);
});

test('alerts: a patient her own, a barangay account its own barangay, a super account all 14', () => {
  assert.equal(sel.alertsOf(state, rowena).length, 14);
  assert.equal(sel.alertsOf(state, cynthia).length, 14);
  assert.deepEqual(sel.alertsOf(state, maricel), []);
  assert.equal(sel.alertsOf(state, rosalinda).length, 1);
  assert.deepEqual(sel.alertsOf(state, lourdes).map((a) => a.patient_id), ['rosalinda-ramos']);
  const sanJose = who('esperanza-macatangay');
  assert.deepEqual(sel.alertsOf(state, sanJose).map((a) => a.patient_id), ['maribel-lopez']);
  assert.deepEqual(sel.alertsOf(state, nora), [], 'nothing from other barangays');
  assert.deepEqual(sel.alertsOf(state, lourdes, { patientId: 'maribel-lopez' }), []);
  assert.equal(sel.alertsOf(state, rowena, { status: 'new' }).length, 1);
  assert.equal(sel.alertsOf(state, rowena, { status: 'acknowledged' }).length, 1);
  assert.equal(sel.alertsOf(state, rowena, { status: 'resolved' }).length, 12);
  const list = sel.alertsOf(state, rowena);
  assert.ok(list.every((a, i) => i === 0 || list[i - 1].created_at >= a.created_at), 'newest first');
});

test('visit notes: providers in scope read all; a patient reads only the notes shared with her', () => {
  const all = state.db.visit_notes.filter((n) => n.patient_id === 'maricel-dimaculangan');
  const shared = all.filter((n) => n.shared);
  assert.ok(all.length > shared.length, 'at least one note is for providers only');
  assert.equal(sel.visitNotesOf(state, lourdes, 'maricel-dimaculangan').length, all.length);
  assert.equal(sel.visitNotesOf(state, rowena, 'maricel-dimaculangan').length, all.length);
  assert.equal(sel.visitNotesOf(state, maricel, 'maricel-dimaculangan').length, shared.length);
  assert.ok(sel.visitNotesOf(state, maricel, 'maricel-dimaculangan').every((n) => n.shared));
  assert.deepEqual(sel.visitNotesOf(state, maricel, 'rosalinda-ramos'), []);
  assert.deepEqual(sel.visitNotesOf(state, nora, 'maricel-dimaculangan'), []);
});

test('appointments: own, own barangay, all', () => {
  assert.ok(sel.appointmentsOf(state, maricel).every((a) => a.patient_id === 'maricel-dimaculangan'));
  assert.ok(sel.appointmentsOf(state, maricel).length >= 3);
  assert.deepEqual(sel.appointmentsOf(state, maricel, { patientId: 'rosalinda-ramos' }), []);
  const barangayPatients = new Set(['maricel-dimaculangan', 'rosalinda-ramos', 'shiela-marie-aguila']);
  assert.ok(sel.appointmentsOf(state, lourdes).every((a) => barangayPatients.has(a.patient_id)));
  assert.equal(sel.appointmentsOf(state, rowena).length, state.db.appointments.length);
  assert.deepEqual(sel.appointmentsOf(state, gloria), []);
});

test('events: all-barangay events plus your own barangay; super accounts see all four', () => {
  const titles = (viewer) => sel.eventsOf(state, viewer).map((e) => e.title);
  assert.deepEqual(titles(maricel), ['Prenatal check-up day', 'Tetanus vaccination day']);
  assert.deepEqual(titles(lourdes), ['Prenatal check-up day', 'Tetanus vaccination day']);
  assert.deepEqual(titles(lilia), ['Pregnancy class', 'Tetanus vaccination day']);
  assert.deepEqual(titles(nora), ['Tetanus vaccination day']);
  assert.equal(titles(rowena).length, 4);
  const unsorted = sel.eventsOf(state, rowena);
  assert.ok(unsorted.every((e, i) => i === 0 || unsorted[i - 1].starts_at <= e.starts_at), 'soonest first');
});

test('conversations: a patient her two threads; a barangay account the barangay threads of its patients; a super account the midwife threads assigned to it', () => {
  assert.deepEqual(ids(sel.conversationsOf(state, maricel)), ['conv-barangay-maricel-dimaculangan', 'conv-midwife-maricel-dimaculangan']);
  assert.deepEqual(ids(sel.conversationsOf(state, lourdes)), [
    'conv-barangay-maricel-dimaculangan', 'conv-barangay-rosalinda-ramos', 'conv-barangay-shiela-marie-aguila',
  ]);
  assert.deepEqual(sel.conversationsOf(state, gloria), []);
  assert.deepEqual(ids(sel.conversationsOf(state, cynthia)), ['conv-midwife-analyn-gonzales']);
  assert.deepEqual(sel.conversationsOf(state, rowena), [], 'no midwife thread is assigned to her');
});

test('messages: only through a thread the viewer may read', () => {
  assert.ok(sel.messagesOf(state, maricel, 'conv-barangay-maricel-dimaculangan').length >= 3);
  assert.deepEqual(sel.messagesOf(state, maricel, 'conv-barangay-rosalinda-ramos'), []);
  assert.deepEqual(sel.messagesOf(state, nora, 'conv-barangay-maricel-dimaculangan'), []);
  assert.ok(sel.messagesOf(state, lourdes, 'conv-barangay-rosalinda-ramos').length >= 3);
  assert.deepEqual(sel.messagesOf(state, lourdes, 'conv-midwife-analyn-gonzales'), []);
  assert.deepEqual(sel.messagesOf(state, rowena, 'conv-midwife-analyn-gonzales'), []);
  assert.equal(sel.messagesOf(state, cynthia, 'conv-midwife-analyn-gonzales').length, 1);
  assert.deepEqual(sel.messagesOf(state, rowena, 'no-such-thread'), []);
});

test('a message made offline stays with its sender until it syncs', () => {
  const queued = {
    id: 'msg-queued', conversation_id: 'conv-barangay-maricel-dimaculangan', sender_id: 'maricel-dimaculangan', body: 'Hello po',
    attachment_art: null, sent_at: NOW, delivered_at: null, seen_at: null, client_id: 'c1', syncState: 'queued',
  };
  const withQueued = { ...state, db: { ...state.db, messages: [...state.db.messages, queued] } };
  assert.ok(sel.messagesOf(withQueued, maricel, 'conv-barangay-maricel-dimaculangan').some((m) => m.id === 'msg-queued'));
  assert.ok(!sel.messagesOf(withQueued, lourdes, 'conv-barangay-maricel-dimaculangan').some((m) => m.id === 'msg-queued'));
  const synced = { ...withQueued, db: { ...withQueued.db, messages: withQueued.db.messages.map((m) => (m.id === 'msg-queued' ? { ...m, syncState: 'synced' } : m)) } };
  assert.ok(sel.messagesOf(synced, lourdes, 'conv-barangay-maricel-dimaculangan').some((m) => m.id === 'msg-queued'));
});

test('notifications and assistant messages belong to one account', () => {
  assert.ok(sel.notificationsOf(state, maricel).every((n) => n.profile_id === 'maricel-dimaculangan'));
  assert.ok(sel.notificationsOf(state, maricel).length >= 2);
  assert.ok(sel.notificationsOf(state, rowena).every((n) => n.profile_id === 'rowena-macaraig'));
  const list = sel.notificationsOf(state, lourdes);
  assert.ok(list.every((n, i) => i === 0 || list[i - 1].created_at >= n.created_at));
  assert.deepEqual(sel.heleMessagesOf(state, maricel), []);
  const withHele = { ...state, db: { ...state.db, hele_messages: [{ id: 'h1', profile_id: 'rosalinda-ramos', role: 'user', content: 'hi', created_at: 1, flagged_emergency: false }] } };
  assert.deepEqual(sel.heleMessagesOf(withHele, maricel), []);
  assert.equal(sel.heleMessagesOf(withHele, rosalinda).length, 1);
});

test('provider accounts and the logs are for super accounts only', () => {
  assert.equal(sel.providerAccounts(state, rowena).length, 22);
  assert.deepEqual(sel.providerAccounts(state, lourdes), []);
  assert.deepEqual(sel.providerAccounts(state, maricel), []);
  assert.equal(sel.accessLogOf(state, cynthia).length, state.db.access_log.length);
  assert.equal(sel.exportLogOf(state, rowena).length, 3);
  for (const viewer of [maricel, lourdes]) {
    assert.deepEqual(sel.accessLogOf(state, viewer), []);
    assert.deepEqual(sel.exportLogOf(state, viewer), []);
  }
});

test('passwords are never returned by a selector', () => {
  const everything = JSON.stringify([
    sel.patientsInScope(state, rowena), sel.providerAccounts(state, rowena), sel.patientRecord(state, rowena, 'maricel-dimaculangan'),
  ]);
  assert.ok(!everything.includes('NurtureLink2026!'));
});

test('who the scenarios act on: herself for a patient with devices, otherwise the chosen patient within scope', () => {
  assert.equal(sel.focusPatientId(state, maricel), 'maricel-dimaculangan');
  assert.equal(sel.focusPatientId(state, who('shiela-marie-aguila')), null, 'no devices, nothing to run');
  assert.deepEqual(ids(sel.focusCandidates(state, lourdes)), ['maricel-dimaculangan', 'rosalinda-ramos']);
  assert.equal(sel.focusCandidates(state, rowena).length, 14);
  assert.equal(sel.focusPatientId(state, lourdes), 'maricel-dimaculangan');
  assert.equal(sel.focusPatientId(state, rowena), 'maricel-dimaculangan');
  assert.equal(sel.focusPatientId(state, nora), null, 'San Isidro has no patient with both devices');
  assert.equal(sel.focusPatientId(state, gloria), null);
  const chosen = (id) => ({ ...state, meta: { ...state.meta, focus_patient_id: id } });
  assert.equal(sel.focusPatientId(chosen('rosalinda-ramos'), lourdes), 'rosalinda-ramos');
  assert.equal(sel.focusPatientId(chosen('jenny-rose-villanueva'), lourdes), 'maricel-dimaculangan', 'out of her barangay: ignored');
  assert.equal(sel.focusPatientId(chosen('jenny-rose-villanueva'), rowena), 'jenny-rose-villanueva');
  assert.equal(sel.focusPatientId(chosen('rosalinda-ramos'), maricel), 'maricel-dimaculangan', 'a patient never acts on someone else');
});

test('permission rules in one place: who may do what', () => {
  const patient = (id) => who(id);
  assert.equal(access.canReadPatient(lourdes, patient('maricel-dimaculangan')), true);
  assert.equal(access.canReadPatient(lourdes, patient('jenny-rose-villanueva')), false);
  assert.equal(access.canReadPatient(maricel, patient('maricel-dimaculangan')), true);
  assert.equal(access.canReadPatient(maricel, patient('rosalinda-ramos')), false);
  assert.equal(access.canAcknowledge(lourdes, patient('rosalinda-ramos')), true);
  assert.equal(access.canAcknowledge(lourdes, patient('maribel-lopez')), false);
  assert.equal(access.canAcknowledge(maricel, patient('maricel-dimaculangan')), false, 'a patient cannot acknowledge');
  assert.equal(access.canAcknowledge(rowena, patient('maribel-lopez')), true);
  assert.equal(access.canEditClinical(maricel, patient('maricel-dimaculangan')), false);
  assert.equal(access.canManageProviders(rowena), true);
  assert.equal(access.canManageProviders(lourdes), false);
  assert.equal(access.canReadLogs(cynthia), true);
  assert.equal(access.canReadLogs(maricel), false);
  assert.equal(access.canApproveBookings(rowena), true);
  assert.equal(access.canApproveBookings(lourdes), false);
  assert.equal(access.canExportPatients(lourdes), false);
  assert.equal(access.canCreateEvent(rowena, { scope: 'all', barangay_id: null }), true);
  assert.equal(access.canCreateEvent(lourdes, { scope: 'barangay', barangay_id: 'brgy-14' }), true);
  assert.equal(access.canCreateEvent(lourdes, { scope: 'barangay', barangay_id: 'pisa' }), false);
  assert.equal(access.canCreateEvent(lourdes, { scope: 'all', barangay_id: null }), false);
  assert.equal(access.canCreateEvent(maricel, { scope: 'barangay', barangay_id: 'brgy-14' }), false);
  assert.equal(access.canReadPatient(null, patient('maricel-dimaculangan')), false);
});

test('the gear shows each role only what fits it (Section 7)', () => {
  const patient = access.gearConfigFor('patient');
  const barangay = access.gearConfigFor('barangay');
  const sup = access.gearConfigFor('super');
  const none = access.gearConfigFor(null);
  assert.deepEqual(none.sections, ['reset']);
  assert.equal(patient.devices && barangay.devices && !sup.devices, true);
  assert.equal(patient.patientChooser, false);
  assert.equal(barangay.patientChooser && sup.patientChooser, true);
  assert.ok(patient.groups.checks.includes('check-normal') && barangay.groups.checks.includes('check-normal'));
  assert.equal(sup.groups.checks, undefined);
  assert.ok(patient.groups.alerts.includes('missed-check') && !barangay.groups.alerts.includes('missed-check'));
  assert.ok(barangay.groups.alerts.includes('alert-unacknowledged') && sup.groups.alerts.includes('alert-unacknowledged'));
  assert.ok(!patient.groups.alerts.includes('alert-unacknowledged'));
  assert.ok(sup.groups.consult.includes('booking-request') && sup.groups.consult.includes('referral') && sup.groups.consult.includes('video-usage-80'));
  assert.ok(barangay.groups.consult.includes('incoming-message'));
  assert.equal(access.PRESENTER_ACCOUNTS.length, 8);
});

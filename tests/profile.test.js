import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { createActions } from '../src/store/actions.js';
import * as sel from '../src/store/selectors.js';
import { MS_DAY, MS_HOUR, addDays, manilaDate } from '../src/lib/dates.js';
import { countdown, gestationalAge, trimester } from '../src/lib/pregnancy.js';
import { squareCrop, photoProblem, PHOTO_SIZE } from '../src/lib/photo.js';
import { validateBarangayChange, validateChangePassword, validatePersonal, validateReschedule, EMERGENCY_RELATIONSHIPS } from '../src/lib/profileRules.js';
import { applyOps } from '../src/store/ops.js';

const ROWENA = 'rowena-macaraig';
const CYNTHIA = 'cynthia-dimayuga';
const LOURDES = 'lourdes-magpantay';
const instant = async () => {};
const as = (id = MARICEL) => {
  const rt = makeRuntime();
  rt.auth.signInAs(id);
  return rt;
};
const viewer = (rt) => sel.viewerOf(rt.state());
const upcoming = (rt, patient = MARICEL) => rt.db().appointments.find((a) => a.patient_id === patient && a.status === 'approved' && a.scheduled_at > NOW);
const VALID = { contact_no: '09175550299', emergency_name: 'Ramon  Dimaculangan', emergency_relationship: 'husband', emergency_no: '+63 917 555 0598' };

// ---------- Rules ----------

test('personal information rules: a mobile number, a full name, a relationship from the list', () => {
  assert.deepEqual(validatePersonal(VALID), {});
  assert.deepEqual(validatePersonal({ ...VALID, contact_no: '' }), { contact_no: 'required' });
  assert.deepEqual(validatePersonal({ ...VALID, contact_no: '12345' }), { contact_no: 'phone' });
  assert.deepEqual(validatePersonal({ ...VALID, emergency_name: 'Ramon' }), { emergency_name: 'fullName' });
  assert.deepEqual(validatePersonal({ ...VALID, emergency_relationship: 'neighbour' }), { emergency_relationship: 'required' });
  assert.deepEqual(validatePersonal({ ...VALID, emergency_no: 'abc' }), { emergency_no: 'phone' });
  for (const seeded of ['husband', 'mother', 'sister']) assert.ok(EMERGENCY_RELATIONSHIPS.includes(seeded), 'the seed uses it');
});

test('request rules: a reschedule needs a reason and a date after today; a barangay change needs another barangay', () => {
  const ctx = { today: '2026-11-08' };
  assert.deepEqual(validateReschedule({ reason: 'Work', preferred_date: '' }, ctx), {});
  assert.deepEqual(validateReschedule({ reason: ' ', preferred_date: '' }, ctx), { reason: 'required' });
  assert.deepEqual(validateReschedule({ reason: 'x'.repeat(301) }, ctx), { reason: 'tooLong' });
  assert.deepEqual(validateReschedule({ reason: 'Work', preferred_date: '2026-11-08' }, ctx), { preferred_date: 'future' });
  assert.deepEqual(validateReschedule({ reason: 'Work', preferred_date: '2026-11-31x' }, ctx), { preferred_date: 'date' });
  const b = { current: 'brgy-14', barangayIds: ['brgy-14', 'papaya'] };
  assert.deepEqual(validateBarangayChange({ barangay_id: 'papaya' }, b), {});
  assert.deepEqual(validateBarangayChange({ barangay_id: 'brgy-14' }, b), { barangay_id: 'same_barangay' });
  assert.deepEqual(validateBarangayChange({ barangay_id: '' }, b), { barangay_id: 'required' });
  assert.deepEqual(validateBarangayChange({ barangay_id: 'nowhere' }, b), { barangay_id: 'barangay' });
});

test('change password rules: the current one, a strong different new one, the same twice', () => {
  assert.deepEqual(validateChangePassword({ current: 'Old-pass-1', password: 'New-pass-22', confirm: 'New-pass-22' }), {});
  assert.deepEqual(validateChangePassword({ current: '', password: 'New-pass-22', confirm: 'New-pass-22' }), { current: 'required' });
  assert.deepEqual(validateChangePassword({ current: 'Old-pass-1', password: 'weak', confirm: 'weak' }), { password: 'weak' });
  assert.deepEqual(validateChangePassword({ current: 'Old-pass-1', password: 'Old-pass-1', confirm: 'Old-pass-1' }), { password: 'same' });
  assert.deepEqual(validateChangePassword({ current: 'Old-pass-1', password: 'New-pass-22', confirm: 'New-pass-23' }), { confirm: 'mismatch' });
});

test('the photo is cut square from the middle and made at most 256 px; only small JPEG, PNG and WebP pictures are taken', () => {
  assert.deepEqual(squareCrop(4000, 3000), { sx: 500, sy: 0, side: 3000, size: PHOTO_SIZE });
  assert.deepEqual(squareCrop(600, 1200), { sx: 0, sy: 300, side: 600, size: PHOTO_SIZE });
  assert.equal(squareCrop(100, 80).size, 80, 'never made bigger');
  assert.equal(photoProblem({ type: 'image/jpeg', size: 1000 }), null);
  assert.equal(photoProblem({ type: 'application/pdf', size: 1000 }), 'type');
  assert.equal(photoProblem({ type: 'image/png', size: 13 * 1024 * 1024 }), 'size');
  assert.equal(photoProblem(null), 'type');
});

test('the delete operation removes one row, and does nothing for a row that is not there', () => {
  const base = { db: { devices: [{ id: 'a' }, { id: 'b' }] }, meta: {}, hardware: {} };
  assert.deepEqual(applyOps(base, [{ op: 'delete', table: 'devices', id: 'a' }]).db.devices, [{ id: 'b' }]);
  assert.equal(applyOps(base, [{ op: 'delete', table: 'devices', id: 'zzz' }]), base, 'no change, same state');
});

// ---------- Pregnancy information (PAT-P-02, PAT-P-03) ----------

test('Maricel\'s EDD is her LMP + 280 days and her gestational age is 31 weeks 2 days', () => {
  const rt = as();
  const { pregnancy } = sel.patientRecord(rt.state(), viewer(rt), MARICEL);
  assert.equal(pregnancy.edd, addDays(pregnancy.lmp, 280));
  assert.equal(pregnancy.edd_source, 'naegele');
  const today = manilaDate(NOW);
  const age = gestationalAge(pregnancy.lmp, today);
  assert.deepEqual([age.weeks, age.days, trimester(age.totalDays)], [31, 2, 3]);
  const left = countdown(pregnancy.edd, today);
  assert.equal(left.days, 280 - age.totalDays);
  assert.equal(left.weeks * 7 + left.remainderDays, left.days);
});

test('a patient can read her LMP, EDD and shared visit notes, and has no way to write them', () => {
  const rt = as();
  const notes = sel.visitNotesOf(rt.state(), viewer(rt), MARICEL);
  assert.ok(notes.length >= 1 && notes.every((n) => n.shared === true), 'her providers-only note is not shown');
  const before = JSON.stringify(rt.db().pregnancies.find((p) => p.patient_id === MARICEL));
  // every service she can call touches her own profile and patient rows only
  rt.profile.savePersonal(VALID);
  rt.requests.requestBarangayChange({ barangay_id: 'papaya', reason: '' });
  assert.equal(JSON.stringify(rt.db().pregnancies.find((p) => p.patient_id === MARICEL)), before);
  assert.deepEqual(Object.keys(rt.profile).sort(), ['savePersonal', 'setHeleLogging', 'setPhoto']);
});

// ---------- Personal information (PAT-P-01) ----------

test('saving personal information online changes her profile and patient row at once', () => {
  const rt = as();
  const result = rt.profile.savePersonal(VALID);
  assert.deepEqual([result.ok, result.queued], [true, false]);
  const profile = rt.db().profiles.find((p) => p.id === MARICEL);
  const row = rt.db().patients.find((p) => p.id === MARICEL);
  assert.equal(profile.contact_no, '0917 555 0299', 'stored in the usual format');
  assert.deepEqual([row.emergency_name, row.emergency_relationship, row.emergency_no, row.queued_edit], ['Ramon Dimaculangan', 'husband', '0917 555 0598', null]);
  assert.equal(sel.profileByIdentifier(rt.state(), '09175550299').id, MARICEL, 'her new number is her sign-in');
});

test('a number that belongs to another account is refused, and a bad form gives its errors', () => {
  const rt = as();
  assert.deepEqual(rt.profile.savePersonal({ ...VALID, contact_no: '0917 555 0202' }), { ok: false, error: 'form', errors: { contact_no: 'taken' } });
  assert.equal(rt.profile.savePersonal({ ...VALID, emergency_name: '' }).errors.emergency_name, 'required');
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).contact_no, '0917 555 0201', 'nothing changed');
  assert.equal(rt.profile.savePersonal({ ...VALID, contact_no: '0917 555 0201' }).ok, true, 'her own number is fine');
});

test('an edit made offline waits on the phone, shows to her at once, stays hidden from others, and is applied once when online', () => {
  const rt = as();
  rt.setConnection('offline');
  const result = rt.profile.savePersonal(VALID);
  assert.deepEqual([result.ok, result.queued], [true, true]);
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).contact_no, '0917 555 0201', 'the saved record is unchanged');
  const mine = sel.personalInfoOf(rt.state(), viewer(rt));
  assert.deepEqual([mine.queued, mine.profile.contact_no, mine.patient.emergency_name], [true, '0917 555 0299', 'Ramon Dimaculangan']);
  // a second edit keeps the first one's other fields
  rt.profile.setPhoto({ avatar_art: 'bell' });
  assert.equal(sel.personalInfoOf(rt.state(), viewer(rt)).profile.avatar_art, 'bell');
  assert.equal(sel.personalInfoOf(rt.state(), viewer(rt)).profile.contact_no, '0917 555 0299');
  rt.auth.signInAs(LOURDES);
  assert.equal(sel.profileOf(rt.state(), MARICEL).contact_no, '0917 555 0201', 'her barangay account still sees the saved number');
  rt.auth.signInAs(MARICEL);
  const summary = rt.core.setConnection('online');
  assert.equal(summary.edits, 1);
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).contact_no, '0917 555 0299');
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).avatar_art, 'bell');
  assert.equal(rt.db().patients.find((p) => p.id === MARICEL).queued_edit, null);
  assert.equal(rt.core.flushQueue().edits, 0, 'sent once');
});

test('the photo is a small JPEG, a drawn avatar, or neither; anything else is refused', () => {
  const rt = as();
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  assert.equal(rt.profile.setPhoto({ photo_url: jpeg }).ok, true);
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).photo_url, jpeg);
  assert.equal(rt.profile.setPhoto({ avatar_art: 'shield' }).ok, true);
  const p = rt.db().profiles.find((x) => x.id === MARICEL);
  assert.deepEqual([p.photo_url, p.avatar_art], [null, 'shield'], 'a drawn avatar replaces the photo');
  assert.equal(rt.profile.setPhoto({}).ok, true);
  assert.deepEqual([rt.db().profiles.find((x) => x.id === MARICEL).photo_url, rt.db().profiles.find((x) => x.id === MARICEL).avatar_art], [null, null]);
  for (const bad of [{ photo_url: 'https://example.com/a.jpg' }, { photo_url: 'data:image/svg+xml;base64,AAAA' }, { avatar_art: 'hele' }, { photo_url: jpeg, avatar_art: 'bell' }, { photo_url: `data:image/jpeg;base64,${'A'.repeat(300001)}` }]) {
    assert.equal(rt.profile.setPhoto(bad).error, 'invalid');
  }
});

test('only a signed-in patient can use the profile services, and only on herself', () => {
  for (const id of [LOURDES, ROWENA]) {
    const rt = as(id);
    assert.equal(rt.profile.savePersonal(VALID).error, 'not_allowed');
    assert.equal(rt.profile.setPhoto({}).error, 'not_allowed');
    assert.equal(rt.profile.setHeleLogging(true).error, 'not_allowed');
    assert.equal(rt.requests.requestBarangayChange({ barangay_id: 'papaya' }).error, 'not_allowed');
  }
  const signedOut = makeRuntime();
  assert.equal(signedOut.profile.savePersonal(VALID).error, 'not_allowed');
  assert.deepEqual(sel.personalInfoOf(signedOut.state(), null), null);
});

// ---------- Barangay change (PAT-P-01) ----------

test('a barangay change is a pending request that tells the super accounts, and her barangay stays as it is', () => {
  const rt = as();
  const result = rt.requests.requestBarangayChange({ barangay_id: 'papaya', reason: ' Moved to my mother\'s house ' });
  assert.deepEqual([result.ok, result.queued], [true, false]);
  const row = rt.db().requests[0];
  assert.deepEqual([row.kind, row.status, row.from_barangay_id, row.to_barangay_id, row.reason, row.syncState], ['barangay_change', 'pending', 'brgy-14', 'papaya', 'Moved to my mother\'s house', 'synced']);
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).barangay_id, 'brgy-14');
  for (const id of [ROWENA, CYNTHIA]) {
    const got = rt.inbox(id).filter((n) => n.type === 'barangay_change_request');
    assert.equal(got.length, 1);
    assert.deepEqual(got[0].payload, { request_id: row.id, patient_id: MARICEL });
  }
  assert.equal(rt.inbox(LOURDES).filter((n) => n.type === 'barangay_change_request').length, 0, 'the barangay accounts are not the ones who approve');
  assert.equal(sel.pendingRequestOf(rt.state(), viewer(rt), 'barangay_change').id, row.id);
  assert.equal(rt.requests.requestBarangayChange({ barangay_id: 'pisa' }).error, 'pending_exists', 'one at a time');
});

test('a barangay change needs another barangay from the list', () => {
  const rt = as();
  assert.equal(rt.requests.requestBarangayChange({ barangay_id: 'brgy-14' }).errors.barangay_id, 'same_barangay');
  assert.equal(rt.requests.requestBarangayChange({ barangay_id: 'nowhere' }).errors.barangay_id, 'barangay');
  assert.equal(rt.requests.requestBarangayChange({ barangay_id: '' }).errors.barangay_id, 'required');
  assert.equal(rt.db().requests.length, 0);
});

// ---------- Reschedule requests (PAT-S-05) ----------

test('a reschedule request reaches every super account and the appointment\'s provider as a notification', () => {
  const rt = as();
  const a = upcoming(rt);
  const result = rt.requests.requestReschedule({ appointment_id: a.id, reason: 'Work that day', preferred_date: addDays(manilaDate(NOW), 9) });
  assert.deepEqual([result.ok, result.queued], [true, false]);
  const row = rt.db().requests[0];
  assert.deepEqual([row.kind, row.status, row.appointment_id, row.preferred_date.length], ['reschedule', 'pending', a.id, 10]);
  for (const id of [ROWENA, CYNTHIA, a.provider_id]) {
    const got = rt.inbox(id).filter((n) => n.type === 'reschedule_request');
    assert.equal(got.length, 1, id);
    assert.deepEqual(got[0].payload, { request_id: row.id, appointment_id: a.id, patient_id: MARICEL });
  }
  assert.equal(rt.db().appointments.find((x) => x.id === a.id).status, 'approved', 'the appointment itself waits for the office');
  assert.equal(rt.requests.requestReschedule({ appointment_id: a.id, reason: 'Again' }).error, 'pending_exists');
  assert.ok(sel.pendingRequestOf(rt.state(), viewer(rt), 'reschedule', a.id));
});

test('a reschedule request needs a reason, an upcoming approved appointment of her own', () => {
  const rt = as();
  const a = upcoming(rt);
  assert.equal(rt.requests.requestReschedule({ appointment_id: a.id, reason: '' }).errors.reason, 'required');
  assert.equal(rt.requests.requestReschedule({ appointment_id: a.id, reason: 'x', preferred_date: manilaDate(NOW) }).errors.preferred_date, 'future');
  const past = rt.db().appointments.find((x) => x.patient_id === MARICEL && x.status === 'attended');
  assert.equal(rt.requests.requestReschedule({ appointment_id: past.id, reason: 'x' }).error, 'not_upcoming');
  const other = upcoming(rt, 'rosalinda-ramos');
  assert.equal(rt.requests.requestReschedule({ appointment_id: other.id, reason: 'x' }).error, 'not_found', 'not hers');
  assert.equal(rt.requests.requestReschedule({ appointment_id: 'nothing', reason: 'x' }).error, 'not_found');
  assert.equal(rt.db().requests.length, 0);
  assert.equal(rt.db().notifications.filter((n) => n.type === 'reschedule_request').length, 0);
});

test('a request made offline is hidden from providers and sent once when the connection is back', () => {
  const rt = as();
  const a = upcoming(rt);
  rt.setConnection('offline');
  const result = rt.requests.requestReschedule({ appointment_id: a.id, reason: 'Work that day' });
  assert.deepEqual([result.ok, result.queued], [true, true]);
  assert.equal(rt.db().requests[0].syncState, 'queued');
  assert.equal(rt.db().notifications.filter((n) => n.type === 'reschedule_request').length, 0, 'nobody is told yet');
  assert.ok(sel.pendingRequestOf(rt.state(), viewer(rt), 'reschedule', a.id), 'she sees it as pending');
  rt.auth.signInAs(ROWENA);
  assert.equal(sel.requestsOf(rt.state(), viewer(rt)).length, 0, 'the office does not see it yet');
  rt.auth.signInAs(MARICEL);
  const summary = rt.core.setConnection('online');
  assert.equal(summary.requests, 1);
  assert.equal(rt.db().requests[0].syncState, 'synced');
  assert.equal(rt.db().notifications.filter((n) => n.type === 'reschedule_request' && n.profile_id === ROWENA).length, 1);
  assert.equal(rt.core.flushQueue().requests, 0);
  assert.equal(rt.db().notifications.filter((n) => n.type === 'reschedule_request' && n.profile_id === ROWENA).length, 1, 'no duplicate');
  rt.auth.signInAs(ROWENA);
  assert.equal(sel.requestsOf(rt.state(), viewer(rt)).length, 1);
});

test('requests follow the access rules: a patient sees her own, a barangay account its barangay\'s, a super account all', () => {
  const rt = as();
  rt.requests.requestBarangayChange({ barangay_id: 'papaya' });
  rt.auth.signInAs('shiela-marie-aguila'); // another patient of the same barangay
  assert.equal(sel.requestsOf(rt.state(), viewer(rt)).length, 0);
  rt.auth.signInAs('nora-marasigan'); // another barangay
  assert.equal(sel.requestsOf(rt.state(), viewer(rt)).length, 0);
  rt.auth.signInAs(LOURDES);
  assert.equal(sel.requestsOf(rt.state(), viewer(rt)).length, 1);
  rt.auth.signInAs(CYNTHIA);
  assert.equal(sel.requestsOf(rt.state(), viewer(rt)).length, 1);
});

// ---------- Devices from Profile (PAT-P-05) ----------

test('unpairing frees the device, deletes the row and keeps her readings; it can be paired again', () => {
  const rt = as();
  const belt = rt.db().devices.find((d) => d.patient_id === MARICEL && d.type === 'belt');
  const sessions = rt.db().check_sessions.length;
  const result = rt.devices.unpair(belt.serial);
  assert.equal(result.ok, true);
  assert.equal(rt.db().devices.some((d) => d.serial === belt.serial), false);
  assert.equal(rt.db().check_sessions.length, sessions, 'past readings stay');
  assert.deepEqual([rt.state().hardware[belt.serial].bound_patient_id, rt.state().hardware[belt.serial].advertising, rt.state().hardware[belt.serial].connected], [null, true, false]);
  assert.equal(sel.devicesOf(rt.state(), viewer(rt), MARICEL).length, 1, 'her band is untouched');
  assert.equal(rt.devices.pair(belt.serial).ok, true, 'back in the chooser, and hers again');
  assert.equal(rt.db().devices.filter((d) => d.serial === belt.serial).length, 1);
});

test('a free device can be paired after another patient unpaired it, and then nobody else can take it', () => {
  const rt = as();
  const belt = rt.db().devices.find((d) => d.patient_id === MARICEL && d.type === 'belt');
  rt.devices.unpair(belt.serial);
  rt.auth.signInAs('shiela-marie-aguila');
  assert.equal(rt.devices.pair(belt.serial).ok, true);
  rt.auth.signInAs(MARICEL);
  assert.equal(rt.devices.pair(belt.serial).ok, false, 'it is bound to Shiela now');
  assert.equal(rt.db().devices.find((d) => d.serial === belt.serial).patient_id, 'shiela-marie-aguila');
});

test('unpairing is refused offline, while a check runs, and while its checks wait to upload; and never for another patient\'s device', () => {
  const rt = as();
  const belt = rt.db().devices.find((d) => d.patient_id === MARICEL && d.type === 'belt');
  const other = rt.db().devices.find((d) => d.patient_id === 'rosalinda-ramos' && d.type === 'belt');
  assert.equal(rt.devices.unpair(other.serial).error, 'not_found');
  assert.equal(rt.devices.unpair('nothing').error, 'not_found');
  rt.setConnection('offline');
  assert.equal(rt.devices.unpair(belt.serial).error, 'offline');
  rt.setConnection('online');
  rt.bridge.startCheck(MARICEL);
  assert.equal(rt.devices.unpair(belt.serial).error, 'busy');
  rt.sched.flush();
  rt.setConnection('offline');
  rt.bridge.startCheck(MARICEL);
  rt.sched.flush();
  rt.core.commit([{ op: 'meta', patch: { connection: 'online' } }]); // online again, queue not yet sent
  assert.equal(rt.devices.unpair(belt.serial).error, 'waiting_to_sync');
  rt.core.flushQueue();
  assert.equal(rt.devices.unpair(belt.serial).ok, true);
  assert.equal(rt.devices.unpair(belt.serial).error, 'not_found', 'already gone');
});

test('a barangay or a super account cannot unpair a patient\'s device', () => {
  for (const id of [LOURDES, ROWENA]) {
    const rt = as(id);
    const belt = rt.db().devices.find((d) => d.patient_id === MARICEL && d.type === 'belt');
    assert.equal(rt.devices.unpair(belt.serial).error, 'not_found');
    assert.ok(rt.db().devices.some((d) => d.serial === belt.serial));
  }
});

// ---------- Settings (PAT-P-05, PAT-A-06, COM-04) ----------

test('the Hele question-logging switch is off until she turns it on, records version and time, and records the withdrawal', () => {
  const rt = as();
  assert.equal(sel.heleLoggingOf(rt.state(), viewer(rt)), false);
  assert.deepEqual(rt.profile.setHeleLogging(false), { ok: true, on: false }, 'off when already off changes nothing');
  assert.equal(rt.db().consents.filter((c) => c.document === 'hele_question_logging').length, 0);
  rt.profile.setHeleLogging(true);
  const row = () => rt.db().consents.find((c) => c.profile_id === MARICEL && c.document === 'hele_question_logging');
  assert.deepEqual([row().version, row().accepted_at, row().withdrawn_at], ['1.0', NOW, null]);
  assert.equal(sel.heleLoggingOf(rt.state(), viewer(rt)), true);
  rt.setClock(NOW + MS_DAY);
  rt.profile.setHeleLogging(false);
  assert.equal(row().withdrawn_at, NOW + MS_DAY);
  assert.equal(sel.heleLoggingOf(rt.state(), viewer(rt)), false);
  rt.profile.setHeleLogging(true);
  assert.equal(rt.db().consents.filter((c) => c.document === 'hele_question_logging').length, 1, 'one record, turned on again');
  assert.equal(row().withdrawn_at, null);
  assert.equal(sel.consentRecordsOf(rt.state(), viewer(rt)).terms.version, '1.0', 'the terms are still on record');
});

test('consent review lists the terms with version and time, and a minor\'s guardian form', () => {
  const rt = as('cherry-mae-dalisay');
  const records = sel.consentRecordsOf(rt.state(), viewer(rt));
  assert.equal(records.terms.document, 'terms_privacy');
  assert.ok(records.terms.accepted_at > 0);
  assert.equal(records.guardian.guardian_name, 'Luzviminda Dalisay');
  assert.equal(sel.consentRecordsOf(as().state(), viewer(as())).guardian, null, 'an adult has none');
});

test('notifications off removes the subscription and shows the reminder; on brings it back', () => {
  const rt = as();
  const actions = createActions(rt, { delay: instant });
  assert.equal(sel.pushStateOf(rt.state(), MARICEL), 'allowed');
  actions.disable_push();
  assert.equal(sel.pushStateOf(rt.state(), MARICEL), 'declined');
  assert.equal(rt.db().push_subscriptions.some((s) => s.profile_id === MARICEL), false);
  assert.equal(sel.accessGate(rt.state()).step, null, 'turning it off does not send her back to the push screen');
  rt.alerts.allowPush();
  assert.equal(sel.pushStateOf(rt.state(), MARICEL), 'allowed');
});

test('changing the password from Settings needs the current one and the connection', async () => {
  const rt = as();
  const actions = createActions(rt, { delay: instant });
  assert.deepEqual(await actions.change_password({ current: 'wrong-one', password: 'Brand-new-9' }), { ok: false, error: 'form', errors: { current: 'wrong' } });
  assert.equal((await actions.change_password({ current: 'NurtureLink2026!', password: 'short' })).errors.password, 'weak');
  rt.setConnection('offline');
  assert.equal((await actions.change_password({ current: 'NurtureLink2026!', password: 'Brand-new-9' })).error, 'offline');
  rt.setConnection('online');
  assert.deepEqual(await actions.change_password({ current: 'NurtureLink2026!', password: 'Brand-new-9' }), { ok: true });
  assert.equal(rt.db().credentials.find((c) => c.id === MARICEL).password, 'Brand-new-9');
  assert.equal((await actions.change_password({ password: 'Another-one-7' })).ok, true, 'the first-login change still asks for no current password');
});

test('the profile actions wait like a network call, and the photo and switches answer at once', async () => {
  const rt = as();
  let waited = 0;
  const actions = createActions(rt, { delay: async () => { waited += 1; } });
  await actions.save_personal(VALID);
  await actions.request_barangay_change({ barangay_id: 'papaya' });
  await actions.request_reschedule({ appointment_id: upcoming(rt).id, reason: 'Work' });
  await actions.unpair_device(rt.db().devices.find((d) => d.patient_id === MARICEL && d.type === 'band').serial);
  assert.equal(waited, 4);
  actions.set_photo({ avatar_art: 'chat' });
  actions.set_hele_logging(true);
  assert.equal(waited, 4);
});

test('a reset brings back the seed: no requests, no queued edit, schema version 3', () => {
  const rt = as();
  rt.requests.requestBarangayChange({ barangay_id: 'papaya' });
  rt.profile.savePersonal(VALID);
  rt.reset();
  assert.equal(rt.db().requests.length, 0);
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).contact_no, '0917 555 0201');
  assert.equal(rt.state().schemaVersion, 3);
});

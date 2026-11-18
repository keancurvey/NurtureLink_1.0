import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRuntime } from './helpers.js';
import { createActions } from '../src/store/actions.js';
import { nearbyDevices } from '../src/store/devices.js';
import * as sel from '../src/store/selectors.js';

const SHIELA = 'shiela-marie-aguila';
const FREE_BELT = 'NLB-2026-0555';
const FREE_BAND = 'NLW-2026-0555';
const BOUND_BELT = 'NLB-2026-0099'; // Rosalinda Ramos's belt

function signedIn(id = SHIELA) {
  const rt = makeRuntime();
  assert.equal(rt.auth.signInAs(id).ok, true);
  return rt;
}
const rowsOf = (rt, id = SHIELA) => rt.db().devices.filter((d) => d.patient_id === id);

test('the chooser lists the free belt and the belt bound to someone else, by advertised name (AUTH-07)', () => {
  const rt = signedIn();
  const belts = nearbyDevices(rt.state(), SHIELA, 'belt');
  assert.deepEqual(belts.map((b) => b.name), ['NL-BELT-0099', 'NL-BELT-0555']);
  assert.deepEqual(nearbyDevices(rt.state(), SHIELA, 'band').map((b) => b.name), ['NL-BAND-0555']);
});

test('reading the device gives its serial, model and firmware, and links a free device', () => {
  const rt = signedIn();
  const result = rt.devices.readInfo(FREE_BELT);
  assert.equal(result.ok, true);
  assert.deepEqual([result.info.serial, result.info.model, result.info.fw_version], [FREE_BELT, 'NurtureLink belt', '1.2.0']);
  assert.equal(rt.state().hardware[FREE_BELT].connected, true);
  assert.equal(rt.devices.readInfo('NLB-2026-9999').error, 'not_found');
});

test('pairing binds the serial to the patient: a device record, the device side and a connected link', () => {
  const rt = signedIn();
  rt.devices.readInfo(FREE_BELT);
  const paired = rt.devices.pair(FREE_BELT);
  assert.equal(paired.ok, true);
  const row = rowsOf(rt).find((d) => d.type === 'belt');
  assert.deepEqual([row.serial, row.name, row.model, row.link_state, row.battery_pct, row.last_seq], [FREE_BELT, 'NL-BELT-0555', 'NurtureLink belt', 'connected', 88, 0]);
  assert.equal(row.exposure_left_s, 360);
  assert.equal(rt.state().hardware[FREE_BELT].bound_patient_id, SHIELA);
  assert.equal(rt.state().hardware[FREE_BELT].clock_synced, true, 'the clock was set');
  assert.equal(rt.db().device_status_log.filter((l) => l.device_id === row.id).length >= 1, true);
  assert.deepEqual(nearbyDevices(rt.state(), SHIELA, 'belt').map((b) => b.name), ['NL-BELT-0099'], 'her own belt is no longer offered');
});

test('a device already bound to another patient is refused and nothing changes (spec 10)', () => {
  const rt = signedIn();
  const before = rt.db().devices.length;
  const result = rt.devices.pair(BOUND_BELT);
  assert.deepEqual(result, { ok: false, error: 'already_bound' });
  assert.equal(rt.db().devices.length, before);
  assert.equal(rt.state().hardware[BOUND_BELT].bound_patient_id, 'rosalinda-ramos');
  assert.equal(rowsOf(rt, 'rosalinda-ramos').filter((d) => d.serial === BOUND_BELT).length, 1);
  assert.equal(rt.state().hardware[BOUND_BELT].connected, true, 'her link is not touched');
});

test('one belt and one band per patient: a second belt is refused', () => {
  const rt = signedIn();
  assert.equal(rt.devices.pair(FREE_BELT).ok, true);
  assert.equal(rt.devices.pair(BOUND_BELT).error, 'already_bound');
});

test('only a signed-in patient can pair or connect, and only for herself', () => {
  const rt = makeRuntime();
  assert.equal(rt.devices.pair(FREE_BELT).error, 'not_found', 'signed out');
  rt.auth.signInAs('lourdes-magpantay');
  assert.equal(rt.devices.pair(FREE_BELT).error, 'not_found', 'a barangay account');
  assert.equal(rt.devices.connect('NLB-2026-0412').ok, false);
  rt.auth.signInAs(SHIELA);
  assert.equal(rt.devices.connect('NLB-2026-0412').ok, false, "not Maricel's belt");
  assert.equal(rt.devices.startCheck().started, false);
});

test('leaving the wizard lets go of a device that was linked but not paired; its owner keeps hers', () => {
  const rt = signedIn();
  rt.devices.readInfo(FREE_BAND);
  assert.equal(rt.state().hardware[FREE_BAND].connected, true);
  rt.devices.release(FREE_BAND);
  assert.equal(rt.state().hardware[FREE_BAND].connected, false);
  assert.equal(rt.state().hardware[FREE_BAND].advertising, true, 'it advertises again');
  assert.deepEqual(nearbyDevices(rt.state(), SHIELA, 'band').map((b) => b.name), ['NL-BAND-0555']);
  rt.devices.release(BOUND_BELT);
  assert.equal(rt.state().hardware[BOUND_BELT].connected, true);
});

test('the wizard is shown once: a patient with no devices lands on it, then on Home (AUTH-07)', () => {
  const rt = signedIn();
  assert.equal(sel.needsPairing(rt.state(), SHIELA), true);
  assert.equal(sel.accessTarget(rt.state()), '/patient/pair');
  rt.devices.markPairingSeen();
  assert.equal(sel.needsPairing(rt.state(), SHIELA), false);
  assert.equal(sel.accessTarget(rt.state()), '/patient/home');
  const maricel = signedIn('maricel-dimaculangan');
  assert.equal(sel.accessTarget(maricel.state()), '/patient/home', 'she has devices');
  const lourdes = signedIn('lourdes-magpantay');
  assert.equal(sel.accessTarget(lourdes.state()), '/barangay/monitor');
});

test('Shiela pairs a belt and a band, then runs a check that is saved, uploaded and verified', () => {
  const rt = signedIn();
  assert.equal(rt.devices.startCheck().reason, 'no_belt');
  assert.equal(rt.devices.pair(FREE_BELT).ok, true);
  assert.equal(rt.devices.pair(FREE_BAND).ok, true);
  assert.equal(rowsOf(rt).length, 2);
  const outcome = rt.devices.startCheck();
  assert.equal(outcome.started, true);
  assert.equal(rt.state().live.check.phase, 'starting');
  rt.sched.flush();
  assert.equal(rt.state().live.check.phase, 'complete');
  const session = sel.latestCheck(rt.state(), sel.viewerOf(rt.state()), SHIELA);
  assert.equal(session.syncState, 'synced');
  assert.deepEqual([session.belt_serial, session.band_serial, session.summary.unverified], [FREE_BELT, FREE_BAND, false]);
  assert.ok(session.summary.fhr_bpm >= 140 && session.summary.fhr_bpm <= 148);
  assert.equal(rowsOf(rt).find((d) => d.type === 'belt').exposure_left_s, 240, 'the belt told the app how much allowance is left');
});

test('a belt without a band gives an unverified check (PAT-H-05)', () => {
  const rt = signedIn();
  rt.devices.pair(FREE_BELT);
  assert.equal(rt.devices.startCheck().started, true);
  rt.sched.flush();
  const session = sel.latestCheck(rt.state(), sel.viewerOf(rt.state()), SHIELA);
  assert.equal(session.summary.unverified, true);
  assert.equal(session.band_serial, null);
});

test('Check now refuses, with the reason, when the rule says so; the exposure cap comes from the belt itself', () => {
  const rt = signedIn('maricel-dimaculangan');
  const maricelBelt = 'NLB-2026-0412';
  rt.control.fillExposure(maricelBelt);
  assert.equal(rt.db().devices.find((d) => d.serial === maricelBelt).exposure_left_s, 0);
  assert.equal(rt.devices.startCheck().reason, 'exposure_cap');
  rt.control.setBattery('NLW-2026-0412', 4);
  assert.equal(rt.devices.startCheck().reason, 'cutoff');
  assert.equal(rt.devices.startCheck().device, 'band');
});

test('closing a result or failure removes it from the screen; a running check is left alone', () => {
  const rt = signedIn('maricel-dimaculangan');
  assert.equal(rt.devices.startCheck().started, true);
  rt.devices.dismissCheck();
  assert.ok(rt.state().live.check, 'still running');
  assert.equal(rt.devices.startCheck().reason, 'busy');
  rt.sched.flush();
  assert.equal(rt.state().live.check.phase, 'complete');
  rt.devices.dismissCheck();
  assert.equal(rt.state().live.check, null);
});

test('the screens call these through actions that name what they do', async () => {
  const rt = signedIn();
  const actions = createActions(rt, { delay: async () => {} });
  const info = await actions.read_device(FREE_BELT);
  assert.equal(info.ok, true);
  assert.equal((await actions.pair_device(BOUND_BELT)).error, 'already_bound');
  assert.equal((await actions.pair_device(FREE_BELT)).ok, true);
  assert.equal(actions.start_check().started, true);
  actions.stop_check();
  assert.equal(rt.state().live.check.phase, 'failed');
  assert.equal(rt.state().live.check.reason, 'stopped');
  actions.dismiss_check();
  assert.equal(rt.state().live.check, null);
});

test('a check made offline waits on the phone, and uploads once when the connection returns (COM-05, PAT-H-06)', () => {
  const rt = signedIn('maricel-dimaculangan');
  const sessions = () => rt.db().check_sessions.filter((s) => s.patient_id === 'maricel-dimaculangan');
  const before = sessions().length;
  rt.setConnection('offline');
  assert.equal(rt.devices.startCheck().started, true, 'the belt and the phone do not need the internet');
  rt.sched.flush();
  assert.equal(sessions().length, before + 1);
  assert.equal(sessions().at(-1).syncState, 'queued');
  const viewer = sel.viewerOf(rt.state());
  assert.equal(sel.waitingToSync(rt.state(), viewer, 'maricel-dimaculangan'), 1);
  rt.setConnection('online');
  rt.sched.flush();
  assert.equal(sessions().length, before + 1, 'no duplicate');
  assert.equal(sessions().at(-1).syncState, 'synced');
  assert.equal(sel.waitingToSync(rt.state(), viewer, 'maricel-dimaculangan'), 0);
});

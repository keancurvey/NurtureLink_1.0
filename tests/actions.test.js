import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { createActions } from '../src/store/actions.js';
import { LATENCY_MS, latency, latencyMs } from '../src/lib/latency.js';
import { createSeed } from '../src/sim/seed.js';

const waits = [];
const instant = async () => { waits.push(1); };
const actionsFor = (rt) => createActions(rt, { delay: instant });

test('the wait is between 250 and 700 ms', async () => {
  assert.deepEqual([LATENCY_MS.min, LATENCY_MS.max], [250, 700]);
  assert.equal(latencyMs(() => 0), 250);
  assert.equal(latencyMs(() => 1), 700);
  assert.equal(latencyMs(() => 0.5), 475);
  const started = Date.now();
  await latency(() => 0);
  assert.ok(Date.now() - started >= 240, 'it really waits');
});

test('every action waits before it works, and answers afterwards', async () => {
  const rt = makeRuntime();
  const actions = actionsFor(rt);
  waits.length = 0;
  let worked = false;
  const slow = createActions(rt, { delay: async () => { assert.equal(worked, false, 'the wait comes first'); } });
  const told = await slow.send_push({ recipients: [MARICEL], type: 'message', payload: { conversation_id: 'x' } });
  worked = true;
  assert.equal(told.length, 1);
  await actions.flush_queue();
  assert.equal(waits.length, 1);
});

test('send_push (spec 7.4) puts one notification in each recipient\'s inbox', async () => {
  const rt = makeRuntime();
  const before = rt.db().notifications.length;
  const rows = await actionsFor(rt).send_push({ recipients: [MARICEL, 'lourdes-magpantay', MARICEL], type: 'event_reminder', payload: { event_id: 'e1' } });
  assert.equal(rows.length, 2, 'a recipient listed twice is told once');
  assert.equal(rt.db().notifications.length, before + 2);
  assert.ok(rows.every((n) => n.read_at === null && n.type === 'event_reminder'));
});

test('flush_queue uploads what was made offline, then reports it', async () => {
  const rt = makeRuntime();
  rt.setConnection('offline');
  rt.bridge.startCheck(MARICEL);
  rt.sched.flush();
  const queued = () => rt.db().check_sessions.filter((s) => s.syncState === 'queued').length;
  assert.equal(queued(), 1);
  rt.core.commit([{ op: 'meta', patch: { connection: 'online' } }]); // back online without the automatic upload
  const result = await actionsFor(rt).flush_queue();
  assert.equal(result.checks, 1);
  assert.equal(queued(), 0);
});

test('ingest_readings (spec 7.4) rejects a device that belongs to another patient and removes duplicates', async () => {
  const rt = makeRuntime();
  rt.bridge.startCheck(MARICEL);
  rt.sched.flush();
  const session = rt.db().check_sessions.filter((s) => s.patient_id === MARICEL).at(-1);
  const fetal = rt.db().fetal_readings.filter((r) => r.session_id === session.id);
  const actions = actionsFor(rt);
  const again = await actions.ingest_readings({ patient_id: MARICEL, checks: [{ session, fetal, maternal: [] }] });
  assert.equal(again.duplicates, 1, 'the same check is not stored twice');
  const stolen = await actions.ingest_readings({
    patient_id: 'rosalinda-ramos',
    checks: [{ session: { ...session, id: 'chk_x', client_id: 'other', patient_id: 'rosalinda-ramos' }, fetal: [], maternal: [] }],
  });
  assert.equal(stolen.rejected, 1, 'data from a belt bound to someone else is refused');
});

test('reset_data brings back the starting records and signs out', async () => {
  const rt = makeRuntime();
  rt.setSession({ profile_id: MARICEL });
  rt.engine.start('sos-pressed', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  rt.setTiming('realistic');
  await actionsFor(rt).reset_data();
  assert.equal(rt.state().session, null);
  assert.equal(rt.state().meta.timing, 'quick');
  assert.deepEqual(rt.state().db, createSeed({ now: NOW }).db);
});

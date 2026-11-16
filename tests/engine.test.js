import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/sim/engine.js';
import { createScheduler } from '../src/sim/scheduler.js';
import { createStore } from '../src/store/store.js';
import { createCore } from '../src/store/core.js';
import { createSeed } from '../src/sim/seed.js';
import { MARICEL, NOW, makeRuntime } from './helpers.js';
import { SCENARIOS, SCENARIO_IDS } from '../src/sim/scenarios.js';
import { gearConfigFor } from '../src/lib/permissions.js';

/** An engine over a real store and server core but made-up scenarios, to test the mechanics alone. */
function makeEngine(scenarios, { speed = 1, onError = (e) => { throw e; } } = {}) {
  const store = createStore({ ...createSeed({ now: NOW }), session: null });
  const delays = [];
  const sched = createScheduler({ getSpeed: () => speed, setTimer: (fn, ms) => { delays.push(ms); return delays.length; }, clearTimer: () => {}, onError });
  const core = createCore({ store, now: () => NOW });
  const log = [];
  const engine = createEngine({ store, core, sched, bridge: { reset() { log.push('bridge.reset'); } }, link: {}, control: { settle() { log.push('settle'); } }, scenarios, now: () => NOW });
  const events = [];
  engine.subscribe((e) => events.push(e));
  return { store, sched, core, engine, events, delays, log };
}
const scenario = (id, steps, summary = () => ({ key: `done.${id}`, values: {} })) => ({ id, group: 'checks', labelKey: `label.${id}`, steps: () => steps, summary });

test('steps run in order with their waits; the run is stored while it lasts and cleared when it ends', () => {
  const order = [];
  const { engine, sched, store, events } = makeEngine([
    scenario('three', [
      { run: () => order.push('a') },
      { after: 5000, run: () => order.push('b') },
      { after: 7000, run: () => order.push('c') },
    ]),
  ]);
  engine.start('three', { patientId: 'p' });
  assert.deepEqual(order, ['a']);
  assert.deepEqual(store.getState().meta.run, { scenarioId: 'three', params: { patientId: 'p' }, stepIndex: 0 });
  assert.equal(engine.isRunning(), true);
  assert.deepEqual(engine.describe(), { scenarioId: 'three', labelKey: 'label.three', params: { patientId: 'p' }, stepIndex: 0 });
  sched.advance(5000);
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(store.getState().meta.run.stepIndex, 1);
  sched.advance(6999);
  assert.deepEqual(order, ['a', 'b']);
  sched.advance(1);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(store.getState().meta.run, null);
  assert.equal(engine.isRunning(), false);
  assert.equal(engine.describe(), null);
  assert.deepEqual(events.map((e) => e.type), ['started', 'finished']);
  assert.deepEqual(events[1].summary, { key: 'done.three', values: {} });
});

test('a one-step scenario starts and finishes at once and is never stored as running', () => {
  const { engine, store, events } = makeEngine([scenario('one', [{ run() {} }])]);
  engine.start('one');
  assert.equal(store.getState().meta.run, null);
  assert.equal(engine.isRunning(), false);
  assert.deepEqual(events.map((e) => e.type), ['started', 'finished']);
});

test('finishing now runs every remaining step in order, at once', () => {
  const order = [];
  const { engine, sched, store } = makeEngine([
    scenario('long', [{ run: () => order.push(1) }, { after: 60000, run: () => order.push(2) }, { after: 60000, run: () => order.push(3) }]),
  ]);
  engine.start('long');
  assert.deepEqual(order, [1]);
  engine.finishNow();
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(store.getState().meta.run, null);
  assert.equal(sched.size(), 0);
});

test('only one run at a time: starting another run is refused until the first is finished', () => {
  const { engine } = makeEngine([
    scenario('a', [{ run() {} }, { after: 1000, run() {} }]),
    scenario('b', [{ run() {} }, { after: 1000, run() {} }]),
  ]);
  engine.start('a');
  assert.throws(() => engine.start('b'), /in progress/);
  engine.finishNow();
  assert.doesNotThrow(() => engine.start('b'));
  assert.throws(() => engine.start('nope'), /Unknown scenario/);
});

test('an instant scenario can happen in the middle of a run, and leaves the run alone', () => {
  const order = [];
  const { engine, store, events } = makeEngine([
    scenario('long', [{ run: () => order.push('long-1') }, { after: 5000, run: () => order.push('long-2') }]),
    scenario('toggle', [{ run: () => order.push('toggle') }]),
    scenario('wait', [{ until: () => true }]),
  ]);
  assert.equal(engine.isInstant('toggle'), true);
  assert.equal(engine.isInstant('long'), false);
  assert.equal(engine.isInstant('wait'), false, 'a waiting step is not instant');
  assert.equal(engine.isInstant('nope'), false);
  engine.start('long');
  engine.start('toggle');
  assert.deepEqual(order, ['long-1', 'toggle']);
  assert.equal(store.getState().meta.run.scenarioId, 'long', 'the run is still the one in progress');
  assert.equal(engine.isRunning(), true);
  engine.finishNow();
  assert.deepEqual(order, ['long-1', 'toggle', 'long-2']);
  assert.deepEqual(events.filter((e) => e.type === 'finished').map((e) => e.scenarioId), ['toggle', 'long']);
});

test('an instant scenario that throws reports it and does not disturb a run', () => {
  const { engine, events, store } = makeEngine([
    scenario('long', [{ run() {} }, { after: 5000, run() {} }]),
    scenario('bad', [{ run() { throw new Error('nope'); } }]),
  ]);
  engine.start('long');
  assert.doesNotThrow(() => engine.start('bad'));
  assert.equal(events.at(-1).type, 'failed');
  assert.equal(store.getState().meta.run.scenarioId, 'long');
});

test('Quick shortens the waits by the speed; a real-time wait is not shortened', () => {
  const quick = makeEngine([scenario('w', [{ run() {} }, { after: 30000, run() {} }, { after: 60000, scale: false, run() {} }])], { speed: 3 });
  quick.engine.start('w');
  assert.deepEqual(quick.delays, [10000]);
  quick.sched.advance(30000);
  assert.deepEqual(quick.delays, [10000, 60000]);
  const realistic = makeEngine([scenario('w', [{ run() {} }, { after: 30000, run() {} }, { after: 60000, scale: false, run() {} }])], { speed: 1 });
  realistic.engine.start('w');
  realistic.sched.advance(30000);
  assert.deepEqual(realistic.delays, [30000, 60000]);
});

test('a waiting step checks again and again until its condition holds, then the run goes on', () => {
  const order = [];
  let ready = false;
  const { engine, sched, delays } = makeEngine([
    scenario('wait', [
      { run: () => order.push('start') },
      { until: () => ready, every: 400 },
      { run: () => order.push('after') },
    ]),
  ]);
  engine.start('wait');
  assert.deepEqual(order, ['start']);
  sched.advance(2000);
  assert.deepEqual(order, ['start'], 'still waiting');
  assert.ok(delays.filter((ms) => ms === 400).length >= 4, 'it looked more than once');
  ready = true;
  sched.advance(400);
  assert.deepEqual(order, ['start', 'after']);
  assert.equal(engine.isRunning(), false);
});

test('a waiting step gives up at its limit instead of holding the run for ever', () => {
  const order = [];
  const { engine, sched } = makeEngine([scenario('limit', [{ until: () => false, every: 500, limit: 2000 }, { run: () => order.push('after') }])]);
  engine.start('limit');
  sched.advance(1999);
  assert.deepEqual(order, []);
  sched.advance(2);
  assert.deepEqual(order, ['after']);
});

test('finishing now ends a waiting step once its condition is true, in time order with the rest', () => {
  let ticks = 0;
  const { engine, sched, store } = makeEngine([
    scenario('flush', [
      { run: (ctx) => { ctx.sched.after(5000, () => { ticks += 1; }); ctx.sched.after(9000, () => { ticks += 1; }); } },
      { until: () => ticks >= 2, every: 500 },
    ]),
  ]);
  engine.start('flush');
  engine.finishNow();
  assert.equal(ticks, 2);
  assert.equal(store.getState().meta.run, null);
  assert.equal(sched.size(), 0);
});

test('a waiting step that throws ends the run cleanly', () => {
  const { engine, events, store } = makeEngine([scenario('badwait', [{ until: () => { throw new Error('nope'); } }])]);
  engine.start('badwait');
  assert.equal(events.at(-1).type, 'failed');
  assert.equal(store.getState().meta.run, null);
});

test('a wait can depend on what the earlier steps found', () => {
  const { engine, delays } = makeEngine([
    scenario('dyn', [{ run: (ctx) => { ctx.result.n = 7; } }, { after: (ctx) => ctx.result.n * 1000, run() {} }]),
  ]);
  engine.start('dyn');
  assert.deepEqual(delays, [7000]);
});

test('a step that throws ends the run cleanly and says so', () => {
  const { engine, store, events } = makeEngine([scenario('bad', [{ run() {} }, { after: 100, run() { throw new Error('boom'); } }])]);
  engine.start('bad');
  engine.finishNow();
  assert.equal(store.getState().meta.run, null);
  assert.equal(engine.isRunning(), false);
  assert.equal(events.at(-1).type, 'failed');
  assert.equal(events.at(-1).error.message, 'boom');
  assert.doesNotThrow(() => engine.start('bad'), 'a new run can start');
});

test('after a reload the run picks up at the step it was on and finishes at once', () => {
  const order = [];
  const scenarios = [scenario('r', [{ run: () => order.push('a') }, { after: 9000, run: () => order.push('b') }, { after: 9000, run: () => order.push('c') }])];
  const first = makeEngine(scenarios);
  first.engine.start('r', { patientId: 'x' });
  first.sched.advance(9000);
  assert.deepEqual(order, ['a', 'b']);
  const stored = first.store.getState().meta.run;
  assert.equal(stored.stepIndex, 1);

  // a new page: the stored state carries the run, the timers are gone
  const second = makeEngine(scenarios);
  second.store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { run: stored } }] });
  order.length = 0;
  assert.equal(second.engine.resume(), true);
  assert.deepEqual(order, ['b', 'c'], 'the step that was running runs again, then the rest');
  assert.equal(second.store.getState().meta.run, null);
  assert.deepEqual(second.log, ['settle', 'bridge.reset'], 'devices settle and nothing stays in flight');
  assert.equal(second.events.at(-1).type, 'finished');
  assert.equal(second.engine.resume(), false, 'nothing left to resume');
});

test('after a reload a waiting step starts again from the step that began what it was waiting for', () => {
  const order = [];
  const scenarios = [scenario('w', [{ run: () => order.push('before') }, { run: () => order.push('start') }, { until: () => true }, { until: () => true }, { run: () => order.push('end') }])];
  const { engine, store } = makeEngine(scenarios);
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { run: { scenarioId: 'w', params: {}, stepIndex: 3 } } }] });
  assert.equal(engine.resume(), true);
  assert.deepEqual(order, ['start', 'end'], 'from the step before the waits, not from the wait');
});

test('a stored run of a scenario that no longer exists is dropped', () => {
  const { engine, store } = makeEngine([scenario('x', [{ run() {} }])]);
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { run: { scenarioId: 'gone', params: {}, stepIndex: 1 } } }] });
  assert.equal(engine.resume(), false);
  assert.equal(store.getState().meta.run, null);
});

test('stopping (a reset) forgets the run and cancels everything waiting', () => {
  const order = [];
  const { engine, sched } = makeEngine([scenario('s', [{ run: () => order.push(1) }, { after: 1000, run: () => order.push(2) }])]);
  engine.start('s');
  engine.stop();
  engine.finishNow();
  assert.equal(sched.size(), 0);
  assert.deepEqual(order, [1]);
});

test('the catalog: every scenario the gear can offer exists, and every scenario has a label and a summary', () => {
  assert.equal(new Set(SCENARIO_IDS).size, SCENARIO_IDS.length, 'ids are unique');
  for (const role of ['patient', 'barangay', 'super']) {
    for (const ids of Object.values(gearConfigFor(role).groups)) {
      for (const id of ids) assert.ok(SCENARIO_IDS.includes(id), `${role}: ${id}`);
    }
  }
  for (const s of SCENARIOS) {
    assert.match(s.labelKey, /^presenter:scenario\./);
    assert.equal(typeof s.steps, 'function');
    assert.equal(typeof s.summary, 'function');
    assert.ok(['checks', 'alerts', 'devices', 'consult'].includes(s.group), s.id);
  }
  const offered = new Set(['patient', 'barangay', 'super'].flatMap((role) => Object.values(gearConfigFor(role).groups).flat()));
  const hidden = SCENARIO_IDS.filter((id) => !offered.has(id));
  assert.deepEqual(hidden.sort(), ['checks-while-apart', 'device-battery', 'device-charging', 'device-connection', 'exposure-cap'], 'only the Devices section scenarios are offered by their own controls');
});

test('the runtime builds with the real catalog and a run can be started and finished', () => {
  const rt = makeRuntime();
  rt.engine.start('check-normal', { patientId: MARICEL });
  assert.equal(rt.engine.isRunning(), true);
  rt.engine.finishNow();
  assert.equal(rt.engine.isRunning(), false);
  assert.equal(rt.failed().length, 0);
});

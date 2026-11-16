// The scenario engine (PLAN.md Section 6). A scenario is data plus steps; a run executes the steps in order on the shared
// scheduler, so the Quick timing shortens the waits and `finishNow` runs whatever is left at once. The step a run has
// reached is stored (meta.run), so a reload in the middle of a run finishes it at once instead of losing it, and a run
// goes on when the account is switched or signed out: only a reset stops it.
import { escalationMs } from '../lib/alertRules.js';

/**
 * scenario: { id, group, labelKey, steps(ctx) -> [step], summary(ctx) -> { key, values } }
 *   step   { after?, scale?, run(ctx) } does something, or { after?, until(ctx), every?, limit? } waits for something
 *   after  device-time wait before the step (a number, or a function of ctx); scale: false keeps it in real time
 *   until  checked every `every` ms of device time (default 500) until it is true or `limit` (default 5 minutes) is up
 * Steps must be safe to run twice: after a reload the step that was running is run again.
 */
export function createEngine({ store, core, sched, bridge, link, control, scenarios, now = Date.now }) {
  const catalog = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const listeners = new Set();
  const state = () => store.getState();
  const emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };
  let current = null;

  function createContext(scenario, params) {
    const profile = (id) => state().db.profiles.find((p) => p.id === id) ?? null;
    const ctx = {
      scenarioId: scenario.id,
      params,
      patientId: params.patientId ?? null,
      actorId: params.actorId ?? null,
      actorRole: params.actorRole ?? null,
      startedAt: now(),
      result: {}, // what the steps found out, for the summary
      now,
      state,
      core,
      bridge,
      link,
      control,
      sched,
      commit: core.commit,
      id: core.id,
      sendPush: core.sendPush,
      profile,
      devices() {
        const rows = state().db.devices.filter((d) => d.patient_id === ctx.patientId);
        return { belt: rows.find((d) => d.type === 'belt') ?? null, band: rows.find((d) => d.type === 'band') ?? null };
      },
      escalationMs: () => escalationMs(core.thresholds(), state().meta.timing),
      note: (key, values) => emit({ type: 'note', scenarioId: scenario.id, key, values }),
    };
    return ctx;
  }

  function makeRun(scenarioId, params) {
    const scenario = catalog.get(scenarioId);
    if (!scenario) return null;
    const ctx = createContext(scenario, params);
    return { scenario, params, ctx, steps: scenario.steps(ctx) };
  }

  const setStored = (run, stepIndex) => {
    if (run.steps.length > 1) core.commit([{ op: 'meta', patch: { run: { scenarioId: run.scenario.id, params: run.params, stepIndex } } }]);
  };

  function finish(run) {
    if (current === run) current = null;
    if (run.steps.length > 1) core.commit([{ op: 'meta', patch: { run: null } }]);
    emit({ type: 'finished', scenarioId: run.scenario.id, params: run.params, summary: run.scenario.summary(run.ctx) });
  }

  function abort(run, error) {
    if (current === run) current = null;
    core.commit([{ op: 'meta', patch: { run: null } }]);
    emit({ type: 'failed', scenarioId: run.scenario.id, params: run.params, error });
  }

  function proceed(run, index) {
    const next = run.steps[index + 1];
    if (!next) {
      finish(run);
      return;
    }
    const wait = typeof next.after === 'function' ? next.after(run.ctx) : (next.after ?? 0);
    sched.after(wait, () => execute(run, index + 1), { scale: next.scale !== false });
  }

  /** A waiting step: look again every so often until the condition holds or the limit is reached. */
  function hold(run, index, step, waited = 0) {
    if (current !== run) return;
    try {
      const every = step.every ?? 500;
      if (step.until(run.ctx) || waited >= (step.limit ?? 300000)) {
        proceed(run, index);
        return;
      }
      sched.after(every, () => hold(run, index, step, waited + every));
    } catch (error) {
      abort(run, error);
    }
  }

  function execute(run, index) {
    if (current !== run) return; // stopped or replaced
    try {
      setStored(run, index);
      const step = run.steps[index];
      if (step.until) {
        hold(run, index, step);
        return;
      }
      step.run(run.ctx);
      proceed(run, index);
    } catch (error) {
      abort(run, error);
    }
  }

  return {
    scenarios: catalog,
    has: (id) => catalog.has(id),

    /** A multi-step run is in progress (shown as "Running: ..." in the gear). */
    isRunning: () => state().meta.run !== null,

    /** What is running, or null: { scenarioId, labelKey, params, stepIndex }. */
    describe() {
      const run = state().meta.run;
      if (!run) return null;
      const scenario = catalog.get(run.scenarioId);
      return scenario ? { scenarioId: run.scenarioId, labelKey: scenario.labelKey, params: run.params, stepIndex: run.stepIndex } : null;
    },

    /** A scenario that does its work in one step (a toggle, a message) rather than over time. */
    isInstant(scenarioId, params = {}) {
      const run = makeRun(scenarioId, params);
      return Boolean(run) && run.steps.length === 1 && !run.steps[0].until;
    },

    /**
     * Start a scenario. One that works over time cannot start while another is running: the gear asks for confirmation
     * and calls finishNow() first. An instant one can happen at any time, even in the middle of a run.
     */
    start(scenarioId, params = {}) {
      const run = makeRun(scenarioId, params);
      if (!run) throw new Error(`Unknown scenario ${scenarioId}`);
      emit({ type: 'started', scenarioId, params });
      if (run.steps.length === 1 && !run.steps[0].until) {
        try {
          run.steps[0].run(run.ctx);
        } catch (error) {
          emit({ type: 'failed', scenarioId, params, error });
          return;
        }
        emit({ type: 'finished', scenarioId, params, summary: run.scenario.summary(run.ctx) });
        return;
      }
      if (state().meta.run !== null || current) throw new Error('A run is in progress');
      current = run;
      execute(run, 0);
    },

    /** Run everything that is left, at once, in the order it would have happened. */
    finishNow() {
      sched.flush();
    },

    /** After a reload: pick up the stored run where it was and finish it at once. */
    resume() {
      const saved = state().meta.run;
      if (!saved) return false;
      control.settle();
      bridge.reset();
      const run = makeRun(saved.scenarioId, saved.params);
      if (!run) {
        core.commit([{ op: 'meta', patch: { run: null } }]);
        return false;
      }
      // A waiting step only watches for what an earlier step started, and that is gone after a reload: start again from
      // the step that started it.
      let index = Math.min(saved.stepIndex, run.steps.length - 1);
      while (index > 0 && run.steps[index].until) index -= 1;
      current = run;
      execute(run, index);
      sched.flush();
      return true;
    },

    /** Reset data: forget the run and everything waiting. */
    stop() {
      current = null;
      sched.cancelAll();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

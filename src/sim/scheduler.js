// One scheduler for everything that happens "over time" in the showcase: the steps of a scenario and the packets a
// simulated device sends. Delays are device time; the Quick timing divides them by the speed. Because every task has a
// virtual due time, `flush` can run whatever is pending at once and in the same order the timers would have used,
// which is how a run is finished immediately.

export function createScheduler({ getSpeed = () => 1, setTimer = setTimeout, clearTimer = clearTimeout, onError = (error) => { throw error; } } = {}) {
  let virtualNow = 0;
  let sequence = 0;
  const pending = new Map();

  function run(task) {
    if (!pending.has(task.id)) return;
    pending.delete(task.id);
    clearTimer(task.timer);
    virtualNow = Math.max(virtualNow, task.due);
    try {
      task.fn();
    } catch (error) {
      onError(error);
    }
  }

  return {
    /**
     * Run fn after delayMs of device time. With { scale: false } the delay is real time and is not shortened by the
     * Quick timing (used for the escalation wait, which has its own Quick value).
     */
    after(delayMs, fn, { scale = true, background = false } = {}) {
      const speed = getSpeed();
      const virtualDelay = scale ? delayMs : delayMs * speed;
      const task = { id: (sequence += 1), due: virtualNow + virtualDelay, fn, timer: null, background };
      pending.set(task.id, task);
      task.timer = setTimer(() => run(task), virtualDelay / speed);
      return task.id;
    },
    cancel(id) {
      const task = pending.get(id);
      if (!task) return;
      clearTimer(task.timer);
      pending.delete(id);
    },
    cancelAll() {
      for (const task of pending.values()) clearTimer(task.timer);
      pending.clear();
    },
    /**
     * Run everything pending, in due order, including what the tasks themselves schedule. Background tasks (a repeat that
     * goes on until something stops it) are left to their own timers, so a flush always ends.
     */
    flush() {
      let guard = 0;
      while (guard < 100000) {
        guard += 1;
        const next = [...pending.values()].filter((task) => !task.background).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!next) break;
        run(next);
      }
    },
    /** Run what is due within the next ms of device time (for tests and step-by-step control). */
    advance(ms) {
      const horizon = virtualNow + ms;
      let guard = 0;
      while (guard < 100000) {
        guard += 1;
        const next = [...pending.values()].filter((task) => task.due <= horizon).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!next) break;
        run(next);
      }
      virtualNow = Math.max(virtualNow, horizon);
    },
    size: () => pending.size,
  };
}

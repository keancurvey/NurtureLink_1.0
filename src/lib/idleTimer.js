// Provider sessions end after a period without activity, with a warning shortly before (AUTH-08). The timer keeps one
// "last activity" time and checks it when a timeout is due, so a burst of taps costs nothing. Once the warning shows,
// only stay() carries on: a tap behind the warning does not count.
export function createIdleTimer({ timeoutMs, warnMs, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onWarn, onExpire }) {
  let last = now();
  let warned = false;
  let stopped = true;
  let handle = null;

  function schedule() {
    clearTimer(handle);
    const due = warned ? last + timeoutMs : last + warnMs;
    handle = setTimer(check, Math.max(0, due - now()));
  }

  function check() {
    if (stopped) return;
    const idle = now() - last;
    if (idle >= timeoutMs) {
      stopped = true;
      onExpire();
      return;
    }
    if (!warned && idle >= warnMs) {
      warned = true;
      onWarn();
    }
    schedule();
  }

  return {
    start() {
      last = now();
      warned = false;
      stopped = false;
      schedule();
    },
    /** Something happened on the page. Ignored once the warning is showing. */
    activity() {
      if (!stopped && !warned) last = now();
    },
    /** The person chose to stay signed in. */
    stay() {
      if (stopped) return;
      last = now();
      warned = false;
      schedule();
    },
    stop() {
      stopped = true;
      clearTimer(handle);
    },
    isWarning: () => warned && !stopped,
  };
}

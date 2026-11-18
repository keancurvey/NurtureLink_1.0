import { useEffect } from 'react';

/** Keeps the screen on while `active` (R-01: the app must stay open during a check). Quietly does nothing where the browser has no wake lock. */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    let lock = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.wakeLock) return;
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) await lock.release();
      } catch {
        /* the browser refused (low power mode, hidden page): the check still runs */
      }
    })();
    return () => {
      cancelled = true;
      try {
        lock?.release();
      } catch {
        /* already released */
      }
    };
  }, [active]);
}

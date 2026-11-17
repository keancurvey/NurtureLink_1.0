import { useCallback, useEffect, useRef } from 'react';

const STEP_MS = 22;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The gear's fill: types text into a form one letter at a time, so it looks like someone typing, and leaves the button
 * for the person to tap. steps: [{ set(text), value, instant? }]. Dates and choices are set at once. Stops if the screen
 * goes away. Returns a function that resolves when everything is typed.
 */
export function useTypingFill() {
  const alive = useRef(true);
  const timers = useRef(new Set());

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const wait = useCallback(
    (ms) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          resolve();
        }, ms);
        timers.current.add(timer);
      }),
    [],
  );

  return useCallback(
    async (steps) => {
      const quick = reducedMotion();
      for (const { set, value, instant = false } of steps) {
        if (!alive.current) return;
        if (instant || quick) {
          set(value);
        } else {
          for (let i = 1; i <= value.length; i += 1) {
            if (!alive.current) return;
            set(value.slice(0, i));
            await wait(STEP_MS);
          }
        }
      }
    },
    [wait],
  );
}

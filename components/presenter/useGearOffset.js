import { useEffect, useId } from 'react';

// Everything anchored to the bottom of the screen (the tab bar, a composer, a wizard's button bar) reports its height
// here, and the gear moves above the sum of them. The total is published as --gear-offset on the root element.
const heights = new Map();

function publish() {
  const total = [...heights.values()].reduce((sum, height) => sum + height, 0);
  document.documentElement.style.setProperty('--gear-offset', `${total}px`);
}

/** Call with a ref to a bottom-anchored element. Its height keeps the gear clear of it while it is on screen. */
export function useGearOffset(ref) {
  const key = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const report = () => {
      heights.set(key, element.offsetHeight);
      publish();
    };
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', report);
      heights.delete(key);
      publish();
    };
  }, [ref, key]);
}

import { useEffect, useState } from 'react';

/** The current time in milliseconds, refreshed every `everyMs`, so "5 min ago" stays right while a screen is open. */
export function useNow(everyMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

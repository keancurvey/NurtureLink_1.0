import { useSyncExternalStore } from 'react';

/** Whether a media query matches now, and again whenever it changes (for example the 1024 px switch of the super account's layout). */
export function useMediaQuery(query) {
  const subscribe = (onChange) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

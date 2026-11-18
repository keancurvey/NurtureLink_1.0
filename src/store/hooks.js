import { useContext, useMemo, useSyncExternalStore } from 'react';
import { RuntimeContext } from './StoreProvider.jsx';
import { GATE_PATHS, landingPath } from '../lib/permissions.js';
import { accessGate, viewerOf } from './selectors.js';

export const useRuntime = () => useContext(RuntimeContext).runtime;
export const useActions = () => useContext(RuntimeContext).actions;

/** The whole state; it is a new object whenever anything changes. */
export function useStoreState() {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** A value computed from the state, recomputed only when the state (or the extra dependencies) change. */
export function useSelector(selector, deps = []) {
  const state = useStoreState();
  return useMemo(() => selector(state), [state, ...deps]);
}

/** The signed-in profile, or null. */
export function useViewer() {
  const state = useStoreState();
  return useMemo(() => viewerOf(state), [state]);
}

/**
 * A value that is a string, number, boolean or an untouched table array: the screen re-renders only when it changes,
 * not on every packet of a running check. Use it for things that wrap a whole screen, such as the route guards.
 */
export function useStoreValue(select) {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

/** Who is signed in and what stands between her and the app: { viewer: { id, role } | null, step, target }. */
export function useAccess() {
  const key = useStoreValue((state) => {
    const { viewer, step, pairing } = accessGate(state);
    return viewer ? `${viewer.id}|${viewer.role}|${step ?? ''}|${pairing ? 'pair' : ''}` : '';
  });
  return useMemo(() => {
    if (!key) return { viewer: null, step: null, target: '/sign-in' };
    const [id, role, step, pairing] = key.split('|');
    return { viewer: { id, role }, step: step || null, target: step ? GATE_PATHS[step] : landingPath(role, { pairing: pairing === 'pair' }) };
  }, [key]);
}

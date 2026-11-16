import { useContext, useMemo, useSyncExternalStore } from 'react';
import { RuntimeContext } from './StoreProvider.jsx';
import { profileOf, viewerOf } from './selectors.js';

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

// TEMP: until sign-in exists (Prompt 3) each role's direct URL acts as the first account of that role.
const TEMP_ACCOUNT = { patient: 'maricel-dimaculangan', barangay: 'lourdes-magpantay', super: 'rowena-macaraig' };

/** The signed-in profile; for now, the account of the role in the address when nobody is signed in. */
export function useViewer(routeRole = null) {
  const state = useStoreState();
  return useMemo(() => {
    const signedIn = viewerOf(state);
    if (signedIn) return signedIn;
    return routeRole ? profileOf(state, TEMP_ACCOUNT[routeRole]) : null;
  }, [state, routeRole]);
}

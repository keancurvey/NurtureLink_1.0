import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

const RegistryContext = createContext(null);

/** Screens add their own actions to the gear while they are on screen (CLAUDE.md Section 5, point 3). */
export function PresenterRegistryProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const register = useCallback((key, actions) => {
    setEntries((current) => [...current.filter((entry) => entry.key !== key), { key, actions }]);
    return () => setEntries((current) => current.filter((entry) => entry.key !== key));
  }, []);
  const value = useMemo(() => ({ entries, register }), [entries, register]);
  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}

/**
 * Register actions for this screen: [{ id, labelKey, onSelect, disabled? }]. The gear lists them under "This screen"
 * and removes them when the screen goes away. Pass a new array every render if you like: the latest one is used.
 */
export function usePresenterActions(actions) {
  // Depend on the stable register function only: the context value changes with every registration.
  const register = useContext(RegistryContext)?.register;
  const key = useId();
  const latest = useRef(actions);
  latest.current = actions;
  const ids = actions.map((action) => action.id).join('|');

  useEffect(() => {
    if (!register) return undefined;
    const current = (id) => latest.current.find((action) => action.id === id);
    const stable = ids.split('|').filter(Boolean).map((id) => ({
      id,
      get labelKey() {
        return current(id)?.labelKey;
      },
      get disabled() {
        return Boolean(current(id)?.disabled);
      },
      onSelect: () => current(id)?.onSelect(),
    }));
    return register(key, stable);
  }, [register, key, ids]);
}

/** What the gear shows under "This screen". */
export function useRegisteredActions() {
  const registry = useContext(RegistryContext);
  return useMemo(() => (registry ? registry.entries.flatMap((entry) => entry.actions) : []), [registry]);
}

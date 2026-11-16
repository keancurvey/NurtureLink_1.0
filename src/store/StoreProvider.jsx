import { createContext, useEffect, useState } from 'react';
import { attachPersistence, createPersistence } from './persist.js';
import { createActions } from './actions.js';
import { buildState, createRuntime } from './runtime.js';
import { snapshotOf } from './store.js';

export const RuntimeContext = createContext(null);

/**
 * Loads the stored data (or builds the starting records), starts the runtime and provides it to the app. Nothing is
 * drawn until the data is ready, which takes a few milliseconds; the splash screen covers the first load.
 */
export function StoreProvider({ children, persistence: injected = null }) {
  const [value, setValue] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let detach = () => {};
    let stopRuntime = () => {};

    (async () => {
      const persistence = injected ?? createPersistence();
      const snapshot = await persistence.load();
      if (cancelled) return;
      const runtime = createRuntime({ state: buildState({ snapshot, session: persistence.loadSession() }), persistence });
      // The first visit keeps the starting records through a reload even before anything changes.
      if (!snapshot) persistence.save(snapshotOf(runtime.store.getState()));
      detach = attachPersistence(runtime.store, persistence, { snapshotOf });
      stopRuntime = runtime.start();
      setValue({ runtime, actions: createActions(runtime) });
    })();

    return () => {
      cancelled = true;
      detach();
      stopRuntime();
    };
  }, [injected]);

  if (!value) return null;
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

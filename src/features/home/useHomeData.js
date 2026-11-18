import { useMemo } from 'react';
import { checkNowState } from '../../lib/checkNow.js';
import { checkStatuses } from '../../lib/vitalStatus.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { devicesOf, fetalReadings, latestCheck, liveCheckOf, thresholdsOf, waitingToSync } from '../../store/selectors.js';

export const RUNNING_PHASES = ['starting', 'contact', 'acquiring', 'finishing'];

/** Everything the patient's Home needs, read through the selectors that enforce her own scope. */
export function useHomeData() {
  const state = useStoreState();
  const viewer = useViewer();
  return useMemo(() => {
    const thresholds = thresholdsOf(state);
    const devices = devicesOf(state, viewer, viewer.id);
    const live = liveCheckOf(state, viewer);
    const running = Boolean(live) && RUNNING_PHASES.includes(live.phase);
    const session = latestCheck(state, viewer, viewer.id);
    const windows = session ? fetalReadings(state, viewer, session.id) : [];
    return {
      viewer,
      thresholds,
      belt: devices.find((d) => d.type === 'belt') ?? null,
      band: devices.find((d) => d.type === 'band') ?? null,
      live,
      running,
      session,
      statuses: session ? checkStatuses(session.summary, thresholds, windows) : null,
      waiting: waitingToSync(state, viewer, viewer.id),
      syncedAt: state.meta.last_synced_at,
      verdict: checkNowState({ devices, checking: running, thresholds }),
    };
  }, [state, viewer]);
}

/** The result of a finished check on screen: the session the check saved, with its statuses. */
export function useCheckResult(sessionId) {
  const state = useStoreState();
  const viewer = useViewer();
  return useMemo(() => {
    const session = sessionId ? state.db.check_sessions.find((s) => s.id === sessionId && s.patient_id === viewer.id) : null;
    if (!session) return null;
    const thresholds = thresholdsOf(state);
    return { session, statuses: checkStatuses(session.summary, thresholds, fetalReadings(state, viewer, session.id)) };
  }, [state, viewer, sessionId]);
}

import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell.jsx';
import i18n, { setLanguage } from '../../i18n/index.js';
import { useAccess, useStoreValue } from '../../store/hooks.js';
import { landingPath } from '../../lib/permissions.js';

/** The language saved on the account applies when she signs in, switches account or comes back to a saved session (COM-02). */
export function AccountLanguage() {
  const { viewer } = useAccess();
  const language = useStoreValue((state) => (viewer ? (state.db.profiles.find((p) => p.id === viewer.id)?.language ?? null) : null));
  const id = viewer?.id ?? null;
  useEffect(() => {
    if (id && language && language !== i18n.language) setLanguage(language);
    // Only when the account changes: a change made with the toggle is saved on the account, not undone by it.
  }, [id]);
  return null;
}

/** Sign in, sign up and forgot password are for people who are signed out: anyone signed in goes where she belongs. */
export function SignedOutOnly() {
  const { viewer, target } = useAccess();
  return viewer ? <Navigate to={target} replace /> : <Outlet />;
}

/** Terms and consent, guardian consent and the first password change: only while that step is the one she is on. */
export function StepRoute({ step }) {
  const access = useAccess();
  if (!access.viewer) return <Navigate to="/sign-in" replace />;
  if (access.step !== step) return <Navigate to={access.target} replace />;
  return <Outlet />;
}

/** The app of one role: a signed-out visitor goes to sign-in, a person with a step to finish to that step, another role to her own app. */
export function RoleRoute({ role }) {
  const access = useAccess();
  if (!access.viewer) return <Navigate to="/sign-in" replace />;
  if (access.step) return <Navigate to={access.target} replace />;
  if (access.viewer.role !== role) return <Navigate to={landingPath(access.viewer.role)} replace />;
  return <AppShell role={role} />;
}

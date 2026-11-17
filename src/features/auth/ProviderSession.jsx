import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { MS_MINUTE } from '../../lib/dates.js';
import { createIdleTimer } from '../../lib/idleTimer.js';
import { gearConfigFor } from '../../lib/permissions.js';
import { useActions, useRuntime } from '../../store/hooks.js';
import { thresholdsOf } from '../../store/selectors.js';

const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];

/**
 * AUTH-08: a barangay or super account is signed out after a period without activity, with a warning one minute before.
 * Renders nothing until the warning shows. The gear's "Expire session" ends the session the same way.
 */
export default function ProviderSession({ role }) {
  const { t } = useTranslation('auth');
  const runtime = useRuntime();
  const actions = useActions();
  const [warning, setWarning] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const { timeoutMinutes, warnAfterMinutes } = thresholdsOf(runtime.store.getState()).providerSession;
    const idle = createIdleTimer({
      timeoutMs: timeoutMinutes * MS_MINUTE,
      warnMs: warnAfterMinutes * MS_MINUTE,
      onWarn: () => setWarning(true),
      onExpire: () => {
        setWarning(false);
        runtime.auth.expireSession();
      },
    });
    timer.current = idle;
    idle.start();
    const onActivity = () => {
      idle.activity();
      runtime.auth.touch();
    };
    ACTIVITY.forEach((name) => window.addEventListener(name, onActivity, { passive: true, capture: true }));
    return () => {
      ACTIVITY.forEach((name) => window.removeEventListener(name, onActivity, { capture: true }));
      idle.stop();
      timer.current = null;
    };
  }, [runtime]);

  const stay = useCallback(() => {
    timer.current?.stay();
    setWarning(false);
    runtime.auth.touch();
  }, [runtime]);

  usePresenterActions(gearConfigFor(role).expireSession ? [{ id: 'expire-session', labelKey: 'presenter:action.expireSession', onSelect: () => runtime.auth.expireSession() }] : []);

  return (
    <Sheet
      open={warning}
      onClose={stay}
      title={t('sessionWarning.title')}
      footer={
        <>
          <Button block onClick={stay}>
            {t('sessionWarning.stay')}
          </Button>
          <Button block variant="ghost" onClick={() => actions.sign_out()}>
            {t('sessionWarning.signOut')}
          </Button>
        </>
      }
    >
      <p>{t('sessionWarning.body')}</p>
    </Sheet>
  );
}

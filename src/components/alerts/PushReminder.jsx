import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useActions, useStoreValue } from '../../store/hooks.js';
import { pushStateOf } from '../../store/selectors.js';
import Banner from '../ui/Banner.jsx';
import Button from '../ui/Button.jsx';
import PushExplain from './PushExplain.jsx';
import Sheet from '../ui/Sheet.jsx';

// Hidden for the rest of the visit, per account (a reload shows it again; nothing is stored).
const hidden = new Set();

/** COM-04: after "Not now", a reminder that notifications are off, with a way to turn them on. In-app notifications go on. */
export default function PushReminder({ dismissible = false }) {
  const { t } = useTranslation('alerts');
  const actions = useActions();
  const profileId = useStoreValue((state) => state.session?.profile_id ?? null);
  const declined = useStoreValue((state) => (state.session ? pushStateOf(state, state.session.profile_id) === 'declined' : false));
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  if (!declined || (dismissible && hidden.has(profileId))) return null;
  return (
    <>
      <Banner
        status="attention"
        title={t('push.reminderTitle')}
        action={
          <>
            <Button variant="ghost" onClick={() => setOpen(true)}>
              {t('push.turnOn')}
            </Button>
            {dismissible ? (
              <Button variant="ghost" onClick={() => { hidden.add(profileId); bump((n) => n + 1); }}>
                {t('push.close')}
              </Button>
            ) : null}
          </>
        }
      >
        {t('push.reminderBody')}
      </Banner>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('push.title')}>
        <PushExplain
          onAllow={async () => {
            await actions.allow_push();
            setOpen(false);
          }}
          onLater={() => setOpen(false)}
        />
      </Sheet>
    </>
  );
}

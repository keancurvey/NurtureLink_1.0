import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button.jsx';

/** The short explanation of COM-04 with its two answers. An in-app screen: the browser's own prompt is never used. */
export default function PushExplain({ onAllow, onLater }) {
  const { t } = useTranslation('alerts');
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <p>{t('push.body')}</p>
      <ul className="plain-list">
        <li>{t('push.point1')}</li>
        <li>{t('push.point2')}</li>
      </ul>
      <Button
        block
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onAllow();
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('push.allow')}
      </Button>
      <Button variant="ghost" block disabled={busy} onClick={onLater}>
        {t('push.later')}
      </Button>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { formatRelative } from '../../lib/format.js';
import { useStoreValue } from '../../store/hooks.js';
import { useNow } from '../../features/home/useNow.js';

/** COM-05: a visible banner while the connection is off, with the time of the last sync. It stays out of the way online. */
export default function ConnectionBanner() {
  const { t, i18n } = useTranslation();
  const offline = useStoreValue((state) => state.meta.connection === 'offline');
  const syncedAt = useStoreValue((state) => state.meta.last_synced_at);
  const now = useNow(30000);
  if (!offline) return null;
  return (
    <div className="offline" role="status">
      <WifiOff className="offline__icon" size={20} aria-hidden="true" />
      <div>
        <p className="offline__title">{t('connection.offlineTitle')}</p>
        <p>{t('connection.offlineBody', { time: syncedAt ? formatRelative(syncedAt, now, i18n.language) : '–' })}</p>
      </div>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { formatDateTime, formatRelative } from '../../lib/format.js';
import ReadingsGrid from './ReadingsGrid.jsx';
import { useNow } from './useNow.js';

/** PAT-H-01 and PAT-H-06: the last check with its date and time, the four readings with statuses, and whether it has been uploaded. */
export default function LastCheckCard({ session, statuses, waiting, syncedAt }) {
  const { t, i18n } = useTranslation('home');
  const now = useNow(30000);
  const lang = i18n.language;
  if (!session) {
    return (
      <Card>
        <h2 className="card__title">{t('last.title')}</h2>
        <EmptyState illustration="heart" title={t('last.emptyTitle')}>
          {t('last.emptyBody')}
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="stack">
      <div className="card__head">
        <h2 className="card__title">{t('last.title')}</h2>
        {statuses.overall ? <StatusBadge status={statuses.overall} /> : null}
      </div>
      <p className="card__meta">{t('last.when', { relative: formatRelative(session.ended_at, now, lang), date: formatDateTime(session.ended_at, lang) })}</p>
      <ReadingsGrid summary={session.summary} statuses={statuses} />
      {statuses.overall && statuses.overall !== 'normal' ? <p className="card__note">{t('last.worried')}</p> : null}
      <div className="card__sync">
        {waiting > 0 ? <Badge status="info">{t('last.sync.waiting')}</Badge> : null}
        {syncedAt ? <span className="card__meta">{t('last.sync.synced', { time: formatRelative(syncedAt, now, lang) })}</span> : null}
      </div>
    </Card>
  );
}

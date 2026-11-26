import { useTranslation } from 'react-i18next';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { formatDateTime, formatRelative } from '../../lib/format.js';
import { checkStatuses } from '../../lib/vitalStatus.js';
import { useNow } from '../home/useNow.js';
import VitalsGrid from './VitalsGrid.jsx';

/** A patient's latest completed check as a provider sees it: when, the four readings with their statuses, or a note that there is none yet. */
export default function LatestVitals({ session, thresholds }) {
  const { t, i18n } = useTranslation('monitor');
  const now = useNow(30000);
  if (!session) {
    return (
      <EmptyState illustration="heart" title={t('vitals.emptyTitle')}>
        {t('vitals.emptyBody')}
      </EmptyState>
    );
  }
  const statuses = checkStatuses(session.summary, thresholds);
  return (
    <div className="stack">
      <div className="card__head">
        <p className="card__meta">{t('vitals.when', { relative: formatRelative(session.ended_at, now, i18n.language), date: formatDateTime(session.ended_at, i18n.language) })}</p>
        {statuses.overall ? <StatusBadge status={statuses.overall} /> : null}
      </div>
      <VitalsGrid summary={session.summary} statuses={statuses} />
    </div>
  );
}

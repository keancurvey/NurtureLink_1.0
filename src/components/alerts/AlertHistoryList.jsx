import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { alertTypeText } from '../../features/alerts/text.js';
import { toneOf } from '../../lib/alertView.js';
import { formatDateTime } from '../../lib/format.js';
import Badge from '../ui/Badge.jsx';

const STATUS_TONE = { new: 'alert', acknowledged: 'info', resolved: 'normal' };

/**
 * Alert history (ALR-07): a list of alerts, newest first, each opening its detail screen. Pass alerts already read through
 * a selector (alertsOf), so the list never holds more than the viewer may see. role picks the plain or technical wording.
 */
export default function AlertHistoryList({ alerts, role, patientNames = null }) {
  const { t, i18n } = useTranslation('alerts');
  if (alerts.length === 0) return <p className="card__meta">{t('history.empty')}</p>;
  return (
    <ul className="alert-list">
      {alerts.map((alert) => {
        const status = alert.cancelled_at ? 'cancelled' : alert.status;
        const type = alertTypeText(t, alert.type, role);
        const when = formatDateTime(alert.created_at, i18n.language);
        return (
          <li key={alert.id}>
            <Link className="alert-row" to={`/alerts/${alert.id}`} aria-label={t('history.item', { type, status: t(`status.${status}`), time: when })}>
              <span className="alert-row__text">
                <span className="alert-row__title">{type}</span>
                <span className="card__meta">{patientNames?.[alert.patient_id] ? `${patientNames[alert.patient_id]} · ${when}` : when}</span>
              </span>
              <Badge status={status === 'cancelled' ? 'neutral' : status === 'new' ? toneOf(alert) : STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>
              <ChevronRight size={20} aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

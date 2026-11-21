import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { alertTypeText } from '../../features/alerts/text.js';
import { patientNoticeAlerts, toneOf, toneOfType } from '../../lib/alertView.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { alertsOf, phoneNoticesOf } from '../../store/selectors.js';
import Banner from '../ui/Banner.jsx';
import Card from '../ui/Card.jsx';
import AlertHistoryList from './AlertHistoryList.jsx';

const HISTORY_SHOWN = 5;

/**
 * The patient's notices on Home (ALR-06): for each alert still open, a plain "please contact your barangay health worker
 * or midwife" and what was noticed in everyday words, never a diagnosis; then her alert history (ALR-07). A notice the
 * phone made from its own rules shows here before the server has made the alert.
 */
export default function PatientNotices() {
  const { t } = useTranslation('alerts');
  const state = useStoreState();
  const viewer = useViewer();
  const all = alertsOf(state, viewer, { patientId: viewer.id });
  const open = patientNoticeAlerts(all);
  const waiting = phoneNoticesOf(state, viewer).filter((n) => !open.some((a) => a.type === n.payload.alert_type));
  const closed = all.filter((a) => a.status === 'resolved');
  return (
    <>
      {open.map((alert) => (
        <Banner
          key={alert.id}
          status={toneOf(alert)}
          title={t('notice.title')}
          action={
            <Link className="btn btn--ghost" to={`/alerts/${alert.id}`}>
              {t('notice.view')}
            </Link>
          }
        >
          {alertTypeText(t, alert.type, 'patient')}.
        </Banner>
      ))}
      {waiting.map((n) => (
        <Banner key={n.id} status={toneOfType(n.payload.alert_type)} title={t('notice.title')}>
          {alertTypeText(t, n.payload.alert_type, 'patient')}.
        </Banner>
      ))}
      {closed.length > 0 ? (
        <Card className="stack">
          <h2 className="card__title">{t('history.title')}</h2>
          <AlertHistoryList alerts={closed.slice(0, HISTORY_SHOWN)} role="patient" />
        </Card>
      ) : null}
    </>
  );
}

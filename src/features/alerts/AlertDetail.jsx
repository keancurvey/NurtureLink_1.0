import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AlertActions from '../../components/alerts/AlertActions.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { alertFacts, alertTimeline, toneOf } from '../../lib/alertView.js';
import { formatDateTime } from '../../lib/format.js';
import { landingPath } from '../../lib/permissions.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { alertById, profileOf, thresholdsOf } from '../../store/selectors.js';
import { alertTypeText } from './text.js';

const STATUS_TONE = { new: null, acknowledged: 'info', resolved: 'normal' };

/**
 * The permanent alert screen at /alerts/:id (ALR-04, ALR-06), reached from a notification by every role. A provider sees
 * the facts, the account names and times of each step, and the Respond button; the patient sees the plain notice to
 * contact her provider, who has seen it, and no diagnostic wording.
 */
export default function AlertDetail() {
  const { t, i18n } = useTranslation('alerts');
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useStoreState();
  const viewer = useViewer();
  const [responding, setResponding] = useState(false);
  const alert = alertById(state, viewer, id);
  const closeSheet = () => setResponding(false);

  if (!alert) {
    return (
      <section className="page">
        <Card>
          <EmptyState illustration="shield" title={t('detail.notFoundTitle')} action={<Button onClick={() => navigate(landingPath(viewer.role), { replace: true })}>{t('detail.openAlerts')}</Button>}>
            {t('detail.notFoundBody')}
          </EmptyState>
        </Card>
      </section>
    );
  }

  const isPatient = viewer.role === 'patient';
  const patient = profileOf(state, alert.patient_id);
  const name = (profileId) => profileOf(state, profileId)?.full_name ?? '';
  const when = (ms) => formatDateTime(ms, i18n.language);
  const status = alert.cancelled_at ? 'cancelled' : alert.status;
  const tone = toneOf(alert);
  const claimer = alert.acknowledged_by ? name(alert.acknowledged_by) : null;
  const canRespond = !isPatient && alert.status !== 'resolved';

  return (
    <section className="page">
      <Button variant="ghost" className="alert-back" onClick={() => navigate(-1)}>
        <ArrowLeft size={20} aria-hidden="true" />
        {t('detail.back')}
      </Button>
      <h1 className="page__title">{t('detail.title')}</h1>

      <Card className="stack">
        <div className="card__head">
          <h2 className="card__title">{alertTypeText(t, alert.type, viewer.role)}</h2>
          <Badge status={status === 'cancelled' ? 'neutral' : (STATUS_TONE[status] ?? tone)}>{t(`status.${status}`)}</Badge>
        </div>
        {!isPatient && patient ? <p>{t('detail.patient')}: {patient.full_name}</p> : null}
        <p className="card__meta">{t('detail.raisedAt', { time: when(alert.created_at) })}</p>

        {isPatient ? (
          alert.status === 'resolved' ? (
            <p>{t('detail.closed')}</p>
          ) : (
            <Banner status={tone} title={t('detail.noticeTitle')}>
              {t('detail.noticeBody')}
            </Banner>
          )
        ) : null}
        {isPatient && claimer && alert.status !== 'resolved' ? <p>{t('detail.handled', { name: claimer })}</p> : null}
        {isPatient && alert.type !== 'sos' && alert.status !== 'resolved' ? (
          <Link className="btn btn--primary btn--block" to="/patient/consult">
            {t('detail.message')}
          </Link>
        ) : null}

        {canRespond ? (
          <Button block onClick={() => setResponding(true)}>
            {t('detail.respond')}
          </Button>
        ) : null}
      </Card>

      {!isPatient ? (
        <Card className="stack">
          <h2 className="card__title">{t('detail.what')}</h2>
          <ul className="plain-list">
            {alertFacts(alert, thresholdsOf(state)).map((fact) => (
              <li key={fact.key}>{t(fact.key, fact.values)}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!isPatient ? (
        <Card className="stack">
          <h2 className="card__title">{t('detail.history')}</h2>
          <ol className="timeline">
            {alertTimeline(alert).map((step) => (
              <li key={`${step.key}-${step.at}`} className="timeline__item">
                <span>{t(`timeline.${step.key}`, { name: step.by ? name(step.by) : '', count: step.values?.count })}</span>
                <span className="card__meta">{when(step.at)}</span>
              </li>
            ))}
          </ol>
          {alert.outcome ? (
            <div>
              <h3 className="card__label">{t('detail.outcome')}</h3>
              <p>{alert.outcome}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {!isPatient ? <AlertActions alertId={alert.id} open={responding} onClose={closeSheet} /> : null}
    </section>
  );
}

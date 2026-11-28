import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AlertActions from '../../components/alerts/AlertActions.jsx';
import AlertHistoryList from '../../components/alerts/AlertHistoryList.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { KIND_ICONS } from '../../components/ui/kindIcons.js';
import { ageOn } from '../../lib/authRules.js';
import { manilaDate } from '../../lib/dates.js';
import { formatDateShort, formatDateTime, formatDaysAway } from '../../lib/format.js';
import { cardStatus } from '../../lib/monitor.js';
import { countdown, gestationalAge, trimester } from '../../lib/pregnancy.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { alertsOf, appointmentsOf, checkSessions, latestCheck, patientRecord, profileOf, thresholdsOf } from '../../store/selectors.js';
import { alertTypeText, telHref } from '../alerts/text.js';
import { useNow } from '../home/useNow.js';
import LatestVitals from '../monitor/LatestVitals.jsx';
import ReadingsHistory from '../monitor/ReadingsHistory.jsx';
import { VISIT_BADGE } from '../monitor/PatientDetail.jsx';
import { statusBadge } from '../monitor/monitorText.js';

const HISTORY_STEP = 5;

function Detail({ label, children }) {
  return (
    <div className="detail">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

/**
 * A patient's full profile for a super account (SUP-X-01), reached from the Tracker or from Consult: pregnancy details, latest readings,
 * readings history with charts, check-up history and alerts history. Back returns to where she came from, with the same filter or chat.
 * Every opening is written to the access log with the account's name (SUP-X-02). Route: /super/patient/:patientId.
 */
export default function PatientProfile() {
  const { patientId } = useParams();
  const { t, i18n } = useTranslation('tracker');
  const { t: tm } = useTranslation('monitor');
  const { t: ta } = useTranslation('alerts');
  const navigate = useNavigate();
  const location = useLocation();
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const now = useNow(60000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(now);
  const [responding, setResponding] = useState(null);
  const [shown, setShown] = useState(HISTORY_STEP);
  const closeAlert = useCallback(() => setResponding(null), []);
  const record = useMemo(() => patientRecord(state, viewer, patientId), [state, viewer, patientId]);

  // Every opening is written to the access log, once for each time the screen opens.
  const logged = useRef(null);
  useEffect(() => {
    if (record && logged.current !== patientId) {
      logged.current = patientId;
      actions.open_record(patientId, 'view_record');
    }
  }, [record, patientId, actions]);

  if (!record) return <Navigate to="/super/tracker" replace />;

  const { profile, patient, pregnancy } = record;
  const thresholds = thresholdsOf(state);
  const sessions = checkSessions(state, viewer, patientId);
  const latest = latestCheck(state, viewer, patientId);
  const alerts = alertsOf(state, viewer, { patientId });
  const open = alerts.filter((a) => a.status !== 'resolved');
  const visits = appointmentsOf(state, viewer, { patientId })
    .filter((a) => VISIT_BADGE[a.status])
    .sort((a, b) => (b.scheduled_at ?? b.requested_at) - (a.scheduled_at ?? a.requested_at));
  const age = pregnancy ? gestationalAge(pregnancy.lmp, today) : null;
  const left = pregnancy ? countdown(pregnancy.edd, today) : null;
  const barangay = state.db.barangays.find((b) => b.id === profile.barangay_id);
  const [tone, key] = statusBadge(cardStatus({ openAlerts: open, summary: latest?.summary ?? null, thresholds }));
  const author = (id) => profileOf(state, id)?.full_name ?? '';
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/super/tracker'));

  return (
    <section className="page page--wide">
      <header className="chat__header">
        <button type="button" className="icon-btn icon-btn--fixed" onClick={goBack} aria-label={t('patient.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </button>
        <div className="chat__heading">
          <h1 className="chat__title">{profile.full_name}</h1>
          <p className="card__meta">{[patient ? tm('card.age', { count: ageOn(patient.birthdate, today) }) : null, barangay?.name].filter(Boolean).join(' · ')}</p>
        </div>
      </header>

      <div className="office-grid">
        <Card className="stack">
          <h2 className="card__title">{t('patient.details')}</h2>
          <div className="profile__head">
            <Avatar name={profile.full_name} size="lg" photo={profile.photo_url} illustration={profile.avatar_art ?? undefined} />
            <div className="profile__who">
              <Badge status={tone}>{tm(key)}</Badge>
              {profile.contact_no ? <p className="card__meta">{profile.contact_no}</p> : null}
            </div>
          </div>
          <dl className="details">
            <Detail label={t('patient.barangay')}>{barangay?.name ?? ''}</Detail>
            <Detail label={t('patient.contact')}>{profile.contact_no ?? t('list.noContact')}</Detail>
          </dl>
          {profile.contact_no ? (
            <a className="btn btn--ghost" href={telHref(profile.contact_no)}>
              <Phone size={20} aria-hidden="true" />
              {t('patient.call')}
            </a>
          ) : null}
        </Card>

        <Card className="stack">
          <h2 className="card__title">{t('patient.pregnancy')}</h2>
          {pregnancy ? (
            <>
              <dl className="details">
                <Detail label={tm('pregnancy.age')}>
                  <span className="detail__strong">{tm('pregnancy.ageValue', { weeks: age.weeks, days: age.days })}</span>
                  <span className="detail__sub">{tm(`trimester.${trimester(age.totalDays)}`)}</span>
                </Detail>
                <Detail label={tm('pregnancy.lmp')}>{formatDateShort(pregnancy.lmp, lang)}</Detail>
                <Detail label={tm('pregnancy.edd')}>
                  <span className="tracker__edd">{formatDateShort(pregnancy.edd, lang)}</span>
                  <span className="detail__sub">{tm(pregnancy.edd_source === 'naegele' ? 'pregnancy.eddCalculated' : 'pregnancy.eddProvider')}</span>
                  <span className="detail__sub">{left.overdue ? tm('pregnancy.passed', { when: formatDaysAway(left.days, lang) }) : tm('pregnancy.toGo', { when: formatDaysAway(left.days, lang) })}</span>
                </Detail>
                <Detail label={tm('pregnancy.risk')}>{pregnancy.risk_notes ?? tm('pregnancy.noRisk')}</Detail>
              </dl>
              {pregnancy.updated_by ? <p className="card__meta">{tm('pregnancy.updated', { name: author(pregnancy.updated_by), date: formatDateTime(pregnancy.updated_at, lang) })}</p> : null}
            </>
          ) : (
            <p className="card__meta">{t('patient.noPregnancy')}</p>
          )}
        </Card>
      </div>

      {open.length > 0 ? (
        <Card className="stack">
          <h2 className="card__title">{t('patient.openAlerts')}</h2>
          <ul className="alert-list">
            {open.map((alert) => (
              <li key={alert.id} className="patient-card__alert">
                <Badge status={alert.status === 'new' ? 'alert' : 'info'}>{alert.status === 'new' ? ta('status.new') : t('patient.acknowledgedBy', { name: author(alert.acknowledged_by) })}</Badge>
                <span>{alertTypeText(ta, alert.type, 'provider')}</span>
                <Button variant="ghost" onClick={() => setResponding(alert.id)}>
                  {t('patient.respond')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="stack">
        <h2 className="card__title">{t('patient.latest')}</h2>
        <LatestVitals session={latest} thresholds={thresholds} />
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('patient.history')}</h2>
        <ReadingsHistory sessions={sessions} thresholds={thresholds} />
      </Card>

      <div className="office-grid">
        <Card className="stack">
          <h2 className="card__title">{t('patient.visits')}</h2>
          {visits.length === 0 ? (
            <p className="card__meta">{tm('visits.empty')}</p>
          ) : (
            <ol className="history">
              {visits.slice(0, shown).map((visit) => {
                const Icon = KIND_ICONS[visit.type];
                const [badgeTone, badgeKey] = VISIT_BADGE[visit.status];
                const when = visit.scheduled_at ?? visit.requested_at;
                return (
                  <li key={visit.id} className="history__item">
                    <Icon size={20} aria-hidden="true" />
                    <div className="history__body">
                      <p className="history__title">{tm(`visits.kind.${visit.type}`)}</p>
                      <p className="card__meta">{formatDateShort(manilaDate(when), lang)}</p>
                    </div>
                    <Badge status={badgeTone}>{tm(badgeKey)}</Badge>
                  </li>
                );
              })}
            </ol>
          )}
          {visits.length > shown ? (
            <Button variant="ghost" onClick={() => setShown((n) => n + HISTORY_STEP)}>
              {tm('history.more')}
            </Button>
          ) : null}
        </Card>

        <Card className="stack">
          <h2 className="card__title">{t('patient.alerts')}</h2>
          <AlertHistoryList alerts={alerts} role="super" />
        </Card>
      </div>
      <AlertActions alertId={responding} open={responding !== null} onClose={closeAlert} />
    </section>
  );
}

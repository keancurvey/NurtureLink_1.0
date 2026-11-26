import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Phone, CalendarDays } from 'lucide-react';
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
import { alertsOf, appointmentsOf, checkSessions, latestCheck, patientRecord, profileOf, referralsOf, requestsOf, thresholdsOf, visitNotesOf } from '../../store/selectors.js';
import { alertTypeText, telHref } from '../alerts/text.js';
import { useNow } from '../home/useNow.js';
import LatestVitals from './LatestVitals.jsx';
import ReadingsHistory from './ReadingsHistory.jsx';
import { ClinicalSheet, ProposeSheet, ReferSheet } from './Sheets.jsx';
import { statusBadge } from './monitorText.js';

const HISTORY_STEP = 5;
const VISIT_BADGE = {
  approved: ['info', 'history.upcoming'],
  attended: ['normal', 'history.attended'],
  missed: ['attention', 'history.missed'],
  rescheduled: ['info', 'history.rescheduled'],
  pending: ['neutral', 'history.pending'],
  declined: ['neutral', 'history.declined'],
};

function Detail({ label, children }) {
  return (
    <div className="detail">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

/**
 * The detail of one patient of the barangay (BRG-M-04 to BRG-M-06): who she is, her open alerts, pregnancy details (editable by
 * the barangay account), latest vitals, readings history with charts, check-up history, visit notes, referral and a proposed time.
 * Opening it writes an access log entry with the account's name (ACC-07). Route: /barangay/monitor/:patientId.
 */
export default function PatientDetail() {
  const { patientId } = useParams();
  const { t, i18n } = useTranslation('monitor');
  const { t: ta } = useTranslation('alerts');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const now = useNow(60000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(now);
  const [sheet, setSheet] = useState(null); // clinical | refer | propose
  const [responding, setResponding] = useState(null);
  const [shown, setShown] = useState(HISTORY_STEP);
  const closeSheet = useCallback(() => setSheet(null), []);
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

  if (!record) return <Navigate to="/barangay/monitor" replace />;

  const { profile, patient, pregnancy } = record;
  const thresholds = thresholdsOf(state);
  const sessions = checkSessions(state, viewer, patientId);
  const latest = latestCheck(state, viewer, patientId);
  const alerts = alertsOf(state, viewer, { patientId });
  const open = alerts.filter((a) => a.status !== 'resolved');
  const notes = visitNotesOf(state, viewer, patientId);
  const visits = appointmentsOf(state, viewer, { patientId })
    .filter((a) => VISIT_BADGE[a.status])
    .sort((a, b) => (b.scheduled_at ?? b.requested_at) - (a.scheduled_at ?? a.requested_at));
  const referrals = referralsOf(state, viewer, patientId);
  const proposal = requestsOf(state, viewer, { patientId, kind: 'appointment_proposal' }).find((r) => r.status === 'pending') ?? null;
  const age = pregnancy ? gestationalAge(pregnancy.lmp, today) : null;
  const left = pregnancy ? countdown(pregnancy.edd, today) : null;
  const author = (id) => profileOf(state, id)?.full_name ?? '';
  const [tone, key] = statusBadge(cardStatus({ openAlerts: open, summary: latest?.summary ?? null, thresholds }));

  return (
    <section className="page">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/barangay/monitor" aria-label={t('detail.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <div className="chat__heading">
          <h1 className="chat__title">{profile.full_name}</h1>
          <p className="card__meta">{[patient ? t('card.age', { count: ageOn(patient.birthdate, today) }) : null, patient?.address ?? null].filter(Boolean).join(' · ')}</p>
        </div>
      </header>

      <Card className="stack">
        <div className="profile__head">
          <Avatar name={profile.full_name} size="lg" photo={profile.photo_url} illustration={profile.avatar_art ?? undefined} />
          <div className="profile__who">
            <Badge status={tone}>{t(key)}</Badge>
            {profile.contact_no ? <p className="card__meta">{profile.contact_no}</p> : null}
          </div>
        </div>
        <div className="alert-actions">
          {profile.contact_no ? (
            <a className="btn btn--ghost" href={telHref(profile.contact_no)}>
              <Phone size={20} aria-hidden="true" />
              {t('detail.call')}
            </a>
          ) : null}
          <Link className="btn btn--ghost" to={`/barangay/chat/${patientId}`}>
            <MessageCircle size={20} aria-hidden="true" />
            {t('detail.chat')}
          </Link>
          <Link className="btn btn--ghost" to="/barangay/calendar">
            <CalendarDays size={20} aria-hidden="true" />
            {t('detail.schedule')}
          </Link>
        </div>
      </Card>

      {open.length > 0 ? (
        <Card className="stack">
          <h2 className="card__title">{t('detail.openAlerts')}</h2>
          <ul className="alert-list">
            {open.map((alert) => (
              <li key={alert.id} className="patient-card__alert">
                <Badge status={alert.status === 'new' ? 'alert' : 'info'}>{alert.status === 'new' ? ta('status.new') : t('card.acknowledgedBy', { name: author(alert.acknowledged_by) })}</Badge>
                <span>{alertTypeText(ta, alert.type, 'provider')}</span>
                <Button variant="ghost" onClick={() => setResponding(alert.id)}>
                  {t('card.respond')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {pregnancy ? (
        <Card className="stack">
          <div className="card__head">
            <h2 className="card__title">{t('pregnancy.title')}</h2>
            <Button variant="ghost" onClick={() => setSheet('clinical')}>
              {t('pregnancy.edit')}
            </Button>
          </div>
          <dl className="details">
            <Detail label={t('pregnancy.age')}>
              <span className="detail__strong">{t('pregnancy.ageValue', { weeks: age.weeks, days: age.days })}</span>
              <span className="detail__sub">{t(`trimester.${trimester(age.totalDays)}`)}</span>
            </Detail>
            <Detail label={t('pregnancy.lmp')}>{formatDateShort(pregnancy.lmp, lang)}</Detail>
            <Detail label={t('pregnancy.edd')}>
              {formatDateShort(pregnancy.edd, lang)}
              <span className="detail__sub">{t(pregnancy.edd_source === 'naegele' ? 'pregnancy.eddCalculated' : 'pregnancy.eddProvider')}</span>
              <span className="detail__sub">{left.overdue ? t('pregnancy.passed', { when: formatDaysAway(left.days, lang) }) : t('pregnancy.toGo', { when: formatDaysAway(left.days, lang) })}</span>
            </Detail>
            <Detail label={t('pregnancy.risk')}>{pregnancy.risk_notes ?? t('pregnancy.noRisk')}</Detail>
          </dl>
          {pregnancy.updated_by ? <p className="card__meta">{t('pregnancy.updated', { name: author(pregnancy.updated_by), date: formatDateTime(pregnancy.updated_at, lang) })}</p> : null}
        </Card>
      ) : null}

      <Card className="stack">
        <h2 className="card__title">{t('detail.latest')}</h2>
        <LatestVitals session={latest} thresholds={thresholds} />
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('history.title')}</h2>
        <ReadingsHistory sessions={sessions} thresholds={thresholds} />
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('visits.title')}</h2>
        {visits.length === 0 ? (
          <p className="card__meta">{t('visits.empty')}</p>
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
                    <p className="history__title">{t(`visits.kind.${visit.type}`)}</p>
                    <p className="card__meta">{formatDateShort(manilaDate(when), lang)}</p>
                  </div>
                  <Badge status={badgeTone}>{t(badgeKey)}</Badge>
                </li>
              );
            })}
          </ol>
        )}
        {visits.length > shown ? (
          <Button variant="ghost" onClick={() => setShown((n) => n + HISTORY_STEP)}>
            {t('history.more')}
          </Button>
        ) : null}
        {proposal ? (
          <p className="card__meta">{t('propose.waiting', { date: formatDateShort(proposal.preferred_date, lang) })}</p>
        ) : (
          <Button variant="ghost" onClick={() => setSheet('propose')}>
            {t('propose.button')}
          </Button>
        )}
      </Card>

      <Card className="stack">
        <div className="card__head">
          <h2 className="card__title">{t('note.listTitle')}</h2>
          <Link className="btn btn--ghost" to={`/barangay/monitor/${patientId}/note`}>
            {t('note.add')}
          </Link>
        </div>
        {notes.length === 0 ? (
          <p className="card__meta">{t('note.empty')}</p>
        ) : (
          <ul className="notes">
            {notes.map((note) => (
              <li key={note.id} className="notes__item">
                <p className="notes__head">
                  {formatDateShort(manilaDate(note.taken_at), lang)} · {author(note.author_id)}
                </p>
                <p className="card__meta">{t('note.vitals', { bp: `${note.bp_systolic}/${note.bp_diastolic}`, weight: note.weight_kg })}</p>
                <p>{note.note}</p>
                <Badge status={note.shared ? 'info' : 'neutral'}>{t(note.shared ? 'note.sharedBadge' : 'note.privateBadge')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('refer.cardTitle')}</h2>
        {referrals.length > 0 ? (
          <ul className="notes">
            {referrals.map((r) => (
              <li key={`${r.at}-${r.by}`} className="notes__item">
                <p className="notes__head">{t('refer.sentBy', { name: r.by ?? '', date: formatDateTime(r.at, lang) })}</p>
                <p>{r.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card__meta">{t('refer.none')}</p>
        )}
        <Button variant="ghost" onClick={() => setSheet('refer')}>
          {t('refer.button')}
        </Button>
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('detail.alertHistory')}</h2>
        <AlertHistoryList alerts={alerts} role="barangay" />
      </Card>

      {sheet === 'clinical' && pregnancy ? <ClinicalSheet patientId={patientId} pregnancy={pregnancy} onClose={closeSheet} /> : null}
      {sheet === 'refer' ? <ReferSheet patientId={patientId} latest={latest} thresholds={thresholds} onClose={closeSheet} /> : null}
      {sheet === 'propose' ? <ProposeSheet patientId={patientId} onClose={closeSheet} /> : null}
      <AlertActions alertId={responding} open={responding !== null} onClose={closeAlert} />
    </section>
  );
}

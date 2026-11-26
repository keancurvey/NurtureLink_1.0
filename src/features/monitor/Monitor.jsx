import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AlertActions from '../../components/alerts/AlertActions.jsx';
import EmergencyBanner from '../../components/alerts/EmergencyBanner.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Field from '../../components/ui/Field.jsx';
import Select from '../../components/ui/Select.jsx';
import Toggle from '../../components/ui/Toggle.jsx';
import { filterCards, monitorCounts } from '../../lib/monitor.js';
import { formatRelative } from '../../lib/format.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { monitorOf, profileOf } from '../../store/selectors.js';
import { alertTypeText } from '../alerts/text.js';
import { useNow } from '../home/useNow.js';
import { ageText, dueText, statusBadge } from './monitorText.js';

/** One line about the open alert of a patient: what it is and where it stands (new, or who acknowledged it). */
function AlertLine({ alert, claimer }) {
  const { t } = useTranslation('monitor');
  const { t: ta } = useTranslation('alerts');
  const status = alert.status === 'new' ? 'alert' : 'info';
  return (
    <p className="patient-card__alert">
      <Badge status={status}>{alert.status === 'new' ? ta('status.new') : t('card.acknowledgedBy', { name: claimer ?? '' })}</Badge>
      <span>{alertTypeText(ta, alert.type, 'provider')}</span>
    </p>
  );
}

/** A patient of the barangay (BRG-M-02, BRG-M-03): who she is, how far along, her status and last check. An emergency gets the red card and a Respond button. */
function PatientCard({ card, now, lang, onRespond, claimerOf }) {
  const { t } = useTranslation('monitor');
  const [tone, key] = statusBadge(card.status);
  const classes = ['patient-card', card.emergency ? 'patient-card--emergency' : ''].filter(Boolean).join(' ');
  return (
    <li className={classes}>
      <Link className="patient-card__main" to={`/barangay/monitor/${card.id}`} aria-label={t('card.open', { name: card.name })}>
        <Avatar name={card.name} size="lg" photo={card.profile.photo_url} illustration={card.profile.avatar_art ?? undefined} />
        <span className="patient-card__body">
          <span className="patient-card__name">{card.name}</span>
          <span className="card__meta">{[card.age !== null ? t('card.age', { count: card.age }) : null, card.weeks !== null ? ageText(t, card.weeks, card.days) : null].filter(Boolean).join(' · ')}</span>
          {card.edd ? <span className="card__meta">{dueText(t, card.edd, card.daysToEdd, lang)}</span> : null}
          <span className="patient-card__badges">
            <Badge status={tone}>{t(key)}</Badge>
            {card.overdue ? <Badge status="attention">{t('card.overdue')}</Badge> : null}
          </span>
          <span className="card__meta">{card.lastCheckAt ? t('card.lastCheck', { when: formatRelative(card.lastCheckAt, now, lang) }) : t('card.noCheck')}</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </Link>
      {card.openAlerts[0] ? <AlertLine alert={card.openAlerts[0]} claimer={claimerOf(card.openAlerts[0])} /> : null}
      {card.emergency ? (
        <Button block onClick={() => onRespond(card.emergency.id)}>
          {t('card.respond')}
        </Button>
      ) : null}
    </li>
  );
}

/** The barangay account's Monitor tab (BRG-M-01 to BRG-M-03): counts, search and filters, the pinned emergency banner and the patient cards. */
export default function Monitor() {
  const { t, i18n } = useTranslation('monitor');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(30000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const [query, setQuery] = useState('');
  const [trimester, setTrimester] = useState('');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [responding, setResponding] = useState(null);
  const closeSheet = useCallback(() => setResponding(null), []);

  const cards = useMemo(() => monitorOf(state, viewer, now), [state, viewer, now]);
  const counts = monitorCounts(cards, now);
  const shown = filterCards(cards, { query, trimester: trimester === '' ? null : trimester, alertsOnly, overdueOnly });
  const emergencies = cards.filter((card) => card.emergency);
  const claimerOf = (alert) => (alert.acknowledged_by ? profileOf(state, alert.acknowledged_by)?.full_name ?? null : null);
  const barangay = state.db.barangays.find((b) => b.id === viewer.barangay_id);
  const filtering = query.trim() !== '' || trimester !== '' || alertsOnly || overdueOnly;

  return (
    <section className="page">
      <h1 className="page__title">{t('title')}</h1>
      {barangay ? <p className="card__meta monitor__where">{barangay.name}</p> : null}

      {emergencies.length > 0 ? (
        <div className="monitor__pinned">
          {emergencies.map((card) => (
            <EmergencyBanner key={card.emergency.id} alert={card.emergency} patientName={card.name} onRespond={() => setResponding(card.emergency.id)} />
          ))}
        </div>
      ) : null}

      <ul className="counts" aria-label={t('counts.label')}>
        {[
          ['patients', counts.patients],
          ['alerts', counts.activeAlerts],
          ['overdue', counts.overdue],
          ['due', counts.dueThisMonth],
        ].map(([key, value]) => (
          <li className="counts__tile" key={key}>
            <span className="counts__value">{value}</span>
            <span className="counts__label">{t(`counts.${key}`)}</span>
          </li>
        ))}
      </ul>

      {cards.length === 0 ? (
        <Card>
          <EmptyState illustration="heart" title={t('empty.title')}>
            {t('empty.body')}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="stack">
            <Field label={t('filter.search')} type="search" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
            <Select
              label={t('filter.trimester')}
              value={trimester}
              onChange={(event) => setTrimester(event.target.value)}
              options={[
                { value: '', label: t('filter.allTrimesters') },
                { value: '1', label: t('trimester.1') },
                { value: '2', label: t('trimester.2') },
                { value: '3', label: t('trimester.3') },
              ]}
            />
            <Toggle label={t('filter.alertsOnly')} checked={alertsOnly} onChange={setAlertsOnly} />
            <Toggle label={t('filter.overdueOnly')} checked={overdueOnly} onChange={setOverdueOnly} />
          </Card>

          {shown.length === 0 ? (
            <Card>
              <EmptyState illustration="heart" title={t('empty.noMatchTitle')}>
                {filtering ? t('empty.noMatchBody') : t('empty.body')}
              </EmptyState>
            </Card>
          ) : (
            <ul className="patient-cards" aria-label={t('card.list', { count: shown.length })}>
              {shown.map((card) => (
                <PatientCard key={card.id} card={card} now={now} lang={lang} onRespond={setResponding} claimerOf={claimerOf} />
              ))}
            </ul>
          )}
        </>
      )}

      <AlertActions alertId={responding} open={responding !== null} onClose={closeSheet} />
    </section>
  );
}

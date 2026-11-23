import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Calendar from '../../components/ui/Calendar.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { KIND_ICONS } from '../../components/ui/kindIcons.js';
import { manilaDate } from '../../lib/dates.js';
import { formatDateLong, formatDaysAway, formatRelative, formatTime } from '../../lib/format.js';
import { KINDS, itemsOn, markersByDate, monthOf, upcomingItems } from '../../lib/schedule.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { calendarOf, pendingRequestOf, providerOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import RescheduleSheet from './RescheduleSheet.jsx';
import { STATUS_BADGE, placeText, roleText } from './scheduleText.js';

function Detail({ label, children }) {
  return (
    <div className="detail">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

/** One item of a date (PAT-S-02): type, time, place or teleconsultation, provider, notes and status. */
function ItemDetails({ item, now, provider, pending, onReschedule }) {
  const { t, i18n } = useTranslation('schedule');
  const Icon = KIND_ICONS[item.kind];
  const isEvent = item.source === 'event';
  const name = isEvent ? item.row.title : t(`kind.${item.kind}`);
  const badge = STATUS_BADGE[item.status];
  const time = item.endsAt ? `${formatTime(item.startsAt, i18n.language)} – ${formatTime(item.endsAt, i18n.language)}` : formatTime(item.startsAt, i18n.language);
  const canReschedule = !isEvent && item.status === 'approved' && item.startsAt > now;
  const notes = item.row.notes ?? null;
  const reason = item.row.reason ?? null;
  return (
    <li className="item">
      <div className="item__head">
        <Icon size={24} aria-hidden="true" />
        <h3 className="item__title">{name}</h3>
        {badge ? <Badge status={badge[0]}>{t(badge[1])}</Badge> : null}
      </div>
      <dl className="details">
        {isEvent ? <Detail label={t('details.type')}>{t('kind.event')}</Detail> : null}
        <Detail label={t('details.time')}>{time}</Detail>
        <Detail label={t('details.place')}>{placeText(t, item)}</Detail>
        {provider ? (
          <Detail label={t(isEvent ? 'details.organizer' : 'details.provider')}>
            {provider.full_name}
            <span className="detail__sub">{roleText(t, provider.role)}</span>
          </Detail>
        ) : null}
        {!isEvent ? (
          <Detail label={t('details.notes')}>
            {notes ?? reason ?? t('details.noNotes')}
          </Detail>
        ) : null}
      </dl>
      {canReschedule ? (
        pending ? (
          <Badge status="info">{t('reschedule.requested')}</Badge>
        ) : (
          <Button variant="ghost" onClick={() => onReschedule(item)}>
            {t('reschedule.button')}
          </Button>
        )
      ) : null}
    </li>
  );
}

/** The patient's Schedule (PAT-S-01 to PAT-S-05): the month calendar, details of a date, the upcoming list and reschedule requests. */
export default function Schedule() {
  const { t, i18n } = useTranslation('schedule');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(30000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(now);
  const [month, setMonth] = useState(() => monthOf(manilaDate(Date.now())));
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState(null);

  const items = useMemo(() => calendarOf(state, viewer), [state, viewer]);
  const markers = useMemo(() => markersByDate(items), [items]);
  const upcoming = useMemo(() => upcomingItems(items, now), [items, now]);
  const onDate = selected ? itemsOn(items, selected) : [];
  const providerFor = (item) => providerOf(state, viewer, item.source === 'event' ? item.row.created_by : item.row.provider_id);
  const isPending = (item) => item.source === 'appointment' && Boolean(pendingRequestOf(state, viewer, 'reschedule', item.id));

  const labels = { prev: t('calendar.prev'), next: t('calendar.next'), today: t('calendar.today'), kinds: Object.fromEntries(KINDS.map((kind) => [kind, t(`kind.${kind}`)])) };

  function pick(date) {
    setSelected(date);
    setMonth(monthOf(date));
    setOpen(itemsOn(items, date).length > 0);
  }

  const reschedulingKind = rescheduling ? t(`kind.${rescheduling.kind}`).toLowerCase() : '';

  return (
    <section className="page">
      <h1 className="page__title">{t('title')}</h1>

      <Card className="stack calendar-card">
        <Calendar month={month} onMonthChange={setMonth} today={today} selected={selected} onSelect={pick} markers={markers} labels={labels} lang={lang} />
        <ul className="legend" aria-label={t('calendar.legend')}>
          {KINDS.map((kind) => {
            const Icon = KIND_ICONS[kind];
            return (
              <li key={kind} className="legend__item">
                <Icon size={16} aria-hidden="true" />
                <span>{t(`kind.${kind}`)}</span>
              </li>
            );
          })}
        </ul>
        {selected && onDate.length === 0 ? (
          <p className="card__note" role="status">
            {t('calendar.nothing', { date: formatDateLong(selected, lang) })}
          </p>
        ) : null}
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('upcoming.title')}</h2>
        {upcoming.length === 0 ? (
          <EmptyState illustration="calendar" title={t('upcoming.emptyTitle')}>
            {t('upcoming.emptyBody')}
          </EmptyState>
        ) : (
          <ul className="upcoming">
            {upcoming.map((item) => {
              const Icon = KIND_ICONS[item.kind];
              return (
                <li key={item.key}>
                  <button type="button" className="upcoming__row" onClick={() => pick(item.date)}>
                    <Icon size={24} aria-hidden="true" />
                    <span className="upcoming__body">
                      <span className="upcoming__title">{item.source === 'event' ? item.row.title : t(`kind.${item.kind}`)}</span>
                      <span className="upcoming__when">
                        {formatDateLong(item.date, lang)}, {formatTime(item.startsAt, lang)}
                      </span>
                      {isPending(item) ? <Badge status="info">{t('reschedule.requested')}</Badge> : null}
                    </span>
                    <span className="upcoming__days">{formatDaysAway(item.days, lang)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="card__meta">{t('synced', { time: state.meta.last_synced_at ? formatRelative(state.meta.last_synced_at, now, lang) : t('syncedNever') })}</p>

      <Sheet open={open && !rescheduling} onClose={() => setOpen(false)} title={selected ? formatDateLong(selected, lang, { year: true }) : ''}>
        <ul className="items">
          {onDate.map((item) => (
            <ItemDetails key={item.key} item={item} now={now} provider={providerFor(item)} pending={isPending(item)} onReschedule={setRescheduling} />
          ))}
        </ul>
      </Sheet>

      {rescheduling ? <RescheduleSheet appointment={rescheduling.row} kindText={reschedulingKind} onClose={() => setRescheduling(null)} onSent={() => { setRescheduling(null); setOpen(false); }} /> : null}
    </section>
  );
}

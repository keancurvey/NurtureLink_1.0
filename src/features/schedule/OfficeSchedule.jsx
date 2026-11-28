import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Calendar from '../../components/ui/Calendar.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { KIND_ICONS } from '../../components/ui/kindIcons.js';
import { manilaDate } from '../../lib/dates.js';
import { formatDateLong, formatDaysAway, formatRelative, formatTime } from '../../lib/format.js';
import { KINDS, itemsOn, markersByDate, monthOf, upcomingItems } from '../../lib/schedule.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { officeCalendarOf, profileOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import { STATUS_BADGE, placeText } from './scheduleText.js';

/**
 * The Schedule tab of a super account (SUP-S-01): every approved appointment and every event of all barangays, with highlighted dates, the
 * upcoming list and the details of a date. It creates events for all barangays or for one. Reminders reach the bell like any notification.
 */
export default function OfficeSchedule() {
  const { t, i18n } = useTranslation('tracker');
  const { t: ts } = useTranslation('schedule');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(30000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(now);
  const [month, setMonth] = useState(() => monthOf(manilaDate(Date.now())));
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);

  const items = useMemo(() => officeCalendarOf(state, viewer), [state, viewer]);
  const markers = useMemo(() => markersByDate(items), [items]);
  const upcoming = useMemo(() => upcomingItems(items, now), [items, now]);
  const onDate = selected ? itemsOn(items, selected) : [];
  const labels = { prev: ts('calendar.prev'), next: ts('calendar.next'), today: ts('calendar.today'), kinds: Object.fromEntries(KINDS.map((kind) => [kind, ts(`kind.${kind}`)])) };
  const nameOf = (item) => (item.source === 'event' ? item.row.title : profileOf(state, item.row.patient_id)?.full_name ?? '');
  const title = (item) => (item.source === 'event' ? item.row.title : `${ts(`kind.${item.kind}`)} · ${nameOf(item)}`);

  function pick(date) {
    setSelected(date);
    setMonth(monthOf(date));
    setOpen(itemsOn(items, date).length > 0);
  }

  return (
    <section className="page page--wide">
      <h1 className="page__title">{t('schedule.title')}</h1>
      <Link className="btn btn--primary btn--block" to="/super/schedule/new">
        <Plus size={24} aria-hidden="true" />
        {t('schedule.create')}
      </Link>

      <Card className="stack calendar-card">
        <Calendar month={month} onMonthChange={setMonth} today={today} selected={selected} onSelect={pick} markers={markers} labels={labels} lang={lang} />
        <ul className="legend" aria-label={ts('calendar.legend')}>
          {KINDS.map((kind) => {
            const Icon = KIND_ICONS[kind];
            return (
              <li key={kind} className="legend__item">
                <Icon size={16} aria-hidden="true" />
                <span>{ts(`kind.${kind}`)}</span>
              </li>
            );
          })}
        </ul>
        {selected && onDate.length === 0 ? (
          <p className="card__note" role="status">
            {ts('calendar.nothing', { date: formatDateLong(selected, lang) })}
          </p>
        ) : null}
      </Card>

      <Card className="stack">
        <h2 className="card__title">{ts('upcoming.title')}</h2>
        {upcoming.length === 0 ? (
          <EmptyState illustration="calendar" title={ts('upcoming.emptyTitle')}>
            {t('schedule.emptyBody')}
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
                      <span className="upcoming__title">{title(item)}</span>
                      <span className="upcoming__when">
                        {formatDateLong(item.date, lang)}, {formatTime(item.startsAt, lang)}
                      </span>
                    </span>
                    <span className="upcoming__days">{formatDaysAway(item.days, lang)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="card__meta">{ts('synced', { time: state.meta.last_synced_at ? formatRelative(state.meta.last_synced_at, now, lang) : ts('syncedNever') })}</p>

      <Sheet open={open} onClose={() => setOpen(false)} title={selected ? formatDateLong(selected, lang, { year: true }) : ''}>
        <ul className="items">
          {onDate.map((item) => {
            const Icon = KIND_ICONS[item.kind];
            const badge = STATUS_BADGE[item.status];
            const isEvent = item.source === 'event';
            const time = item.endsAt ? `${formatTime(item.startsAt, lang)} – ${formatTime(item.endsAt, lang)}` : formatTime(item.startsAt, lang);
            const provider = profileOf(state, isEvent ? item.row.created_by : item.row.provider_id);
            return (
              <li className="item" key={item.key}>
                <div className="item__head">
                  <Icon size={24} aria-hidden="true" />
                  <h3 className="item__title">{title(item)}</h3>
                  {badge ? <Badge status={badge[0]}>{ts(badge[1])}</Badge> : null}
                </div>
                <dl className="details">
                  <div className="detail">
                    <dt className="detail__label">{ts('details.time')}</dt>
                    <dd className="detail__value">{time}</dd>
                  </div>
                  <div className="detail">
                    <dt className="detail__label">{ts('details.place')}</dt>
                    <dd className="detail__value">{placeText(ts, item)}</dd>
                  </div>
                  {provider ? (
                    <div className="detail">
                      <dt className="detail__label">{ts(isEvent ? 'details.organizer' : 'details.provider')}</dt>
                      <dd className="detail__value">{provider.full_name}</dd>
                    </div>
                  ) : null}
                  {!isEvent ? (
                    <div className="detail">
                      <dt className="detail__label">{ts('details.notes')}</dt>
                      <dd className="detail__value">{item.row.notes ?? item.row.reason ?? ts('details.noNotes')}</dd>
                    </div>
                  ) : null}
                </dl>
                {!isEvent ? (
                  <Link className="btn btn--ghost" to={`/super/patient/${item.row.patient_id}`}>
                    {t('schedule.openPatient')}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Sheet>
    </section>
  );
}

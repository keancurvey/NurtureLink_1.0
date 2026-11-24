import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Plus, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SosShortcut from '../../components/alerts/SosShortcut.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { hasPhoto } from '../../lib/consult.js';
import { formatDateLong, formatRelative, formatTime } from '../../lib/format.js';
import { manilaDate } from '../../lib/dates.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { bookingsOf, callTargetOf, providerOf, teleconsultOf, threadPeopleOf, threadsOf } from '../../store/selectors.js';
import { telHref } from '../alerts/text.js';
import { useNow } from '../home/useNow.js';
import JoinCard, { JoinButton } from './JoinCard.jsx';
import { BOOKING_BADGE, lockText, threadName } from './consultText.js';

/** One conversation of the list (PAT-C-01): who, the last message or why it is locked, the time and what is new. */
function ThreadRow({ thread, people, now, lang }) {
  const { t } = useTranslation('consult');
  const { conversation, last, unread, lock } = thread;
  const name = threadName(t, conversation, people);
  const preview = last ? (last.body ? last.body : t('threads.photo')) : conversation.kind === 'barangay' ? t('threads.emptyBarangay') : t('threads.emptyMidwife');
  const text = last && hasPhoto(last) && last.body ? `${t('threads.photo')}: ${preview}` : preview;
  const shown = last && last.sender_id === conversation.patient_id ? t('threads.you', { text }) : text;
  return (
    <li>
      <Link className="thread" to={`/patient/consult/chat/${conversation.id}`} aria-label={t('threads.open', { name })}>
        <Avatar name={name} illustration={conversation.kind === 'barangay' ? 'shield' : 'heart'} size="lg" />
        <span className="thread__body">
          <span className="thread__top">
            <span className="thread__name">{name}</span>
            {last && lock.open ? <span className="thread__time">{formatRelative(last.sent_at, now, lang)}</span> : null}
          </span>
          <span className="thread__preview">{lock.open ? shown : lockText(t, lock.reason)}</span>
          {!lock.open || unread > 0 ? (
            <span className="thread__badges">
              {!lock.open ? <Badge status="neutral">{t('threads.locked')}</Badge> : null}
              {unread > 0 ? <Badge status="info">{t('threads.unread', { count: unread })}</Badge> : null}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** One booking request with how it stands and who handled it (PAT-C-04). */
function BookingCard({ row, provider, handler, now, lang }) {
  const { t } = useTranslation('consult');
  const [tone, key] = BOOKING_BADGE[row.status];
  const range = row.preferred_start ? `${formatTime(row.preferred_start, lang)} – ${formatTime(row.preferred_end, lang)}` : '';
  const waiting = row.syncState === 'queued';
  return (
    <li className="booking">
      <div className="booking__head">
        <h3 className="booking__title">{t(`bookings.kind.${row.type}`)}</h3>
        <Badge status={tone}>{t(key)}</Badge>
      </div>
      <p className="card__meta">{t('bookings.requested', { when: formatRelative(row.requested_at, now, lang) })}</p>
      {row.scheduled_at ? (
        <p>{t('bookings.scheduled', { date: formatDateLong(manilaDate(row.scheduled_at), lang), time: formatTime(row.scheduled_at, lang) })}</p>
      ) : row.preferred_start ? (
        <p>{t('bookings.preferred', { date: formatDateLong(manilaDate(row.preferred_start), lang), range })}</p>
      ) : null}
      {row.reason ? (
        <p>
          <span className="booking__label">{t('bookings.reason')}: </span>
          {row.reason}
        </p>
      ) : null}
      {handler ? <p className="card__meta">{t('bookings.handledBy', { name: handler.full_name })}</p> : null}
      {provider && row.status === 'approved' ? <p className="card__meta">{t('bookings.assigned', { name: provider.full_name })}</p> : null}
      {row.status === 'declined' && row.decline_reason ? (
        <p>
          <span className="booking__label">{t('bookings.declineReason')}: </span>
          {row.decline_reason}
        </p>
      ) : null}
      {waiting ? <p className="card__meta">{t('bookings.waiting')}</p> : null}
      {row.status === 'approved' && row.type === 'teleconsult' ? <JoinButton appointment={row} now={now} /> : null}
    </li>
  );
}

/** The patient's Consult tab (PAT-C-01, PAT-C-04 to PAT-C-06): the notice, the next video call, her two conversations and her booking requests. */
export default function Consult() {
  const { t, i18n } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(15000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';

  const threads = useMemo(() => threadsOf(state, viewer, now), [state, viewer, now]);
  const bookings = useMemo(() => bookingsOf(state, viewer, now), [state, viewer, now]);
  const call = useMemo(() => callTargetOf(state, viewer), [state, viewer]);
  const teleconsult = useMemo(() => teleconsultOf(state, viewer, now), [state, viewer, now]);
  const providerFor = (id) => providerOf(state, viewer, id);

  return (
    <section className="page">
      <h1 className="page__title">{t('title')}</h1>

      <Card className="stack emergency-note">
        <div className="card__head">
          <TriangleAlert size={24} aria-hidden="true" />
          <h2 className="card__title">{t('emergency.title')}</h2>
        </div>
        <p>{t('emergency.body')}</p>
        <SosShortcut />
        {call ? (
          <a className="btn btn--ghost btn--block" href={telHref(call.contact_no)}>
            <Phone size={24} aria-hidden="true" />
            {t('emergency.call', { name: call.name })}
          </a>
        ) : null}
      </Card>

      {teleconsult ? <JoinCard appointment={teleconsult} provider={providerFor(teleconsult.provider_id)} now={now} lang={lang} /> : null}

      <Card className="stack">
        <h2 className="card__title">{t('threads.title')}</h2>
        <ul className="threads">
          {threads.map((thread) => (
            <ThreadRow key={thread.conversation.id} thread={thread} people={threadPeopleOf(state, viewer, thread.conversation)} now={now} lang={lang} />
          ))}
        </ul>
      </Card>

      <Card className="stack">
        <div className="card__head">
          <h2 className="card__title">{t('bookings.title')}</h2>
        </div>
        <Link className="btn btn--primary btn--block" to="/patient/consult/book">
          <Plus size={24} aria-hidden="true" />
          {t('bookings.request')}
        </Link>
        {bookings.length === 0 ? (
          <EmptyState illustration="calendar" title={t('bookings.emptyTitle')}>
            {t('bookings.emptyBody')}
          </EmptyState>
        ) : (
          <ul className="bookings">
            {bookings.map((row) => (
              <BookingCard key={row.id} row={row} provider={providerFor(row.provider_id)} handler={providerFor(row.handled_by)} now={now} lang={lang} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

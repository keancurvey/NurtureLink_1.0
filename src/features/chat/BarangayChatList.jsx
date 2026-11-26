import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { hasPhoto } from '../../lib/consult.js';
import { formatRelative } from '../../lib/format.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { inboxOf, profileOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';

/** The barangay account's Chat tab (BRG-C-01): the shared inbox of each patient, newest first, with what is new. */
export default function BarangayChatList() {
  const { t, i18n } = useTranslation('monitor');
  const { t: tc } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(15000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const rows = useMemo(() => inboxOf(state, viewer), [state, viewer]);

  function preview(last, patientId) {
    if (!last) return t('chat.empty');
    const text = last.body ? last.body : tc('threads.photo');
    if (last.sender_id === viewer.id) return t('chat.you', { text });
    if (last.sender_id === patientId) return text;
    return t('chat.from', { name: profileOf(state, last.sender_id)?.full_name ?? '', text });
  }

  return (
    <section className="page">
      <h1 className="page__title">{t('chat.title')}</h1>
      {rows.length === 0 ? (
        <Card>
          <EmptyState illustration="chat" title={t('empty.title')}>
            {t('chat.noPatients')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="stack">
          <ul className="threads">
            {rows.map(({ patient, last, unread }) => (
              <li key={patient.id}>
                <Link className="thread" to={`/barangay/chat/${patient.id}`} aria-label={t('chat.open', { name: patient.full_name })}>
                  <Avatar name={patient.full_name} size="lg" photo={patient.photo_url} illustration={patient.avatar_art ?? undefined} />
                  <span className="thread__body">
                    <span className="thread__top">
                      <span className="thread__name">{patient.full_name}</span>
                      {last ? <span className="thread__time">{formatRelative(last.sent_at, now, lang)}</span> : null}
                    </span>
                    <span className="thread__preview">{hasPhoto(last ?? {}) && !last?.body ? tc('threads.photo') : preview(last, patient.id)}</span>
                    {unread > 0 ? (
                      <span className="thread__badges">
                        <Badge status="info">{t('chat.unread', { count: unread })}</Badge>
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

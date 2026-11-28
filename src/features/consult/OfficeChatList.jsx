import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { hasPhoto } from '../../lib/consult.js';
import { formatRelative } from '../../lib/format.js';
import { useStoreState, useViewer } from '../../store/hooks.js';
import { officeThreadsOf, profileOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';

/**
 * The chats of a super account (SUP-C-02): the midwife threads assigned to it, plus the two kinds that stay visible so nothing is lost: a
 * midwife thread whose account was deactivated, and the inbox of a barangay that has no active account. Newest message first.
 */
export default function OfficeChatList() {
  const { t, i18n } = useTranslation('tracker');
  const { t: tc } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(15000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const rows = officeThreadsOf(state, viewer, now);

  function preview(last, patientId) {
    if (!last) return t('chats.empty');
    const text = last.body ? last.body : hasPhoto(last) ? tc('threads.photo') : '';
    if (last.sender_id === viewer.id) return t('chats.you', { text });
    if (last.sender_id === patientId) return text;
    return t('chats.from', { name: profileOf(state, last.sender_id)?.full_name ?? '', text });
  }

  return (
    <Card className="stack">
      <h2 className="card__title">{t('chats.title')}</h2>
      {rows.length === 0 ? (
        <EmptyState illustration="chat" title={t('chats.emptyTitle')}>
          {t('chats.emptyBody')}
        </EmptyState>
      ) : (
        <ul className="threads">
          {rows.map(({ patient, conversation, last, unread, lock, why }) => (
            <li key={conversation.id}>
              <Link className="thread" to={`/super/consult/chat/${conversation.id}`} aria-label={t('chats.open', { name: patient.full_name })}>
                <Avatar name={patient.full_name} size="lg" photo={patient.photo_url} illustration={patient.avatar_art ?? undefined} />
                <span className="thread__body">
                  <span className="thread__top">
                    <span className="thread__name">{patient.full_name}</span>
                    {last ? <span className="thread__time">{formatRelative(last.sent_at, now, lang)}</span> : null}
                  </span>
                  <span className="thread__preview">{preview(last, patient.id)}</span>
                  <span className="thread__badges">
                    <Badge status="neutral">{t(`chats.why.${why}`)}</Badge>
                    {!lock.open ? <Badge status="neutral">{t('chats.locked')}</Badge> : null}
                    {unread > 0 ? <Badge status="info">{t('chats.unread', { count: unread })}</Badge> : null}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, MessageCircle, MessagesSquare, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { STATUS_ICONS } from '../../components/ui/statusIcons.js';
import { notificationText } from '../alerts/text.js';
import { formatRelative } from '../../lib/format.js';
import { describeNotification } from '../../lib/notifications.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { notificationContext, notificationsOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';

const ICONS = { alert: STATUS_ICONS.alert, battery: Zap, calendar: CalendarDays, chat: MessageCircle, video: MessagesSquare, bell: Bell };
const MAX_SHOWN = 100;

/**
 * The notification center (COM-03): the account's notifications, newest first. Tapping one opens the screen it is about
 * and marks it read; each unread one can also be marked read on its own, and all at once.
 */
export default function NotificationCenter() {
  const { t, i18n } = useTranslation('alerts');
  const navigate = useNavigate();
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const now = useNow(30000);

  const items = useMemo(
    () => notificationsOf(state, viewer).slice(0, MAX_SHOWN).map((n) => ({ n, view: describeNotification(n, notificationContext(state, viewer, n)) })),
    [state, viewer],
  );
  const unread = items.filter(({ view }) => view.unread).length;

  function open({ n, view }) {
    actions.mark_read(n.id);
    navigate(view.path);
  }

  return (
    <section className="page">
      <div className="card__head">
        <h1 className="page__title">{t('center.title')}</h1>
        <Button variant="ghost" disabled={unread === 0} onClick={() => actions.mark_all_read()}>
          {t('center.markAll')}
        </Button>
      </div>
      <p className="card__meta" aria-live="polite">
        {unread > 0 ? t('center.count', { count: unread }) : t('center.allRead')}
      </p>
      {items.length === 0 ? (
        <Card>
          <EmptyState illustration="bell" title={t('center.emptyTitle')}>
            {t('center.emptyBody')}
          </EmptyState>
        </Card>
      ) : (
        <ul className="notif-list" aria-label={t('center.list')}>
          {items.map((item) => {
            const { n, view } = item;
            const text = notificationText(t, view);
            const Icon = view.tone === 'alert' ? STATUS_ICONS.alert : view.tone === 'attention' ? STATUS_ICONS.attention : (ICONS[view.icon] ?? Bell);
            return (
              <li key={n.id} className={`notif ${view.unread ? 'notif--unread' : ''}`}>
                <button type="button" className="notif__open" onClick={() => open(item)}>
                  <Icon className={`notif__icon notif__icon--${view.tone}`} size={24} aria-hidden="true" />
                  <span className="notif__text">
                    <span className="notif__title">{text.title}</span>
                    {text.body ? <span className="notif__body">{text.body}</span> : null}
                    <span className="card__meta">{formatRelative(n.created_at, now, i18n.language)}</span>
                  </span>
                  {view.unread ? <Badge status="info">{t('center.unread')}</Badge> : null}
                </button>
                {view.unread ? (
                  <Button variant="ghost" className="notif__mark" onClick={() => actions.mark_read(n.id)}>
                    {t('center.markOne')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

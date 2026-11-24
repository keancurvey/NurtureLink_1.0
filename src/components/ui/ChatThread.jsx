import { useEffect, useMemo, useRef } from 'react';
import { Check, CheckCheck, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageState } from '../../lib/consult.js';
import { manilaDate } from '../../lib/dates.js';
import { formatDateLong, formatTime } from '../../lib/format.js';
import ChatPhoto from './ChatPhoto.jsx';

const STATE_ICONS = { sending: Clock, sent: Check, delivered: CheckCheck, seen: CheckCheck };

/** One message's sending state: an icon and its word, never colour alone (PAT-C-02). */
function MessageState({ state }) {
  const { t } = useTranslation('consult');
  const Icon = STATE_ICONS[state];
  return (
    <span className={`bubble__state bubble__state--${state}`}>
      <Icon size={16} aria-hidden="true" />
      <span>{t(`chat.state.${state}`)}</span>
    </span>
  );
}

/**
 * Messenger-style thread (PAT-C-02, ACC-03): days with a heading, bubbles with the sender's name on other people's
 * messages, the time, a photo when there is one, and for the viewer's own messages where each one has got to (sending,
 * sent, delivered, seen). The other roles reuse it.
 *   messages  oldest first, as the selectors give them
 *   viewerId  whose messages sit on the right
 *   names     Map of profile id to { name }
 *   now       the current time, so delivered and seen show once their time has come
 */
export default function ChatThread({ messages, viewerId, names, now, lang = 'en', emptyText, label }) {
  const { t } = useTranslation('consult');
  const endRef = useRef(null);
  const today = manilaDate(now);
  const yesterday = manilaDate(now - 24 * 60 * 60 * 1000);

  const days = useMemo(() => {
    const groups = [];
    for (const message of messages) {
      const date = manilaDate(message.sent_at);
      const last = groups[groups.length - 1];
      if (last && last.date === date) last.messages.push(message);
      else groups.push({ date, messages: [message] });
    }
    return groups;
  }, [messages]);

  // A new message brings the end of the thread into view.
  const count = messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  if (messages.length === 0) {
    return (
      <div className="chat__empty">
        <p>{emptyText ?? t('chat.empty')}</p>
        <div ref={endRef} />
      </div>
    );
  }

  const dayLabel = (date) => (date === today ? t('chat.today') : date === yesterday ? t('chat.yesterday') : formatDateLong(date, lang));

  return (
    <div className="chat__thread" role="log" aria-label={label ?? t('chat.list')} aria-live="polite">
      {days.map((day) => (
        <section key={day.date} className="chat__day">
          <h3 className="chat__date">{dayLabel(day.date)}</h3>
          <ol className="chat__messages">
            {day.messages.map((message) => {
              const mine = message.sender_id === viewerId;
              const sender = names.get(message.sender_id)?.name ?? '';
              return (
                <li key={message.id} className={`bubble-row bubble-row--${mine ? 'mine' : 'theirs'}`}>
                  <div className={`bubble bubble--${mine ? 'mine' : 'theirs'}`}>
                    {!mine && sender ? <p className="bubble__sender">{sender}</p> : null}
                    {message.attachment_url ? <img className="chat-photo" src={message.attachment_url} alt={t('chat.photo')} /> : null}
                    {message.attachment_art ? <ChatPhoto name={message.attachment_art} label={t('chat.photo')} /> : null}
                    {message.body ? <p className="bubble__body">{message.body}</p> : null}
                    <p className="bubble__meta">
                      <time dateTime={new Date(message.sent_at).toISOString()}>{formatTime(message.sent_at, lang)}</time>
                      {mine ? <MessageState state={messageState(message, now)} /> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <div ref={endRef} />
    </div>
  );
}

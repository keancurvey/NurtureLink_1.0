import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Banner from '../../components/ui/Banner.jsx';
import ChatThread from '../../components/ui/ChatThread.jsx';
import Composer from '../../components/ui/Composer.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { CHAT } from '../../config/thresholds.js';
import { ATTACHMENT_ARTS, newClientId, unseenFrom } from '../../lib/consult.js';
import { formatDateTime } from '../../lib/format.js';
import { downscaleAttachment, photoProblem } from '../../lib/photo.js';
import { useActions, useRuntime, useStoreState, useViewer } from '../../store/hooks.js';
import { senderNamesOf, teleconsultOf, threadOf, threadPeopleOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import { JoinButton } from './JoinCard.jsx';
import { lockText, threadName } from './consultText.js';

/** The chat with her barangay's health team or the midwife (PAT-C-01 to PAT-C-03, PAT-C-06). Route: /patient/consult/chat/:conversationId. */
export default function ChatScreen() {
  const { conversationId } = useParams();
  const { t, i18n } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const runtime = useRuntime();
  const now = useNow(1000); // delivered and seen show the moment their time comes
  const lang = i18n.language === 'fil' ? 'fil' : 'en';

  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null); // { url } | { art }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const clientId = useRef(null); // one id per message being written: a retry is not a second message
  const arts = useRef(0);

  const thread = useMemo(() => threadOf(state, viewer, conversationId, now), [state, viewer, conversationId, now]);
  const people = useMemo(() => (thread ? threadPeopleOf(state, viewer, thread.conversation) : []), [state, viewer, thread]);
  const names = useMemo(() => senderNamesOf(state, viewer, conversationId), [state, viewer, conversationId]);
  const appointment = useMemo(() => (thread?.conversation.kind === 'midwife' ? teleconsultOf(state, viewer, now) : null), [state, viewer, thread, now]);
  const offline = state.meta.connection === 'offline';

  // The chat takes the whole page: the message box sits above the tab bar and the page has no gear space at its foot.
  useEffect(() => {
    document.documentElement.dataset.chat = 'true';
    return () => {
      delete document.documentElement.dataset.chat;
    };
  }, []);

  // She has the thread open: what the other side wrote is seen, so their messages show as read and the bell clears.
  const unseen = thread ? unseenFrom(thread.messages, viewer.id).length : 0;
  useEffect(() => {
    if (unseen > 0) actions.mark_seen(conversationId);
  }, [unseen, conversationId, actions]);

  const open = thread?.lock.open === true;

  const send = useCallback(async () => {
    if (!thread) return;
    setError(null);
    clientId.current ??= newClientId();
    setBusy(true);
    const result = await actions.send_message({
      conversation_id: conversationId,
      body: text,
      attachment_url: attachment?.url ?? null,
      attachment_art: attachment?.art ?? null,
      client_id: clientId.current,
    });
    setBusy(false);
    if (result.ok) {
      clientId.current = null;
      setText('');
      setAttachment(null);
    } else setError(result.errors?.body ?? result.error);
  }, [thread, actions, conversationId, text, attachment]);

  async function pick(file) {
    setError(null);
    const problem = photoProblem(file);
    if (problem) return setError(problem);
    try {
      setAttachment({ url: await downscaleAttachment(file, CHAT.photoMaxSide, CHAT.photoQuality) });
    } catch {
      setError('unreadable');
    }
    return undefined;
  }

  const incoming = useCallback(() => {
    runtime.engine.start('incoming-message', { patientId: viewer.id, actorId: viewer.id, actorRole: 'patient', conversationId });
  }, [runtime, viewer, conversationId]);
  const attachDrawn = useCallback(() => {
    setAttachment({ art: ATTACHMENT_ARTS[arts.current % ATTACHMENT_ARTS.length] });
    arts.current += 1;
  }, []);

  usePresenterActions(
    thread
      ? [
          { id: 'incoming-message', labelKey: 'presenter:scenario.incomingMessage', onSelect: incoming, disabled: !open },
          { id: 'attach-photo', labelKey: 'presenter:action.attachPhoto', onSelect: attachDrawn, disabled: !open },
        ]
      : [],
  );

  if (!viewer || viewer.role !== 'patient') return <Navigate to="/" replace />;
  if (!thread) return <Navigate to="/patient/consult" replace />;

  const { conversation, lock } = thread;
  const title = threadName(t, conversation, people);
  const peopleNames = people.map((p) => p.name).join(', ');
  const failure = error ? t(`error.${error}`) : null;

  return (
    <section className="chat">
      <header className="chat__header">
        <Link className="icon-btn" to="/patient/consult" aria-label={t('chat.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <div className="chat__heading">
          <h1 className="chat__title">{title}</h1>
          {conversation.kind === 'barangay' && peopleNames ? <p className="card__meta">{t('chat.with', { names: peopleNames })}</p> : null}
          {conversation.kind === 'midwife' && lock.open ? <p className="card__meta">{t('chat.openUntil', { when: formatDateTime(lock.until, lang) })}</p> : null}
        </div>
      </header>

      {appointment && open ? (
        <div className="chat__join">
          <JoinButton appointment={appointment} now={now} block={false} />
        </div>
      ) : null}

      {!lock.open ? (
        <Banner status="info" title={t('chat.lockedTitle')}>
          {lockText(t, lock.reason, true)}
        </Banner>
      ) : null}

      {thread.messages.length > 0 || lock.open ? <ChatThread messages={thread.messages} viewerId={viewer.id} names={names} now={now} lang={lang} label={title} /> : <div className="chat__empty" />}

      {lock.open ? (
        <Composer
          value={text}
          onChange={setText}
          attachment={attachment}
          onPickFile={pick}
          onRemoveAttachment={() => setAttachment(null)}
          onSend={send}
          busy={busy}
          error={failure}
          note={offline ? t('composer.waiting') : null}
        />
      ) : (
        <div className="chat__locked">
          <Lock size={20} aria-hidden="true" />
          <span>{t('threads.locked')}</span>
        </div>
      )}
    </section>
  );
}

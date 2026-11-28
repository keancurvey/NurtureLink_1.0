import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, UserRound, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import ChatThread from '../../components/ui/ChatThread.jsx';
import Composer from '../../components/ui/Composer.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { CHAT } from '../../config/thresholds.js';
import { joinState, newClientId } from '../../lib/consult.js';
import { formatDateLong, formatTime } from '../../lib/format.js';
import { manilaDate } from '../../lib/dates.js';
import { downscaleAttachment, photoProblem } from '../../lib/photo.js';
import { useActions, useRuntime, useStoreState, useViewer } from '../../store/hooks.js';
import { latestCheck, officeThreadOf, senderNamesOf, thresholdsOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import LatestVitals from '../monitor/LatestVitals.jsx';

/** The patient's latest vitals beside the chat (SUP-C-02). Opening them is written to the access log, like opening the record. */
function VitalsSheet({ patientId, name, onClose }) {
  const { t } = useTranslation('tracker');
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const logged = useRef(false);
  useEffect(() => {
    if (!logged.current) {
      logged.current = true;
      actions.open_record(patientId, 'view_vitals');
    }
  }, [patientId, actions]);
  return (
    <Sheet open onClose={onClose} title={t('chat.latest')}>
      <div className="stack">
        <p className="card__meta">{name}</p>
        <LatestVitals session={latestCheck(state, viewer, patientId)} thresholds={thresholdsOf(state)} />
        <Link className="btn btn--ghost btn--block" to={`/super/patient/${patientId}`}>
          {t('chat.profile')}
        </Link>
      </div>
    </Sheet>
  );
}

/**
 * A super account's conversation with one patient (SUP-C-02): the midwife chat of a visit assigned to it, with her profile and latest
 * vitals one tap away and Join video for the assigned midwife. The inbox of a barangay with no active account looks the same. Route:
 * /super/consult/chat/:conversationId.
 */
export default function OfficeChat() {
  const { conversationId } = useParams();
  const { t, i18n } = useTranslation('tracker');
  const { t: tc } = useTranslation('consult');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const runtime = useRuntime();
  const now = useNow(1000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [vitals, setVitals] = useState(false);
  const clientId = useRef(null);
  const closeVitals = useCallback(() => setVitals(false), []);

  const thread = useMemo(() => officeThreadOf(state, viewer, conversationId, now), [state, viewer, conversationId, now]);
  const names = useMemo(() => (thread ? senderNamesOf(state, viewer, thread.conversation.id) : new Map()), [state, viewer, thread]);
  const offline = state.meta.connection === 'offline';

  // The chat takes the whole page: the message box sits above the tab bar.
  useEffect(() => {
    document.documentElement.dataset.chat = 'true';
    return () => {
      delete document.documentElement.dataset.chat;
    };
  }, []);

  // The thread is open: what the patient wrote is seen, and the bells clear.
  const unseen = thread ? thread.unread : 0;
  useEffect(() => {
    if (unseen > 0) actions.mark_seen(conversationId);
  }, [unseen, conversationId, actions]);

  const send = useCallback(async () => {
    if (!thread) return;
    setError(null);
    clientId.current ??= newClientId();
    setBusy(true);
    const result = await actions.send_message({ conversation_id: thread.conversation.id, body: text, attachment_url: attachment?.url ?? null, attachment_art: null, client_id: clientId.current });
    setBusy(false);
    if (result.ok) {
      clientId.current = null;
      setText('');
      setAttachment(null);
    } else setError(result.errors?.body ?? result.error);
  }, [thread, actions, text, attachment]);

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

  // The gear's Incoming message acts on the patient whose midwife chat is open.
  const patientId = thread?.conversation.patient_id;
  const midwifeChat = thread?.conversation.kind === 'midwife';
  const incoming = useCallback(() => {
    runtime.engine.start('incoming-message', { patientId, actorId: viewer.id, actorRole: 'super' });
  }, [runtime, patientId, viewer]);
  usePresenterActions(midwifeChat ? [{ id: 'incoming-message', labelKey: 'presenter:scenario.incomingMessage', onSelect: incoming }] : []);

  if (!viewer || viewer.role !== 'super') return <Navigate to="/" replace />;
  if (!thread) return <Navigate to="/super/consult?view=chats" replace />;

  const { conversation, patient, lock } = thread;
  const name = patient.full_name;
  const appointment = conversation.appointment_id ? state.db.appointments.find((a) => a.id === conversation.appointment_id) : null;
  const join = joinState(appointment, now);
  const assignee = appointment?.provider_id ? state.db.profiles.find((p) => p.id === appointment.provider_id) : null;
  const mine = appointment?.provider_id === viewer.id;
  const failure = error ? tc(`error.${error}`) : null;
  return (
    <section className="chat">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/super/consult?view=chats" aria-label={t('chat.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <div className="chat__heading">
          <h1 className="chat__title">{name}</h1>
          <p className="card__meta">{t(`chat.kind.${conversation.kind}`)}</p>
        </div>
        <Button variant="ghost" onClick={() => setVitals(true)}>
          <Activity size={20} aria-hidden="true" />
          {t('chat.latest')}
        </Button>
        <Link className="btn btn--ghost" to={`/super/patient/${patient.id}`}>
          <UserRound size={20} aria-hidden="true" />
          {t('chat.profile')}
        </Link>
      </header>

      {midwifeChat && appointment && join.state !== 'unavailable' && join.state !== 'over' ? (
        <div className="office-join">
          <p className="card__meta">{t('chat.visit', { date: formatDateLong(manilaDate(appointment.scheduled_at), lang), time: formatTime(appointment.scheduled_at, lang) })}</p>
          {mine ? (
            join.state === 'open' ? (
              <Link className="btn btn--primary" to={`/super/consult/call/${appointment.id}`}>
                <Video size={24} aria-hidden="true" />
                {t('chat.join')}
              </Link>
            ) : (
              <>
                <Button disabled>
                  <Video size={24} aria-hidden="true" />
                  {t('chat.join')}
                </Button>
                <p className="card__meta">{t('chat.joinEarly', { time: formatTime(join.opens, lang) })}</p>
              </>
            )
          ) : (
            <p className="card__meta">{t('chat.joinOwner', { name: assignee?.full_name ?? '' })}</p>
          )}
        </div>
      ) : null}

      <ChatThread messages={thread.messages} viewerId={viewer.id} names={names} now={now} lang={lang} label={name} emptyText={t('chat.emptyThread', { name })} />

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
          note={offline ? t('chat.waiting') : null}
        />
      ) : (
        <p className="chat__locked" role="status">
          {t(`chat.locked.${lock.reason}`)}
        </p>
      )}
      {vitals ? <VitalsSheet patientId={patient.id} name={name} onClose={closeVitals} /> : null}
    </section>
  );
}

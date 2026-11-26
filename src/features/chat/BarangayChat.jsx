import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/ui/Button.jsx';
import ChatThread from '../../components/ui/ChatThread.jsx';
import Composer from '../../components/ui/Composer.jsx';
import Sheet from '../../components/ui/Sheet.jsx';
import { usePresenterActions } from '../../components/presenter/presenterRegistry.jsx';
import { CHAT } from '../../config/thresholds.js';
import { newClientId } from '../../lib/consult.js';
import { downscaleAttachment, photoProblem } from '../../lib/photo.js';
import { useActions, useRuntime, useStoreState, useViewer } from '../../store/hooks.js';
import { inboxThreadOf, latestCheck, senderNamesOf, thresholdsOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import LatestVitals from '../monitor/LatestVitals.jsx';

/** The patient's latest vitals one tap away (BRG-C-01). Opening them is written to the access log, like opening the record. */
function VitalsSheet({ patientId, name, onClose }) {
  const { t } = useTranslation('monitor');
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
    <Sheet open onClose={onClose} title={t('chat.vitalsTitle', { name })}>
      <div className="stack">
        <LatestVitals session={latestCheck(state, viewer, patientId)} thresholds={thresholdsOf(state)} />
        <Link className="btn btn--ghost btn--block" to={`/barangay/monitor/${patientId}`}>
          {t('chat.openPatient')}
        </Link>
      </div>
    </Sheet>
  );
}

/** The shared inbox with one patient (BRG-C-01, ACC-03): any account of the barangay can reply, every message shows its sender's name, and read state is shared. Route: /barangay/chat/:patientId. */
export default function BarangayChat() {
  const { patientId } = useParams();
  const { t, i18n } = useTranslation('monitor');
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

  const thread = useMemo(() => inboxThreadOf(state, viewer, patientId), [state, viewer, patientId]);
  const names = useMemo(() => (thread ? senderNamesOf(state, viewer, thread.conversation.id) : new Map()), [state, viewer, thread]);
  const offline = state.meta.connection === 'offline';

  // The chat takes the whole page: the message box sits above the tab bar and the page has no gear space at its foot.
  useEffect(() => {
    document.documentElement.dataset.chat = 'true';
    return () => {
      delete document.documentElement.dataset.chat;
    };
  }, []);

  // The thread is open: what the patient wrote is seen for every account of the barangay, and their bells clear.
  const unseen = thread ? thread.unread : 0;
  const conversationId = thread?.conversation.id;
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

  // The gear's Incoming message acts on the patient whose thread is open (it replaces the one in Scenarios while this screen is open).
  const incoming = useCallback(() => {
    runtime.engine.start('incoming-message', { patientId, actorId: viewer.id, actorRole: 'barangay' });
  }, [runtime, patientId, viewer]);
  usePresenterActions(thread ? [{ id: 'incoming-message', labelKey: 'presenter:scenario.incomingMessage', onSelect: incoming }] : []);

  if (!viewer || viewer.role !== 'barangay') return <Navigate to="/" replace />;
  if (!thread) return <Navigate to="/barangay/chat" replace />;

  const name = thread.patient.full_name;
  const failure = error ? tc(`error.${error}`) : null;
  return (
    <section className="chat">
      <header className="chat__header">
        <Link className="icon-btn icon-btn--fixed" to="/barangay/chat" aria-label={t('chat.back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </Link>
        <div className="chat__heading">
          <h1 className="chat__title">{name}</h1>
          <p className="card__meta">{t('chat.shared')}</p>
        </div>
        <Button variant="ghost" onClick={() => setVitals(true)}>
          <Activity size={20} aria-hidden="true" />
          {t('chat.vitals')}
        </Button>
      </header>

      <ChatThread messages={thread.messages} viewerId={viewer.id} names={names} now={now} lang={lang} label={name} emptyText={t('chat.emptyThread', { name })} />

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
      {vitals ? <VitalsSheet patientId={patientId} name={name} onClose={closeVitals} /> : null}
    </section>
  );
}

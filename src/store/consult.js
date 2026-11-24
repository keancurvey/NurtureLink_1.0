// What a patient does in Consult (PAT-C-02, PAT-C-03, PAT-C-06): write to her barangay's health accounts or to the midwife,
// and read what they wrote. Access follows spec 6.2: she reaches only her own two threads, and the midwife thread takes
// messages only while it is open. A message made offline waits on the phone with a client id (syncState 'queued'), is hidden
// from providers and goes out with the queue (core.flushQueue). Screens reach these through the wrappers in actions.js;
// replacing them with calls to a real backend is the only change needed to go live.
import { canReadConversation } from '../lib/permissions.js';
import { threadLock, validAttachment, validateMessage } from '../lib/consult.js';
import { byId } from './ops.js';
import { viewerOf } from './selectors.js';

export function createConsult({ store, core, now = Date.now }) {
  const state = () => store.getState();
  const patient = () => {
    const viewer = viewerOf(state());
    return viewer?.active && viewer.role === 'patient' ? viewer : null;
  };
  const threadOf = (me, conversationId) => {
    const conversation = byId(state().db.conversations).get(conversationId) ?? null;
    return conversation && canReadConversation(me, conversation, me) ? conversation : null;
  };

  return {
    /**
     * Send a message: { conversation_id, body, attachment_url | attachment_art, client_id }. Answers { ok, queued, message }
     * (also for a client id already held: { ok, duplicate }) or { ok: false, error, errors? } with error one of not_allowed,
     * not_found, locked (with reason), form, photo.
     */
    sendMessage({ conversation_id, body = '', attachment_url = null, attachment_art = null, client_id = null }) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      const conversation = threadOf(me, conversation_id);
      if (!conversation) return { ok: false, error: 'not_found' };
      const lock = threadLock(conversation, now());
      if (!lock.open) return { ok: false, error: 'locked', reason: lock.reason };
      if (!validAttachment({ attachment_url, attachment_art })) return { ok: false, error: 'photo' };
      const problem = validateMessage({ body, attachment: attachment_url !== null || attachment_art !== null });
      if (problem) return { ok: false, error: 'form', errors: { body: problem } };
      const { message, duplicate } = core.sendMessage({
        conversation_id: conversation.id,
        sender_id: me.id,
        body: body.trim(),
        attachment_url,
        attachment_art,
        client_id,
      });
      return { ok: true, queued: message.syncState === 'queued', duplicate, message };
    },

    /**
     * She has the thread open: what the other side wrote is seen, and its notifications are read. Answers { ok, count }.
     */
    markSeen(conversation_id) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      const conversation = threadOf(me, conversation_id);
      if (!conversation) return { ok: false, error: 'not_found' };
      const at = now();
      const db = state().db;
      const unseen = db.messages.filter((m) => m.conversation_id === conversation.id && m.sender_id !== me.id && !m.seen_at && m.syncState !== 'queued');
      const told = db.notifications.filter((n) => n.profile_id === me.id && n.type === 'message' && n.payload.conversation_id === conversation.id && !n.read_at);
      core.commit([
        { op: 'updateMany', table: 'messages', patches: unseen.map((m) => ({ id: m.id, patch: { seen_at: at } })) },
        { op: 'updateMany', table: 'notifications', patches: told.map((n) => ({ id: n.id, patch: { read_at: at } })) },
      ]);
      return { ok: true, count: unseen.length };
    },
  };
}

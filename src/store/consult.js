// What a patient and a barangay account do in a conversation (PAT-C-02, PAT-C-03, PAT-C-06, ACC-03): write, and read what the
// other side wrote. Access follows spec 6.2: a patient reaches only her own two threads, and the midwife thread takes
// messages only while it is open; a barangay account reaches the shared inbox of each patient of its own barangay, and read
// state is shared by all its accounts. A message made offline waits on the phone with a client id (syncState 'queued'), is
// hidden from the other side and goes out with the queue (core.flushQueue). Screens reach these through the wrappers in
// actions.js; replacing them with calls to a real backend is the only change needed to go live.
import { canReadConversation } from '../lib/permissions.js';
import { threadLock, validAttachment, validateMessage } from '../lib/consult.js';
import { byId } from './ops.js';
import { profileOf, viewerOf } from './selectors.js';

export function createConsult({ store, core, now = Date.now }) {
  const state = () => store.getState();
  /** The signed-in account that may write: a patient or a barangay account. */
  const account = () => {
    const viewer = viewerOf(state());
    return viewer?.active && (viewer.role === 'patient' || viewer.role === 'barangay') ? viewer : null;
  };
  const threadOf = (me, conversationId) => {
    const conversation = byId(state().db.conversations).get(conversationId) ?? null;
    return conversation && canReadConversation(me, conversation, profileOf(state(), conversation.patient_id)) ? conversation : null;
  };

  return {
    /**
     * Send a message as a patient or as a barangay account: { conversation_id, body, attachment_url | attachment_art, client_id }. Answers { ok, queued, message }
     * (also for a client id already held: { ok, duplicate }) or { ok: false, error, errors? } with error one of not_allowed,
     * not_found, locked (with reason), form, photo.
     */
    sendMessage({ conversation_id, body = '', attachment_url = null, attachment_art = null, client_id = null }) {
      const me = account();
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
     * The thread is open on this account's screen: what the other side wrote is seen, and its notifications are read. For a
     * barangay account the read state is shared (ACC-03): the patient's messages are seen for all the accounts of the
     * barangay, and the bells of all of them clear. Answers { ok, count }.
     */
    markSeen(conversation_id) {
      const me = account();
      if (!me) return { ok: false, error: 'not_allowed' };
      const conversation = threadOf(me, conversation_id);
      if (!conversation) return { ok: false, error: 'not_found' };
      const at = now();
      const db = state().db;
      const isPatient = me.role === 'patient';
      const unseen = db.messages.filter(
        (m) => m.conversation_id === conversation.id && !m.seen_at && m.syncState !== 'queued' && (isPatient ? m.sender_id !== me.id : m.sender_id === conversation.patient_id),
      );
      const readers = new Set(isPatient ? [me.id] : db.profiles.filter((p) => p.role === 'barangay' && p.barangay_id === conversation.barangay_id).map((p) => p.id));
      const told = db.notifications.filter((n) => readers.has(n.profile_id) && n.type === 'message' && n.payload.conversation_id === conversation.id && !n.read_at);
      core.commit([
        { op: 'updateMany', table: 'messages', patches: unseen.map((m) => ({ id: m.id, patch: { seen_at: at } })) },
        { op: 'updateMany', table: 'notifications', patches: told.map((n) => ({ id: n.id, patch: { read_at: at } })) },
      ]);
      return { ok: true, count: unseen.length };
    },
  };
}

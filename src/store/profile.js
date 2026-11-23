// What a patient changes about herself (PAT-P-01, PAT-P-03, PAT-A-06): her contact and emergency contact, her photo, and the
// choice about keeping her questions to Hele AI. Access follows spec 6.2: a patient edits only her own contact details;
// LMP, EDD, risk notes and visit notes are the providers' and are not reachable from here. Edits made offline wait on
// the phone (patients.queued_edit) and are applied when the connection is back; until then providers see the old values.
// Screens reach these through the wrappers in actions.js; replacing them with calls to a real backend is the only change
// needed to go live.
import { AUTH } from '../config/thresholds.js';
import { formatPhone, identifierKey } from '../lib/authRules.js';
import { AVATAR_CHOICES, validatePersonal } from '../lib/profileRules.js';
import { byId } from './ops.js';
import { viewerOf } from './selectors.js';

/** A photo is a small JPEG data URL (lib/photo.js makes it); anything else is refused. */
const PHOTO_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const PHOTO_MAX_CHARS = 300000;

export function createProfileService({ store, core, now = Date.now }) {
  const state = () => store.getState();
  const patient = () => {
    const viewer = viewerOf(state());
    return viewer?.active && viewer.role === 'patient' ? viewer : null;
  };

  /** Apply an edit now when online; offline, keep it with her patient row until the queue is sent. */
  function save(me, edit) {
    if (core.isOnline()) {
      core.commit(core.personalEditOps(me.id, edit));
      return { ok: true, queued: false };
    }
    const row = byId(state().db.patients).get(me.id);
    const merged = { ...(row.queued_edit?.values ?? {}), ...edit };
    core.commit([{ op: 'update', table: 'patients', id: me.id, patch: { queued_edit: { at: now(), values: merged } } }]);
    return { ok: true, queued: true };
  }

  return {
    /**
     * Contact number, emergency contact name, relationship and number. Answers { ok, queued } or { ok: false, error: 'form', errors }.
     * Her contact number is also her sign-in, so another account's number is refused ('taken').
     */
    savePersonal(values) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      const errors = validatePersonal(values);
      if (!errors.contact_no) {
        const key = identifierKey(values.contact_no);
        if (state().db.profiles.some((p) => p.id !== me.id && p.contact_no && identifierKey(p.contact_no) === key)) errors.contact_no = 'taken';
      }
      if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
      return save(me, {
        contact_no: formatPhone(values.contact_no),
        emergency_name: values.emergency_name.trim().replace(/\s+/g, ' '),
        emergency_relationship: values.emergency_relationship,
        emergency_no: formatPhone(values.emergency_no),
      });
    },

    /** Her photo: a small picture made on the phone, one of the drawn avatars, or neither (the initials). */
    setPhoto({ photo_url = null, avatar_art = null } = {}) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      const photoOk = photo_url === null || (typeof photo_url === 'string' && photo_url.length <= PHOTO_MAX_CHARS && PHOTO_URL.test(photo_url));
      const artOk = avatar_art === null || AVATAR_CHOICES.includes(avatar_art);
      if (!photoOk || !artOk || (photo_url !== null && avatar_art !== null)) return { ok: false, error: 'invalid' };
      return save(me, { photo_url, avatar_art });
    },

    /**
     * The switch for keeping her questions to Hele AI, anonymised (PAT-A-06). Turning it on records the consent (version and
     * time); turning it off records the withdrawal. Off until she turns it on.
     */
    setHeleLogging(on) {
      const me = patient();
      if (!me) return { ok: false, error: 'not_allowed' };
      const at = now();
      const row = state().db.consents.find((c) => c.profile_id === me.id && c.document === 'hele_question_logging');
      if (on) {
        if (row && !row.withdrawn_at) return { ok: true, on: true };
        if (row) core.commit([{ op: 'update', table: 'consents', id: row.id, patch: { version: AUTH.heleLoggingVersion, accepted_at: at, withdrawn_at: null } }]);
        else core.commit([{ op: 'insert', table: 'consents', row: { id: core.id('con'), profile_id: me.id, document: 'hele_question_logging', version: AUTH.heleLoggingVersion, accepted_at: at, withdrawn_at: null } }]);
        return { ok: true, on: true };
      }
      if (row && !row.withdrawn_at) core.commit([{ op: 'update', table: 'consents', id: row.id, patch: { withdrawn_at: at } }]);
      return { ok: true, on: false };
    },
  };
}

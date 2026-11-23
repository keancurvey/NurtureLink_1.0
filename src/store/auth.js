// The sign-in side of the in-process server (spec 7.4, Auth): sign-up for patients, sign-in for all roles, password
// reset, the forced first-login password change, consent records, and the provider session. Screens reach it through
// the latency wrapper in actions.js. Replacing it with calls to a real auth service is the only change needed to go live.
import { AUTH } from '../config/thresholds.js';
import {
  formatPhone,
  identifierKey,
  validateGuardian,
  validateNewPassword,
  validateSignIn,
  validateSignUp,
} from '../lib/authRules.js';
import { MS_MINUTE, manilaDate } from '../lib/dates.js';
import { isProviderRole } from '../lib/permissions.js';
import { byId } from './ops.js';
import { barangayChoices, profileByIdentifier, viewerOf } from './selectors.js';

const TOUCH_EVERY_MS = 15000;

/** A six digit code that depends on the account and the moment it was asked for, so tests and the gear can know it. */
function codeFor(profileId, at) {
  let hash = 7;
  for (const char of `${profileId}:${at}`) hash = (hash * 31 + char.charCodeAt(0)) % 900000;
  return String(100000 + hash);
}

export function createAuth({ store, core, setSession, now = Date.now }) {
  const state = () => store.getState();
  const commit = core.commit;
  const credentialOf = (profileId) => byId(state().db.credentials).get(profileId) ?? null;
  const viewer = () => viewerOf(state());

  // ---------- Throttling of failed sign-ins (spec 10) ----------
  const failuresOf = (key) => state().meta.auth_failures?.[key] ?? { count: 0, locked_until: 0 };
  const writeFailures = (key, entry) => {
    const next = { ...(state().meta.auth_failures ?? {}) };
    if (entry) next[key] = entry;
    else delete next[key];
    commit([{ op: 'meta', patch: { auth_failures: next } }]);
  };
  const lockedFor = (key) => Math.max(0, failuresOf(key).locked_until - now());

  function registerFailure(key) {
    const { count } = failuresOf(key);
    if (count + 1 >= AUTH.maxFailedSignIns) {
      writeFailures(key, { count: 0, locked_until: now() + AUTH.lockSeconds * 1000 });
      return { ok: false, error: 'locked', retryAfterMs: AUTH.lockSeconds * 1000 };
    }
    writeFailures(key, { count: count + 1, locked_until: 0 });
    return { ok: false, error: 'invalid' };
  }

  function startSession(profile) {
    const at = now();
    setSession({ profile_id: profile.id, signed_in_at: at, last_active_at: at });
    store.dispatch({ type: 'live', patch: { notice: null } });
  }

  // ---------- Sign in, sign up, sign out ----------

  function signIn({ identifier, password }) {
    const errors = validateSignIn({ identifier, password });
    if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
    const key = identifierKey(identifier);
    const wait = lockedFor(key);
    if (wait > 0) return { ok: false, error: 'locked', retryAfterMs: wait };
    const profile = profileByIdentifier(state(), identifier);
    if (!profile || credentialOf(profile.id)?.password !== password) return registerFailure(key);
    if (!profile.active) return { ok: false, error: 'inactive' };
    writeFailures(key, null);
    startSession(profile);
    return { ok: true, profile };
  }

  /** AUTH-02: a patient registers herself. The account exists at once; the consent screens follow. */
  function signUp(values) {
    const errors = validateSignUp(values, { today: manilaDate(now()), barangayIds: barangayChoices(state()).map((b) => b.id) });
    if (!errors.contact_no && profileByIdentifier(state(), values.contact_no)) errors.contact_no = 'taken';
    if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
    const at = now();
    const profileId = core.id('pro');
    const profile = {
      id: profileId,
      role: 'patient',
      full_name: values.full_name.trim().replace(/\s+/g, ' '),
      name_suffix: null,
      title: null,
      contact_no: formatPhone(values.contact_no),
      email: null,
      language: values.language,
      photo_url: null,
      avatar_art: null,
      barangay_id: values.barangay_id,
      active: true,
      created_by: null,
      created_at: at,
    };
    commit([
      { op: 'insert', table: 'profiles', row: profile },
      {
        op: 'insert',
        table: 'patients',
        row: {
          id: profileId,
          profile_id: profileId,
          birthdate: values.birthdate,
          address: null,
          civil_status: null,
          emergency_name: null,
          emergency_relationship: null,
          emergency_no: null,
        },
      },
      { op: 'insert', table: 'credentials', row: { id: profileId, profile_id: profileId, password: values.password, must_change_password: false } },
    ]);
    startSession(profile);
    return { ok: true, profile };
  }

  function signOut() {
    setSession(null);
  }

  /** Gear → Switch account: signs out and signs in as the chosen account without a password. */
  function signInAs(profileId) {
    const profile = byId(state().db.profiles).get(profileId);
    if (!profile?.active) return { ok: false, error: 'unknown' };
    startSession(profile);
    return { ok: true, profile };
  }

  // ---------- Consent (AUTH-05, AUTH-06) ----------

  function acceptConsent() {
    const who = viewer();
    if (!who) return { ok: false, error: 'signed_out' };
    commit([
      {
        op: 'insert',
        table: 'consents',
        row: { id: core.id('con'), profile_id: who.id, document: 'terms_privacy', version: AUTH.termsVersion, accepted_at: now() },
      },
    ]);
    return { ok: true, version: AUTH.termsVersion };
  }

  function saveGuardianConsent(values) {
    const who = viewer();
    if (!who) return { ok: false, error: 'signed_out' };
    const errors = validateGuardian(values);
    if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
    commit([
      {
        op: 'insert',
        table: 'guardian_consents',
        row: {
          id: core.id('gcon'),
          profile_id: who.id,
          guardian_name: values.guardian_name.trim().replace(/\s+/g, ' '),
          relationship: values.relationship,
          contact: formatPhone(values.contact),
          signed_at: now(),
        },
      },
    ]);
    return { ok: true };
  }

  // ---------- Passwords (AUTH-03, AUTH-08) ----------

  /** The forced change on a provider's first sign-in, and any later change by a signed-in person. */
  function changePassword({ password, current }) {
    const who = viewer();
    if (!who) return { ok: false, error: 'signed_out' };
    // From Settings the person gives the password she has now (the forced first-login change does not ask). The server does this, so it needs the connection.
    if (current !== undefined) {
      if (!core.isOnline()) return { ok: false, error: 'offline' };
      if (credentialOf(who.id)?.password !== current) return { ok: false, error: 'form', errors: { current: 'wrong' } };
    }
    const errors = validateNewPassword({ password }, { current: credentialOf(who.id)?.password ?? null });
    if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
    commit([{ op: 'update', table: 'credentials', id: who.id, patch: { password, must_change_password: false } }]);
    return { ok: true };
  }

  /**
   * Step one of the reset. A patient gets a code (it is only "sent": the product would text it); a provider account is
   * told to contact the Municipal Health Office; a number nobody uses looks the same as a patient's, so the form never
   * says who has an account.
   */
  function requestPasswordReset({ identifier }) {
    const errors = validateSignIn({ identifier, password: 'x' });
    if (errors.identifier) return { ok: false, error: 'form', errors: { identifier: errors.identifier } };
    const profile = profileByIdentifier(state(), identifier);
    if (profile && isProviderRole(profile.role)) return { ok: true, outcome: 'provider' };
    if (profile) {
      const at = now();
      commit([
        {
          op: 'update',
          table: 'credentials',
          id: profile.id,
          patch: { reset_code: codeFor(profile.id, at), reset_expires_at: at + AUTH.resetCodeMinutes * MS_MINUTE },
        },
      ]);
    }
    return { ok: true, outcome: 'code_sent' };
  }

  function codeMatches(identifier, code) {
    const profile = profileByIdentifier(state(), identifier);
    const credential = profile ? credentialOf(profile.id) : null;
    const ok = Boolean(credential?.reset_code) && credential.reset_code === String(code ?? '').trim() && credential.reset_expires_at > now();
    return ok ? profile : null;
  }

  function verifyResetCode({ identifier, code }) {
    return codeMatches(identifier, code) ? { ok: true } : { ok: false, error: 'code' };
  }

  function resetPassword({ identifier, code, password }) {
    const profile = codeMatches(identifier, code);
    if (!profile) return { ok: false, error: 'code' };
    const errors = validateNewPassword({ password });
    if (Object.keys(errors).length > 0) return { ok: false, error: 'form', errors };
    commit([
      { op: 'update', table: 'credentials', id: profile.id, patch: { password, must_change_password: false, reset_code: null, reset_expires_at: null } },
    ]);
    writeFailures(identifierKey(identifier), null);
    return { ok: true };
  }

  // ---------- The provider session (AUTH-08) and the language on the account (COM-02) ----------

  /** The session ended for lack of activity: signed out, and the sign-in screen says why. */
  function expireSession() {
    setSession(null);
    store.dispatch({ type: 'live', patch: { notice: 'session_expired' } });
  }

  const dismissNotice = () => store.dispatch({ type: 'live', patch: { notice: null } });

  /** Remember that a provider is still active, so a page reopened after the timeout starts signed out. */
  function touch() {
    const session = state().session;
    const who = viewer();
    if (!session || !who || !isProviderRole(who.role)) return;
    if (now() - (session.last_active_at ?? 0) < TOUCH_EVERY_MS) return;
    setSession({ ...session, last_active_at: now() });
  }

  function saveLanguage(language) {
    const who = viewer();
    if (who && who.language !== language) commit([{ op: 'update', table: 'profiles', id: who.id, patch: { language } }]);
  }

  return {
    signIn,
    signUp,
    signOut,
    signInAs,
    acceptConsent,
    saveGuardianConsent,
    changePassword,
    requestPasswordReset,
    verifyResetCode,
    resetPassword,
    expireSession,
    dismissNotice,
    touch,
    saveLanguage,
  };
}

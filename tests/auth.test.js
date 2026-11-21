import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH } from '../src/config/thresholds.js';
import {
  GUARDIAN_RELATIONSHIPS,
  ageOn,
  formatPhone,
  identifierKey,
  isMinor,
  isPhoneNumber,
  isStrongPassword,
  passwordChecks,
  validateGuardian,
  validateNewPassword,
  validateSignIn,
  validateSignUp,
} from '../src/lib/authRules.js';
import { createIdleTimer } from '../src/lib/idleTimer.js';
import { GATE_PATHS, PRESENTER_ACCOUNTS, TABS, gateStep, gearConfigFor, landingPath } from '../src/lib/permissions.js';
import { PASSWORD } from '../src/sim/seedData.js';
import { buildState } from '../src/store/runtime.js';
import * as sel from '../src/store/selectors.js';
import { MARICEL, NOW, makeRuntime } from './helpers.js';

const TODAY = '2026-11-08';
const BARANGAY_IDS = ['papaya', 'san-jose'];

// ---------- Contact numbers, passwords, birthdates ----------

test('a Philippine mobile number is accepted in its usual spellings and stored as 0917 555 0201', () => {
  for (const raw of ['0917 555 0201', '09175550201', '0917-555-0201', '+63 917 555 0201', '639175550201', '917 555 0201']) {
    assert.ok(isPhoneNumber(raw), raw);
    assert.equal(formatPhone(raw), '0917 555 0201', raw);
    assert.equal(identifierKey(raw), '09175550201', raw);
  }
  for (const raw of ['', '12345', '0817 555 0201', '0917 555 020', 'maricel', '0917 555 02011']) assert.equal(isPhoneNumber(raw), false, raw);
});

test('an email is compared in lower case and a number by its digits', () => {
  assert.equal(identifierKey('  Rowena.Macaraig@NurtureLink.ph '), 'rowena.macaraig@nurturelink.ph');
  assert.equal(identifierKey('0917 555 0201'), identifierKey('+639175550201'));
});

test('age counts whole years and under 18 is a minor, around the birthday', () => {
  assert.equal(ageOn('2010-11-08', TODAY), 16);
  assert.equal(ageOn('2010-11-09', TODAY), 15, 'the day before her birthday');
  assert.equal(ageOn('2008-11-08', TODAY), 18);
  assert.equal(isMinor('2008-11-09', TODAY), true);
  assert.equal(isMinor('2008-11-08', TODAY), false);
});

test('a strong password has length, upper case, lower case and a number; the seeded password is strong', () => {
  assert.deepEqual(passwordChecks('Abcdef12').map((c) => c.ok), [true, true, true, true]);
  assert.equal(isStrongPassword(PASSWORD), true);
  for (const weak of ['', 'abcdefg1', 'ABCDEFG1', 'Abcdefgh', 'Ab1']) assert.equal(isStrongPassword(weak), false, weak);
  assert.equal(passwordChecks('Ab1').find((c) => c.id === 'length').ok, false);
});

// ---------- Form rules ----------

test('the sign-in form needs a contact number or an email, and a password', () => {
  assert.deepEqual(validateSignIn({ identifier: '', password: '' }), { identifier: 'required', password: 'required' });
  assert.deepEqual(validateSignIn({ identifier: 'maricel', password: 'x' }), { identifier: 'identifier' });
  assert.deepEqual(validateSignIn({ identifier: '0917 555 0201', password: 'x' }), {});
  assert.deepEqual(validateSignIn({ identifier: 'rowena.macaraig@nurturelink.ph', password: 'x' }), {});
});

const goodSignUp = {
  full_name: 'Angelica Panganiban',
  birthdate: '2002-06-01',
  contact_no: '0917 555 0242',
  barangay_id: 'san-jose',
  password: 'Tingloy-Care-2026',
  language: 'en',
};
const rulesContext = { today: TODAY, barangayIds: BARANGAY_IDS };

test('the sign-up form checks every field of AUTH-02', () => {
  assert.deepEqual(validateSignUp(goodSignUp, rulesContext), {});
  assert.deepEqual(validateSignUp({}, rulesContext), {
    full_name: 'required', birthdate: 'required', contact_no: 'required', barangay_id: 'required', password: 'required', language: 'required',
  });
  assert.equal(validateSignUp({ ...goodSignUp, full_name: 'Angelica' }, rulesContext).full_name, 'fullName');
  assert.equal(validateSignUp({ ...goodSignUp, birthdate: '2027-01-01' }, rulesContext).birthdate, 'birthdate', 'not in the future');
  assert.equal(validateSignUp({ ...goodSignUp, birthdate: TODAY }, rulesContext).birthdate, 'birthdate', 'not today');
  assert.equal(validateSignUp({ ...goodSignUp, birthdate: '2002-02-31' }, rulesContext).birthdate, 'date');
  assert.equal(validateSignUp({ ...goodSignUp, birthdate: '1900-01-01' }, rulesContext).birthdate, 'birthdate');
  assert.equal(validateSignUp({ ...goodSignUp, contact_no: '12345' }, rulesContext).contact_no, 'phone');
  assert.equal(validateSignUp({ ...goodSignUp, barangay_id: 'manila' }, rulesContext).barangay_id, 'barangay', 'only one of the listed barangays');
  assert.equal(validateSignUp({ ...goodSignUp, password: 'short' }, rulesContext).password, 'weak');
  assert.equal(validateSignUp({ ...goodSignUp, language: 'es' }, rulesContext).language, 'required');
});

test('the guardian form needs a name, a relationship, a contact number and the acknowledgement (AUTH-06)', () => {
  const good = { guardian_name: 'Teresita Ilagan', relationship: 'mother', contact: '0917 555 0244', acknowledged: true };
  assert.deepEqual(validateGuardian(good), {});
  assert.deepEqual(validateGuardian({}), { guardian_name: 'required', relationship: 'required', contact: 'required', acknowledged: 'acknowledge' });
  assert.equal(validateGuardian({ ...good, acknowledged: false }).acknowledged, 'acknowledge');
  assert.equal(validateGuardian({ ...good, contact: '123' }).contact, 'phone');
  assert.ok(GUARDIAN_RELATIONSHIPS.includes('mother'));
});

test('a new password must be strong and different from the current one', () => {
  assert.deepEqual(validateNewPassword({ password: 'Tingloy-Care-2026' }, { current: PASSWORD }), {});
  assert.deepEqual(validateNewPassword({ password: PASSWORD }, { current: PASSWORD }), { password: 'same' });
  assert.deepEqual(validateNewPassword({ password: 'weak' }), { password: 'weak' });
  assert.deepEqual(validateNewPassword({ password: '' }), { password: 'required' });
});

// ---------- Tabs, landing and the steps before the app ----------

test('each role has the tabs of spec Appendix A and lands on its first one (AUTH-04)', () => {
  assert.deepEqual(TABS.patient, ['home', 'schedule', 'consult', 'hele', 'profile']);
  assert.deepEqual(TABS.barangay, ['monitor', 'chat', 'calendar', 'profile']);
  assert.deepEqual(TABS.super, ['tracker', 'consult', 'schedule', 'profile']);
  assert.equal(landingPath('patient'), '/patient/home');
  assert.equal(landingPath('barangay'), '/barangay/monitor');
  assert.equal(landingPath('super'), '/super/tracker');
  assert.equal(landingPath(null), '/sign-in');
});

test('the steps before the app come in order: new password, consent, guardian consent, push', () => {
  const base = { role: 'patient', mustChangePassword: false, hasConsent: true, minor: false, hasGuardianConsent: false };
  assert.equal(gateStep(base), null);
  assert.equal(gateStep({ ...base, hasConsent: false }), 'consent');
  assert.equal(gateStep({ ...base, minor: true }), 'guardian-consent');
  assert.equal(gateStep({ ...base, minor: true, hasGuardianConsent: true }), null);
  assert.equal(gateStep({ ...base, minor: true, hasConsent: false }), 'consent', 'consent first, then the guardian');
  assert.equal(gateStep({ ...base, role: 'barangay', minor: true }), null, 'only patients need a guardian');
  assert.equal(gateStep({ ...base, role: 'super', mustChangePassword: true, hasConsent: false }), 'change-password');
  assert.equal(gateStep({ ...base, role: 'barangay', mustChangePassword: true }), 'change-password');
  assert.equal(gateStep({ ...base, mustChangePassword: true }), null, 'a patient is never forced (AUTH-03 is for provider accounts)');
  assert.equal(gateStep({ ...base, needsPush: true }), 'push', 'the push choice comes last (COM-04)');
  assert.equal(gateStep({ ...base, minor: true, needsPush: true }), 'guardian-consent', 'the guardian first');
  assert.deepEqual(Object.keys(GATE_PATHS).sort(), ['change-password', 'consent', 'guardian-consent', 'push']);
});

test('only provider accounts get the gear action that expires the session', () => {
  assert.equal(gearConfigFor(null).expireSession, false);
  assert.equal(gearConfigFor('patient').expireSession, false);
  assert.equal(gearConfigFor('barangay').expireSession, true);
  assert.equal(gearConfigFor('super').expireSession, true);
});

// ---------- Sign in ----------

const phoneOf = (rt, id) => rt.db().profiles.find((p) => p.id === id).contact_no;
const emailOf = (rt, id) => rt.db().profiles.find((p) => p.id === id).email;

test('every role signs in with its own contact and the seeded password, and lands in its own app', () => {
  for (const [id, landing] of [
    [MARICEL, '/patient/home'],
    ['lourdes-magpantay', '/barangay/monitor'],
    ['rowena-macaraig', '/super/tracker'],
  ]) {
    const rt = makeRuntime();
    const identifier = sel.signInFillFor(rt.state(), id).identifier;
    const result = rt.auth.signIn({ identifier, password: PASSWORD });
    assert.equal(result.ok, true, id);
    assert.equal(rt.state().session.profile_id, id);
    assert.equal(sel.accessTarget(rt.state(), NOW), landing, id);
  }
});

test('a patient can sign in by number in any spelling, a provider by email in any case', () => {
  const rt = makeRuntime();
  assert.equal(rt.auth.signIn({ identifier: '+63 917 555 0201', password: PASSWORD }).ok, true);
  rt.auth.signOut();
  assert.equal(rt.state().session, null);
  assert.equal(rt.auth.signIn({ identifier: emailOf(rt, 'rowena-macaraig').toUpperCase(), password: PASSWORD }).ok, true);
  rt.auth.signOut();
  assert.equal(rt.auth.signIn({ identifier: phoneOf(rt, 'rowena-macaraig'), password: PASSWORD }).ok, true, 'a provider may also use the number on her account');
});

test('a wrong password shows an error and signs nobody in; an empty form says what is missing', () => {
  const rt = makeRuntime();
  const result = rt.auth.signIn({ identifier: phoneOf(rt, MARICEL), password: 'wrong' });
  assert.deepEqual([result.ok, result.error], [false, 'invalid']);
  assert.equal(rt.state().session, null);
  const nobody = rt.auth.signIn({ identifier: '0917 555 0999', password: PASSWORD });
  assert.deepEqual([nobody.ok, nobody.error], [false, 'invalid'], 'an unknown number gets the same answer');
  const empty = rt.auth.signIn({ identifier: '', password: '' });
  assert.deepEqual([empty.ok, empty.error, empty.errors], [false, 'form', { identifier: 'required', password: 'required' }]);
});

test('five failed sign-ins lock the account for a short wait, and the right password waits too (spec 10)', () => {
  const rt = makeRuntime();
  const identifier = phoneOf(rt, MARICEL);
  for (let i = 1; i < AUTH.maxFailedSignIns; i += 1) assert.equal(rt.auth.signIn({ identifier, password: 'wrong' }).error, 'invalid', `attempt ${i}`);
  const locked = rt.auth.signIn({ identifier, password: 'wrong' });
  assert.deepEqual([locked.error, locked.retryAfterMs], ['locked', AUTH.lockSeconds * 1000]);
  const during = rt.auth.signIn({ identifier: '0917-555-0201', password: PASSWORD });
  assert.equal(during.error, 'locked', 'the same number in another spelling is locked too');
  assert.equal(during.retryAfterMs, AUTH.lockSeconds * 1000);
  rt.advanceClock(10000);
  assert.equal(rt.auth.signIn({ identifier, password: PASSWORD }).retryAfterMs, AUTH.lockSeconds * 1000 - 10000, 'the wait counts down');
  rt.advanceClock(AUTH.lockSeconds * 1000);
  assert.equal(rt.auth.signIn({ identifier, password: PASSWORD }).ok, true, 'after the wait the right password works');
});

test('a successful sign-in clears the count, and other accounts are not affected by the lock', () => {
  const rt = makeRuntime();
  const identifier = phoneOf(rt, MARICEL);
  for (let i = 0; i < AUTH.maxFailedSignIns - 1; i += 1) rt.auth.signIn({ identifier, password: 'wrong' });
  assert.equal(rt.auth.signIn({ identifier, password: PASSWORD }).ok, true);
  rt.auth.signOut();
  for (let i = 0; i < AUTH.maxFailedSignIns - 1; i += 1) assert.equal(rt.auth.signIn({ identifier, password: 'wrong' }).error, 'invalid', 'the count started again from zero');
  for (let i = 0; i < AUTH.maxFailedSignIns; i += 1) rt.auth.signIn({ identifier: '0917 555 0999', password: 'wrong' });
  assert.equal(rt.auth.signIn({ identifier: phoneOf(rt, 'rosalinda-ramos'), password: PASSWORD }).ok, true, 'another account is not locked');
});

test('a lock survives a reload because it is kept with the data', () => {
  const rt = makeRuntime();
  const identifier = phoneOf(rt, MARICEL);
  for (let i = 0; i < AUTH.maxFailedSignIns; i += 1) rt.auth.signIn({ identifier, password: 'wrong' });
  const reloaded = makeRuntime({ snapshot: { schemaVersion: rt.state().schemaVersion, seededAt: rt.state().seededAt, db: rt.db(), hardware: rt.state().hardware, meta: rt.state().meta } });
  assert.equal(reloaded.auth.signIn({ identifier, password: PASSWORD }).error, 'locked');
});

test('a deactivated account cannot sign in', () => {
  const rt = makeRuntime();
  rt.core.commit([{ op: 'update', table: 'profiles', id: 'lourdes-magpantay', patch: { active: false } }]);
  const result = rt.auth.signIn({ identifier: emailOf(rt, 'lourdes-magpantay'), password: PASSWORD });
  assert.deepEqual([result.ok, result.error], [false, 'inactive']);
  assert.equal(rt.state().session, null);
});

test('the seeded accounts need no step before the app (they accepted the terms and changed their password)', () => {
  for (const id of [MARICEL, 'cherry-mae-dalisay', 'shiela-marie-aguila', 'lourdes-magpantay', 'jocelyn-landicho', 'rowena-macaraig', 'cynthia-dimayuga']) {
    const rt = makeRuntime({ session: { profile_id: id } });
    assert.equal(sel.accessGate(rt.state(), NOW).step, null, id);
  }
  assert.equal(AUTH.termsVersion, makeRuntime().db().consents[0].version, 'the seed records the current terms version');
});

// ---------- Sign up, consent, guardian consent ----------

const signUpValues = (rt, overrides = {}) => ({
  full_name: 'Angelica Panganiban',
  birthdate: '2002-06-01',
  contact_no: '0917 555 0242',
  barangay_id: 'san-jose',
  password: 'Tingloy-Care-2026',
  language: 'fil',
  ...overrides,
});

test('a patient signs up: account, patient row and password are created, she is signed in and the consent comes next', () => {
  const rt = makeRuntime();
  const before = rt.db().profiles.length;
  const result = rt.auth.signUp(signUpValues(rt));
  assert.equal(result.ok, true);
  assert.equal(rt.db().profiles.length, before + 1);
  const profile = rt.db().profiles.find((p) => p.id === result.profile.id);
  assert.deepEqual(
    [profile.role, profile.full_name, profile.contact_no, profile.barangay_id, profile.language, profile.active],
    ['patient', 'Angelica Panganiban', '0917 555 0242', 'san-jose', 'fil', true],
  );
  assert.equal(rt.db().patients.find((p) => p.profile_id === profile.id).birthdate, '2002-06-01');
  assert.equal(rt.state().session.profile_id, profile.id);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'consent');
  assert.equal(rt.auth.signIn({ identifier: '0917 555 0242', password: 'Tingloy-Care-2026' }).ok, true, 'she can sign in again later');
});

test('sign-up refuses a number that already has an account, whatever the spelling, and a weak password', () => {
  const rt = makeRuntime();
  const count = rt.db().profiles.length;
  const taken = rt.auth.signUp(signUpValues(rt, { contact_no: '+63 917 555 0201' }));
  assert.deepEqual([taken.ok, taken.errors.contact_no], [false, 'taken']);
  assert.equal(rt.auth.signUp(signUpValues(rt, { password: 'short' })).errors.password, 'weak');
  assert.equal(rt.state().session, null);
  assert.equal(rt.db().profiles.length, count, 'no account was made');
});

test('accepting the terms records the document version and the time, and lets an adult in (AUTH-05)', () => {
  const rt = makeRuntime();
  rt.auth.signUp(signUpValues(rt, { birthdate: '2002-06-01' }));
  const id = rt.state().session.profile_id;
  rt.advanceClock(60000);
  assert.equal(rt.auth.acceptConsent().ok, true);
  const record = rt.db().consents.find((c) => c.profile_id === id);
  assert.deepEqual([record.document, record.version, record.accepted_at], ['terms_privacy', AUTH.termsVersion, NOW + 60000]);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'push', 'a new account has not yet chosen push notifications (COM-04)');
  rt.alerts.allowPush();
  assert.equal(sel.accessGate(rt.state(), NOW).step, null);
  // A new patient has no devices and has not seen the pairing wizard: she lands on it (AUTH-07, Prompt 4).
  assert.equal(sel.accessTarget(rt.state(), NOW), '/patient/pair');
});

test('a patient under 18 cannot go on without the guardian consent (AUTH-06)', () => {
  const rt = makeRuntime();
  rt.auth.signUp(signUpValues(rt, { full_name: 'Kristine Joy Ilagan', birthdate: '2010-03-01', contact_no: '0917 555 0243', barangay_id: 'papaya' }));
  const id = rt.state().session.profile_id;
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'consent');
  rt.auth.acceptConsent();
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'guardian-consent', 'accepting the terms is not enough');
  assert.equal(sel.accessTarget(rt.state(), NOW), '/guardian-consent');

  const incomplete = rt.auth.saveGuardianConsent({ guardian_name: 'Teresita Ilagan', relationship: 'mother', contact: '0917 555 0244', acknowledged: false });
  assert.deepEqual([incomplete.ok, incomplete.errors.acknowledged], [false, 'acknowledge']);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'guardian-consent');

  rt.advanceClock(1000);
  assert.equal(rt.auth.saveGuardianConsent({ guardian_name: 'Teresita Ilagan', relationship: 'mother', contact: '09175550244', acknowledged: true }).ok, true);
  const record = rt.db().guardian_consents.find((g) => g.profile_id === id);
  assert.deepEqual([record.guardian_name, record.relationship, record.contact, record.signed_at], ['Teresita Ilagan', 'mother', '0917 555 0244', NOW + 1000]);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'push');
  rt.alerts.declinePush();
  assert.equal(sel.accessGate(rt.state(), NOW).step, null, 'Not now also answers the question');
});

test('the seeded patient under 18 has her guardian consent on file, so she goes straight in', () => {
  const rt = makeRuntime({ session: { profile_id: 'cherry-mae-dalisay' } });
  assert.equal(rt.db().guardian_consents.some((g) => g.profile_id === 'cherry-mae-dalisay'), true);
  assert.equal(sel.accessGate(rt.state(), NOW).step, null);
});

test('a terms version change asks everyone to accept again', () => {
  const rt = makeRuntime({ session: { profile_id: MARICEL } });
  rt.core.commit([{ op: 'update', table: 'consents', id: rt.db().consents.find((c) => c.profile_id === MARICEL).id, patch: { version: '0.9' } }]);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'consent');
});

// ---------- The first sign-in of a provider (AUTH-03) ----------

function withNewProvider(rt) {
  rt.core.commit([
    {
      op: 'insert',
      table: 'profiles',
      row: { id: 'pro_new', role: 'barangay', full_name: 'Maria Santos', name_suffix: null, title: 'Barangay health worker', contact_no: '0917 555 0350', email: 'maria.santos@nurturelink.ph', language: 'fil', photo_url: null, avatar_art: null, barangay_id: 'papaya', active: true, created_by: 'rowena-macaraig', created_at: NOW + 1000 },
    },
    { op: 'insert', table: 'credentials', row: { id: 'pro_new', profile_id: 'pro_new', password: 'Temp-Pass-2026', must_change_password: true } },
  ]);
}

test('a provider account made by a super account must change the password before anything else', () => {
  const rt = makeRuntime();
  withNewProvider(rt);
  assert.equal(rt.auth.signIn({ identifier: 'maria.santos@nurturelink.ph', password: 'Temp-Pass-2026' }).ok, true);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'change-password');
  assert.equal(sel.accessTarget(rt.state(), NOW), '/change-password');

  assert.equal(rt.auth.changePassword({ password: 'Temp-Pass-2026' }).errors.password, 'same', 'not the temporary one');
  assert.equal(rt.auth.changePassword({ password: 'weak' }).errors.password, 'weak');
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'change-password', 'nothing changed');

  assert.equal(rt.auth.changePassword({ password: 'Tingloy-Care-2026' }).ok, true);
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'consent', 'then the terms, which every role accepts');
  rt.auth.acceptConsent();
  assert.equal(sel.accessGate(rt.state(), NOW).step, 'push');
  rt.alerts.allowPush();
  assert.equal(sel.accessTarget(rt.state(), NOW), '/barangay/monitor');

  rt.auth.signOut();
  assert.equal(rt.auth.signIn({ identifier: 'maria.santos@nurturelink.ph', password: 'Temp-Pass-2026' }).error, 'invalid', 'the old password no longer works');
  assert.equal(rt.auth.signIn({ identifier: 'maria.santos@nurturelink.ph', password: 'Tingloy-Care-2026' }).ok, true);
  assert.equal(sel.accessGate(rt.state(), NOW).step, null);
});

test('the gear can fill the account most recently created by a super account, never a seeded one', () => {
  const rt = makeRuntime();
  assert.equal(sel.newestCreatedProvider(rt.state()), null);
  withNewProvider(rt);
  assert.equal(sel.newestCreatedProvider(rt.state()).id, 'pro_new');
  assert.deepEqual(sel.signInFillFor(rt.state(), 'pro_new'), { identifier: 'maria.santos@nurturelink.ph', password: 'Temp-Pass-2026' });
  assert.deepEqual(sel.signInFillFor(rt.state(), MARICEL), { identifier: '0917 555 0201', password: PASSWORD });
  assert.equal(sel.signInFillFor(rt.state(), 'nobody'), null);
});

test('every account the gear can fill or switch to exists, and has the right role', () => {
  const rt = makeRuntime();
  for (const { id, role } of PRESENTER_ACCOUNTS) assert.equal(rt.db().profiles.find((p) => p.id === id)?.role, role, id);
  assert.equal(PRESENTER_ACCOUNTS.length, 8);
});

// ---------- Forgot password (AUTH-08) ----------

test('a patient resets her password with a code sent to her number', () => {
  const rt = makeRuntime();
  const identifier = phoneOf(rt, MARICEL);
  assert.deepEqual(rt.auth.requestPasswordReset({ identifier }), { ok: true, outcome: 'code_sent' });
  const code = sel.pendingResetCode(rt.state(), identifier, NOW);
  assert.match(code, /^\d{6}$/);

  assert.equal(rt.auth.verifyResetCode({ identifier, code: '000000' }).ok, false);
  assert.equal(rt.auth.verifyResetCode({ identifier: '+63 917 555 0201', code }).ok, true, 'the number may be spelled another way');
  assert.equal(rt.auth.resetPassword({ identifier, code: '000000', password: 'Tingloy-Care-2026' }).error, 'code');
  assert.equal(rt.auth.resetPassword({ identifier, code, password: 'weak' }).errors.password, 'weak');
  assert.equal(rt.auth.resetPassword({ identifier, code, password: 'Tingloy-Care-2026' }).ok, true);

  assert.equal(rt.state().session, null, 'she still signs in herself');
  assert.equal(rt.auth.signIn({ identifier, password: PASSWORD }).error, 'invalid');
  assert.equal(rt.auth.signIn({ identifier, password: 'Tingloy-Care-2026' }).ok, true);
  assert.equal(sel.pendingResetCode(rt.state(), identifier, NOW), null, 'the code works once');
});

test('a reset code stops working after its time, and a reset clears a lock', () => {
  const rt = makeRuntime();
  const identifier = phoneOf(rt, MARICEL);
  rt.auth.requestPasswordReset({ identifier });
  const code = sel.pendingResetCode(rt.state(), identifier, NOW);
  rt.advanceClock(AUTH.resetCodeMinutes * 60000 + 1);
  assert.equal(rt.auth.verifyResetCode({ identifier, code }).ok, false);
  assert.equal(sel.pendingResetCode(rt.state(), identifier, NOW + AUTH.resetCodeMinutes * 60000 + 1), null);

  rt.setClock(NOW);
  rt.auth.requestPasswordReset({ identifier });
  for (let i = 0; i < AUTH.maxFailedSignIns; i += 1) rt.auth.signIn({ identifier, password: 'wrong' });
  assert.equal(rt.auth.signIn({ identifier, password: PASSWORD }).error, 'locked');
  const fresh = sel.pendingResetCode(rt.state(), identifier, NOW);
  assert.equal(rt.auth.resetPassword({ identifier, code: fresh, password: 'Tingloy-Care-2026' }).ok, true);
  assert.equal(rt.auth.signIn({ identifier, password: 'Tingloy-Care-2026' }).ok, true);
});

test('a provider account is told to contact the Municipal Health Office, and no code is made', () => {
  const rt = makeRuntime();
  for (const identifier of [emailOf(rt, 'lourdes-magpantay'), phoneOf(rt, 'rowena-macaraig')]) {
    assert.deepEqual(rt.auth.requestPasswordReset({ identifier }), { ok: true, outcome: 'provider' });
    assert.equal(sel.pendingResetCode(rt.state(), identifier, NOW), null);
  }
});

test('a number nobody uses looks like any other, so the form never says who has an account', () => {
  const rt = makeRuntime();
  assert.deepEqual(rt.auth.requestPasswordReset({ identifier: '0917 555 0999' }), { ok: true, outcome: 'code_sent' });
  assert.equal(rt.auth.verifyResetCode({ identifier: '0917 555 0999', code: '123456' }).ok, false);
  assert.equal(rt.auth.requestPasswordReset({ identifier: 'abc' }).errors.identifier, 'identifier');
  assert.equal(rt.auth.requestPasswordReset({ identifier: '' }).errors.identifier, 'required');
});

// ---------- Session and language ----------

test('sign out clears the session; the sign-in screen has nothing to say about it', () => {
  const rt = makeRuntime({ session: { profile_id: MARICEL } });
  rt.auth.signOut();
  assert.equal(rt.state().session, null);
  assert.equal(rt.state().live.notice, null);
  assert.equal(sel.accessTarget(rt.state(), NOW), '/sign-in');
});

test('expiring a provider session signs out and leaves the notice for the sign-in screen', () => {
  const rt = makeRuntime({ session: { profile_id: 'lourdes-magpantay' } });
  rt.auth.expireSession();
  assert.equal(rt.state().session, null);
  assert.equal(rt.state().live.notice, 'session_expired');
  rt.auth.dismissNotice();
  assert.equal(rt.state().live.notice, null);
  rt.auth.signIn({ identifier: emailOf(rt, 'lourdes-magpantay'), password: PASSWORD });
  assert.equal(rt.state().live.notice, null);
});

test('a provider session idle for longer than the timeout is not restored; a patient session is, and a recent one is', () => {
  const minutes = (n) => n * 60000;
  const at = (session, now = NOW) => buildState({ now, session });
  const idle = at({ profile_id: 'lourdes-magpantay', signed_in_at: NOW - minutes(40), last_active_at: NOW - minutes(16) });
  assert.deepEqual([idle.session, idle.live.notice], [null, 'session_expired']);
  const recent = at({ profile_id: 'lourdes-magpantay', signed_in_at: NOW - minutes(40), last_active_at: NOW - minutes(14) });
  assert.deepEqual([recent.session?.profile_id, recent.live.notice], ['lourdes-magpantay', null]);
  const patient = at({ profile_id: MARICEL, signed_in_at: NOW - minutes(600), last_active_at: NOW - minutes(600) });
  assert.equal(patient.session?.profile_id, MARICEL, 'the timeout is for provider accounts');
  assert.equal(at({ profile_id: 'rowena-macaraig' }).session?.profile_id, 'rowena-macaraig', 'a session with no times is taken as just started');
  assert.equal(at({ profile_id: 'nobody' }).session, null);
});

test('a provider\'s activity is remembered at most every 15 seconds, and a patient\'s is not recorded', () => {
  const rt = makeRuntime();
  rt.auth.signIn({ identifier: emailOf(rt, 'rowena-macaraig'), password: PASSWORD });
  const stamp = () => rt.state().session.last_active_at;
  assert.equal(stamp(), NOW);
  rt.advanceClock(5000);
  rt.auth.touch();
  assert.equal(stamp(), NOW, 'too soon');
  rt.advanceClock(11000);
  rt.auth.touch();
  assert.equal(stamp(), NOW + 16000);
  rt.auth.signOut();
  rt.auth.signIn({ identifier: phoneOf(rt, MARICEL), password: PASSWORD });
  rt.advanceClock(60000);
  rt.auth.touch();
  assert.equal(rt.state().session.last_active_at, NOW + 16000, 'untouched');
});

test('the language chosen is saved on the account and kept for the next sign-in (COM-02)', () => {
  const rt = makeRuntime();
  rt.auth.saveLanguage('fil');
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).language, 'en', 'nobody is signed in: nothing to save');
  rt.auth.signIn({ identifier: phoneOf(rt, MARICEL), password: PASSWORD });
  rt.auth.saveLanguage('fil');
  assert.equal(rt.db().profiles.find((p) => p.id === MARICEL).language, 'fil');
  rt.auth.signOut();
  rt.auth.signIn({ identifier: phoneOf(rt, MARICEL), password: PASSWORD });
  assert.equal(sel.viewerOf(rt.state()).language, 'fil');
});

test('the gear switches account without a password and a run goes on', () => {
  const rt = makeRuntime({ session: { profile_id: MARICEL } });
  rt.engine.start('check-normal', { patientId: MARICEL, actorId: MARICEL, actorRole: 'patient' });
  assert.equal(rt.engine.isRunning(), true);
  assert.equal(rt.auth.signInAs('lourdes-magpantay').ok, true);
  assert.equal(rt.state().session.profile_id, 'lourdes-magpantay');
  assert.equal(sel.accessTarget(rt.state(), NOW), '/barangay/monitor');
  assert.equal(rt.engine.isRunning(), true, 'switching account does not stop a run');
  assert.equal(rt.auth.signInAs('nobody').ok, false);
});

// ---------- The idle timer ----------

function fakeClock() {
  let time = 0;
  let timers = [];
  return {
    now: () => time,
    setTimer(fn, ms) {
      const timer = { fn, at: time + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timers = timers.filter((t) => t !== timer);
    },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        time = next.at;
        next.fn();
      }
      time = end;
    },
  };
}
const MIN = 60000;

function makeIdle() {
  const clock = fakeClock();
  const events = [];
  const timer = createIdleTimer({
    timeoutMs: 15 * MIN,
    warnMs: 14 * MIN,
    ...clock,
    onWarn: () => events.push(['warn', clock.now()]),
    onExpire: () => events.push(['expire', clock.now()]),
  });
  timer.start();
  return { clock, events, timer };
}

test('the idle timer warns at 14 minutes and ends the session at 15 (AUTH-08)', () => {
  const { clock, events, timer } = makeIdle();
  clock.advance(14 * MIN - 1);
  assert.deepEqual(events, []);
  clock.advance(1);
  assert.deepEqual(events, [['warn', 14 * MIN]]);
  assert.equal(timer.isWarning(), true);
  clock.advance(MIN);
  assert.deepEqual(events, [['warn', 14 * MIN], ['expire', 15 * MIN]]);
});

test('activity moves the warning later, and a tap behind the warning does not count', () => {
  const { clock, events, timer } = makeIdle();
  clock.advance(10 * MIN);
  timer.activity();
  clock.advance(13 * MIN);
  assert.deepEqual(events, [], 'the clock started again at the tap');
  clock.advance(MIN);
  assert.deepEqual(events, [['warn', 24 * MIN]]);
  clock.advance(30000);
  timer.activity();
  clock.advance(30000);
  assert.deepEqual(events.map((e) => e[0]), ['warn', 'expire'], 'the tap behind the warning did not extend it');
});

test('staying signed in starts the clock again, and a stopped timer stays quiet', () => {
  const { clock, events, timer } = makeIdle();
  clock.advance(14 * MIN);
  timer.stay();
  assert.equal(timer.isWarning(), false);
  clock.advance(14 * MIN - 1);
  assert.deepEqual(events.map((e) => e[0]), ['warn']);
  clock.advance(1);
  assert.deepEqual(events.map((e) => e[0]), ['warn', 'warn']);
  timer.stop();
  clock.advance(60 * MIN);
  assert.deepEqual(events.map((e) => e[0]), ['warn', 'warn']);
});

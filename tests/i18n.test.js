import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { ALERT_TYPES } from '../src/lib/alertRules.js';
import { RESULT, RESULT_NAMES } from '../src/lib/packets.js';
import { validateGuardian, validateNewPassword, validateSignIn, validateSignUp } from '../src/lib/authRules.js';

const ROOT = new URL('../src/i18n/locales/', import.meta.url);
const load = (lang, file) => JSON.parse(readFileSync(new URL(`${lang}/${file}`, ROOT), 'utf8'));
const namespaces = readdirSync(new URL('en/', ROOT)).filter((f) => f.endsWith('.json'));

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );
}
const placeholders = (text) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

test('English and Filipino have the same namespaces', () => {
  assert.deepEqual(readdirSync(new URL('fil/', ROOT)).filter((f) => f.endsWith('.json')).sort(), [...namespaces].sort());
});

test('every key exists in both languages, with no empty text and the same placeholders', () => {
  for (const file of namespaces) {
    const en = new Map(flatten(load('en', file)));
    const fil = new Map(flatten(load('fil', file)));
    assert.deepEqual([...en.keys()].sort(), [...fil.keys()].sort(), `${file}: the same keys`);
    for (const [key, text] of en) {
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${file} ${key}: English text`);
      assert.ok(fil.get(key).trim().length > 0, `${file} ${key}: Filipino text`);
      assert.deepEqual(placeholders(fil.get(key)), placeholders(text), `${file} ${key}: the same placeholders`);
    }
  }
});

test('Filipino is a translation, not a copy: the long texts differ from the English', () => {
  const en = new Map(flatten(load('en', 'presenter.json')));
  const fil = new Map(flatten(load('fil', 'presenter.json')));
  for (const [key, text] of en) if (text.length > 25) assert.notEqual(fil.get(key), text, key);
});

test('no screen text uses wording the product must never show', () => {
  const banned = /\b(demo|sample|simulated|simulation|simulate|fake|mock|dummy|placeholder|lorem ipsum|coming soon|tbd)\b|test data/i;
  for (const lang of ['en', 'fil']) {
    for (const file of namespaces) {
      for (const [key, text] of flatten(load(lang, file))) assert.doesNotMatch(text, banned, `${lang}/${file} ${key}`);
    }
  }
});

test('every text the scenarios and the gear ask for exists', () => {
  const texts = new Map(flatten(load('en', 'presenter.json')));
  const has = (key) => {
    assert.ok(key.startsWith('presenter:'), key);
    assert.ok(texts.has(key.slice('presenter:'.length)), `missing ${key}`);
  };
  for (const scenario of SCENARIOS) has(scenario.labelKey);
  for (const name of Object.values(RESULT_NAMES)) {
    const key = name.toLowerCase();
    if (['ok', 'clock_not_synced', 'not_allowed'].includes(key)) continue;
    has(`presenter:reason.${key}`);
  }
  for (const reason of ['no_belt', 'disconnected', 'stopped', 'no_reading', 'no_contact']) has(`presenter:reason.${reason}`);
  for (const type of ALERT_TYPES) has(`presenter:alertType.${type}`);
  for (const key of [
    'gear.label', 'gear.title', 'running', 'section.screen', 'section.scenarios', 'section.devices', 'section.timing', 'section.connection',
    'section.switchAccount', 'section.reset', 'group.checks', 'group.alerts', 'group.consult', 'patient.label', 'patient.none', 'devices.belt',
    'devices.band', 'devices.connected', 'devices.charging', 'devices.battery', 'devices.level.normal', 'devices.level.low', 'devices.level.critical',
    'devices.level.cutoff', 'timing.quick', 'timing.realistic', 'connection.online', 'connection.offline', 'account.label', 'account.patient',
    'account.barangay', 'account.super', 'confirm.startTitle', 'confirm.startBody', 'confirm.resetTitle', 'confirm.resetBody', 'confirm.confirm',
    'confirm.cancel', 'action.skipSplash', 'toast.started', 'toast.failed',
  ]) has(`presenter:${key}`);
});

test('every finishing line a scenario can produce has a text', () => {
  const texts = new Map(flatten(load('en', 'presenter.json')));
  const source = readFileSync(new URL('../src/sim/scenarios.js', import.meta.url), 'utf8');
  const used = [...source.matchAll(/'presenter:done\.(\w+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 25);
  for (const key of new Set(used)) assert.ok(texts.has(`done.${key}`), `done.${key}`);
  const reasons = [...source.matchAll(/presenter:reason\.(\w+)/g)].map((m) => m[1]);
  for (const key of new Set(reasons)) assert.ok(texts.has(`reason.${key}`), `reason.${key}`);
});

// ---------- The sign-in, consent and guardian screens (Prompt 3) ----------

test('every text key the auth screens ask for exists in English and Filipino', () => {
  const dir = new URL('../src/features/auth/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'));
  assert.ok(files.length >= 8);
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    const ns = /useTranslation\('(\w+)'\)/.exec(source)?.[1] ?? 'common';
    const has = (lang, space, key) => new Map(flatten(load(lang, `${space}.json`))).has(key) || new Map(flatten(load(lang, `${space}.json`))).has(`${key}_other`);
    for (const [, key, tail] of source.matchAll(/\bt\(\s*'([\w.]+)'([^)]*)\)/g)) {
      const space = /ns:\s*'(\w+)'/.exec(tail)?.[1] ?? ns;
      for (const lang of ['en', 'fil']) assert.ok(has(lang, space, key), `${lang} ${space}:${key} (${file})`);
      checked += 1;
    }
    for (const [, space, key] of source.matchAll(/labelKey:\s*'(\w+):([\w.]+)'/g)) {
      for (const lang of ['en', 'fil']) assert.ok(has(lang, space, key), `${lang} ${space}:${key} (${file})`);
      checked += 1;
    }
  }
  assert.ok(checked > 60, `checked ${checked}`);
});

test('every error a form rule can give has a text, and every password rule and relationship too', () => {
  const codes = new Set();
  const collect = (errors) => Object.values(errors).forEach((code) => codes.add(code));
  collect(validateSignIn({ identifier: '', password: '' }));
  collect(validateSignIn({ identifier: 'x', password: 'x' }));
  const ctx = { today: '2026-11-08', barangayIds: ['papaya'] };
  collect(validateSignUp({}, ctx));
  for (const bad of [{ full_name: 'A', birthdate: '2027-01-01', contact_no: '1', barangay_id: 'x', password: 'a', language: 'x' }, { birthdate: '2002-02-31' }]) collect(validateSignUp(bad, ctx));
  collect(validateGuardian({}));
  collect(validateGuardian({ guardian_name: 'A', contact: '1' }));
  collect(validateNewPassword({ password: 'abc' }));
  collect(validateNewPassword({ password: 'Abcdefg1' }, { current: 'Abcdefg1' }));
  codes.add('taken'); // given by the service when the number already has an account
  assert.ok(codes.size >= 10);
  for (const lang of ['en', 'fil']) {
    const auth = new Map(flatten(load(lang, 'auth.json')));
    const consent = new Map(flatten(load(lang, 'consent.json')));
    for (const code of codes) assert.ok(auth.has(`error.${code}`), `${lang} error.${code}`);
    for (const rule of ['length', 'upper', 'lower', 'number']) assert.ok(auth.has(`password.rules.${rule}`), `${lang} rule ${rule}`);
    for (const key of ['mother', 'father', 'grandmother', 'grandfather', 'aunt', 'uncle', 'legal_guardian']) assert.ok(consent.has(`guardian.relationships.${key}`), `${lang} ${key}`);
  }
});

test('the consent document has every section the screen lists, and covers what AUTH-05 and spec 10 require', () => {
  const source = readFileSync(new URL('../src/features/auth/Consent.jsx', import.meta.url), 'utf8');
  const listed = [...(/const SECTIONS = \[([^\]]+)\]/.exec(source)[1].matchAll(/'(\w+)'/g))].map((m) => m[1]);
  for (const lang of ['en', 'fil']) {
    const texts = new Map(flatten(load(lang, 'consent.json')));
    for (const id of listed) {
      assert.ok(texts.get(`sections.${id}.title`)?.length > 3, `${lang} ${id} title`);
      assert.ok(texts.get(`sections.${id}.body`)?.length > 60, `${lang} ${id} body`);
    }
    const sectionIds = [...new Set([...texts.keys()].filter((k) => k.startsWith('sections.')).map((k) => k.split('.')[1]))];
    assert.deepEqual(sectionIds.sort(), [...listed].sort(), `${lang}: no section is left out of the screen`);
  }
  // Hele, readings, who can view records, the third-party video service, retention (spec section 10), in both languages.
  for (const [lang, words] of [['en', ['Hele', 'readings', 'can see', 'third-party', 'kept']], ['fil', ['Hele', 'sukat', 'makakakita', 'third-party', 'iniingatan']]]) {
    const all = [...new Map(flatten(load(lang, 'consent.json'))).values()].join(' ');
    for (const word of words) assert.match(all, new RegExp(word, 'i'), `${lang}: ${word}`);
  }
});

// ---------- Home, the check screen, the pairing wizard and the offline banner (Prompt 4) ----------

const PROMPT4_SOURCES = ['../src/features/home/', '../src/features/devices/'];
const PROMPT4_FILES = ['../src/components/ui/StatusBadge.jsx', '../src/components/layout/ConnectionBanner.jsx'];

test('every text key the Home, check and pairing screens ask for exists in English and Filipino', () => {
  const sources = [];
  for (const dir of PROMPT4_SOURCES) {
    const url = new URL(dir, import.meta.url);
    for (const file of readdirSync(url).filter((f) => f.endsWith('.jsx') || f === 'reasons.js')) sources.push([file, readFileSync(new URL(file, url), 'utf8')]);
  }
  for (const file of PROMPT4_FILES) sources.push([file, readFileSync(new URL(file, import.meta.url), 'utf8')]);
  const tables = { en: {}, fil: {} };
  const has = (lang, space, key) => {
    tables[lang][space] ??= new Map(flatten(load(lang, `${space}.json`)));
    return tables[lang][space].has(key);
  };
  let checked = 0;
  for (const [file, source] of sources) {
    const defaultSpace = /useTranslation\('(\w+)'\)/.exec(source)?.[1] ?? 'common';
    for (const [, key] of source.matchAll(/\bt\(\s*'([\w:.]+)'/g)) {
      const [space, name] = key.includes(':') ? key.split(':') : [defaultSpace, key];
      for (const lang of ['en', 'fil']) assert.ok(has(lang, space, name), `${lang} ${space}:${name} (${file})`);
      checked += 1;
    }
    for (const [, space, key] of source.matchAll(/labelKey:\s*'(\w+):([\w.]+)'/g)) {
      for (const lang of ['en', 'fil']) assert.ok(has(lang, space, key), `${lang} ${space}:${key} (${file})`);
      checked += 1;
    }
  }
  assert.ok(checked > 50, `checked ${checked}`);
});

test('the texts chosen by a code (reasons, phases, statuses, battery levels, pairing errors) all exist', () => {
  const reasons = ['no_belt', 'busy', 'disconnected', 'link_lost', 'charging', 'cutoff', 'exposure_cap', 'low_battery', 'no_contact', 'fault', 'stopped', 'no_reading', 'not_allowed', 'clock_not_synced'];
  // Every refusal the belt can give comes back as its lower-case name; each needs a text.
  for (const name of Object.keys(RESULT).filter((n) => n !== 'OK')) assert.ok(reasons.includes(name.toLowerCase()), `belt result ${name}`);
  const wanted = {
    home: [...reasons.map((r) => `check.reason.${r}`), ...['starting', 'contact', 'acquiring', 'finishing', 'complete', 'failed'].map((p) => `check.phase.${p}`), ...['contact', 'measuring', 'saving'].map((s) => `check.steps.${s}`), ...['fhr', 'hr', 'spo2', 'temp'].map((r) => `reading.${r}`)],
    devices: [...['belt', 'band'].flatMap((d) => [`name.${d}`, `row.${d}`, `pairing.stage.${d}`]), ...['low', 'critical', 'cutoff'].map((l) => `level.${l}`), ...['already_bound', 'not_found', 'type_taken', 'match'].map((e) => `pairing.error.${e}`), ...['connected', 'connecting', 'notConnected', 'notPaired'].map((s) => `state.${s}`)],
    common: ['normal', 'attention', 'alert'].map((s) => `status.${s}`),
  };
  for (const lang of ['en', 'fil']) {
    for (const [space, keys] of Object.entries(wanted)) {
      const table = new Map(flatten(load(lang, `${space}.json`)));
      for (const key of keys) assert.ok(table.has(key), `${lang} ${space}:${key}`);
    }
  }
});

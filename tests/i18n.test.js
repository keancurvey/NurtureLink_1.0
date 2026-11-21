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

// ---------- Alerts, notifications, escalation (Prompt 5) ----------

const PROMPT5_DIRS = ['../src/features/alerts/', '../src/features/notifications/', '../src/components/alerts/'];

test('every text key the alert, notification and push screens ask for exists in English and Filipino', () => {
  const tables = { en: new Map(flatten(load('en', 'alerts.json'))), fil: new Map(flatten(load('fil', 'alerts.json'))) };
  let checked = 0;
  for (const dir of PROMPT5_DIRS) {
    const url = new URL(dir, import.meta.url);
    for (const file of readdirSync(url).filter((f) => f.endsWith('.jsx'))) {
      const source = readFileSync(new URL(file, url), 'utf8');
      assert.match(source, /useTranslation\('alerts'\)/, `${file} reads the alerts namespace`);
      for (const [, key] of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
        for (const lang of ['en', 'fil']) assert.ok(tables[lang].has(key) || tables[lang].has(`${key}_other`), `${lang} alerts:${key} (${file})`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 60, `checked ${checked}`);
});

test('the texts chosen by a code (alert types, facts, timeline, statuses, notifications, errors) all exist in both languages', async () => {
  const { describeNotification } = await import('../src/lib/notifications.js');
  const { alertFacts, alertTimeline } = await import('../src/lib/alertView.js');
  const wanted = new Set();
  for (const type of ALERT_TYPES) for (const who of ['provider', 'patient']) wanted.add(`type.${type}.${who}`);
  for (const status of ['new', 'acknowledged', 'resolved', 'cancelled']) wanted.add(`status.${status}`);
  const types = ['alert', 'alert_notice', 'battery_low', 'booking_request', 'appointment_approved', 'appointment_started', 'follow_up_open', 'event_created', 'event_reminder', 'message', 'referral', 'video_usage_warning', 'unknown'];
  for (const role of ['patient', 'barangay', 'super']) {
    for (const type of types) {
      for (const extra of [{}, { escalated: true }, { cancelled: true }, { device: 'band' }]) {
        const view = describeNotification({ type, payload: { alert_type: 'sos', ...extra }, read_at: null }, { role });
        wanted.add(view.titleKey);
        if (view.bodyKey) wanted.add(view.bodyKey);
        if (view.values.typeKey) wanted.add(view.values.typeKey);
      }
    }
  }
  const metrics = [{ metric: 'spo2', value: 90 }, { metric: 'skin_temperature', value: 39 }, ...['low', 'high'].map((direction) => ({ metric: 'heart_rate', value: 1, direction }))];
  const payloads = {
    fhr_out_of_range: [{ direction: 'low' }, { direction: 'high' }], signal_loss: [{}], maternal_vitals: [{ metrics }],
    sos: [{ source: 'app' }, { battery: 50 }, { battery: null }], battery_critical: [{ device: 'belt' }, { device: 'band' }], missed_check: [{}],
  };
  for (const type of ALERT_TYPES) for (const payload of payloads[type]) for (const fact of alertFacts({ type, payload })) wanted.add(fact.key);
  const alert = { created_at: 1, last_seen_at: 2, merged_count: 1, escalated_at: 3, acknowledged_at: 4, acknowledged_by: 'x', referred_at: 5, referred_by: 'x' };
  for (const status of ['acknowledged', 'resolved']) for (const step of alertTimeline({ ...alert, status, resolved_at: 6, resolved_by: 'x' })) wanted.add(`timeline.${step.key}`);
  wanted.add('timeline.cancelled');
  for (const code of ['already_acknowledged', 'resolved', 'already_resolved', 'not_allowed', 'not_found', 'not_acknowledged', 'not_yours', 'outcome_required', 'outcome_too_long', 'reason_required', 'reason_too_long', 'already_referred', 'generic']) wanted.add(`actions.error.${code}`);
  for (const code of ['acknowledged', 'resolved', 'referred']) wanted.add(`actions.done.${code}`);
  assert.ok(wanted.size > 70, `checking ${wanted.size}`);
  for (const lang of ['en', 'fil']) {
    const table = new Map(flatten(load(lang, 'alerts.json')));
    for (const key of wanted) assert.ok(table.has(key), `${lang} alerts:${key}`);
  }
});

test('the patient wording of an alert never reads as a diagnosis', () => {
  const diagnostic = /\b(distress|hypoxia|fever|bradycardia|tachycardia|preeclampsia|miscarriage|fetal|diagnos\w*)\b/i;
  for (const lang of ['en', 'fil']) {
    const table = new Map(flatten(load(lang, 'alerts.json')));
    for (const [key, text] of table) {
      if (/\.patient$/.test(key) || key.startsWith('detail.notice') || key.startsWith('notice.') || key.startsWith('sos.') || key === 'notification.alert_notice') {
        assert.doesNotMatch(text, diagnostic, `${lang} alerts:${key}`);
      }
    }
    assert.match(table.get('notification.alert_notice'), lang === 'en' ? /contact your barangay health worker or midwife/ : /barangay health worker o midwife/, 'ALR-06');
  }
});

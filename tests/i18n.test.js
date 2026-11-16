import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { ALERT_TYPES } from '../src/lib/alertRules.js';
import { RESULT_NAMES } from '../src/lib/packets.js';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { KINDS } from '../src/lib/schedule.js';
import { AVATAR_CHOICES, EMERGENCY_RELATIONSHIPS, validateBarangayChange, validateChangePassword, validatePersonal, validateReschedule } from '../src/lib/profileRules.js';
import { NOTIFICATION_TYPES } from '../src/store/schema.js';
import { describeNotification } from '../src/lib/notifications.js';

const ROOT = new URL('../src/i18n/locales/', import.meta.url);
const load = (lang, file) => JSON.parse(readFileSync(new URL(`${lang}/${file}.json`, ROOT), 'utf8'));
function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (value !== null && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));
}
const keys = (lang, ns) => new Set(flatten(load(lang, ns)).map(([key]) => key));

/** Every text the Schedule and Profile screens ask for with a fixed key exists in both languages. */
test('every fixed text key used by the Schedule and Profile screens exists in English and Filipino', () => {
  const dirs = ['../src/features/schedule/', '../src/features/profile/', '../src/components/ui/'];
  let checked = 0;
  for (const dir of dirs) {
    const base = new URL(dir, import.meta.url);
    for (const file of readdirSync(base).filter((f) => /\.(jsx|js)$/.test(f))) {
      const source = readFileSync(new URL(file, base), 'utf8');
      if (dir.endsWith('ui/') && file !== 'Calendar.jsx') continue;
      // A file can bind the same name to different namespaces in different components: a key must exist in one of them.
      const byVariable = new Map();
      for (const [, variable, ns] of source.matchAll(/const \{ t(?::\s*(\w+))?[^}]*\} = useTranslation\('(\w+)'\)/g)) byVariable.set(variable ?? 't', [...(byVariable.get(variable ?? 't') ?? []), ns]);
      for (const [variable, spaces] of byVariable) {
        const pattern = new RegExp(`\\b${variable}\\(\\s*'([\\w.]+)'`, 'g');
        for (const [, key] of source.matchAll(pattern)) {
          // A text with a count has one key for each plural form (key_one, key_other).
          for (const lang of ['en', 'fil']) assert.ok(spaces.some((ns) => keys(lang, ns).has(key) || keys(lang, ns).has(`${key}_other`)), `${lang} ${spaces.join('|')}:${key} (${file})`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 120, `checked ${checked}`);
});

test('every text that is chosen by a value (kinds, statuses, relationships, errors, avatars, notices) exists in both languages', () => {
  const codes = new Set();
  const collect = (errors) => Object.values(errors).forEach((code) => codes.add(code));
  collect(validatePersonal({}));
  collect(validatePersonal({ contact_no: '1', emergency_name: 'A', emergency_relationship: 'x', emergency_no: '1' }));
  collect(validatePersonal({ contact_no: '0917 555 0123', emergency_name: 'A '.repeat(40), emergency_relationship: 'mother', emergency_no: '0917 555 0123' }));
  codes.add('taken');
  collect(validateReschedule({ reason: '', preferred_date: 'x' }, { today: '2026-11-08' }));
  collect(validateReschedule({ reason: 'x'.repeat(400), preferred_date: '2026-11-08' }, { today: '2026-11-08' }));
  collect(validateBarangayChange({ barangay_id: 'a' }, { current: 'a', barangayIds: ['a'] }));
  collect(validateBarangayChange({ barangay_id: '' }, { current: 'a', barangayIds: ['a'] }));
  collect(validateBarangayChange({ barangay_id: 'z' }, { current: 'a', barangayIds: ['a'] }));
  collect(validateChangePassword({ current: '', password: 'weak', confirm: '' }));
  collect(validateChangePassword({ current: 'Aa1aaaaa', password: 'Aa1aaaaa', confirm: 'Aa1aaaaa' }));
  collect(validateChangePassword({ current: 'Aa1aaaaa', password: 'Bb2bbbbb', confirm: 'x' }));
  codes.add('wrong');
  assert.ok(codes.size >= 10, `${codes.size} error codes`);
  for (const lang of ['en', 'fil']) {
    const profile = keys(lang, 'profile');
    const schedule = keys(lang, 'schedule');
    const alerts = keys(lang, 'alerts');
    for (const code of codes) assert.ok(profile.has(`error.${code}`), `${lang} profile error.${code}`);
    for (const kind of KINDS) assert.ok(schedule.has(`kind.${kind}`), `${lang} kind.${kind}`);
    for (const key of ['approved', 'attended', 'missed', 'rescheduled']) assert.ok(schedule.has(`status.${key}`), `${lang} status.${key}`);
    for (const key of ['approved', 'attended', 'missed', 'rescheduled']) if (key !== 'approved') assert.ok(profile.has(`history.${key}`), `${lang} history.${key}`);
    for (const role of ['barangay', 'super']) assert.ok(schedule.has(`provider.role.${role}`), `${lang} role ${role}`);
    for (const place of ['clinic', 'office', 'hospital', 'teleconsult']) assert.ok(schedule.has(`place.${place}`), `${lang} place.${place}`);
    for (const key of EMERGENCY_RELATIONSHIPS) assert.ok(profile.has(`relationship.${key}`), `${lang} relationship.${key}`);
    for (const art of AVATAR_CHOICES) assert.ok(profile.has(`photo.art.${art}`), `${lang} photo.art.${art}`);
    for (const key of ['type', 'size', 'unreadable', 'invalid']) assert.ok(profile.has(`photo.error.${key}`), `${lang} photo.error.${key}`);
    for (const key of ['offline', 'busy', 'waiting_to_sync', 'not_found']) assert.ok(profile.has(`devices.error.${key}`), `${lang} devices.error.${key}`);
    for (const key of ['pending_exists', 'not_upcoming', 'not_found', 'not_allowed']) assert.ok(schedule.has(`reschedule.error.${key}`), `${lang} reschedule.error.${key}`);
    for (const n of [1, 2, 3]) assert.ok(profile.has(`pregnancy.trimesterValue.${n}`), `${lang} trimester ${n}`);
    // every notification type the app can make has a text
    for (const type of NOTIFICATION_TYPES) {
      for (const payload of [{}, { lead: 'day', kind: 'clinic' }, { lead: 'hours', kind: 'teleconsult' }]) {
        const view = describeNotification({ type, payload: { alert_type: 'sos', ...payload }, read_at: null }, { role: 'patient', patientName: 'A', eventTitle: 'B' });
        assert.ok(alerts.has(view.titleKey), `${lang} alerts:${view.titleKey} for ${type}`);
        for (const [name, value] of Object.entries(view.values)) if (name.endsWith('Key')) assert.ok(alerts.has(value), `${lang} alerts:${value}`);
      }
    }
  }
});

test('the screens that show a date or time use Intl through lib/format, never a hand-made format', () => {
  for (const file of ['features/schedule/Schedule.jsx', 'features/profile/Profile.jsx', 'components/ui/Calendar.jsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /toLocale(Date|Time)String|getHours|getMonth\(|padStart\(2/, file);
  }
});

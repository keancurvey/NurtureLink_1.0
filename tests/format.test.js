import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime, formatRelative } from '../src/lib/format.js';

const NOW = Date.parse('2026-11-18T08:00:00Z'); // 4:00 pm in Manila

test('times are Asia/Manila, 12-hour', () => {
  assert.match(formatDateTime(NOW, 'en'), /Nov 18/);
  assert.match(formatDateTime(NOW, 'en'), /4:00\s?pm/i);
});

test('recent times are relative, older than a day falls back to the date', () => {
  assert.match(formatRelative(NOW - 10 * 1000, NOW, 'en'), /now/i);
  assert.match(formatRelative(NOW - 5 * 60 * 1000, NOW, 'en'), /5 min/);
  assert.match(formatRelative(NOW - 3 * 3600 * 1000, NOW, 'en'), /3 hr/);
  assert.equal(formatRelative(NOW - 30 * 3600 * 1000, NOW, 'en'), formatDateTime(NOW - 30 * 3600 * 1000, 'en'));
});

test('Filipino uses its own wording', () => {
  assert.notEqual(formatRelative(NOW - 5 * 60 * 1000, NOW, 'fil'), formatRelative(NOW - 5 * 60 * 1000, NOW, 'en'));
});

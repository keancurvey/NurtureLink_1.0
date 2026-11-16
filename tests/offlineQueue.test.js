import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeKey, queuedInOrder, splitDuplicates } from '../src/lib/offlineQueue.js';

test('the server removes duplicates by (device serial, sequence number), or by client id', () => {
  assert.equal(dedupeKey({ serial: 'BELT-1', device_seq: 7, client_id: 'c1' }), 'd:BELT-1:7');
  assert.equal(dedupeKey({ client_id: 'c1' }), 'c:c1');
  assert.equal(dedupeKey({ serial: 'BELT-1', device_seq: 0 }), 'd:BELT-1:0', 'sequence zero is a real sequence number');
  assert.equal(dedupeKey({ body: 'hello' }), null);
});

test('records already on the server are duplicates; the same sequence on another device is not', () => {
  const existing = [{ serial: 'BELT-1', device_seq: 7 }, { client_id: 'm1' }];
  const incoming = [
    { serial: 'BELT-1', device_seq: 7 },
    { serial: 'BELT-1', device_seq: 8 },
    { serial: 'BAND-1', device_seq: 7 },
    { client_id: 'm1' },
    { client_id: 'm2' },
  ];
  const { fresh, duplicates } = splitDuplicates(existing, incoming);
  assert.deepEqual(fresh.map((r) => dedupeKey(r)), ['d:BELT-1:8', 'd:BAND-1:7', 'c:m2']);
  assert.deepEqual(duplicates.map((r) => dedupeKey(r)), ['d:BELT-1:7', 'c:m1']);
});

test('a record repeated inside one upload is kept once', () => {
  const { fresh, duplicates } = splitDuplicates([], [{ serial: 'B', device_seq: 1 }, { serial: 'B', device_seq: 1 }, { serial: 'B', device_seq: 2 }]);
  assert.equal(fresh.length, 2);
  assert.equal(duplicates.length, 1);
});

test('records without any key are never treated as duplicates', () => {
  const { fresh, duplicates } = splitDuplicates([{ body: 'a' }], [{ body: 'a' }, { body: 'a' }]);
  assert.equal(fresh.length, 2);
  assert.equal(duplicates.length, 0);
});

test('uploading the same batch twice adds nothing the second time', () => {
  const batch = [{ serial: 'B', device_seq: 1 }, { serial: 'B', device_seq: 2 }, { client_id: 'x' }];
  const server = [];
  const first = splitDuplicates(server, batch);
  server.push(...first.fresh);
  const second = splitDuplicates(server, batch);
  assert.equal(first.fresh.length, 3);
  assert.equal(second.fresh.length, 0);
  assert.equal(second.duplicates.length, 3);
});

test('queued records come out oldest first and synced records stay out', () => {
  const records = [
    { id: 'c', syncState: 'queued', queued_at: 300 },
    { id: 'a', syncState: 'queued', queued_at: 100 },
    { id: 'x', syncState: 'synced', queued_at: 50 },
    { id: 'b', syncState: 'queued', queued_at: 100 },
    { id: 'd', syncState: 'queued' },
  ];
  assert.deepEqual(queuedInOrder(records).map((r) => r.id), ['d', 'a', 'b', 'c']);
});

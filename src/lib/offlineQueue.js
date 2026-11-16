// Offline queue (spec 3.2, "Offline sync"): records made offline carry syncState 'queued' and a client id.
// On reconnection they upload in order and the server removes duplicates by (device serial, sequence number)
// or by client id.

/**
 * The identity the server de-duplicates on, or null when a record has neither. Readings do not carry the serial
 * themselves (spec 6.1: it is on their check session), so the caller can pass it in.
 */
export function dedupeKey(record, serial = record.serial) {
  if (serial !== undefined && serial !== null && record.device_seq !== undefined && record.device_seq !== null) {
    return `d:${serial}:${record.device_seq}`;
  }
  if (record.client_id) return `c:${record.client_id}`;
  return null;
}

/**
 * Split incoming records into new ones and duplicates, against what the server already has and against each other.
 * Records without a key are always new.
 */
export function splitDuplicates(existing, incoming, keyOf = dedupeKey) {
  const seen = new Set();
  for (const record of existing) {
    const key = keyOf(record);
    if (key) seen.add(key);
  }
  const fresh = [];
  const duplicates = [];
  for (const record of incoming) {
    const key = keyOf(record);
    if (key && seen.has(key)) {
      duplicates.push(record);
      continue;
    }
    if (key) seen.add(key);
    fresh.push(record);
  }
  return { fresh, duplicates };
}

/** Queued records in the order they were made (queued_at, then their position), oldest first. */
export function queuedInOrder(records) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.syncState === 'queued')
    .sort((a, b) => (a.record.queued_at ?? 0) - (b.record.queued_at ?? 0) || a.index - b.index)
    .map(({ record }) => record);
}

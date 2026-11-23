// Immutable table operations. Rows are never changed in place: a changed table gets a new array, so React and the
// index cache below can rely on identity.

const indexes = new WeakMap();

/** Rows of one table by id. Cached per array, which is replaced whenever the table changes. */
export function byId(rows) {
  let map = indexes.get(rows);
  if (!map) {
    map = new Map(rows.map((row) => [row.id, row]));
    indexes.set(rows, map);
  }
  return map;
}

/**
 * Apply a list of operations to the state and return the new state:
 *   { op: 'insert', table, row }            { op: 'insertMany', table, rows }
 *   { op: 'update', table, id, patch }      { op: 'updateMany', table, patches: [{ id, patch }] }
 *   { op: 'delete', table, id }
 *   { op: 'meta', patch }                   { op: 'hardware', serial, patch }
 * An update or delete of a row that does not exist changes nothing.
 */
export function applyOps(state, ops) {
  let { db, meta, hardware } = state;
  for (const op of ops) {
    switch (op.op) {
      case 'insert':
        db = { ...db, [op.table]: [...db[op.table], op.row] };
        break;
      case 'insertMany':
        if (op.rows.length > 0) db = { ...db, [op.table]: [...db[op.table], ...op.rows] };
        break;
      case 'update':
        db = { ...db, [op.table]: db[op.table].map((row) => (row.id === op.id ? { ...row, ...op.patch } : row)) };
        break;
      case 'delete':
        if (db[op.table].some((row) => row.id === op.id)) db = { ...db, [op.table]: db[op.table].filter((row) => row.id !== op.id) };
        break;
      case 'updateMany': {
        const patches = new Map(op.patches.map(({ id, patch }) => [id, patch]));
        if (patches.size > 0) {
          db = { ...db, [op.table]: db[op.table].map((row) => (patches.has(row.id) ? { ...row, ...patches.get(row.id) } : row)) };
        }
        break;
      }
      case 'meta':
        meta = { ...meta, ...op.patch };
        break;
      case 'hardware':
        hardware = { ...hardware, [op.serial]: { ...hardware[op.serial], ...op.patch } };
        break;
      default:
        throw new Error(`Unknown operation ${op.op}`);
    }
  }
  if (db === state.db && meta === state.meta && hardware === state.hardware) return state;
  return { ...state, db, meta, hardware };
}

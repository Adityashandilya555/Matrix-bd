// skipcq: JS-0833
// snake_case (wire) → camelCase (React) for the vendor platform API modules.
// Recursive, so nested rows and arrays come out in one call. Keys that are data
// rather than field names (phase keys, checklist item ids) are kept as sent.
const KEEP_KEYS = new Set(['progress', 'checks']);

function camelKey(k) {
  return k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function camelize(value) { // skipcq: JS-0833
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[camelKey(k)] = KEEP_KEYS.has(k) ? v : camelize(v);
    }
    return out;
  }
  return value;
}

// skipcq: JS-0833
// parseEventValue — recover the structured value behind a timeline diff string.
//
// launch_review_events stores each change as {field, label, from, to} where from
// and to are already strings. New events carry JSON (launch_service._str now uses
// json.dumps), but events recorded before that fix hold a PYTHON REPR:
//
//   [{'year': 1, 'percent': 12.0, 'dine_in_pct': 2.0}]
//
// Single quotes, so JSON.parse rejects it outright. Rather than migrate an audit
// trail in place, this reads both shapes so existing history renders correctly.
//
// Returns the parsed value, or null when the string is not a container we
// recognise. NEVER throws — callers fall back to rendering the raw string, so the
// worst case is exactly today's behaviour.

// Only the keys a staggered-escalation row can carry. The legacy path rewrites
// quotes, which would corrupt any value containing an apostrophe, so it is gated
// on the string actually looking like one of these objects rather than applied
// hopefully to anything that failed JSON.parse.
//
// Expressed with string ops rather than a regex on purpose: DeepSource's JS
// parser mis-tokenises a regex literal that contains a quote character, treating
// the leading slash as division and the quote as an unterminated string, which
// fails the whole file with JS-0833.
const Q = String.fromCharCode(39);
const LEGACY_KEYS = ['year', 'percent', 'mg', 'dine_in_pct', 'delivery_pct'];
const looksLegacy = (text) =>
  text.startsWith('[') && LEGACY_KEYS.some((k) => text.includes(`{${Q}${k}${Q}:`));

export function parseEventValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;      // already structured
  const text = String(raw).trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return null;

  try {
    return JSON.parse(text);
  } catch (notJson) {   // eslint-disable-line no-unused-vars
    // Not JSON — fall through to the legacy repr path below.
  }

  if (!looksLegacy(text)) return null;
  try {
    // Python repr of these rows contains only single-quoted bare keys and
    // numbers — no nested strings — so swapping the quote character is safe
    // here in a way it would not be in general. None/True/False are mapped
    // because a legacy row could carry an explicit null.
    const json = text
      .split(Q).join('"')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');
    return JSON.parse(json);
  } catch (notRepr) {   // eslint-disable-line no-unused-vars
    return null;
  }
}

// A staggered schedule is a non-empty array of objects carrying a `year`.
// Anything else (a bare list, a dict, a number) renders as text.
export function asScheduleRows(raw) {
  const parsed = parseEventValue(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const rows = parsed.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  return rows.length === parsed.length ? rows : null;
}

// skipcq: JS-0833
// Display helpers shared by the vendor portal and the Project team's
// Vendor fit-out page. Formatting only — every figure is computed server-side.

export const STATUS_LABEL = { // skipcq: JS-0833
  ontrack: 'On track',
  risk: 'At risk',
  late: 'Late',
  handed: 'Handed over',
  po: 'PO issued',
  mobilising: 'Mobilising',
  cancelled: 'Cancelled',
};

export const STATUS_TONE = {
  ontrack: 'ok', risk: 'warn', late: 'bad', handed: 'info', po: 'muted', mobilising: 'muted', cancelled: 'muted',
};

export function inr(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;
}

export function lakh(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return `₹${(Number(v) / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
}

function parseDay(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

export function fmtDate(s, withYear = false) {
  const d = parseDay(s);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' });
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function slipText(p) {
  if (!p || ['handed', 'po', 'mobilising', 'cancelled'].includes(p.scheduleStatus)) return '';
  const n = Number(p.slipDays) || 0;
  if (n > 0) return `${n} day${n === 1 ? '' : 's'} behind`;
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} ahead`;
  return 'On plan';
}

// Only a #RRGGBB accent from the server is applied; anything else falls back.
export function safeAccent(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}

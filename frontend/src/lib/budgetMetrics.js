// skipcq: JS-0833
// Shared budget-metrics helpers — the single source of truth for the 3
// derived, read-only ratios shown alongside the 11-line site budget
// (Project Excellence, Project, Business Admin approval, Financial Closure).

// Indices (1-based) whose sum feeds the "Civil, Interior & MEP" metric.
export const CIVIL_MEP_IDX = [2, 3, 4, 5, 8];

export function sumByIdx(items, idxList, amountKey = 'amount') {
  const list = items || [];
  return idxList.reduce((sum, idx) => {
    const item = list.find((it) => Number(it.idx) === idx);
    return sum + (Number(item?.[amountKey]) || 0);
  }, 0);
}

export function computeBudgetTotal(items, amountKey = 'amount') {
  return (items || []).reduce((sum, item) => sum + (Number(item?.[amountKey]) || 0), 0);
}

// Indian-grouped rupee value for whole totals (e.g. 804670 -> "₹8,04,670").
export function formatINR(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₹0';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Raw numeric ratio, or null when the divisor is missing / zero / the result
// isn't finite. Kept separate from formatRatio so callers that need to diff
// two ratios (e.g. GFC vs Closure) can do the arithmetic before formatting.
export function computeRatio(numerator, divisor) {
  const d = Number(divisor);
  if (!Number.isFinite(d) || d === 0) return null;
  const ratio = Number(numerator) / d;
  return Number.isFinite(ratio) ? ratio : null;
}

// A calculated ratio renders the rupee value, or "—" when its divisor is
// missing / zero (so we never show Infinity or NaN). A nonzero ratio that
// would otherwise round away to a misleading "₹0" at whole-rupee precision
// is instead shown to 2 decimal places, so a real (if tiny) value is never
// hidden behind a flat zero.
export function formatRatio(numerator, divisor) {
  const ratio = computeRatio(numerator, divisor);
  if (ratio === null) return '—';
  if (ratio !== 0 && Math.abs(ratio) < 0.5) {
    return `₹${ratio.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatINR(ratio);
}

// The 3 derived metrics shared across Project Excellence, Project, Business
// Admin approval, and Financial Closure. Returns both the formatted display
// string and the raw numeric ratio (for callers that need to diff two
// snapshots, e.g. Financial Closure's GFC-vs-actual comparison).
export function computeDerivedMetrics({ items, totalIndoorAreaSqft, totalAreaSqft, covers, amountKey = 'amount' }) {
  const budgetTotal = computeBudgetTotal(items, amountKey);
  const civilMepSum = sumByIdx(items, CIVIL_MEP_IDX, amountKey);
  return {
    budgetTotal,
    civilMepPerSqft: formatRatio(civilMepSum, totalIndoorAreaSqft),
    capexPerSqft: formatRatio(budgetTotal, totalAreaSqft),
    capexPerCover: formatRatio(budgetTotal, covers),
    civilMepPerSqftRaw: computeRatio(civilMepSum, totalIndoorAreaSqft),
    capexPerSqftRaw: computeRatio(budgetTotal, totalAreaSqft),
    capexPerCoverRaw: computeRatio(budgetTotal, covers),
  };
}

// Variation = closure actual − GFC baseline. Over budget (positive) is red,
// under budget (negative) is green, exactly on budget is muted.
export function variationTone(variation) {
  const v = Number(variation) || 0;
  if (v > 0) return 'var(--zm-danger)';
  if (v < 0) return 'var(--zm-success)';
  return 'var(--zm-fg-3)';
}

export function formatVariation(variation) {
  const v = Number(variation) || 0;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatINR(Math.abs(v))}`;
}

// Diffs two raw ratios (as returned by computeRatio / computeDerivedMetrics'
// *Raw fields) — same sign convention as formatVariation, but never rounds a
// small nonzero delta away to "+₹0". If both sides are null (no divisor data
// at all, e.g. area/covers never entered) there's nothing to diff, so this
// returns "—" rather than a misleading "₹0" flat variation.
export function formatRatioVariation(closureRatio, gfcRatio) {
  if (closureRatio == null && gfcRatio == null) return '—';
  const c = closureRatio == null ? 0 : Number(closureRatio);
  const g = gfcRatio == null ? 0 : Number(gfcRatio);
  const v = c - g;
  if (!Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 0.5) {
    return `${sign}₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${sign}${formatINR(abs)}`;
}

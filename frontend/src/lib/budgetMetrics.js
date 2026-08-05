// skipcq: JS-0833
export const CIVIL_MEP_IDX = [2, 4];

export const FITOUT_FURNITURE_IDX = [2, 3, 4];

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

export function computeRatio(numerator, divisor) {
  const d = Number(divisor);
  if (!Number.isFinite(d) || d === 0) return null;
  const ratio = Number(numerator) / d;
  return Number.isFinite(ratio) ? ratio : null;
}

export function formatRatio(numerator, divisor) {
  const ratio = computeRatio(numerator, divisor);
  if (ratio === null) return '—';
  if (ratio !== 0 && Math.abs(ratio) < 0.5) {
    return `₹${ratio.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatINR(ratio);
}

export function computeDerivedMetrics({ items, totalIndoorAreaSqft, totalAreaSqft, covers, amountKey = 'amount' }) {
  const budgetTotal = computeBudgetTotal(items, amountKey);
  const civilMepSum = sumByIdx(items, CIVIL_MEP_IDX, amountKey);
  const fitoutFurnitureSum = sumByIdx(items, FITOUT_FURNITURE_IDX, amountKey);
  return {
    budgetTotal,
    civilMepPerSqft: formatRatio(civilMepSum, totalIndoorAreaSqft),
    fitoutFurniturePerSqft: formatRatio(fitoutFurnitureSum, totalIndoorAreaSqft),
    capexPerSqft: formatRatio(budgetTotal, totalAreaSqft),
    capexPerCover: formatRatio(budgetTotal, covers),
    civilMepPerSqftRaw: computeRatio(civilMepSum, totalIndoorAreaSqft),
    fitoutFurniturePerSqftRaw: computeRatio(fitoutFurnitureSum, totalIndoorAreaSqft),
    capexPerSqftRaw: computeRatio(budgetTotal, totalAreaSqft),
    capexPerCoverRaw: computeRatio(budgetTotal, covers),
  };
}

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

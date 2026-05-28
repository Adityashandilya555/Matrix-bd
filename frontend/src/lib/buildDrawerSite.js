// Data transform extracted from App.jsx buildDrawerSite helper.
// Pure function — no UI, no side effects.

export function buildDrawerSite(row) {
  const details = row.details || {};
  const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
  const createdBy = typeof row.createdBy === 'object' ? row.createdBy?.name : row.createdBy;
  const rent = first(row.rent, row.expectedRent, details.rent);
  const cam = first(row.cam, details.cam);
  const totalOpCost = first(row.totalOpCost, details.totalOpCost);

  return {
    ...row,
    id: row.id || row.code,
    code: row.code || '—',
    name: row.name || details.name || 'Untitled site',
    city: row.city || details.city || '—',
    stage: row.stage || 'shortlist',
    carpet: first(row.carpet, details.carpet),
    opCost: totalOpCost,
    rent,
    rentType: first(row.rentType, details.rentType),
    cam,
    deposit: first(row.deposit, details.deposit),
    lockin: first(row.lockin, details.lockin),
    tenure: first(row.tenure, details.tenure),
    escalation: first(row.expectedEscalationPct, row.escalation, details.escalation),
    escalationYears: first(row.expectedEscalationYears, details.escalationYears),
    revshare: first(row.expectedRevsharePct, row.revshare, details.revshare),
    rentFree: first(row.rentFreeDays, details.rentFreeDays),
    estSales: first(row.estSales, details.estSales),
    nearestStarbucks: first(row.nearestStarbucks, details.nearestStarbucks),
    nearestTWC: first(row.nearestTWC, details.nearestTWC),
    cadex: first(row.cadex, details.cadex),
    brokerage: first(row.brokerage, details.brokerage),
    model: first(row.model, details.model),
    spocName: first(row.spocName, details.spocName, createdBy, row.by),
    spocPhone: first(row.spocPhone, details.spocPhone),
    pin: first(row.googlePin, row.pin, details.googlePin),
    googleMapsUrl: first(row.googleMapsUrl, details.googleMapsUrl),
    photos: Array.isArray(details.photos) ? details.photos : [],
    loiSignedAt: first(row.loiUploadedAt, row._loiUploadedAt),
    loiSubmittedAt: first(row.loiUploadedAt, row._loiUploadedAt),
    days: row.days ?? row.daysSinceApproval ?? 0,
    createdAt: first(row.createdAt, row.visitDate),
    createdBy,
  };
}

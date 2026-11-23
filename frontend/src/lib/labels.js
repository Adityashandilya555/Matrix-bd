// skipcq: JS-0833
// Turn stored codes into words people read. Raw values such as
// `pending_admin_review`, `monthly_rent` or `project_excellence` must never be
// shown as-is.
import { workspaceModuleLabel } from '../modules/shared/workspaceModules.js';

const WORDS = { dd: 'DD', loi: 'LOI', nso: 'NSO', gfc: 'GFC', boq: 'BOQ', bd: 'BD', noc: 'NOC', fssai: 'FSSAI', cam: 'CAM', qa: 'QA', '2d': '2D', '3d': '3D' };

// "legal_review" → "Legal review"; known acronyms keep their capitals.
export function humanize(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const words = String(value).replace(/[_-]+/g, ' ').trim().split(/\s+/);
  return words.map((w, i) => {
    const lower = w.toLowerCase();
    if (WORDS[lower]) return WORDS[lower];
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  }).join(' ');
}

// Module key → its display name ("project_excellence" → "Project Excellence").
export function moduleLabel(value) {
  return workspaceModuleLabel(value) || humanize(value);
}

// Legal change requests name a table and a column; show what the field means.
const CHANGE_FIELD = {
  legal_dd_checklist: 'Due diligence',
  site_agreement: 'Agreement',
  site_licensing: 'Licensing',
  sites: 'Site',
};
export function changeFieldLabel(table, field) {
  return `${CHANGE_FIELD[table] || humanize(table)} · ${humanize(field)}`;
}

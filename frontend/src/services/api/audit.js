import { adapter } from './adapters/index.js';

// Public site-activity service.
// `getSiteActivity` returns a list of canonical activity entries (see below).
// Components must NOT inline-hardcode mock activity data — go through this.
//
// Canonical activity entry shape:
//   { id, siteId, actor, action, fromStatus?, toStatus?, fieldName?, fromValue?, toValue?, detail?, createdAt }
//
// The frontend derives a render `tag` (create | submit | edit | approve | doc) from `action`
// at render time so all colour/icon decisions live in one place.

const ACTION_TO_TAG = {
  create_draft: 'create',
  shortlist: 'submit',
  submit_details_for_review: 'submit',
  pipeline_field_edited: 'edit',
  supervisor_field_edited: 'supervisor',
  exec_viewed_details: 'view',
  approve_details: 'approve',
  set_loi_timeline: 'edit',
  upload_loi: 'doc',
  push_to_payments: 'approve',
  send_to_legal: 'submit',
  legal_dd_items_saved: 'edit',
  legal_dd_submitted_for_review: 'submit',
  legal_dd_auto_positive: 'approve',
  legal_dd_positive: 'approve',
  legal_dd_rejected: 'edit',
  legal_dd_recovered: 'approve',
  legal_agreement_saved: 'approve',
  legal_approved: 'approve',
  legal_licensing_partial: 'edit',
  legal_licensing_submitted_for_review: 'submit',
  design_allocated: 'submit',
  design_delegation_revoked: 'edit',
  design_boq_approved: 'approve',
  design_deliverable_approved: 'approve',
  design_deliverable_awaiting_admin: 'submit',
  design_deliverable_self_uploaded: 'submit',
  design_deliverable_submitted: 'submit',
  design_deliverable_rejected: 'edit',
  design_admin_approved: 'approve',
  design_admin_rejected: 'edit',
  design_gfc_approved: 'approve',
  design_gfc_rejected: 'edit',
  project_allocated: 'submit',
  project_allocation_revoked: 'edit',
  project_budget_saved: 'edit',
  project_budget_submitted: 'submit',
  project_budget_supervisor_reviewed: 'approve',
  project_budget_admin_reviewed: 'approve',
  project_milestone_submitted: 'submit',
  project_milestone_reviewed: 'approve',
  project_initialization_responded: 'submit',
  project_initialization_finalized: 'approve',
  project_mid_visit_set: 'edit',
  project_quality_audit_uploaded: 'submit',
  project_quality_audit_reviewed: 'approve',
  project_pushed_to_nso: 'approve',
  nso_stage_one_saved: 'edit',
  nso_stage_two_saved: 'edit',
  nso_stage_three_saved: 'edit',
  nso_final_approved: 'approve',
  reject: 'edit',
  archive: 'edit',
  reassign_site: 'edit',
};

const TAG_TO_COLOR = {
  create: '#6B7280',
  submit: '#1E40AF',
  edit: '#005F60',
  approve: '#047857',
  doc: '#1E40AF',
  // Supervisor amended an executive's submission — amber, matches the site's
  // yellow flag and the per-field eye highlight in the drawer.
  supervisor: '#B45309',
  view: '#6B7280',
};

const MODULE_ACTION_FILTERS = {
  legal: [
    (action) => action === 'send_to_legal',
    (action) => action.startsWith('legal_'),
    (action) => action.startsWith('change_request_'),
  ],
  design: [
    (action) => action.startsWith('design_'),
  ],
  project: [
    (action) => action.startsWith('project_'),
  ],
  nso: [
    (action) => action.startsWith('nso_'),
    (action) => action === 'project_pushed_to_nso',
  ],
};

function entryMatchesModule(entry, module) {
  const checks = MODULE_ACTION_FILTERS[String(module || '').toLowerCase()];
  if (!checks) return true;
  const action = String(entry?.action || '');
  return checks.some((check) => check(action));
}

export function tagForAction(action) { return ACTION_TO_TAG[action] || 'edit'; }
export function colorForAction(action) { return TAG_TO_COLOR[tagForAction(action)]; }

// Human-readable label per action. Field edits get their field_name suffixed.
export function labelForEntry(e) {
  switch (e.action) {
    case 'create_draft':              return 'created pipeline draft';
    case 'shortlist':                 return 'submitted pipeline for shortlist';
    case 'submit_details_for_review': return 'completed site detail form';
    case 'approve_details':           return 'approved site shortlist';
    case 'set_loi_timeline':          return e.detail ? `set LOI timeline (${e.detail})` : 'set LOI timeline';
    case 'upload_loi':                return 'uploaded LOI document';
    case 'push_to_payments':          return 'pushed site to payments';
    case 'send_to_legal':             return 'sent site to Legal';
    case 'legal_dd_items_saved':      return 'updated due-diligence checklist';
    case 'legal_dd_submitted_for_review': return 'submitted DDR for review';
    case 'legal_dd_auto_positive':    return 'auto-marked DDR positive';
    case 'legal_dd_positive':         return 'marked DDR positive';
    case 'legal_dd_rejected':         return e.detail ? `rejected DDR (${e.detail})` : 'rejected DDR';
    case 'legal_dd_recovered':        return 'recovered site to legal review';
    case 'legal_agreement_saved':     return 'saved agreement status';
    case 'legal_approved':            return 'legal approved site';
    case 'legal_licensing_partial':   return 'saved licensing checklist';
    case 'legal_licensing_submitted_for_review': return 'submitted licensing for review';
    case 'design_allocated':          return 'allocated design work';
    case 'design_delegation_revoked': return 'revoked design delegation';
    case 'design_boq_approved':       return 'approved BOQ';
    case 'design_deliverable_approved': return 'approved design deliverable';
    case 'design_deliverable_awaiting_admin': return 'sent design deliverable for admin approval';
    case 'design_deliverable_self_uploaded': return 'uploaded design deliverable';
    case 'design_deliverable_submitted': return 'submitted design deliverable';
    case 'design_deliverable_rejected': return e.detail ? `rejected design deliverable (${e.detail})` : 'rejected design deliverable';
    case 'design_admin_approved':     return 'admin approved design deliverable';
    case 'design_admin_rejected':     return e.detail ? `admin rejected design deliverable (${e.detail})` : 'admin rejected design deliverable';
    case 'design_gfc_approved':       return 'approved GFC';
    case 'design_gfc_rejected':       return e.detail ? `rejected GFC (${e.detail})` : 'rejected GFC';
    case 'project_allocated':         return 'allocated project work';
    case 'project_allocation_revoked': return 'revoked project allocation';
    case 'project_budget_saved':      return 'saved project budget draft';
    case 'project_budget_submitted':  return 'submitted project budget';
    case 'project_budget_supervisor_reviewed': return 'supervisor reviewed project budget';
    case 'project_budget_admin_reviewed': return 'admin reviewed project budget';
    case 'project_milestone_submitted': return 'submitted project milestone';
    case 'project_milestone_reviewed': return 'reviewed project milestone';
    case 'project_initialization_responded': return 'responded to project initialization';
    case 'project_initialization_finalized': return 'finalized project initialization';
    case 'project_mid_visit_set':     return 'recorded mid-project visit';
    case 'project_quality_audit_uploaded': return 'uploaded quality audit';
    case 'project_quality_audit_reviewed': return 'reviewed quality audit';
    case 'project_pushed_to_nso':     return 'pushed project to NSO';
    case 'nso_stage_one_saved':       return 'saved NSO property readiness';
    case 'nso_stage_two_saved':       return 'saved NSO license status';
    case 'nso_stage_three_saved':     return 'saved NSO launch readiness';
    case 'nso_final_approved':        return 'final approved NSO';
    case 'reject':                    return 'rejected site';
    case 'archive':                   return 'archived site';
    case 'reassign_site':             return 'reassigned site';
    case 'pipeline_field_edited':
      return `updated ${e.fieldName || 'field'}${e.toValue ? ` to ${e.toValue}` : ''}`;
    case 'supervisor_field_edited':
      return `supervisor edited ${e.fieldName || 'field'}${e.toValue ? ` to ${e.toValue}` : ''}`;
    case 'exec_viewed_details':
      return 'reviewed supervisor edits';
    default:
      return e.action.replace(/_/g, ' ');
  }
}

export async function getSiteActivity(siteId, options = {}) {
  // Adapter contract: returns { items: [...], total: N } where items are canonical entries.
  const response = await adapter.getSiteActivity(siteId, options);
  if (!options?.module) return response;
  const items = (response?.items || []).filter((entry) => entryMatchesModule(entry, options.module));
  return { items, total: items.length };
}

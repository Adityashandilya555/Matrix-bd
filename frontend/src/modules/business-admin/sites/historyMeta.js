// Cross-module history helpers. The audit_logs table has no `module` column, so
// module is inferred from the action prefix (the same convention the backend
// uses). Labels/colours give the business-admin timeline a readable, per-module
// view of everything that has happened to a site.

export const MODULE_META = {
  bd:      { label: 'BD',      color: '#6B7CFF' },
  legal:   { label: 'Legal',   color: '#36B39A' },
  design:  { label: 'Design',  color: '#4FA3FF' },
  payment: { label: 'Payment', color: '#E0A23C' },
  project: { label: 'Project', color: '#B083E8' },
};

export function moduleForAction(action = '') {
  if (action.startsWith('legal_') || action.startsWith('change_request_')) return 'legal';
  if (action.startsWith('design_')) return 'design';
  if (action.startsWith('project_')) return 'project';
  if (action.startsWith('finance_')) return 'payment';
  return 'bd';
}

const LABELS = {
  // BD
  create_draft: 'created pipeline draft',
  create_draft_auto_shortlist: 'created & shortlisted site',
  shortlist: 'shortlisted site',
  submit_details_for_review: 'completed site detail form',
  approve_details: 'approved site shortlist',
  set_loi_timeline: 'set LOI timeline',
  upload_loi: 'uploaded LOI document',
  upload_photo: 'uploaded a photo',
  send_to_legal: 'pushed site to Legal',
  reassign_site: 'reassigned site',
  reject: 'rejected site',
  archive: 'archived site',
  revive: 'revived site',
  // Legal
  legal_dd_items_saved: 'updated due-diligence checklist',
  legal_dd_submitted_for_review: 'submitted DDR for review',
  legal_dd_positive: 'marked DDR positive',
  legal_dd_rejected: 'rejected DDR',
  legal_dd_recovered: 'recovered site to legal review',
  legal_agreement_saved: 'saved agreement status',
  legal_approved: 'legal approved site',
  legal_licensing_partial: 'saved licensing checklist',
  legal_licensing_submitted_for_review: 'submitted licensing for review',
  legal_licensing_auto_inherited: 'inherited licensing status',
  change_request_opened: 'opened a change request',
  change_request_approved: 'approved a change request',
  change_request_rejected: 'rejected a change request',
  // Design
  design_allocated: 'allocated design to an executive',
  design_deliverable_submitted: 'submitted a design deliverable',
  design_deliverable_self_uploaded: 'uploaded a design deliverable',
  design_deliverable_approved: 'supervisor approved a deliverable',
  design_deliverable_rejected: 'sent back a deliverable',
  design_deliverable_awaiting_admin: 'deliverable awaiting admin approval',
  design_admin_approved: 'admin approved a 2D/3D deliverable',
  design_admin_rejected: 'admin sent back a 2D/3D deliverable',
  design_admin_review_undone: 'admin undid their 2D/3D decision',
  design_boq_approved: 'approved the BOQ',
  design_gfc_approved: 'granted Good-For-Construction',
  design_gfc_rejected: 'sent back the GFC package',
  design_delegation_revoked: 'revoked a design allocation',
  // Payment / finance
  finance_draft_saved: 'saved finance details',
  finance_submitted: 'submitted finance for approval',
  finance_supervisor_approved: 'supervisor approved finance',
  finance_admin_approved: 'admin approved payment',
  // Project
  project_allocated: 'allocated project to an executive',
  project_budget_saved: 'saved the project budget',
  project_budget_submitted: 'submitted budget for review',
  project_budget_supervisor_approved: 'supervisor approved the budget',
  project_budget_supervisor_rejected: 'supervisor sent back the budget',
  project_budget_approved: 'admin approved the budget',
  project_budget_admin_rejected: 'admin sent back the budget',
  project_milestone_approved: 'approved a milestone',
  project_milestone_rejected: 'sent back a milestone',
  project_inspection_recorded: 'recorded an inspection',
  project_quality_audit_passed: 'passed the quality audit',
  project_quality_audit_failed: 'failed the quality audit',
  project_completed: 'marked the project complete',
};

export function labelForEntry(e) {
  if (e.action === 'pipeline_field_edited') {
    return `updated ${e.fieldName || 'a field'}${e.toValue ? ` to ${e.toValue}` : ''}`;
  }
  return LABELS[e.action] || e.action.replace(/_/g, ' ');
}

const isApproval = (a = '') => /approved|positive|gfc|complete|passed/.test(a);
const isReject = (a = '') => /rejected|reject|failed|negative|archive/.test(a);

// Dot colour: approvals green, rejections red, otherwise the module hue.
export function dotColor(action) {
  if (isReject(action)) return '#E5484D';
  if (isApproval(action)) return '#2FA160';
  return MODULE_META[moduleForAction(action)].color;
}

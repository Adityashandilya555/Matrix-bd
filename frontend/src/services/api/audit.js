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
  approve_details: 'approve',
  set_loi_timeline: 'edit',
  upload_loi: 'doc',
  push_to_payments: 'approve',
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
};

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
    case 'reject':                    return 'rejected site';
    case 'archive':                   return 'archived site';
    case 'reassign_site':             return 'reassigned site';
    case 'pipeline_field_edited':
      return `updated ${e.fieldName || 'field'}${e.toValue ? ` to ${e.toValue}` : ''}`;
    default:
      return e.action.replace(/_/g, ' ');
  }
}

export async function getSiteActivity(siteId) {
  // Adapter contract: returns { items: [...], total: N } where items are canonical entries.
  return adapter.getSiteActivity(siteId);
}

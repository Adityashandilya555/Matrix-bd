import { ROLE } from './roles.js';

// ACTION -> allowed roles map
// Keep in sync with backend app/rbac/permissions.py
export const PERMISSIONS = {
  create_draft:               [ROLE.EXECUTIVE, ROLE.SUPERVISOR, ROLE.BUSINESS_ADMIN],
  save_draft_details:         [ROLE.EXECUTIVE],
  submit_details_for_review:  [ROLE.EXECUTIVE],
  upload_loi:                 [ROLE.EXECUTIVE],
  view_own_loi:               [ROLE.EXECUTIVE],

  shortlist:                  [ROLE.SUPERVISOR, ROLE.BUSINESS_ADMIN],
  approve_details:            [ROLE.SUPERVISOR, ROLE.BUSINESS_ADMIN],
  reject:                     [ROLE.SUPERVISOR, ROLE.BUSINESS_ADMIN],
  archive:                    [ROLE.SUPERVISOR, ROLE.BUSINESS_ADMIN],
  set_loi_timeline:           [ROLE.SUPERVISOR],
  push_to_payments:           [ROLE.SUPERVISOR],
  reassign_site:              [ROLE.SUPERVISOR],
  legal_view_queue:           [ROLE.SUPERVISOR, ROLE.EXECUTIVE],
  legal_save_dd:              [ROLE.SUPERVISOR, ROLE.EXECUTIVE],
  legal_finalize_dd:          [ROLE.SUPERVISOR],
  legal_save_agreement:       [ROLE.SUPERVISOR],
  legal_save_licensing:       [ROLE.SUPERVISOR, ROLE.EXECUTIVE],
};

export function can(role, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role);
}

// skipcq: JS-0833
// The two status vocabularies of financial closure, and the one rule for reading
// "who owes the next action" off them.
//
// These lived in FinancialClosureQueuePage until the Launch Sites page grew a
// Financial Closure tab and needed the same labels. They are shared rather than
// copied because the pair has already caused one bug: the two vocabularies are
// DIFFERENT and were once looked up in the same map, so every CLOSURE STATUS
// lookup missed and fell through to a raw token ("pending_supervisor").
//
//   sites.financial_closure_status  — where the site is in the closure workflow
//   site_budgets.status            — where the closure BUDGET is in its review
//
// COMMENT STYLE: line comments only, no JSDoc blocks — see launchRentAdapter.js.

// sites.financial_closure_status — the workflow stage. Drives the filter pills.
export const STATUS_LABELS = {
  open: 'Open',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  closed: 'Closed',
};

// site_budgets.status — the closure budget row's own state. A DIFFERENT
// vocabulary; the CLOSURE STATUS column reads this one.
export const CLOSURE_BUDGET_LABELS = {
  draft: 'Draft',
  pending_supervisor: 'Supervisor',
  pending_admin: 'Admin',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const CLOSURE_BUDGET_TONES = {
  draft: 'var(--zm-fg-3)',
  pending_supervisor: 'var(--zm-warning)',
  pending_admin: 'var(--zm-warning)',
  approved: 'var(--zm-success)',
  rejected: 'var(--zm-danger)',
};

export const STATUS_FILTERS = [
  { key: 'open',      label: 'Open',      color: 'var(--zm-warning)' },
  { key: 'allocated', label: 'Allocated', color: 'var(--zm-accent)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'closed',    label: 'Closed',    color: 'var(--zm-success)' },
];

// The Launch Sites tab collapses the four workflow stages into the only two
// questions a BD reader asks: is this still moving, or is it done?
export const PENDING_STATUSES = ['open', 'allocated', 'budgeting'];

export const isClosed = (row) => row?.financial_closure_status === 'closed';

// Who owes the next action.
//
// The BUDGET status is the real signal — it says whose desk the closure is on —
// so it is read first. Only while the budget is still being prepared (draft, or
// bounced back as rejected) does the question fall to who is preparing it: the
// delegated executive if one was allocated, otherwise the supervisor who owns
// the site.
//
// Deliberately NOT submitted_by_name: that is the site's CREATOR, who may be an
// executive and is not the person reviewing the closure. Naming them would point
// the reader at the wrong desk.
export function pendingWith(row) {
  if (!row) return '—';
  if (isClosed(row)) return '—';
  switch (row.closure_status) {
    case 'pending_supervisor': return 'Supervisor';
    case 'pending_admin': return 'Business Admin';
    case 'approved': return '—';
    default:
      return row.allocated_to_name
        ? `Executive · ${row.allocated_to_name} (delegated)`
        : 'Supervisor';
  }
}

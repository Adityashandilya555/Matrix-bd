// skipcq: JS-0833
// Financial closure status vocabularies, shared by the closure queue page and the
// Launch Sites closure tab.
//
// There are two, and they are not interchangeable:
//   sites.financial_closure_status — the site's stage in the closure workflow
//   site_budgets.status            — the closure budget's review state
//
// They were once looked up in the same map, so every CLOSURE STATUS lookup missed
// and fell through to a raw token. Kept in one module so they cannot drift apart.

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

// The Launch Sites tab collapses the four workflow stages into two: still moving,
// or done.
export const PENDING_STATUSES = ['open', 'allocated', 'budgeting'];

// Rows come from getFCQueue / getFC, both of which camelCase the wire payload.
export const isClosed = (row) => row?.financialClosureStatus === 'closed';

// Who owes the next action.
//
// The budget status is read first: it identifies whose desk the closure is on.
// Only while the budget is still being prepared does ownership fall to whoever is
// preparing it — the delegated executive, else the supervisor.
//
// Not submittedByName: that is the site's creator, not the closure's reviewer.
export function pendingWith(row) {
  if (!row) return '—';
  if (isClosed(row)) return '—';
  switch (row.closureStatus) {
    case 'pending_supervisor': return 'Supervisor';
    case 'pending_admin': return 'Business Admin';
    case 'approved': return '—';
    default:
      return row.allocatedToName
        ? `Executive · ${row.allocatedToName} (delegated)`
        : 'Supervisor';
  }
}

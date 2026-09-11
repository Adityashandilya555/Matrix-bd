// skipcq: JS-0833
// Contract for the closure status helpers.
//
// They read the camelCase rows that financialClosureApi's adapters emit, not the
// snake_case wire payload. A mismatch here is silent: every row falls to the
// default branch, the pills count nothing, and the tab renders empty while its
// tests pass against a shape the app never sees. The snake_case cases below
// exist to keep that failure loud.
import { describe, it, expect } from 'vitest';
import { isClosed, pendingWith, PENDING_STATUSES, STATUS_LABELS } from '../closureStatus.js';

const row = (over = {}) => ({
  siteId: 'f1', siteCode: 'CA-301', siteName: 'Powai', city: 'Mumbai',
  financialClosureStatus: 'allocated', closureStatus: 'draft',
  allocatedToName: null, ...over,
});

describe('isClosed', () => {
  it('is true only for the closed stage', () => {
    expect(isClosed(row({ financialClosureStatus: 'closed' }))).toBe(true);
    for (const s of PENDING_STATUSES) {
      expect(isClosed(row({ financialClosureStatus: s }))).toBe(false);
    }
  });

  it('is false for a snake_case row, rather than quietly half-working', () => {
    expect(isClosed({ financial_closure_status: 'closed' })).toBe(false);
  });

  it('tolerates a missing row', () => {
    expect(isClosed(null)).toBe(false);
  });
});

describe('pendingWith', () => {
  it('names the delegated executive while the budget is being prepared', () => {
    expect(pendingWith(row({ allocatedToName: 'Priya S.' })))
      .toBe('Executive · Priya S. (delegated)');
    expect(pendingWith(row({ closureStatus: 'rejected', allocatedToName: 'Priya S.' })))
      .toBe('Executive · Priya S. (delegated)');
  });

  it('falls to the supervisor when nobody is delegated', () => {
    expect(pendingWith(row())).toBe('Supervisor');
  });

  it('lets the budget status outrank the allocation', () => {
    // The executive prepared it, but the ball is elsewhere now.
    expect(pendingWith(row({ closureStatus: 'pending_supervisor', allocatedToName: 'Priya S.' })))
      .toBe('Supervisor');
    expect(pendingWith(row({ closureStatus: 'pending_admin', allocatedToName: 'Priya S.' })))
      .toBe('Business Admin');
  });

  it('shows nothing pending once the work is done', () => {
    expect(pendingWith(row({ closureStatus: 'approved' }))).toBe('—');
    expect(pendingWith(row({ financialClosureStatus: 'closed' }))).toBe('—');
  });

  it('does not read a snake_case row as delegated', () => {
    expect(pendingWith({ closure_status: 'draft', allocated_to_name: 'Priya S.' }))
      .toBe('Supervisor');
  });
});

describe('status vocabularies', () => {
  it('keeps the pending stages disjoint from closed', () => {
    expect(PENDING_STATUSES).not.toContain('closed');
    // Every pending stage is a real workflow stage, not an invented one.
    for (const s of PENDING_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
  });
});

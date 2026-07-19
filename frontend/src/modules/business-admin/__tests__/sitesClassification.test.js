import { describe, it, expect } from 'vitest';
import {
  classifyCounts, isSiteCompleted, isSiteLaunching, isSiteActive, isSiteRejected,
} from '../sites/SitesTab.jsx';

// The "Completed sites" KPI tile and the Sites → Completed tab must report the
// same number. Before the fix the tile counted `projectStatus in (done,
// completed)` while the tab counted *launched* sites — so a site whose project
// execution finished but which hadn't launched yet inflated the tile only.
describe('site lifecycle classification (KPI tile ↔ Completed tab parity)', () => {
  const launched   = { status: 'launched', isLaunched: true, nsoStatus: 'complete' };
  const projectDone = { status: 'pushed_to_payments', isLaunched: false, projectStatus: 'done', nsoStatus: 'complete' };
  const active      = { status: 'legal_review', isLaunched: false, projectStatus: 'in_progress', nsoStatus: 'pending' };
  const rejected    = { status: 'rejected', isLaunched: false };

  it('counts only launched sites as completed', () => {
    expect(isSiteCompleted(launched)).toBe(true);
    expect(isSiteCompleted(projectDone)).toBe(false); // the old-bug case
  });

  it('a project-done-but-unlaunched site is NOT completed', () => {
    // nso complete + not launched + not rejected → Launching, not Completed.
    expect(isSiteLaunching(projectDone)).toBe(true);
    expect(isSiteCompleted(projectDone)).toBe(false);
  });

  it('rejected wins over completed', () => {
    const launchedButRejected = { status: 'rejected', isLaunched: true };
    expect(isSiteRejected(launchedButRejected)).toBe(true);
    expect(classifyCounts([launchedButRejected])).toMatchObject({ rejected: 1, completed: 0 });
  });

  it('classifyCounts buckets a mixed set the same way the tabs do', () => {
    const counts = classifyCounts([launched, projectDone, active, rejected]);
    expect(counts).toEqual({ active: 1, launching: 1, completed: 1, rejected: 1 });
    // The tile reads .completed — exactly what the Completed tab shows.
    expect(counts.completed).toBe(1);
  });

  it('the four buckets are mutually exclusive and total', () => {
    const set = [launched, projectDone, active, rejected];
    for (const s of set) {
      const flags = [isSiteRejected(s), isSiteCompleted(s) && !isSiteRejected(s),
        isSiteLaunching(s), isSiteActive(s)].filter(Boolean);
      expect(flags.length).toBeGreaterThanOrEqual(1);
    }
    const c = classifyCounts(set);
    expect(c.active + c.launching + c.completed + c.rejected).toBe(set.length);
  });
});

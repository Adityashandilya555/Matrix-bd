// skipcq: JS-0833
// One queue for everyone waiting to be let into the workspace.
//
// Pending observers shipped in a second queue inside the Observer access
// section, further down the Departments tab. Two queues split one question —
// "who is waiting?" — across two places, and the lower one is under a heading
// nobody scrolls to.
//
// This lives in its own module because BOTH the tab and the shell need the
// answer. DepartmentsTab renders the list; TeamDashboard counts it for the nav
// badge, the attention summary and the Pending requests tile. When the merge
// lived inside the tab, those three still counted supervisors only — so a
// workspace whose only pending request was an observer showed a zero badge and
// "You're all caught up", which is the exact problem the merge set out to
// remove, just moved one level up.

// `kind` is what the shell dispatches approve/reject on: the two roles have
// different endpoints (a supervisor approval also writes a module membership;
// an observer approval must not). `module: 'observer'` lets the existing
// module-keyed filter tabs and counts work with no special-casing.
export function mergePending(supervisors, observers) {
  const sup = (supervisors?.items || []).map((u) => ({ ...u, kind: 'supervisor' }));
  const obs = (observers?.items || []).map((u) => ({ ...u, kind: 'observer', module: 'observer' }));
  const items = [...sup, ...obs].sort(
    (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  );

  const supFailed = supervisors?.status === 'error';
  const obsFailed = observers?.status === 'error';
  const anyLoading = supervisors?.status === 'loading' || observers?.status === 'loading';

  // Skeletons only when there is genuinely nothing to show. One side loading
  // while the other holds rows is not the initial load — it is a foreground
  // retry, and those fire from BOTH sections: Retry inside Observer access at
  // the foot of the tab calls loadObservers(false), which would otherwise blank
  // the Awaiting approval list at the head of it. A click in one section must
  // not empty another.
  //
  // Only a total failure is an error. If one side is down the other's rows are
  // still the best answer available, and blanking them would let an outage in
  // the observer endpoint block supervisor approvals entirely.
  const status = (supFailed && obsFailed) ? 'error'
    : (anyLoading && items.length === 0) ? 'loading'
      : 'ready';

  // A partial list must never read as a complete one: that is how someone
  // concludes nobody is waiting and closes the tab. So the rows show AND the
  // gap is stated, rather than one or the other.
  const partialError = (status === 'ready' && (supFailed || obsFailed))
    ? `${supFailed ? 'Pending supervisors' : 'Pending observers'} could not be loaded, so this list is incomplete.`
    : null;

  return {
    status,
    items,
    error: supervisors?.error || observers?.error || null,
    partialError,
    // A side still loading behind visible rows reads as a refresh, because that
    // is what it looks like from here — the spinner is how the header says
    // "there may be more coming" without taking the rows away.
    refreshing: Boolean(supervisors?.refreshing || observers?.refreshing
      || (anyLoading && status === 'ready')),
  };
}

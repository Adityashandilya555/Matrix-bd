import React from 'react';
import { Icon, SectionHeader, ErrorState, Skeleton } from '../ui/kit.jsx';
import PendingSupervisorsList from '../PendingSupervisorsList.jsx';
import ExecutiveRequestsList from '../ExecutiveRequestsList.jsx';
import OrgModuleCard from './OrgModuleCard.jsx';
import ObserverAccessSection from './ObserverAccessSection.jsx';

// Department codes + org in one place: who's awaiting approval, then each
// department's invite code with the supervisors and executives under them.

// One queue for everyone waiting to be let in.
//
// Pending observers shipped in a second queue further down the tab, inside the
// Observer access section. Two queues meant a request could sit unnoticed under
// a heading nobody scrolls to, and it split one question — "who is waiting?" —
// across two places. They merge here rather than in the shell so each queue
// keeps its own fetch, refresh and error state; only the rendering is joined.
//
// `kind` is what the shell dispatches approve/reject on: the two roles have
// different endpoints (a supervisor approval also writes a module membership;
// an observer approval must not). `module: 'observer'` makes the existing
// filter tabs and counts work with no special-casing.
function mergePending(supervisors, observers) {
  const sup = (supervisors?.items || []).map((u) => ({ ...u, kind: 'supervisor' }));
  const obs = (observers?.items || []).map((u) => ({ ...u, kind: 'observer', module: 'observer' }));
  const items = [...sup, ...obs].sort(
    (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  );

  const supFailed = supervisors?.status === 'error';
  const obsFailed = observers?.status === 'error';

  // Only a total failure is an error. If ONE side is down the other's rows are
  // still the best answer available, and blanking them would let an outage in
  // the observer endpoint block supervisor approvals — an unrelated queue
  // taking the whole section down with it.
  //
  // But a partial list must never read as a complete one: that is how someone
  // concludes nobody is waiting and closes the tab. So the rows show AND the
  // gap is stated, rather than one or the other.
  // Skeletons only when there is genuinely nothing to show. One side loading
  // while the other holds rows is not the initial load — it is a foreground
  // retry, and those are triggered from BOTH sections: Retry inside Observer
  // access at the foot of the tab calls loadObservers(false), which would
  // otherwise blank the Awaiting approval list at the head of it. A click in
  // one section must not empty another.
  const anyLoading = supervisors?.status === 'loading' || observers?.status === 'loading';
  const status = (supFailed && obsFailed) ? 'error'
    : (anyLoading && items.length === 0) ? 'loading'
      : 'ready';

  const partialError = (status === 'ready' && (supFailed || obsFailed))
    ? `${supFailed ? 'Pending supervisors' : 'Pending observers'} could not be loaded, so this list is incomplete.`
    : null;

  return {
    status,
    items,
    error: supervisors?.error || observers?.error || null,
    partialError,
    // A side still loading behind visible rows reads as a refresh, because
    // that is what it looks like from here — the spinner is how the header
    // says "there may be more coming" without taking the rows away.
    refreshing: Boolean(supervisors?.refreshing || observers?.refreshing
      || (anyLoading && status === 'ready')),
  };
}

// readOnly: the observer portal shows the org directory — which modules exist,
// which supervisors run them, which executives report to whom — and nothing
// that acts on it. The approval queues are dropped entirely rather than shown
// empty, since an empty 'Awaiting approval' implies this role could clear it.
export default function DepartmentsTab({ org, pendingSupervisors, executiveRequests, observers, handlers, readOnly = false }) {
  const pending = React.useMemo(
    () => mergePending(pendingSupervisors, observers?.pending),
    [pendingSupervisors, observers?.pending],
  );
  const execReqCount = executiveRequests.items?.length || 0;
  const modules = org.items || [];

  const reloadPending = (silent) => Promise.all([
    handlers.reloadPendingSupervisors(silent),
    handlers.reloadObservers?.(silent),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
      {!readOnly && (
      <section>
        <SectionHeader icon={Icon.users} title="Awaiting approval" count={pending.items.length} tone="warn"
          description="People who signed up with a department or observer code and need approval before they can get in."
          onRefresh={() => reloadPending(true)} refreshing={pending.refreshing} />
        <PendingSupervisorsList
          data={pending}
          onApprove={handlers.onApprovePending}
          onReject={handlers.onRejectPending}
          onRetry={() => reloadPending(false)} />
      </section>
      )}

      {!readOnly && (
      <section>
        <SectionHeader icon={Icon.doc} title="Executive Access Requests" count={execReqCount} tone="warn"
          description="Supervisors requesting dual-role access to also act as executives in their module."
          onRefresh={() => handlers.reloadExecutiveRequests(true)} refreshing={executiveRequests.refreshing} />
        <ExecutiveRequestsList
          data={executiveRequests}
          onApprove={handlers.onApproveExecutiveReq}
          onReject={handlers.onRejectExecutiveReq}
          onRetry={() => handlers.reloadExecutiveRequests(false)} />
      </section>
      )}

      <section>
        <SectionHeader icon={Icon.key} title="Departments"
          description={readOnly
            ? "Each department, the supervisors running it, and the executives reporting to them."
            : "Each department's invite code, and the supervisors with the executives reporting to them. Rotate a code to revoke the old one."}
          onRefresh={() => handlers.reloadOrg(true)} refreshing={org.refreshing} />

        {org.status === 'error' && <ErrorState message={org.error} onRetry={() => handlers.reloadOrg(false)} />}

        {org.status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1].map((i) => <Skeleton key={i} h={120} r={14} />)}
          </div>
        )}

        {org.status === 'ready' && (
          <div className="ac-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {modules.map((mod) => (
              <OrgModuleCard key={mod.module} mod={mod}
                // Omitted, not no-op'd: OrgModuleCard renders each affordance
                // only when its callback exists, so undefined is what hides them.
                onRotate={readOnly ? undefined : handlers.onRotate}
                onRemove={readOnly ? undefined : handlers.onRemoveUser} />
            ))}
          </div>
        )}
      </section>

      {/* Its own section, not a seventh card in the list above: an observer
          holds no module, and filing it under "Departments" would say it does.
          The CARD is the same shape as a department's — same header row, code
          chip and person rows — which is the consistency that was missing; the
          separate heading is the distinction that is real. */}
      {!readOnly && (
      <section>
        <SectionHeader icon={Icon.shield} title="Observer access"
          description="Read-only access to the whole workspace: every site and its history, and every module in view-only. Observers approve nothing and change nothing."
          onRefresh={() => handlers.reloadObservers(true)} refreshing={observers?.roster?.refreshing} />
        <ObserverAccessSection
          code={observers?.code ?? null}
          observers={observers?.roster}
          rotating={observers?.rotating}
          busyId={observers?.busyId}
          onRotate={handlers.onRotateObserverCode}
          onRevoke={handlers.onRevokeObserver}
          onRetry={() => handlers.reloadObservers(false)} />
      </section>
      )}
    </div>
  );
}

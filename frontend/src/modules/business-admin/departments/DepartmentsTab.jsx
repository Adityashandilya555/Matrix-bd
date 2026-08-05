import React from 'react';
import { Icon, SectionHeader, ErrorState, Skeleton } from '../ui/kit.jsx';
import PendingSupervisorsList from '../PendingSupervisorsList.jsx';
import ExecutiveRequestsList from '../ExecutiveRequestsList.jsx';
import OrgModuleCard from './OrgModuleCard.jsx';
import ObserverAccessSection from './ObserverAccessSection.jsx';

// Department codes + org in one place: who's awaiting approval, then each
// department's invite code with the supervisors and executives under them.

// readOnly: the observer portal shows the org directory — which modules exist,
// which supervisors run them, which executives report to whom — and nothing
// that acts on it. The approval queues are dropped entirely rather than shown
// empty, since an empty 'Awaiting approval' implies this role could clear it.
export default function DepartmentsTab({ org, pendingSupervisors, executiveRequests, observers, handlers, readOnly = false }) {
  const pendingCount = pendingSupervisors.items?.length || 0;
  const execReqCount = executiveRequests.items?.length || 0;
  const modules = org.items || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
      {!readOnly && (
      <section>
        <SectionHeader icon={Icon.users} title="Awaiting approval" count={pendingCount} tone="warn"
          description="People who signed up with a department code and need approval before they can access their module."
          onRefresh={() => handlers.reloadPendingSupervisors(true)} refreshing={pendingSupervisors.refreshing} />
        <PendingSupervisorsList
          data={pendingSupervisors}
          onApprove={handlers.onApproveSupervisor}
          onReject={handlers.onRejectSupervisor}
          onRetry={() => handlers.reloadPendingSupervisors(false)} />
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

      {/* Workspace-wide, so it sits after the departments rather than among them
          — an observer has no module, no supervisor and no executives. */}
      {!readOnly && (
      <section>
        <SectionHeader icon={Icon.shield} title="Observer access"
          count={observers?.pending?.items?.length || 0} tone="warn"
          description="Read-only access to the whole workspace: every site and its history, and every module in view-only. Observers approve nothing and change nothing."
          onRefresh={() => handlers.reloadObservers(true)} refreshing={observers?.pending?.refreshing} />
        <ObserverAccessSection
          code={observers?.code ?? null}
          pending={observers?.pending ?? { status: 'loading', items: [] }}
          observers={observers?.roster}
          rotating={observers?.rotating}
          busyId={observers?.busyId}
          onRotate={handlers.onRotateObserverCode}
          onApprove={handlers.onApproveObserver}
          onReject={handlers.onRejectObserver}
          onRevoke={handlers.onRevokeObserver}
          onRetry={() => handlers.reloadObservers(false)} />
      </section>
      )}
    </div>
  );
}

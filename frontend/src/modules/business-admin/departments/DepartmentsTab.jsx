import React from 'react';
import { Icon, SectionHeader, ErrorState, Skeleton } from '../ui/kit.jsx';
import PendingSupervisorsList from '../PendingSupervisorsList.jsx';
import OrgModuleCard from './OrgModuleCard.jsx';

// Department codes + org in one place: who's awaiting approval, then each
// department's invite code with the supervisors and executives under them.

export default function DepartmentsTab({ org, pendingSupervisors, handlers }) {
  const pendingCount = pendingSupervisors.items?.length || 0;
  const modules = org.items || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
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

      <section>
        <SectionHeader icon={Icon.key} title="Departments"
          description="Each department's invite code, and the supervisors with the executives reporting to them. Rotate a code to revoke the old one."
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
              <OrgModuleCard key={mod.module} mod={mod} onRotate={handlers.onRotate} onRemove={handlers.onRemoveUser} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

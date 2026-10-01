// skipcq: JS-0833
import React from 'react';
// skipcq: JS-0833
import { T, Icon, Card, Button, Skeleton, EmptyState, ErrorState } from './ui/kit.jsx';

// Cross-module workspace access (migration 20260930) — the admin's side.
//
// Two lists over one table: requests awaiting a decision, and the grants that
// are currently live. Approving writes no membership row; the grant itself is
// what deps.py checks on every request, so revoking takes effect immediately.
//
// The shell owns fetching and passes the two queue states plus the actions.
// skipcq: JS-0833
export default function ModuleAccessSection({
  requests, grants, onApprove, onReject, onRevoke, onRetryRequests, onRetryGrants,
}) {
  const [busyId, setBusyId] = React.useState(null);
  const [error, setError] = React.useState(null);

  async function act(fn, id) {
    setBusyId(id);
    setError(null);
    try { await fn(id); }
    catch (err) { setError(err?.detail || err?.message || 'Action failed'); }
    finally { setBusyId(null); }
  }

  function confirmRevoke(g) {
    // Revoking leaves any executives this supervisor recruited active — they
    // resurface under that module's unassigned list. Deactivating real people
    // as a side effect of an admin toggle would be worse than an orphaned link,
    // so the admin is told rather than protected from it.
    if (g.recruitedCount > 0) {
      const ok = window.confirm(
        `${g.recruitedCount} executive${g.recruitedCount === 1 ? '' : 's'} in ${g.module} report to `
        + `${g.supervisorName}. They stay active and will appear as unassigned in `
        + `Departments → ${g.module}. Withdraw access anyway?`,
      );
      if (!ok) return;
    }
    act(onRevoke, g.id);
  }

  const reqItems = requests.items || [];
  const grantItems = grants.items || [];

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: T.radiusSm, background: T.dangerSoft,
          color: T.dangerText, marginBottom: 14, fontSize: 12.5,
          border: '1px solid rgba(192,65,63,0.35)' }}>{error}</div>
      )}

      {requests.status === 'error'
        ? <ErrorState message={requests.error} onRetry={onRetryRequests} />
        : requests.status === 'loading'
          ? (
            <Card style={{ overflow: 'hidden' }}>
              {[0, 1].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px',
                  borderTop: i === 0 ? 'none' : `1px solid ${T.line}` }}>
                  <Skeleton w={200} h={13} /><span style={{ flex: 1 }} />
                  <Skeleton w={72} h={28} r={8} /><Skeleton w={84} h={28} r={8} />
                </div>
              ))}
            </Card>
          )
          : reqItems.length === 0
            ? (
              <EmptyState icon={Icon.external}
                title="No workspace access requests"
                hint="When a supervisor asks to work in another module, the request appears here." />
            )
            : (
              <Card raised className="ac-stagger" style={{ overflow: 'hidden' }}>
                {reqItems.map((r, i) => {
                  const isBusy = busyId === r.id;
                  return (
                    <div key={r.id} style={{ display: 'grid',
                      gridTemplateColumns: 'minmax(0,1.6fr) auto minmax(0,1fr) auto', gap: 14,
                      padding: '14px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                      alignItems: 'center', opacity: isBusy ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.supervisorName}</span>
                        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
                          {r.supervisorEmail}
                        </span>
                      </div>
                      <span style={{ fontSize: 11.5, color: T.textMuted, justifySelf: 'start' }}>
                        {r.homeModule ? `${r.homeModule} → ` : ''}<strong>{r.module}</strong>
                      </span>
                      <span style={{ fontSize: 11.5, color: T.textFaint, justifySelf: 'end' }}>
                        {r.createdAt
                          ? new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                          : ''}
                      </span>
                      <div style={{ display: 'flex', gap: 6, justifySelf: 'end' }}>
                        <Button variant="ghost" size="sm" loading={isBusy} disabled={isBusy}
                          onClick={() => act(onReject, r.id)}>Reject</Button>
                        <Button variant="solid" size="sm" loading={isBusy} disabled={isBusy}
                          onClick={() => act(onApprove, r.id)}>Approve</Button>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: T.textFaint, margin: '0 0 8px' }}>Active access</div>
        {grants.status === 'error'
          ? <ErrorState message={grants.error} onRetry={onRetryGrants} />
          : grantItems.length === 0
            ? (
              <div style={{ padding: '14px', textAlign: 'center', fontSize: 12.5, color: T.textFaint,
                border: `1px dashed ${T.line}`, borderRadius: T.radiusSm }}>
                Nobody is currently working outside their own module.
              </div>
            )
            : (
              <Card style={{ overflow: 'hidden' }}>
                {grantItems.map((g, i) => {
                  const isBusy = busyId === g.id;
                  return (
                    <div key={g.id} style={{ display: 'grid',
                      gridTemplateColumns: 'minmax(0,1.6fr) auto minmax(0,1fr) auto', gap: 14,
                      padding: '12px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                      alignItems: 'center', opacity: isBusy ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{g.supervisorName}</span>
                        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
                          {g.supervisorEmail}
                        </span>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: T.textMuted, padding: '3px 9px', borderRadius: 999,
                        background: T.chip, border: `1px solid ${T.line}`, justifySelf: 'start' }}>
                        {g.module}
                      </span>
                      <span style={{ fontSize: 11.5, color: T.textFaint, justifySelf: 'end' }}>
                        {g.recruitedCount > 0
                          ? `${g.recruitedCount} executive${g.recruitedCount === 1 ? '' : 's'}`
                          : ''}
                      </span>
                      <Button variant="ghost" size="sm" loading={isBusy} disabled={isBusy}
                        onClick={() => confirmRevoke(g)} style={{ justifySelf: 'end' }}>Withdraw</Button>
                    </div>
                  );
                })}
              </Card>
            )}
      </div>
    </div>
  );
}

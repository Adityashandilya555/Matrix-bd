// skipcq: JS-0833
import React from 'react';
// skipcq: JS-0833
import { T, Icon, Card, Button, Skeleton, EmptyState, ErrorState } from './ui/kit.jsx';

// Executive cross-module access (migration 20261022) — the admin's side.
//
// The executive sibling of ModuleAccessSection: requests awaiting a decision,
// then the grants that are live. Each row names the supervisor the executive
// asked to work under, since that is half of what is being approved. Approving
// puts the executive on that supervisor's team in the target module;
// withdrawing also ends their site delegations there.
//
// The shell owns fetching and passes the two queue states plus the actions.
// skipcq: JS-0833
export default function ExecModuleAccessSection({
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
    const ok = window.confirm(
      `Withdraw ${g.executiveName}'s access to ${g.module}? Any sites delegated to them in `
      + `${g.module} go back to their supervisor.`,
    );
    if (ok) act(onRevoke, g.id);
  }

  const reqItems = requests.items || [];
  const grantItems = grants.items || [];

  return (
    <div>
      {error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: T.radiusSm, background: T.dangerSoft,
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
                title="No executive access requests"
                hint="When an executive asks to work in another module, the request appears here." />
            )
            : (
              <Card raised className="ac-stagger" style={{ overflow: 'hidden' }}>
                {reqItems.map((r, i) => {
                  const isBusy = busyId === r.id;
                  return (
                    <div key={r.id} data-testid={`exec-access-request-${r.id}`} style={{ display: 'grid',
                      gridTemplateColumns: 'minmax(0,1.4fr) auto minmax(0,1.2fr) auto auto', gap: 14,
                      padding: '14px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                      alignItems: 'center', opacity: isBusy ? 0.6 : 1 }}>
                      <Person name={r.executiveName} email={r.executiveEmail} note={r.note} />
                      <span style={{ fontSize: 11.5, color: T.textMuted, justifySelf: 'start' }}>
                        {r.homeModule ? `${r.homeModule} → ` : ''}<strong>{r.module}</strong>
                      </span>
                      <span style={{ fontSize: 11.5, color: T.textMuted, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        under {r.supervisorName || 'a supervisor who has since left'}
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
          color: T.textFaint, margin: '0 0 8px' }}>Active executive access</div>
        {/* useQueue starts at status 'loading' with items [], so the empty
            line must wait for the first load — otherwise it claims nobody
            holds access while the list is still on its way. */}
        {grants.status === 'error'
          ? <ErrorState message={grants.error} onRetry={onRetryGrants} />
          : grants.status === 'loading'
            ? (
              <Card style={{ overflow: 'hidden' }}>
                <div data-testid="exec-access-grants-loading" style={{ display: 'flex', alignItems: 'center',
                  gap: 12, padding: '13px 18px' }}>
                  <Skeleton w={200} h={13} /><span style={{ flex: 1 }} /><Skeleton w={84} h={28} r={8} />
                </div>
              </Card>
            )
          : grantItems.length === 0
            ? (
              <div style={{ padding: '14px', textAlign: 'center', fontSize: 12.5, color: T.textFaint,
                border: `1px dashed ${T.line}`, borderRadius: T.radiusSm }}>
                No executive is currently working outside their own module.
              </div>
            )
            : (
              <Card style={{ overflow: 'hidden' }}>
                {grantItems.map((g, i) => {
                  const isBusy = busyId === g.id;
                  return (
                    <div key={g.id} data-testid={`exec-access-grant-${g.id}`} style={{ display: 'grid',
                      gridTemplateColumns: 'minmax(0,1.4fr) auto minmax(0,1.2fr) auto', gap: 14,
                      padding: '12px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                      alignItems: 'center', opacity: isBusy ? 0.6 : 1 }}>
                      <Person name={g.executiveName} email={g.executiveEmail} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: T.textMuted, padding: '3px 9px', borderRadius: 999,
                        background: T.chip, border: `1px solid ${T.line}`, justifySelf: 'start' }}>
                        {g.module}
                      </span>
                      <span style={{ fontSize: 11.5, color: T.textMuted, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        under {g.supervisorName || 'a supervisor who has since left'}
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

function Person({ name, email, note }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{email}</span>
      {note && (
        <span style={{ fontSize: 11.5, color: T.textMuted, marginTop: 3, fontStyle: 'italic' }}>
          “{note}”
        </span>
      )}
    </div>
  );
}

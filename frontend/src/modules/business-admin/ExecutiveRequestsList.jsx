// skipcq: JS-0833
import React from 'react';
// skipcq: JS-0833
import { T, Icon, Card, Button, Skeleton, EmptyState, ErrorState } from './ui/kit.jsx';

// Presentational component for executive requests.
// The shell owns fetching and passes:
//   data = { status, items, error }   — items: [{ id, supervisorId, supervisorEmail, supervisorName, module, status, createdAt }]
//   onApprove(reqId) -> Promise
//   onReject(reqId)  -> Promise
// skipcq: JS-0833
export default function ExecutiveRequestsList({ data, onApprove, onReject, onRetry }) {
  const [busyReqId, setBusyReqId] = React.useState(null);
  const [error, setError] = React.useState(null);

  const items = data.items || [];

  async function act(fn, reqId) {
    setBusyReqId(reqId);
    setError(null);
    try { await fn(reqId); }
    catch (err) { setError(err?.detail || err?.message || 'Action failed'); }
    finally { setBusyReqId(null); }
  }

  if (data.status === 'error') return <ErrorState message={data.error} onRetry={onRetry} />;
  const loading = data.status === 'loading';

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: T.radiusSm, background: T.dangerSoft,
          color: T.dangerText, marginBottom: 14, fontSize: 12.5, border: `1px solid rgba(192,65,63,0.35)` }}>{error}</div>
      )}

      {loading && (
        <Card style={{ overflow: 'hidden' }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px',
              borderTop: i === 0 ? 'none' : `1px solid ${T.line}` }}>
              <Skeleton w={200} h={13} /><span style={{ flex: 1 }} /><Skeleton w={72} h={28} r={8} /><Skeleton w={84} h={28} r={8} />
            </div>
          ))}
        </Card>
      )}

      {!loading && items.length === 0 && (
        <EmptyState icon={Icon.doc}
          title="No executive access requests"
          hint="When supervisors request dual-role executive access, they will appear here." />
      )}

      {!loading && items.length > 0 && (
        <Card raised className="ac-stagger" style={{ overflow: 'hidden' }}>
          {items.map((r, i) => {
            const isBusy = busyReqId === r.id;
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) auto minmax(0,1fr) auto',
                gap: 14, padding: '14px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                alignItems: 'center', opacity: isBusy ? 0.6 : 1 }}>
                
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.supervisorName}
                  </span>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{r.supervisorEmail}</span>
                </div>
                
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: T.textMuted, padding: '3px 9px', borderRadius: 999, background: T.chip,
                  border: `1px solid ${T.line}`, justifySelf: 'start' }}>{r.module}</span>
                
                <span style={{ fontSize: 11.5, color: T.textFaint, justifySelf: 'end' }}>
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                
                <div style={{ display: 'flex', gap: 6, justifySelf: 'end' }}>
                  <Button variant="ghost" tone="danger" size="sm"
                    loading={isBusy} disabled={isBusy}
                    onClick={() => act(onReject, r.id)}>Reject</Button>
                  <Button variant="solid" tone="accent" size="sm"
                    loading={isBusy} disabled={isBusy}
                    onClick={() => act(onApprove, r.id)}>Approve</Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// skipcq: JS-0833
// Observer access — the workspace-level read-only role.
//
// Shaped as a sibling of OrgModuleCard, not a layout of its own: same card, same
// header row, same CodeChip and Rotate, same Person rows underneath. An observer
// is not a department — it has no module, no supervisor tree and no executives —
// but on this tab it is still "a code, and the people who joined with it", and
// reading as a different kind of thing made it look like a different feature.
//
// Pending sign-ups are NOT here. They belong in the Awaiting approval section at
// the top of the tab, with the pending supervisors, because that is where an
// admin goes to approve someone. A second approval queue further down the page
// meant a request could sit unnoticed under a heading nobody scrolls to.
//
// The code grants signup only. Approval is still a human step, so a leaked code
// cannot by itself create an account.
import React from 'react';
import { T, Icon, Card, Button, Skeleton, ErrorState } from '../ui/kit.jsx';
import CodeChip from './CodeChip.jsx';
import Person from './Person.jsx';

export default function ObserverAccessSection({
  code, observers, rotating, busyId, onRotate, onRevoke, onRetry, loading,
}) {
  const roster = observers || { status: 'ready', items: [] };
  const items = roster.items || [];
  const [error, setError] = React.useState(null);

  const rotate = async () => {
    setError(null);
    try { await onRotate(); }
    catch (e) { setError(e?.detail || e?.message || 'Rotate failed'); }
  };

  // Revoking removes the account outright, so it reads as "remove this
  // observer" in the same two-step confirm every other person row uses.
  const revoke = onRevoke ? (p) => onRevoke(p) : undefined;

  return (
    <Card raised style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', background: T.chip, color: T.textMuted }}><Icon.shield size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text }}>Observer access</div>
          <div style={{ fontSize: 11.5, color: T.textFaint }}>
            {items.length} observer{items.length === 1 ? '' : 's'} · read-only, workspace-wide
          </div>
        </div>
        <CodeChip code={code} loading={loading} emptyLabel="No code yet" />
        {onRotate && (
          <Button variant="ghost" size="sm" loading={rotating} disabled={loading}
            icon={!rotating && <Icon.rotate size={14} />} onClick={rotate}>
            {rotating ? 'Rotating' : (code ? 'Rotate' : 'Generate')}
          </Button>
        )}
      </div>

      {error && <div style={{ marginTop: 12, fontSize: 12, color: T.dangerText }}>{error}</div>}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roster.status === 'error' && <ErrorState message={roster.error} onRetry={onRetry} />}
        {roster.status === 'loading' && <Skeleton h={44} r={10} />}

        {roster.status === 'ready' && items.length === 0 && (
          <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: 12.5, color: T.textFaint,
            border: `1px dashed ${T.line}`, borderRadius: T.radiusSm }}>
            No one has read-only access yet. Share the code above with someone who
            should see the whole workspace without changing it.
          </div>
        )}

        {roster.status === 'ready' && items.map((u) => (
          <div key={u.id} style={{ border: `1px solid ${T.line}`, borderRadius: T.radiusSm, padding: '4px 8px',
            opacity: busyId === u.id ? 0.6 : 1 }}>
            <Person
              p={u}
              role="observer"
              onRemove={revoke}
              removeLabel="observer"
              subtitle={`${u.email} · read-only across the whole workspace`}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

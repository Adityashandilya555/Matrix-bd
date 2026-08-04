// skipcq: JS-0833
// Observer access — the workspace-level read-only role.
//
// Sits in Departments because that is the only org-management surface the admin
// has, but it is deliberately NOT an OrgModuleCard: an observer belongs to the
// workspace rather than a department, so there is no module, no supervisor tree
// and no executives beneath it. One code, one pending queue.
//
// The code grants signup only. Approval is still a human step here, exactly as
// it is for supervisors, so a leaked code cannot by itself create an account.
import React from 'react';
import { T, TABULAR, Icon, Card, Button, Skeleton, EmptyState, ErrorState, Avatar } from '../ui/kit.jsx';

function CodeRow({ code, onRotate, rotating }) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <Card style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.textFaint }}>
          Workspace observer code
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          {code ? (
            <span style={{ fontFamily: T.mono, fontSize: 15, color: T.text, ...TABULAR }}>
              {revealed ? code : '•'.repeat(code.length)}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: T.textFaint }}>Not yet generated</span>
          )}
          {code && (
            <button
              type="button" onClick={() => setRevealed((v) => !v)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 11.5, fontWeight: 650, color: T.accent }}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
          Share this with someone who should see the whole workspace read-only.
          Rotating issues a new code and <strong>immediately stops the old one working</strong>.
        </div>
      </div>
      <Button variant="ghost" size="sm" loading={rotating}
        icon={!rotating && <Icon.rotate size={14} />} onClick={onRotate}>
        {code ? 'Rotate' : 'Generate'}
      </Button>
    </Card>
  );
}

function PendingRow({ user, onApprove, onReject, busyId }) {
  const busy = busyId === user.id;
  return (
    <Card style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Avatar name={user.email} size={30} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: T.text }}>{user.email}</div>
        {user.createdAt && (
          <div style={{ marginTop: 2, fontSize: 11.5, color: T.textFaint, ...TABULAR }}>
            Requested {new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onReject(user)}>Reject</Button>
        <Button variant="solid" size="sm" loading={busy}
          icon={!busy && <Icon.check size={14} />} onClick={() => onApprove(user)}>
          Approve
        </Button>
      </div>
    </Card>
  );
}

export default function ObserverAccessSection({
  code, pending, rotating, busyId, onRotate, onApprove, onReject, onRetry,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <CodeRow code={code} onRotate={onRotate} rotating={rotating} />

      {pending.status === 'error' && <ErrorState message={pending.error} onRetry={onRetry} />}

      {pending.status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1].map((i) => <Skeleton key={i} h={62} r={14} />)}
        </div>
      )}

      {pending.status === 'ready' && (pending.items?.length ? (
        <div className="ac-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pending.items.map((u) => (
            <PendingRow key={u.id} user={u} onApprove={onApprove} onReject={onReject} busyId={busyId} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Icon.users}
          title="No one waiting"
          hint="People who sign up with the observer code will appear here for approval."
        />
      ))}
    </div>
  );
}

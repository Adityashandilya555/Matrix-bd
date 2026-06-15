import React from 'react';
import { T, Icon, Card, Button, Avatar, Disclosure, Skeleton } from '../ui/kit.jsx';

// One department: its invite code (+ rotate) and the supervisors with the
// executives reporting to each. Executives with no/unknown supervisor are listed
// under "Unassigned".

export const MODULE_META = {
  bd:                  { label: 'BD',                  icon: Icon.flag },
  legal:               { label: 'Legal',               icon: Icon.scale },
  design:              { label: 'Design',               icon: Icon.layers },
  project:             { label: 'Project',             icon: Icon.wrench },
  nso:                 { label: 'NSO',                 icon: Icon.flag },
  project_excellence:  { label: 'Project Excellence',  icon: Icon.shield },
};

const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ''; } };

function Person({ p, role, onRemove }) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const roleLabel = role === 'supervisor' ? 'supervisor' : 'executive';

  // Two-step remove: trash → "Remove this {role}?" → confirm. On success the
  // parent reloads the org and this row unmounts, so we don't reset state.
  const doRemove = async (e) => {
    e?.stopPropagation?.();
    setBusy(true); setErr(null);
    try {
      await onRemove(p);
    } catch (ex) {
      setErr(ex?.detail || ex?.message || 'Could not remove this user.');
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <Avatar name={p.name} email={p.email} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.email}</div>
        <div style={{ fontSize: 11.5, color: T.textFaint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.email}{p.joinedAt ? ` · joined ${fmtDate(p.joinedAt)}` : ''}
          {err ? <span style={{ color: T.dangerText }}> · {err}</span> : ''}
        </div>
      </div>
      {role && !confirming && (
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted,
          padding: '2px 8px', borderRadius: 999, background: T.chip, border: `1px solid ${T.line}` }}>{role}</span>
      )}
      {onRemove && !confirming && (
        <button
          type="button" title={`Remove ${roleLabel}`} aria-label={`Remove ${roleLabel}`}
          onClick={(e) => { e.stopPropagation(); setErr(null); setConfirming(true); }}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
            borderRadius: 8, border: `1px solid ${T.line}`, background: 'transparent', color: T.textFaint, cursor: 'pointer', flex: '0 0 auto' }}
        >
          <Icon.trash size={14} />
        </button>
      )}
      {onRemove && confirming && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: T.textMuted, whiteSpace: 'nowrap' }}>Remove this {roleLabel}?</span>
          <Button variant="danger" size="sm" loading={busy} onClick={doRemove}>Remove</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => { e.stopPropagation(); setConfirming(false); setErr(null); }}>Cancel</Button>
        </span>
      )}
    </div>
  );
}

export default function OrgModuleCard({ mod, onRotate, onRemove, loading }) {
  const meta = MODULE_META[mod.module] || { label: mod.module, icon: Icon.key };
  const MetaIcon = meta.icon;
  const [rotating, setRotating] = React.useState(false);
  const [error, setError] = React.useState(null);

  const rotate = async () => {
    setRotating(true); setError(null);
    try { await onRotate(mod.module); }
    catch (e) { setError(e?.detail || e?.message || 'Rotate failed'); }
    finally { setRotating(false); }
  };

  const totalExecs = (mod.supervisors || []).reduce((n, s) => n + (s.executives?.length || 0), 0) + (mod.unassignedExecutives?.length || 0);

  return (
    <Card raised style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', background: T.chip, color: T.textMuted }}><MetaIcon size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text }}>{meta.label}</div>
          <div style={{ fontSize: 11.5, color: T.textFaint }}>
            {(mod.supervisors?.length || 0)} supervisor{mod.supervisors?.length === 1 ? '' : 's'} · {totalExecs} executive{totalExecs === 1 ? '' : 's'}
          </div>
        </div>
        <code style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', padding: '8px 12px',
          borderRadius: T.radiusSm, background: T.surfaceInset, border: `1px solid ${T.line}`,
          color: mod.code ? T.text : T.textFaint }}>{loading ? '…' : (mod.code || 'No code yet')}</code>
        <Button variant="ghost" size="sm" loading={rotating} disabled={loading}
          icon={!rotating && <Icon.rotate size={14} />} onClick={rotate}>{rotating ? 'Rotating' : 'Rotate'}</Button>
      </div>

      {error && <div style={{ marginTop: 12, fontSize: 12, color: T.dangerText }}>{error}</div>}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <Skeleton h={44} r={10} />}
        {!loading && (mod.supervisors || []).length === 0 && (mod.unassignedExecutives || []).length === 0 && (
          <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: 12.5, color: T.textFaint,
            border: `1px dashed ${T.line}`, borderRadius: T.radiusSm }}>
            No one has joined this department yet. Share the code above to onboard a supervisor.
          </div>
        )}
        {!loading && (mod.supervisors || []).map((s) => (
          <Disclosure key={s.id} count={s.executives?.length || 0}
            header={<Person p={s} role="supervisor" onRemove={onRemove} />}>
            {(s.executives || []).length === 0
              ? <div style={{ fontSize: 12, color: T.textFaint, padding: '6px 0' }}>No executives under this supervisor yet.</div>
              : (s.executives || []).map((e) => <Person key={e.id} p={e} role="executive" onRemove={onRemove} />)}
          </Disclosure>
        ))}
        {!loading && (mod.unassignedExecutives || []).length > 0 && (
          <div style={{ marginTop: 4, border: `1px solid ${T.line}`, borderRadius: T.radiusSm, padding: '8px 14px', background: T.surface }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, margin: '4px 0 2px' }}>
              Unassigned executives
            </div>
            {mod.unassignedExecutives.map((e) => <Person key={e.id} p={e} role="executive" onRemove={onRemove} />)}
          </div>
        )}
      </div>
    </Card>
  );
}

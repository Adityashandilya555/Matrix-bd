import React from 'react';
import { T, Icon, Card, Button, Disclosure, Skeleton } from '../ui/kit.jsx';
import CodeChip from './CodeChip.jsx';
import Person from './Person.jsx';

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

  // Distinct people, not rows. An executive may report to several supervisors in
  // one module and so appears under each of them — summing the lists would count
  // the same person once per supervisor.
  const totalExecs = new Set([
    ...(mod.supervisors || []).flatMap((s) => (s.executives || []).map((e) => e.id)),
    ...(mod.unassignedExecutives || []).map((e) => e.id),
  ]).size;
  // Ids that appear under more than one supervisor in this module.
  const sharedIds = new Set(
    (mod.supervisors || [])
      .flatMap((s) => (s.executives || []).map((e) => e.id))
      .filter((id, i, all) => all.indexOf(id) !== i),
  );
  // Supervisor-only modules (NSO) have no executive role — hide all executive UI.
  const execEnabled = mod.executivesEnabled !== false;

  return (
    <Card raised style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', background: T.chip, color: T.textMuted }}><MetaIcon size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text }}>{meta.label}</div>
          <div style={{ fontSize: 11.5, color: T.textFaint }}>
            {(mod.supervisors?.length || 0)} supervisor{mod.supervisors?.length === 1 ? '' : 's'}
            {execEnabled
              ? ` · ${totalExecs} executive${totalExecs === 1 ? '' : 's'}`
              : ' · supervisor-only'}
          </div>
        </div>
        {/* Masked until revealed — a department code onboards a supervisor who
            can write, and the realistic leak is a shared screen. Rendered only
            when there is one: the backend blanks it for anyone whose real role
            is not the business admin, so for an observer this would otherwise
            show a permanent, misleading "No code yet" beside every department. */}
        {(mod.code || onRotate) && (
          <CodeChip code={mod.code} loading={loading} />
        )}
        {/* Gated on the callback, matching how onRemove already behaves below.
            Without this the observer portal — which passes onRotate={undefined}
            to hide it — still renders a live-looking Rotate that throws on
            click. Absence of a handler is how this file says "not allowed". */}
        {onRotate && (
          <Button variant="ghost" size="sm" loading={rotating} disabled={loading}
            icon={!rotating && <Icon.rotate size={14} />} onClick={rotate}>{rotating ? 'Rotating' : 'Rotate'}</Button>
        )}
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
        {!loading && execEnabled && (mod.supervisors || []).map((s) => (
          // `sharedIds` marks the people who also report to someone else here, so
          // the same name appearing under two supervisors reads as one person
          // with two teams rather than as a duplicate rendering bug.
          <Disclosure key={s.id} count={s.executives?.length || 0}
            header={<Person p={s} role="supervisor" onRemove={onRemove} />}>
            {(s.executives || []).length === 0
              ? <div style={{ fontSize: 12, color: T.textFaint, padding: '6px 0' }}>No executives under this supervisor yet.</div>
              : (s.executives || []).map((e) => (
                // Removing from INSIDE a supervisor's group drops only that
                // link — the same person may still report to another supervisor
                // here. onRemove without the context deactivates the account,
                // which is right for a supervisor row or an unassigned exec but
                // wrong for one row of a shared executive.
                <Person key={e.id} p={e} role="executive"
                  // The prompt has to say which of the two things this does.
                  // Unassigned executives below still get the plain "executive"
                  // label, because there the click really does remove the
                  // account.
                  subtitle={sharedIds.has(e.id) ? `${e.email} · also on another team` : undefined}
                  removeLabel="executive from this team"
                  onRemove={onRemove && ((person) => onRemove(person, { module: mod.module, supervisorId: s.id }))} />
              ))}
          </Disclosure>
        ))}
        {!loading && !execEnabled && (mod.supervisors || []).map((s) => (
          <div key={s.id} style={{ border: `1px solid ${T.line}`, borderRadius: T.radiusSm, padding: '4px 8px' }}>
            <Person p={s} role="supervisor" onRemove={onRemove} />
          </div>
        ))}
        {!loading && execEnabled && (mod.unassignedExecutives || []).length > 0 && (
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

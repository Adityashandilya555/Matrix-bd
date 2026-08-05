// skipcq: JS-0833
// One person in the org: avatar, name/email, a role badge, and a two-step
// remove.
//
// Extracted from OrgModuleCard so the observer roster renders the exact same
// row. An observer is a person with workspace access like any other, and the
// section listing them had grown its own card shape with a red Revoke pill —
// louder than the trash affordance used for removing a supervisor, which is
// the more consequential action of the two.
import React from 'react';
import { T, Icon, Button, Avatar } from '../ui/kit.jsx';

const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ''; } };

export default function Person({ p, role, onRemove, removeLabel, subtitle }) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  // What the confirm prompt calls this person. Defaults from the badge so the
  // existing supervisor/executive rows read exactly as they did.
  const roleLabel = removeLabel || (role === 'supervisor' ? 'supervisor' : 'executive');

  // Two-step remove: trash → "Remove this {role}?" → confirm. On success the
  // parent reloads and this row unmounts, so we don't reset state.
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

  // Defaults to the email + join date. The observer roster passes its own,
  // because "read-only across the whole workspace" is the one fact about that
  // row a reader actually needs.
  const meta = subtitle !== undefined
    ? subtitle
    : `${p.email}${p.joinedAt ? ` · joined ${fmtDate(p.joinedAt)}` : ''}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <Avatar name={p.name} email={p.email} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.email}</div>
        <div style={{ fontSize: 11.5, color: T.textFaint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {meta}
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
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
            borderRadius: 9, border: `1px solid ${T.line}`, background: 'transparent', color: T.textFaint, cursor: 'pointer', flex: '0 0 auto' }}
        >
          <Icon.trash size={15} />
        </button>
      )}
      {onRemove && confirming && (
        // Not an interactive control — the onClick only stops the click from
        // bubbling up to the enclosing Disclosure header (the real buttons
        // inside handle their own keyboard activation). Purely a guard.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: T.textMuted, whiteSpace: 'nowrap' }}>Remove this {roleLabel}?</span>
          <Button variant="danger" size="sm" loading={busy} onClick={doRemove}>Remove</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={(e) => { e.stopPropagation(); setConfirming(false); setErr(null); }}>Cancel</Button>
        </span>
      )}
    </div>
  );
}

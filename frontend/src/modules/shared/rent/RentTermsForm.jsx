import React from 'react';
import Icon from '../primitives/Icon.jsx';

/**
 * RentTermsForm — the rent-type + conditional rent fields block, mirroring the
 * BD "New pipeline" popup (App.jsx · NewPipelineModal).
 *
 * Used in the post-NSO launch validation loop:
 *   • admin (editable, first + final touch)
 *   • supervisor (editable, on review)
 *   • executive (readOnly — review only)
 *
 * `value` keys are the backend launch_approvals staging field names, so the
 * object maps 1:1 onto the PATCH /launch-approvals/{id}/rent-fields payload:
 *   rent_type, expected_rent, rev_share_pct, escalation_pct,
 *   expected_escalation_years, rent_free_days, lock_in_months, tenure_months
 *
 * Theme-agnostic: pass `tokens` so it themes inside both the BD surface
 * (LaunchReviewModal) and the business-admin portal (LaunchApprovalTab). Both
 * maps now resolve to the shared --zm-* system; see the note on AC_TOKENS.
 */

import './rent-terms.css';

// Reveal the Dine-in / Delivery revenue-share split in the launch review only
// when the feature is on (FEATURE_RENT_V2). Flag OFF => the launch form is
// unchanged. Inlined per the USE_MOCK convention (see App.jsx).
const FEATURE_RENT_V2 = import.meta.env.VITE_FEATURE_RENT_V2 === 'true';

export const ZM_TOKENS = {
  bg: 'var(--zm-bg)', surface: 'var(--zm-surface)', surface2: 'var(--zm-surface-2)',
  line: 'var(--zm-line)', lineStrong: 'var(--zm-line-strong)',
  accent: 'var(--zm-accent)', accentSoft: 'var(--zm-accent-soft)',
  fg: 'var(--zm-fg)', fgMuted: 'var(--zm-fg-2)', fgFaint: 'var(--zm-fg-3)',
  danger: 'var(--zm-danger)',
  fontBody: 'var(--zm-font-body)', fontMono: 'var(--zm-font-mono)',
};

// The business-admin portal migrated to the shared zm- design system in 92faf4c,
// which deleted every --ac-* declaration from approval-center.css and repointed
// kit.jsx's `T`. This map was missed, so each var() below referenced a property
// that no longer existed — invalid at computed-value time, which resolves to
// `unset`. Borders became `border-style: none` and backgrounds went transparent
// while text still rendered (colour merely inherits), so the whole panel drew as
// bare labels floating on white.
//
// These now mirror kit.jsx's `T`. That makes AC_TOKENS all but identical to
// ZM_TOKENS — deliberately, and both are kept: the two surfaces are free to
// diverge again, and a single `tokens` prop is what lets this component live in
// shared/ without importing anything from business-admin/. fontMono stays a
// literal because the portal has no --zm-font-mono equivalent in this context.
export const AC_TOKENS = {
  bg: 'var(--zm-bg)', surface: 'var(--zm-surface)', surface2: 'var(--zm-surface-2)',
  line: 'var(--zm-line)', lineStrong: 'var(--zm-line-strong, var(--zm-line))',
  accent: 'var(--zm-accent)', accentSoft: 'var(--zm-accent-soft)',
  fg: 'var(--zm-fg)', fgMuted: 'var(--zm-fg-2)', fgFaint: 'var(--zm-fg-3)',
  danger: 'var(--zm-danger)',
  fontBody: 'var(--zm-font-body, system-ui)', fontMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const RENT_TYPES = [
  { id: 'revshare', label: 'Revenue share', sub: '% of monthly sales' },
  { id: 'fixed', label: 'Fixed + escalation', sub: 'monthly fixed + % per year' },
  { id: 'mg_revshare', label: 'MG + Revenue share', sub: 'minimum guarantee + escalation + % of sales' },
  { id: 'staggered', label: 'Staggered Rent with Escalation', sub: 'base rent + yearly stepped schedule' },
];
const CADENCE = [{ years: 1, label: 'Yearly' }, { years: 3, label: 'Every 3 yrs' }, { years: 5, label: 'Every 5 yrs' }];

function Label({ t, children }) {
  return <label style={{ fontFamily: t.fontBody, fontWeight: 600, fontSize: 12, color: t.fg }}>{children}</label>;
}

function NumField({ t, label, value, onChange, prefix, suffix, placeholder, readOnly }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label t={t}>{label}</Label>
      <div className="rt-field" style={{ display: 'flex', alignItems: 'stretch', height: 38, border: `1px solid ${t.line}`, borderRadius: 6, background: readOnly ? t.surface2 : t.bg, overflow: 'hidden' }}>
        {prefix && <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: t.fgFaint, fontFamily: t.fontMono, fontSize: 12, background: t.surface2, borderRight: `1px solid ${t.line}` }}>{prefix}</span>}
        <input
          type="number" min="0" step="any" inputMode="decimal"
          value={value ?? ''} placeholder={placeholder} readOnly={readOnly} disabled={readOnly}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: t.fontMono, fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: readOnly ? t.fgMuted : t.fg, width: '100%' }}
        />
        {suffix && <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: t.fgFaint, fontFamily: t.fontMono, fontSize: 12, background: t.surface2, borderLeft: `1px solid ${t.line}` }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default function RentTermsForm({ value = {}, onChange, readOnly = false, tokens = ZM_TOKENS }) {
  const t = tokens;
  const v = value || {};
  const set = (k) => (val) => onChange?.(k, val);
  const rentType = v.rent_type || '';

  // Arrow-key navigation for the radiogroup. Without this, role="radio" would
  // be a downgrade rather than a fix: it promises arrow keys and a single tab
  // stop, and shipping the role without the behaviour strands keyboard users
  // worse off than plain buttons did.
  const onOptionKeyDown = (e) => {
    if (readOnly) return;
    const KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    const current = RENT_TYPES.findIndex((rt) => rt.id === rentType);
    const from = current === -1 ? 0 : current;
    const next = (from + step + RENT_TYPES.length) % RENT_TYPES.length;
    onChange?.('rent_type', RENT_TYPES[next].id);
    // Move focus to match selection, as the radiogroup pattern requires.
    e.currentTarget.querySelector(`[data-rt-index="${next}"]`)?.focus();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Rent type */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label t={t}>Rent type</Label>
        {/* auto-fit at 260px lands a clean 2x2 in both consumers (the portal
            drawer is ~676px, the BD modal ~768px) and collapses to one column
            on mobile. The old repeat(3, 1fr) orphaned the 4th option on its
            own row. */}
        <div
          role="radiogroup"
          aria-label="Rent type"
          // -1, not 0: the roving tabindex on the options makes THEM the tab
          // stops, so the group must never be one itself. This only satisfies
          // jsx-a11y/interactive-supports-focus, which can't see that pattern.
          tabIndex={-1}
          onKeyDown={onOptionKeyDown}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}
        >
          {RENT_TYPES.map((rt, i) => {
            const selected = rentType === rt.id;
            return (
              <button
                type="button" key={rt.id} disabled={readOnly}
                className="rt-option"
                role="radio"
                aria-checked={selected}
                // Roving tabindex: the group is ONE tab stop and arrows move
                // within it, which is what a screen-reader user is promised the
                // moment they hear "radio button". Falls back to the first
                // option when nothing is selected yet.
                tabIndex={selected || (!rentType && i === 0) ? 0 : -1}
                data-rt-index={i}
                onClick={() => !readOnly && onChange?.('rent_type', rt.id)}
                style={{
                  textAlign: 'left', padding: 12, borderRadius: 8,
                  border: `1px solid ${selected ? t.accent : t.line}`,
                  background: selected ? t.accentSoft : t.surface,
                  cursor: readOnly ? 'default' : 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
                  fontFamily: 'inherit', opacity: readOnly && !selected ? 0.6 : 1,
                }}
              >
                <span style={{ width: 16, height: 16, borderRadius: 999, marginTop: 1, border: `1.5px solid ${selected ? t.accent : t.lineStrong}`, background: selected ? t.accent : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 16px' }}>
                  {selected && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontFamily: t.fontBody, fontWeight: 600, fontSize: 12.5, color: t.fg }}>{rt.label}</span>
                  <span style={{ fontFamily: t.fontBody, fontSize: 11, color: t.fgFaint }}>{rt.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conditional rent fields */}
      {rentType === 'fixed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <NumField t={t} label="Expected rent" value={v.expected_rent} onChange={set('expected_rent')} prefix="₹" suffix="/mo" placeholder="120000" readOnly={readOnly} />
            <NumField t={t} label="Escalation" value={v.escalation_pct} onChange={set('escalation_pct')} suffix="%" placeholder="e.g. 4.5" readOnly={readOnly} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label t={t}>Escalation cadence</Label>
            <div style={{ display: 'flex', gap: 6 }}>
              {CADENCE.map((opt) => {
                const selected = String(v.expected_escalation_years) === String(opt.years);
                return (
                  <button
                    type="button" key={opt.years} disabled={readOnly}
                    onClick={() => !readOnly && onChange?.('expected_escalation_years', opt.years)}
                    style={{ flex: 1, height: 38, borderRadius: 6, border: `1px solid ${selected ? t.accent : t.line}`, background: selected ? t.accentSoft : t.bg, color: selected ? t.accent : t.fg, fontFamily: t.fontBody, fontWeight: 600, fontSize: 13, cursor: readOnly ? 'default' : 'pointer', opacity: readOnly && !selected ? 0.6 : 1 }}
                  >{opt.label}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {rentType === 'revshare' && (
        <NumField t={t} label="Revenue share" value={v.rev_share_pct} onChange={set('rev_share_pct')} suffix="% of sales" placeholder="e.g. 12.5" readOnly={readOnly} />
      )}
      {rentType === 'mg_revshare' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <NumField t={t} label="Minimum guarantee" value={v.expected_rent} onChange={set('expected_rent')} prefix="₹" suffix="/mo" placeholder="80000" readOnly={readOnly} />
            <NumField t={t} label="Revenue share" value={v.rev_share_pct} onChange={set('rev_share_pct')} suffix="% above MG" placeholder="e.g. 12.5" readOnly={readOnly} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <NumField t={t} label="Escalation" value={v.escalation_pct} onChange={set('escalation_pct')} suffix="%" placeholder="e.g. 4.5" readOnly={readOnly} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label t={t}>Escalation cadence</Label>
              <div style={{ display: 'flex', gap: 6 }}>
                {CADENCE.map((opt) => {
                  const selected = String(v.expected_escalation_years) === String(opt.years);
                  return (
                    <button
                      type="button" key={opt.years} disabled={readOnly}
                      onClick={() => !readOnly && onChange?.('expected_escalation_years', opt.years)}
                      style={{ flex: 1, height: 38, borderRadius: 6, border: `1px solid ${selected ? t.accent : t.line}`, background: selected ? t.accentSoft : t.bg, color: selected ? t.accent : t.fg, fontFamily: t.fontBody, fontWeight: 600, fontSize: 13, cursor: readOnly ? 'default' : 'pointer', opacity: readOnly && !selected ? 0.6 : 1 }}
                    >{opt.label}</button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {rentType === 'staggered' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <NumField t={t} label="Base rent" value={v.expected_rent} onChange={set('expected_rent')} prefix="₹" suffix="/mo" placeholder="Base monthly rent" readOnly={readOnly} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label t={t}>Escalation schedule</Label>
              {!readOnly && (!v.staggered_escalation || v.staggered_escalation.length < 5) && (
                <button type="button" onClick={() => {
                  const arr = v.staggered_escalation || [];
                  onChange?.('staggered_escalation', [...arr, { year: arr.length + 1, percent: null }]);
                }} style={{ background: 'transparent', border: 'none', color: t.accent, fontFamily: t.fontBody, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="plus" size={14}/> Add year</button>
              )}
            </div>
            {(v.staggered_escalation || []).map((esc, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: '0 0 100px', display: 'flex', alignItems: 'center', height: 38, padding: '0 10px', background: t.surface2, border: `1px solid ${t.line}`, borderRadius: 6, fontFamily: t.fontBody, fontSize: 13, color: t.fgMuted }}>Year {idx + 1}</div>
                <div className="rt-field" style={{ flex: 1, display: 'flex', alignItems: 'stretch', height: 38, border: `1px solid ${t.line}`, borderRadius: 6, background: readOnly ? t.surface2 : t.bg, overflow: 'hidden' }}>
                  <input type="number" min="0" step="any" value={esc.percent ?? ''} readOnly={readOnly} disabled={readOnly} onChange={(e) => {
                    const next = [...v.staggered_escalation];
                    next[idx].percent = e.target.value === '' ? null : Number(e.target.value);
                    onChange?.('staggered_escalation', next);
                  }} placeholder="Escalation %" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: t.fontMono, fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: readOnly ? t.fgMuted : t.fg }}/>
                  <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: t.fgFaint, fontFamily: t.fontMono, fontSize: 12, background: t.surface2, borderLeft: `1px solid ${t.line}` }}>%</span>
                </div>
                {!readOnly && idx > 0 && idx === (v.staggered_escalation || []).length - 1 && (
                  <button type="button" onClick={() => onChange?.('staggered_escalation', v.staggered_escalation.slice(0, -1))} title="Remove" style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: t.surface, border: `1px solid ${t.line}`, color: t.danger, cursor: 'pointer', flexShrink: 0 }}><Icon name="x" size={16}/></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!rentType && (
        <div style={{ padding: 14, background: t.surface2, borderRadius: 8, fontFamily: t.fontBody, fontSize: 12, color: t.fgFaint, textAlign: 'center' }}>
          {readOnly ? 'No rent type set.' : 'Pick a rent type above to reveal the rent fields.'}
        </div>
      )}

      {/* Revenue-share split (FEATURE_RENT_V2) — carried through the launch loop */}
      {FEATURE_RENT_V2 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <NumField t={t} label="Dine-in share" value={v.revshare_dinein_pct} onChange={set('revshare_dinein_pct')} suffix="% of sales" placeholder="optional" readOnly={readOnly} />
          <NumField t={t} label="Delivery share" value={v.revshare_delivery_pct} onChange={set('revshare_delivery_pct')} suffix="% of sales" placeholder="optional" readOnly={readOnly} />
          <div/>
        </div>
      )}
      {/* Always-on rent-linked terms */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <NumField t={t} label="Rent-free days" value={v.rent_free_days} onChange={set('rent_free_days')} suffix="days" placeholder="optional" readOnly={readOnly} />
        <NumField t={t} label="Lock-in" value={v.lock_in_months} onChange={set('lock_in_months')} suffix="months" placeholder="optional" readOnly={readOnly} />
        <NumField t={t} label="Tenure" value={v.tenure_months} onChange={set('tenure_months')} suffix="months" placeholder="optional" readOnly={readOnly} />
      </div>
    </div>
  );
}

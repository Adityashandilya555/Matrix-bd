import React from 'react';

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
 * Theme-agnostic: pass `tokens` so it themes inside both the BD (zm) surface and
 * the business-admin portal (ac) surface.
 */

export const ZM_TOKENS = {
  bg: 'var(--zm-bg)', surface: 'var(--zm-surface)', surface2: 'var(--zm-surface-2)',
  line: 'var(--zm-line)', lineStrong: 'var(--zm-line-strong)',
  accent: 'var(--zm-accent)', accentSoft: 'var(--zm-accent-soft)',
  fg: 'var(--zm-fg)', fgMuted: 'var(--zm-fg-2)', fgFaint: 'var(--zm-fg-3)',
  danger: 'var(--zm-danger)',
  fontBody: 'var(--zm-font-body)', fontMono: 'var(--zm-font-mono)',
};

export const AC_TOKENS = {
  bg: 'var(--ac-bg)', surface: 'var(--ac-surface)', surface2: 'var(--ac-surface-inset)',
  line: 'var(--ac-line)', lineStrong: 'var(--ac-line-strong)',
  accent: 'var(--ac-accent)', accentSoft: 'var(--ac-accent-soft)',
  fg: 'var(--ac-text)', fgMuted: 'var(--ac-text-muted)', fgFaint: 'var(--ac-text-faint)',
  danger: 'var(--ac-danger)',
  fontBody: 'var(--ac-font, system-ui)', fontMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const RENT_TYPES = [
  { id: 'revshare', label: 'Revenue share', sub: '% of monthly sales' },
  { id: 'fixed', label: 'Fixed + escalation', sub: 'monthly fixed + % per year' },
  { id: 'mg_revshare', label: 'MG + Revenue share', sub: 'minimum guarantee + % of sales' },
];
const CADENCE = [{ years: 1, label: 'Yearly' }, { years: 3, label: 'Every 3 yrs' }, { years: 5, label: 'Every 5 yrs' }];

function Label({ t, children }) {
  return <label style={{ fontFamily: t.fontBody, fontWeight: 600, fontSize: 12, color: t.fg }}>{children}</label>;
}

function NumField({ t, label, value, onChange, prefix, suffix, placeholder, readOnly }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label t={t}>{label}</Label>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: `1px solid ${t.line}`, borderRadius: 6, background: readOnly ? t.surface2 : t.bg, overflow: 'hidden' }}>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Rent type */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label t={t}>Rent type</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {RENT_TYPES.map((rt) => {
            const selected = rentType === rt.id;
            return (
              <button
                type="button" key={rt.id} disabled={readOnly}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <NumField t={t} label="Minimum guarantee" value={v.expected_rent} onChange={set('expected_rent')} prefix="₹" suffix="/mo" placeholder="80000" readOnly={readOnly} />
          <NumField t={t} label="Revenue share" value={v.rev_share_pct} onChange={set('rev_share_pct')} suffix="% above MG" placeholder="e.g. 12.5" readOnly={readOnly} />
        </div>
      )}
      {!rentType && (
        <div style={{ padding: 14, background: t.surface2, borderRadius: 8, fontFamily: t.fontBody, fontSize: 12, color: t.fgFaint, textAlign: 'center' }}>
          {readOnly ? 'No rent type set.' : 'Pick a rent type above to reveal the rent fields.'}
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

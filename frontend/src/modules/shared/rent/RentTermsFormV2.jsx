// skipcq: JS-0833
import React from 'react';
import Icon from '../primitives/Icon.jsx';
import { ZM_TOKENS } from './RentTermsForm.jsx';
import './rent-terms.css';

/**
 * RentTermsFormV2 — the configurable rent-type block (FEATURE_RENT_V2).
 *
 * Reframes rent entry around ONE question — "Is the rent staggered?" — plus an
 * optional REV SHARE split into Dine-in % / Delivery %. It is a presentation
 * layer over the existing model, NOT a new domain concept:
 *   • No  → rent_type = 'fixed'      (base rent + one escalation % at a cadence)
 *   • Yes → rent_type = 'staggered'  (base rent + per-year escalation schedule)
 *   • REV SHARE rides on either path and is the only genuinely new storage.
 *
 * Canonical, snake_case `value` contract (a subset of CreateDraftRequest), so a
 * consumer maps its own state 1:1 and the payload threads straight through:
 *   rent_type, expected_rent, expected_escalation_pct, expected_escalation_years,
 *   revshare_dinein_pct, revshare_delivery_pct,
 *   staggered_escalation: [{ year, percent, dine_in_pct?, delivery_pct? }]
 * onChange(key, value) mirrors RentTermsForm.jsx's contract.
 *
 * `showCadence=false` hides the flat escalation cadence (Add Details never
 * captured escalation years — keep that surface's data model unchanged).
 */

const CADENCE = [{ years: 1, label: 'Yearly' }, { years: 3, label: 'Every 3 yrs' }, { years: 5, label: 'Every 5 yrs' }];
const MAX_YEARS = 5;

// A per-schedule-row value read as a string so the controlled inputs never jump
// the caret; consumers coerce with Number() at submit. Empty string => cleared.
const asStr = (v) => (v === null || v === undefined ? '' : String(v));

function Label({ t, children }) {
  return <label style={{ fontFamily: t.fontBody, fontWeight: 600, fontSize: 12, color: t.fg }}>{children}</label>;
}

function NumBox({ t, value, onChange, prefix, suffix, placeholder, readOnly, flex = 1 }) {
  return (
    <div className="rt-field" style={{ flex, display: 'flex', alignItems: 'stretch', height: 38, border: `1px solid ${t.line}`, borderRadius: 6, background: readOnly ? t.surface2 : t.bg, overflow: 'hidden', minWidth: 0 }}>
      {prefix && <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: t.fgFaint, fontFamily: t.fontMono, fontSize: 12, background: t.surface2, borderRight: `1px solid ${t.line}` }}>{prefix}</span>}
      <input
        type="number" min="0" step="any" inputMode="decimal"
        value={asStr(value)} placeholder={placeholder} readOnly={readOnly} disabled={readOnly}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: t.fontMono, fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: readOnly ? t.fgMuted : t.fg, width: '100%', minWidth: 0 }}
      />
      {suffix && <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: t.fgFaint, fontFamily: t.fontMono, fontSize: 12, background: t.surface2, borderLeft: `1px solid ${t.line}`, whiteSpace: 'nowrap' }}>{suffix}</span>}
    </div>
  );
}

function Field({ t, label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <Label t={t}>{label}</Label>
      {children}
    </div>
  );
}

export default function RentTermsFormV2({ value = {}, onChange, readOnly = false, tokens = ZM_TOKENS, showCadence = true }) {
  const t = tokens;
  const v = value || {};
  const set = (k) => (val) => onChange?.(k, val);
  const rentType = v.rent_type || '';
  const schedule = Array.isArray(v.staggered_escalation) ? v.staggered_escalation : [];

  // REV SHARE is on when any split value is already present, or the user turned
  // it on this session. Deriving-then-latching avoids a flash-off on re-hydrate.
  const splitPresent =
    v.revshare_dinein_pct != null || v.revshare_delivery_pct != null ||
    schedule.some((e) => e && (e.dine_in_pct != null || e.delivery_pct != null));
  const [revShareOn, setRevShareOn] = React.useState(splitPresent);
  React.useEffect(() => { if (splitPresent) setRevShareOn(true); }, [splitPresent]);

  const chooseStaggered = () => {
    if (readOnly) return;
    onChange?.('rent_type', 'staggered');
    if (schedule.length === 0) onChange?.('staggered_escalation', [{ year: 1, percent: '' }]);
  };
  const chooseFlat = () => {
    if (readOnly) return;
    onChange?.('rent_type', 'fixed');
    // Leave any staggered schedule in state untouched; the create/details
    // mappers only emit staggered_escalation when rent_type === 'staggered'.
  };

  const patchRow = (idx, key, val) => {
    const next = schedule.map((row, i) => (i === idx ? { ...row, [key]: val } : row));
    onChange?.('staggered_escalation', next);
  };
  const addYear = () => {
    if (schedule.length >= MAX_YEARS) return;
    onChange?.('staggered_escalation', [...schedule, { year: schedule.length + 1, percent: '' }]);
  };
  const removeLastYear = () => onChange?.('staggered_escalation', schedule.slice(0, -1));

  const toggleRevShare = () => {
    if (readOnly) return;
    const nextOn = !revShareOn;
    setRevShareOn(nextOn);
    if (!nextOn) {
      // Turning the split OFF must also clear its values, or a hidden field
      // would still be submitted. Flat scalars + per-year keys both cleared.
      onChange?.('revshare_dinein_pct', null);
      onChange?.('revshare_delivery_pct', null);
      if (schedule.length) {
        onChange?.('staggered_escalation', schedule.map(({ dine_in_pct: _din, delivery_pct: _del, ...rest }) => rest));
      }
    }
  };

  const seg = (active, label, onClick) => (
    <button
      type="button" disabled={readOnly} onClick={onClick} aria-pressed={active}
      style={{
        flex: 1, height: 38, borderRadius: 6, fontFamily: t.fontBody, fontWeight: 600, fontSize: 13,
        border: `1px solid ${active ? t.accent : t.line}`, background: active ? t.accentSoft : t.bg,
        color: active ? t.accent : t.fg, cursor: readOnly ? 'default' : 'pointer', opacity: readOnly && !active ? 0.6 : 1,
      }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Is the rent staggered? */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label t={t}>Is the rent staggered?</Label>
        <span style={{ fontFamily: t.fontBody, fontSize: 11, color: t.fgFaint, marginTop: -2 }}>
          Staggered rent steps up each year of the term. Choose No for a single fixed rent with one escalation.
        </span>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {seg(rentType === 'staggered', 'Yes — staggered', chooseStaggered)}
          {seg(rentType === 'fixed', 'No — flat rent', chooseFlat)}
        </div>
      </div>

      {rentType && (
        <label className="rt-switch" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: readOnly ? 'default' : 'pointer', fontFamily: t.fontBody, fontWeight: 600, fontSize: 12.5, color: t.fg, userSelect: 'none' }}>
          <input
            type="checkbox" checked={revShareOn} disabled={readOnly} onChange={toggleRevShare}
            style={{ width: 34, height: 20, appearance: 'none', WebkitAppearance: 'none', cursor: readOnly ? 'default' : 'pointer', borderRadius: 999, position: 'relative', background: revShareOn ? t.accent : t.lineStrong, transition: 'background .15s', flex: '0 0 34px' }}
          />
          REV SHARE — add Dine-in % / Delivery % split
        </label>
      )}

      {/* No → flat rent */}
      {rentType === 'fixed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field t={t} label="Rent (monthly)"><NumBox t={t} value={v.expected_rent} onChange={set('expected_rent')} prefix="₹" suffix="/mo" placeholder="120000" readOnly={readOnly} /></Field>
            <Field t={t} label="Escalation"><NumBox t={t} value={v.expected_escalation_pct} onChange={set('expected_escalation_pct')} suffix="%" placeholder="e.g. 4.5" readOnly={readOnly} /></Field>
          </div>
          {showCadence && (
            <Field t={t} label="Escalation cadence">
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
            </Field>
          )}
          {revShareOn && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field t={t} label="Dine-in share"><NumBox t={t} value={v.revshare_dinein_pct} onChange={set('revshare_dinein_pct')} suffix="% of sales" placeholder="e.g. 8" readOnly={readOnly} /></Field>
              <Field t={t} label="Delivery share"><NumBox t={t} value={v.revshare_delivery_pct} onChange={set('revshare_delivery_pct')} suffix="% of sales" placeholder="e.g. 5" readOnly={readOnly} /></Field>
            </div>
          )}
        </div>
      )}

      {/* Yes → staggered */}
      {rentType === 'staggered' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field t={t} label="Base rent"><NumBox t={t} value={v.expected_rent} onChange={set('expected_rent')} prefix="₹" suffix="/mo" placeholder="Base monthly rent" readOnly={readOnly} /></Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label t={t}>Escalation schedule{revShareOn ? ' · per-year rev share' : ''}</Label>
              {!readOnly && schedule.length < MAX_YEARS && (
                <button type="button" onClick={addYear} style={{ background: 'transparent', border: 'none', color: t.accent, fontFamily: t.fontBody, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="plus" size={14} /> Add year</button>
              )}
            </div>
            {schedule.map((esc, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: '0 0 76px', display: 'flex', alignItems: 'center', height: 38, padding: '0 10px', background: t.surface2, border: `1px solid ${t.line}`, borderRadius: 6, fontFamily: t.fontBody, fontSize: 13, color: t.fgMuted, whiteSpace: 'nowrap' }}>Year {idx + 1}</div>
                <NumBox t={t} value={esc?.percent} onChange={(val) => patchRow(idx, 'percent', val)} suffix="Esc %" placeholder="0" readOnly={readOnly} />
                {revShareOn && <NumBox t={t} value={esc?.dine_in_pct} onChange={(val) => patchRow(idx, 'dine_in_pct', val)} suffix="Dine %" placeholder="0" readOnly={readOnly} />}
                {revShareOn && <NumBox t={t} value={esc?.delivery_pct} onChange={(val) => patchRow(idx, 'delivery_pct', val)} suffix="Del %" placeholder="0" readOnly={readOnly} />}
                {!readOnly && idx > 0 && idx === schedule.length - 1 && (
                  <button type="button" onClick={removeLastYear} title="Remove" style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: t.surface, border: `1px solid ${t.line}`, color: t.danger, cursor: 'pointer', flexShrink: 0 }}><Icon name="x" size={16} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!rentType && (
        <div style={{ padding: 14, background: t.surface2, borderRadius: 8, fontFamily: t.fontBody, fontSize: 12, color: t.fgFaint, textAlign: 'center' }}>
          {readOnly ? 'No rent type set.' : 'Choose Yes or No above to configure the rent schedule.'}
        </div>
      )}
    </div>
  );
}

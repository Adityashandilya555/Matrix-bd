// skipcq: JS-0833
import React from 'react';
import Icon from '../primitives/Icon.jsx';
import { ZM_TOKENS } from './RentTermsForm.jsx';

/**
 * RentScheduleButton — a compact "View schedule" trigger + the read-only dialog it
 * opens. One reusable place to render a staggered rent's per-year escalation as a
 * proper table (Year / Escalation % / Dine-in % / Delivery %) instead of cramming
 * "Yr1 5% · Yr2 4% (D 8/Del 4) · …" onto one line.
 *
 * Drop it in anywhere a staggered schedule is shown read-only (Site Fundamentals,
 * launch review summaries, …). The Dine-in / Delivery columns appear only when the
 * schedule actually carries a FEATURE_RENT_V2 rev-share split, so a plain
 * staggered rent stays a clean two-column table. Renders nothing when there is no
 * usable schedule, so callers can drop it in unconditionally.
 */

const hasVal = (x) => x != null && x !== '';
const fmtPct = (x) => (hasVal(x) ? `${Number(x)}%` : '—');
const fmtInr = (x) => (hasVal(x) ? `₹${Number(x).toLocaleString('en-IN')}` : '—');

function ScheduleDialog({ rows, baseRent, tokens, onClose }) {
  const t = tokens;
  const hasSplit = rows.some((e) => hasVal(e.dine_in_pct) || hasVal(e.delivery_pct));

  // Escape closes, matching the app's other overlays.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const th = { fontFamily: t.fontBody, fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.fgFaint, padding: '0 0 10px', textAlign: 'right', whiteSpace: 'nowrap' };
  const td = { fontFamily: t.fontMono, fontFeatureSettings: "'tnum' 1", fontSize: 13, color: t.fg, padding: '10px 0', textAlign: 'right', borderTop: `1px solid ${t.line}` };

  return (
    // Backdrop click closes; keyboard users close with Escape (handled above) or
    // the header's Close button. Same scrim pattern as ImageLightbox / SiteDrawer.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      role="dialog" aria-modal="true" aria-label="Rent escalation schedule"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.5)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'zm-fade 160ms var(--zm-ease, ease)' }}
    >
      {/* Stop propagation so clicks inside the card don't close the dialog. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: t.bg, border: `1px solid ${t.line}`, borderRadius: 12, width: hasSplit ? 480 : 380, maxWidth: '100%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 20px', borderBottom: `1px solid ${t.line}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: t.fontBody, fontWeight: 700, fontSize: 15, color: t.fg }}>Rent escalation schedule</div>
            {hasVal(baseRent) && (
              <div style={{ fontFamily: t.fontBody, fontSize: 12.5, color: t.fgMuted, marginTop: 2 }}>
                Base rent {fmtInr(baseRent)}/mo · steps up each year of the term
              </div>
            )}
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${t.line}`, background: t.surface, color: t.fgMuted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 30px' }}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div style={{ padding: '10px 20px 18px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Year</th>
                <th style={th}>Escalation</th>
                {hasSplit && <th style={th}>Dine-in</th>}
                {hasSplit && <th style={th}>Delivery</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.year ?? i}>
                  <td style={{ ...td, textAlign: 'left', color: t.fgMuted, fontFamily: t.fontBody, fontSize: 13 }}>Year {e.year ?? i + 1}</td>
                  <td style={td}>{fmtPct(e.percent)}</td>
                  {hasSplit && <td style={td}>{fmtPct(e.dine_in_pct)}</td>}
                  {hasSplit && <td style={td}>{fmtPct(e.delivery_pct)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function RentScheduleButton({ schedule, baseRent, tokens = ZM_TOKENS, label = 'View schedule' }) {
  const rows = Array.isArray(schedule) ? schedule.filter((e) => e && hasVal(e.percent)) : [];
  const [open, setOpen] = React.useState(false);
  if (!rows.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={(ev) => { ev.stopPropagation?.(); setOpen(true); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', borderRadius: 6, border: `1px solid ${tokens.line}`, background: tokens.surface, color: tokens.accent, fontFamily: tokens.fontBody, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', verticalAlign: 'middle', whiteSpace: 'nowrap' }}
      >
        <Icon name="list" size={12} /> {label}
      </button>
      {open && <ScheduleDialog rows={rows} baseRent={baseRent} tokens={tokens} onClose={() => setOpen(false)} />}
    </>
  );
}

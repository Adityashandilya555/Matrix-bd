// skipcq: JS-0833
// RentTimeline — the launch loop's rent-change history: baseline → edits →
// verdicts → confirm → launch.
//
// Extracted from LaunchApprovalTab so it can be tested (the surface had no
// coverage at all) and so the exec/supervisor review can mount it later without
// another lift.
//
// The chrome follows SitesTab's HistoryDrawer, which is the house pattern for an
// activity feed: one continuous rail with halo-punched ring dots, day-group
// chips, an avatar in the actor line, and colour applied through color-mix so it
// is theme-safe. What this component keeps from its old self is the structured
// before → after diff — the only one in the app.
//
// The diff rows are the point of the redesign. They used to print whatever
// string the backend sent, which for an escalation schedule was a Python repr:
//   Escalation schedule: [{'year': 1, 'percent': 12.0, ...}] → [{'year': 1, ...}]
// Unreadable, and it hid the actual change (three years becoming two) inside a
// wall of .0 noise. Now each field renders as its own type.
import React from 'react';
import { T, TABULAR, Icon, Avatar, EmptyState, inr } from '../ui/kit.jsx';
import { ScheduleTable } from '../../shared/rent/RentScheduleDialog.jsx';
import { AC_TOKENS } from '../../shared/rent/RentTermsForm.jsx';

// ── Recovering the structured value behind a diff string ──────────────────────
//
// launch_review_events stores each change as {field, label, from, to}, already
// stringified. New events carry JSON (launch_service._str uses json.dumps), but
// events written before that fix hold a PYTHON REPR:
//
//   [{Q}year{Q}: 1, ...]   (single-quoted — JSON.parse rejects it outright)
//
// Rather than migrate an audit trail in place, both shapes are read here. These
// live in this file rather than lib/ because the timeline is their only consumer
// and a standalone module tripped the JS analyser's parser.
//
// Returns null when the string is not a container we recognise, and NEVER throws
// — callers fall back to the raw string, which is exactly the old behaviour.
const Q = String.fromCharCode(39);
const LEGACY_KEYS = ['year', 'percent', 'mg', 'dine_in_pct', 'delivery_pct'];

// The legacy path rewrites quotes, which would corrupt any value containing an
// apostrophe, so it is gated on the string really looking like a schedule row.
const looksLegacy = (text) =>
  text.startsWith('[') && LEGACY_KEYS.some((k) => text.includes(`{${Q}${k}${Q}:`));

export function parseEventValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;      // already structured
  const text = String(raw).trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return null;

  try {
    return JSON.parse(text);
  } catch (notJson) {   // eslint-disable-line no-unused-vars
    // Not JSON — fall through to the legacy repr path below.
  }

  if (!looksLegacy(text)) return null;
  try {
    // These rows carry only bare keys and numbers — no nested strings — so
    // swapping the quote character is safe here in a way it would not be in
    // general. None/True/False are mapped in case a row carries an explicit null.
    const json = text
      .split(Q).join('"')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');
    return JSON.parse(json);
  } catch (notRepr) {   // eslint-disable-line no-unused-vars
    return null;
  }
}

// A staggered schedule is a non-empty array of objects. Anything else renders
// as text.
export function asScheduleRows(raw) {
  const parsed = parseEventValue(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const rows = parsed.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  return rows.length === parsed.length ? rows : null;
}

// Tint an accent for a fill or hairline without leaving the theme — mixing with
// `transparent` keeps it correct in both light and dark. Matches SitesTab.
const cm = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// Icon is a map of components (Icon.clock), not a component taking a name.
const ACTION = {
  baseline:        { label: 'Draft baseline',  icon: Icon.doc,   tone: () => T.textMuted },
  edited:          { label: 'Edited rent',     icon: Icon.rupee, tone: () => T.accent },
  sent_for_review: { label: 'Sent for review', icon: Icon.clock, tone: () => T.textMuted },
  approved:        { label: 'Approved',        icon: Icon.check, tone: () => T.success },
  rejected:        { label: 'Rejected',        icon: Icon.x,     tone: () => T.danger },
  confirmed:       { label: 'Final confirm',   icon: Icon.check, tone: () => T.success },
  committed:       { label: 'Committed to DB', icon: Icon.check, tone: () => T.success },
  launched:        { label: 'Launched',        icon: Icon.flag,  tone: () => T.success },
};
const meta = (action) => ACTION[action] || { label: action, icon: Icon.clock, tone: () => T.textMuted };

const RENT_TYPE_LABEL = {
  fixed: 'Fixed + escalation', revshare: 'Revenue share',
  mg_revshare: 'MG + Revenue share', staggered: 'Staggered',
};
const MONEY_FIELDS = new Set(['expected_rent', 'fixed_rent_amt']);

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

// Group consecutive events under their day, so the per-row stamp can drop the
// date and the feed stays scannable when it runs long.
function byDay(events) {
  const groups = [];
  for (const e of events) {
    const day = e.created_at ? fmtDay(e.created_at) : 'Undated';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(e);
    else groups.push({ day, rows: [e] });
  }
  return groups;
}

// Which years exist on only one side of the change — the bit that was invisible
// before, when both sides were printed as one long string.
function scheduleMarks(fromRows, toRows) {
  const yearsOf = (rows) => new Set((rows || []).map((r, i) => r.year ?? i + 1));
  const before = yearsOf(fromRows);
  const after = yearsOf(toRows);
  const marks = { from: {}, to: {} };
  before.forEach((y) => { if (!after.has(y)) marks.from[y] = 'removed'; });
  after.forEach((y) => { if (!before.has(y)) marks.to[y] = 'added'; });
  return marks;
}

function scalar(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'rent_type') return RENT_TYPE_LABEL[value] || value;
  if (MONEY_FIELDS.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? inr(n) : String(value);
  }
  return String(value);
}

// One changed field. A schedule renders as two small tables; everything else
// keeps the old strikethrough → bold pair, which reads well for scalars.
function Change({ change }) {
  const { field, label, from, to } = change;
  const fromRows = asScheduleRows(from);
  const toRows = asScheduleRows(to);

  if (field === 'staggered_escalation' && (fromRows || toRows)) {
    const marks = scheduleMarks(fromRows, toRows);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, color: T.textFaint, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label || field}
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: fromRows && toRows ? '1fr 1fr' : '1fr', gap: 10 }}>
          {fromRows && (
            <div style={{ minWidth: 0, opacity: 0.72 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 2 }}>Before</div>
              <ScheduleTable rows={fromRows} tokens={AC_TOKENS} compact marks={marks.from} />
            </div>
          )}
          {toRows && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 2 }}>{fromRows ? 'After' : 'Set to'}</div>
              <ScheduleTable rows={toRows} tokens={AC_TOKENS} compact marks={marks.to} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 11.5, color: T.textMuted, ...TABULAR }}>
      <span style={{ color: T.textFaint }}>{label || field}:</span>{' '}
      <span style={{ textDecoration: from != null ? 'line-through' : 'none', color: T.textFaint }}>
        {from == null ? '—' : scalar(field, from)}
      </span>
      {' → '}
      <span style={{ color: T.text, fontWeight: 600 }}>{to == null ? '—' : scalar(field, to)}</span>
    </div>
  );
}

function Event({ event }) {
  const { label, icon: Glyph, tone } = meta(event.action);
  const color = tone();
  const actor = event.actor_name || (event.actor_role === 'system' ? null : event.actor_role);

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 14, padding: '9px 0' }}>
      {/* Hollow ring with a halo in the drawer colour, so the rail reads as one
          continuous line passing behind it rather than stopping at each row. */}
      <span
        data-testid="timeline-dot"
        style={{
          width: 12, height: 12, borderRadius: 999, marginLeft: 5, marginTop: 3, flexShrink: 0,
          background: T.drawerBg, border: `2.5px solid ${color}`, boxSizing: 'border-box',
          boxShadow: `0 0 0 4px ${T.drawerBg}`, zIndex: 1,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999,
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
            color, background: cm(color, 13), border: `1px solid ${cm(color, 32)}`,
          }}>
            <Glyph size={11} /> {label}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: T.textFaint, ...TABULAR }}>
            {event.created_at ? fmtTime(event.created_at) : ''}
          </span>
        </div>

        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: T.textFaint }}>
          {actor ? <><Avatar name={actor} size={17} /><span>{actor}</span></> : <span>System</span>}
          {event.actor_role && actor && <><span aria-hidden="true">·</span><span>{event.actor_role}</span></>}
        </div>

        {event.comment && (
          <div style={{
            marginTop: 6, padding: '7px 10px', borderLeft: `2px solid ${cm(color, 45)}`,
            borderRadius: '4px 10px 10px 4px', background: T.surfaceInset,
            fontSize: 12, lineHeight: 1.45, color: T.textMuted, wordBreak: 'break-word',
          }}>
            {event.comment}
          </div>
        )}

        {Array.isArray(event.changes) && event.changes.length > 0 && (
          <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {event.changes.map((c, j) => (
              <Change key={`${c.field ?? c.label ?? j}-${j}`} change={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RentTimeline({ events }) {
  if (!events?.length) {
    return <EmptyState icon={Icon.clock} title="No activity yet" hint="Rent edits, reviews and approvals will appear here." />;
  }
  return (
    <div style={{ position: 'relative', paddingLeft: 6 }}>
      <div style={{ position: 'absolute', left: 11, top: 12, bottom: 12, width: 2, borderRadius: 2, background: T.line }} />
      {byDay(events).map((g) => (
        <div key={g.day}>
          <div style={{
            position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center',
            margin: '6px 0 4px', padding: '3px 10px', borderRadius: 999,
            border: `1px solid ${T.line}`, background: T.chip, boxShadow: `0 0 0 4px ${T.drawerBg}`,
            fontSize: 9.5, fontWeight: 750, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: T.textMuted, ...TABULAR,
          }}>
            {g.day}
          </div>
          {g.rows.map((e) => <Event key={e.id} event={e} />)}
        </div>
      ))}
    </div>
  );
}

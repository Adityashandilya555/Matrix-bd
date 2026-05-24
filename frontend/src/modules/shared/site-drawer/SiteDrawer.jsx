import React, { useState, useEffect } from 'react';
import Icon from '../primitives/Icon.jsx';
import Avatar from '../primitives/Avatar.jsx';
import StatusPill from '../primitives/StatusPill.jsx';
import { getSiteActivity, colorForAction, labelForEntry } from '../../../services/api/audit.js';
import { SiteStatus } from '../../../lib/stateMachine.js';

// Relative time formatter for the activity tab. Keeps the rendering format from
// the mock data ("12 min ago", "3 days ago") so the visual identity is preserved.
function relativeTime(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60)            return `${sec} sec ago`;
  const min = Math.round(sec / 60);
  if (min < 60)            return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)             return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30)            return `${day} day${day === 1 ? '' : 's'} ago`;
  const mo = Math.round(day / 30);
  return `${mo} mo ago`;
}

// All render bodies preserved exactly from SiteDrawer.jsx.

function Field({ label, value, mono, span = 1 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: `span ${span}` }}>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5,
        letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
      }}>{label}</span>
      <span style={{
        fontFamily: mono ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
        fontFeatureSettings: mono ? "'tnum' 1" : 'normal',
        fontSize: 14, color: 'var(--zm-fg)', fontWeight: mono ? 500 : 500,
      }}>{value}</span>
    </div>
  );
}

function Tab({ active, label, count, onClick }) {
  return (
    <button onClick={onClick} className={"zm-tab" + (active ? " is-active" : "")} style={{
      background: 'none', border: 'none', padding: '12px 4px',
      fontFamily: 'var(--zm-font-body)', fontSize: 13,
      fontWeight: active ? 600 : 500,
      color: active ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
      borderBottom: '2px solid ' + (active ? 'var(--zm-accent)' : 'transparent'),
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
      marginRight: 22,
    }}>
      {label}
      {count != null && (
        <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{count}</span>
      )}
    </button>
  );
}

// Render an LOI tracker that reflects the *real* staging timeline:
//   APPROVED              → countdown (days since approval / expected window)
//   LOI_UPLOADED          → LOI received, days-to-LOI tagged, awaiting push to payments
//   PUSHED_TO_PAYMENTS    → terminal in staging, payments owns the rest
// Anything pre-approval renders nothing — there is no LOI clock yet.
function LOITracker({ site }) {
  if (
    site.status !== SiteStatus.APPROVED
    && site.status !== SiteStatus.LOI_UPLOADED
    && site.status !== SiteStatus.PUSHED_TO_PAYMENTS
  ) {
    return null;
  }

  const expected = Number(site.expectedLoiDays) || 14;
  const daysSinceApproval = Number(site._daysSinceApproval ?? site.daysSinceApproval ?? 0);
  const daysToLOI         = site._daysToLOI ?? site.daysToLOI ?? null;
  const loiUploadedAt     = site._loiUploadedAt || site.loiUploadedAt || null;
  const approvedDate      = site._approvedDate || site.approvedDate || null;

  const uploaded = site.status === SiteStatus.LOI_UPLOADED || site.status === SiteStatus.PUSHED_TO_PAYMENTS;
  const pushed   = site.status === SiteStatus.PUSHED_TO_PAYMENTS;

  // Overdue only applies while we're still waiting for the LOI — once it's
  // uploaded, the clock stops and going past the deadline is just history.
  const daysShown = uploaded ? (daysToLOI ?? daysSinceApproval) : daysSinceApproval;
  const overdue   = !uploaded && daysShown > expected;
  const remaining = Math.max(0, expected - daysSinceApproval);

  const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString('en', { day: '2-digit', month: 'short' }) : '—';

  return (
    <div style={{
      border: '1px solid ' + (overdue ? 'rgba(217,119,6,0.4)' : 'var(--zm-line)'),
      background: overdue ? 'var(--zm-copper-soft)' : 'var(--zm-surface-2)',
      borderRadius: 10, padding: 16,
      display: 'flex', alignItems: 'center', gap: 18,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
          {pushed ? 'LOI · pushed to payments' : uploaded ? 'LOI uploaded' : 'LOI countdown'}
        </span>
        <span style={{ fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 28, fontWeight: 600, color: overdue ? '#B45309' : 'var(--zm-fg)', letterSpacing: '-0.02em' }}>
          {String(daysShown).padStart(2, '0')} days
          {!uploaded && (
            <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--zm-fg-3)', fontWeight: 500 }}>
              / {expected} expected
            </span>
          )}
        </span>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>
          {approvedDate && <>approved {formatDate(approvedDate)}</>}
          {approvedDate && (loiUploadedAt || !uploaded) && ' · '}
          {uploaded && loiUploadedAt
            ? <>LOI received {formatDate(loiUploadedAt)}</>
            : !uploaded && <>{remaining} day{remaining === 1 ? '' : 's'} until SLA</>}
        </span>
      </div>
      <div style={{ flex: 1 }}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#047857' }}>
          <Icon name="check" size={13}/> Approved by supervisor
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: uploaded ? '#047857' : overdue ? '#B45309' : 'var(--zm-fg-3)' }}>
          <Icon name={uploaded ? 'check' : overdue ? 'alert' : 'clock'} size={13}/>
          {uploaded ? 'LOI uploaded' : 'Awaiting LOI from BD'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: pushed ? '#047857' : 'var(--zm-fg-3)' }}>
          <Icon name={pushed ? 'check' : 'clock'} size={13}/>
          {pushed ? 'Pushed to payments' : 'Awaiting push to payments'}
        </div>
      </div>
    </div>
  );
}

function PhotoTile({ caption, hue = 200 }) {
  return (
    <div style={{
      border: '1px solid var(--zm-line)', borderRadius: 10, overflow: 'hidden',
      background: `linear-gradient(135deg, hsl(${hue} 30% 80%), hsl(${hue + 30} 28% 65%))`,
      aspectRatio: '4 / 3', position: 'relative',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent 50%)' }}/>
      <span style={{ position: 'relative', padding: 10, color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 600 }}>{caption}</span>
    </div>
  );
}

function SiteOverviewTab({ site }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <LOITracker site={site}/>

      <section>
        <h4 style={{ margin: '0 0 14px', fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 14, color: 'var(--zm-fg)' }}>Site fundamentals</h4>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px 24px',
          padding: '20px 22px', background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10,
        }}>
          <Field label="Site code" value={site.code} mono/>
          <Field label="Model" value={site.model}/>
          <Field label="City" value={site.city}/>
          <Field label="Carpet area" value={`${site.carpet} sqft`} mono/>
          <Field label="Rent / month" value={`₹${site.rent.toLocaleString('en-IN')}`} mono/>
          <Field label="CAM" value={`₹${site.cam.toLocaleString('en-IN')}`} mono/>
          <Field label="Total op cost" value={`₹${site.opCost.toLocaleString('en-IN')}`} mono/>
          <Field label="Lock-in" value={`${site.lockin} months`} mono/>
          <Field label="Escalation" value={`${site.escalation}% / yr`} mono/>
          <Field label="Security deposit" value={`₹${site.deposit.toLocaleString('en-IN')}`} mono/>
          <Field label="Rent-free days" value={`${site.rentFree}`} mono/>
          <Field label="Est. monthly sales" value={`₹${site.estSales.toLocaleString('en-IN')}`} mono/>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 14, color: 'var(--zm-fg)' }}>SPOC + Google pin</h4>
          <button className="zm-link-btn" style={{ background: 'none', border: 'none', color: 'var(--zm-accent)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Open in Maps →</button>
        </div>
        <div style={{
          padding: 20, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="SPOC name" value={site.spocName}/>
            <Field label="SPOC phone" value={site.spocPhone} mono/>
            <Field label="Google pin" value={site.pin} mono/>
          </div>
          <div style={{
            background: 'linear-gradient(135deg,#EEF1F5,#E1E5EB)', borderRadius: 8, position: 'relative', overflow: 'hidden',
            backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M32 0 L0 0 0 32' fill='none' stroke='%23005F60' stroke-width='0.6' opacity='0.18'/></svg>\")",
            backgroundColor: '#EEF1F5', minHeight: 130,
          }}>
            <span style={{ position: 'absolute', top: 12, left: 12, fontFamily: 'var(--zm-font-mono)', fontSize: 10, color: '#005F60' }}>map · stub</span>
            <span style={{
              position: 'absolute', left: '52%', top: '46%',
              width: 14, height: 14, borderRadius: 999, background: '#D97706',
              boxShadow: '0 0 0 6px rgba(217,119,6,0.22)', transform: 'translate(-50%,-50%)',
            }}/>
          </div>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 14, color: 'var(--zm-fg)' }}>Site photos</h4>
          <button className="zm-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, padding: '6px 10px', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, color: 'var(--zm-fg)', cursor: 'pointer' }}>
            <Icon name="upload" size={13}/> Upload
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <PhotoTile caption="Storefront · day" hue={200}/>
          <PhotoTile caption="Interior shell"   hue={30}/>
          <PhotoTile caption="Foot traffic"     hue={140}/>
          <PhotoTile caption="Adjacency map"    hue={280}/>
        </div>
      </section>
    </div>
  );
}

function SiteActivityTab({ site }) {
  const [entries, setEntries] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    getSiteActivity(site.id)
      .then(res => { if (!cancelled) setEntries(res.items || []); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Failed to load activity'); });
    return () => { cancelled = true; };
  }, [site.id]);

  const wrapStyle = { background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, overflow: 'hidden' };

  if (entries === null && !error) {
    return <div style={{ ...wrapStyle, padding: 20, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Loading activity…</div>;
  }
  if (error) {
    return <div style={{ ...wrapStyle, padding: 20, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: '#B91C1C' }}>{error}</div>;
  }
  if (entries.length === 0) {
    return <div style={{ ...wrapStyle, padding: 20, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>No activity yet for this site.</div>;
  }

  return (
    <div style={wrapStyle}>
      {entries.map((e, i) => (
        <div key={e.id || i} style={{
          display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 16,
          padding: '14px 20px',
          borderBottom: i < entries.length - 1 ? '1px solid var(--zm-line-faint)' : 'none',
        }}>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{relativeTime(e.createdAt)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: colorForAction(e.action), flex: '0 0 6px' }}/>
            <Avatar name={e.actor} size={24}/>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>
              <strong style={{ fontWeight: 600 }}>{e.actor}</strong> <span style={{ color: 'var(--zm-fg-2)' }}>{labelForEntry(e)}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SiteDocsTab() {
  const docs = [
    { name: 'LOI · final signed.pdf',          size: '482 KB', when: '12 min ago', who: 'Riya S.' },
    { name: 'Carpet floor plan v3.pdf',         size: '1.2 MB', when: '3 days ago', who: 'Riya S.' },
    { name: 'Site photos · 14 images.zip',      size: '8.4 MB', when: '3 days ago', who: 'Riya S.' },
    { name: 'Rental agreement draft v2.docx',   size: '212 KB', when: '4 days ago', who: 'Aman V.' },
    { name: 'Estimated sales model.xlsx',       size: '88 KB',  when: '5 days ago', who: 'Riya S.' },
  ];
  return (
    <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, overflow: 'hidden' }}>
      {docs.map((d, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '28px 1fr 80px 110px 80px 24px', alignItems: 'center', gap: 14,
          padding: '12px 16px',
          borderBottom: i < docs.length - 1 ? '1px solid var(--zm-line-faint)' : 'none',
        }}>
          <span style={{ color: 'var(--zm-fg-3)' }}><Icon name="file" size={16}/></span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 500, color: 'var(--zm-fg)' }}>{d.name}</span>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{d.size}</span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>{d.when}</span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>{d.who}</span>
          <span style={{ color: 'var(--zm-fg-3)' }}><Icon name="download" size={14}/></span>
        </div>
      ))}
    </div>
  );
}

export default function SiteDrawer({ site, onClose }) {
  const [tab, setTab] = useState('overview');
  if (!site) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(17,24,39,0.32)',
        animation: 'zm-fade 200ms var(--zm-ease)',
      }}/>
      <aside style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 760, maxWidth: '92%',
        background: 'var(--zm-bg)', borderLeft: '1px solid var(--zm-line)',
        boxShadow: 'var(--zm-shadow-pop)',
        display: 'flex', flexDirection: 'column',
        animation: 'zm-slide 260ms var(--zm-ease-emp)',
      }}>
        <div style={{
          padding: '20px 28px 0', display: 'flex', alignItems: 'flex-start', gap: 16,
          background: 'var(--zm-surface)', borderBottom: '1px solid var(--zm-line)',
        }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{site.code}</span>
              <StatusPill stage={site.stage}/>
            </span>
            <h2 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>{site.name}</h2>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
              {site.city} · {site.model} · created by {site.createdBy} · {site.createdAt}
            </span>
            <div style={{ marginTop: 18, display: 'flex', gap: 0, borderTop: '1px solid var(--zm-line)' }}>
              <Tab label="Overview"  active={tab === 'overview'}  onClick={() => setTab('overview')}/>
              <Tab label="Activity"  count={6} active={tab === 'activity'} onClick={() => setTab('activity')}/>
              <Tab label="Documents" count={5} active={tab === 'docs'}     onClick={() => setTab('docs')}/>
              <Tab label="Payments"  count={1} active={tab === 'payments'} onClick={() => setTab('payments')}/>
            </div>
          </div>
          <button onClick={onClose} className="zm-icon-btn" style={{
            background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8,
            width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--zm-fg-2)', cursor: 'pointer',
          }}><Icon name="x" size={14}/></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {tab === 'overview'  && <SiteOverviewTab site={site}/>}
          {tab === 'activity'  && <SiteActivityTab site={site}/>}
          {tab === 'docs'      && <SiteDocsTab/>}
          {tab === 'payments'  && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
              1 draft payment ready for approval — open the Payments module to action.
            </div>
          )}
        </div>

        <div style={{
          padding: '14px 28px', borderTop: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button className="zm-btn" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}><Icon name="message" size={14}/> Comment</button>
          <span style={{ flex: 1 }}/>
          <button className="zm-btn" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Re-assign</button>
          <button className="zm-btn-primary" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 34, padding: '0 16px', borderRadius: 8, border: 'none',
            background: 'var(--zm-accent)', color: '#fff',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: 'var(--zm-shadow-1)',
          }}>Advance to payment <Icon name="arrow" size={14}/></button>
        </div>
      </aside>
    </>
  );
}

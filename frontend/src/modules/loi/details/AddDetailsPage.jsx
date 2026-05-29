import React from 'react';
import Icon from '../../shared/primitives/Icon.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';
import * as siteService from '../../../services/api/siteService.js';

const MODELS = ['BTC Cafe', 'BTC Cafe+', 'Blue Tokai Origins', 'Roastries', 'Micro-Cafes & Express Outlets', 'Others'];
const RENT_TYPES = [
  { id: 'revshare', label: 'Revenue share', sub: '% of monthly sales' },
  { id: 'fixed', label: 'Fixed + escalation', sub: 'monthly fixed + % per year' },
  { id: 'mg_revshare', label: 'MG + Revenue share', sub: 'minimum guarantee + % of sales' },
];

// uploadingIds: Set of local photo IDs currently being uploaded to storage
function PhotoPicker({ photos, onAdd, onRemove, uploadingIds = new Set() }) {
  const fileInput = React.useRef(null);
  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(f => {
      const url = URL.createObjectURL(f);
      // Pass the original File object so the parent can upload it
      onAdd({ id: Math.random().toString(36).slice(2, 8), name: f.name, size: f.size, url, file: f });
    });
    e.target.value = '';
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {photos.map(p => (
          <div key={p.id} className="zm-photo-tile" style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--zm-line)', background: p.url ? `url(${p.url}) center/cover` : 'var(--zm-surface-2)' }}>
            {/* Upload-in-progress spinner overlay */}
            {uploadingIds.has(p.id) && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(11,12,16,0.45)', borderRadius: 10 }}>
                <span style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'zm-spin 0.7s linear infinite' }}/>
              </div>
            )}
            <button onClick={() => onRemove(p.id)} title="Remove" className="zm-photo-del" style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, padding: 0, border: 'none', borderRadius: 999, background: 'rgba(11,12,16,0.7)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="x" size={12}/></button>
            <span style={{ position: 'absolute', left: 6, bottom: 6, padding: '2px 6px', borderRadius: 4, background: 'rgba(11,12,16,0.6)', color: '#fff', fontFamily: 'var(--zm-font-mono)', fontSize: 10 }}>
              {uploadingIds.has(p.id) ? 'uploading…' : `${Math.round((p.size || (p.fileSizeKb || 0) * 1024) / 1024)} KB`}
            </span>
          </div>
        ))}
        <button onClick={() => fileInput.current?.click()} className="zm-upload-tile" style={{ aspectRatio: '4 / 3', borderRadius: 10, border: '1px dashed var(--zm-line-strong)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}><Icon name="camera" size={20}/> Add photos<span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10, color: 'var(--zm-fg-4)' }}>Stored in Supabase</span></button>
      </div>
      <input ref={fileInput} type="file" accept="image/*" multiple onChange={onPick} style={{ display: 'none' }}/>
      {photos.length === 0 && (<p style={{ margin: '8px 0 0', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>Add storefront photos — they upload immediately and persist across sessions.</p>)}
    </div>
  );
}

const formatINR = (n) => { if (!Number.isFinite(n)) return '—'; return '₹' + Math.round(n).toLocaleString('en-IN'); };

function TextField({ label, value, onChange, placeholder, readOnly, mono, required, span = 1, prefix, suffix, type = 'text', min, max, hint, error }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: `span ${span}` }}>
      <label style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>{label}{required && <span style={{ color: 'var(--zm-danger)', fontWeight: 700 }}>*</span>}{readOnly && <span style={{ color: 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-mono)', fontSize: 10, marginLeft: 'auto' }}>read-only</span>}</label>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid ' + (error ? 'var(--zm-danger)' : 'var(--zm-line)'), borderRadius: 6, background: readOnly ? 'var(--zm-surface-sunken)' : 'var(--zm-bg)', overflow: 'hidden' }}>
        {prefix && (<span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderRight: '1px solid var(--zm-line)' }}>{prefix}</span>)}
        <input type={type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly} min={min} max={max} style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: mono ? 'var(--zm-font-mono)' : 'var(--zm-font-body)', fontFeatureSettings: mono ? "'tnum' 1" : 'normal', fontSize: 13.5, color: readOnly ? 'var(--zm-fg-2)' : 'var(--zm-fg)' }}/>
        {suffix && (<span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>{suffix}</span>)}
      </div>
      {hint && !error && <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{hint}</span>}
      {error && <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-danger)' }}>{error}</span>}
    </div>
  );
}

function SelectField({ label, value, onChange, options, required, span = 1 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: `span ${span}` }}>
      <label style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>{label}{required && <span style={{ color: 'var(--zm-danger)', fontWeight: 700 }}>*</span>}</label>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ height: 38, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)', outline: 'none' }}><option value="">Select…</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>
    </div>
  );
}

function FormSection({ title, n, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 999, background: 'var(--zm-accent-soft)', color: 'var(--zm-accent)', fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, fontWeight: 700 }}>{n}</span>
        <h4 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 14, color: 'var(--zm-fg)' }}>{title}</h4>
      </div>
      {children}
    </section>
  );
}

export default function AddDetailsPage({ item, onClose, onSubmit, onSaveDraft, savingDraft = false, saveError = null }) {
  // Pipeline-stage fields (model, googlePin, rentType, expectedRent) are now
  // captured at draft creation. Prefill them here so the BE picks up where they left off;
  // any edit before submit/save is diff-logged into the activity feed by the backend.
  //
  // Photos are ALWAYS initialised as [] here — blob URLs from a previous session
  // are stale and unusable. The useEffect below loads persisted photos from the API.
  const init = {
    ...(item.details || {
      name: item.name, visitDate: item.visitDate, city: item.city,
      model: item.model || '',
      googlePin: item.googlePin || '',
      rentType: item.rentType || '',
      rent: item.expectedRent != null ? String(item.expectedRent) : '',
      score: '', estSales: '', nearestStarbucks: '', nearestTWC: '',
      carpet: '', cam: '',
      escalation: item.expectedEscalationPct != null ? String(item.expectedEscalationPct) : '',
      revshare: item.expectedRevsharePct != null ? String(item.expectedRevsharePct) : '',
      rentFreeDays: '',
      cadex: '', deposit: '', brokerage: '', lockin: '', tenure: '',
    }),
    photos: [], // always override — load from API below
  };
  const [f, setF] = React.useState(init);
  // Track which photo IDs are mid-upload so the tile can show a spinner
  const [uploadingPhotoIds, setUploadingPhotoIds] = React.useState(new Set());

  // Load persisted photos from Supabase on mount
  React.useEffect(() => {
    if (!item?.id) return;
    siteService.listSitePhotos(item.id)
      .then(photos => {
        if (!photos.length) return;
        setF(prev => ({
          ...prev,
          photos: photos.map(p => ({
            id: p.id,
            name: p.fileName,
            size: (p.fileSizeKb || 0) * 1024,
            fileSizeKb: p.fileSizeKb,
            url: p.url || '',
            persisted: true,
          })),
        }));
      })
      .catch(() => {}); // photos are non-blocking — silently ignore load errors
  }, [item?.id]);

  // Called by PhotoPicker when the user picks file(s).
  // Adds immediately with a blob URL for preview, then uploads to storage
  // and swaps in the persistent signed URL on success.
  const handlePhotoAdd = React.useCallback(async (photoEntry) => {
    setF(prev => ({ ...prev, photos: [...prev.photos, photoEntry] }));
    if (!item?.id || !photoEntry.file) return;
    setUploadingPhotoIds(prev => new Set([...prev, photoEntry.id]));
    try {
      const result = await siteService.uploadPhoto(item.id, photoEntry.file);
      setF(prev => ({
        ...prev,
        photos: prev.photos.map(p =>
          p.id === photoEntry.id
            ? { ...p, url: result.url || p.url, backendId: result.id, persisted: true }
            : p
        ),
      }));
    } catch {
      // Upload failed — photo stays in state with blob URL for preview,
      // marked as not persisted. User can remove and re-add to retry.
    } finally {
      setUploadingPhotoIds(prev => { const s = new Set(prev); s.delete(photoEntry.id); return s; });
    }
  }, [item?.id]);

  const upd = (k) => (v) => setF(prev => ({ ...prev, [k]: v }));
  // Score is 0–100; clamp at the field boundary so users can't enter or
  // paste in 150 / 1000 etc. Empty input stays empty so the "required"
  // validator can still fire on submit.
  const updScore = (v) => {
    if (v === '' || v === null || v === undefined) {
      setF(prev => ({ ...prev, score: '' }));
      return;
    }
    const n = Number(String(v).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n)) return; // ignore garbage
    const clamped = Math.max(0, Math.min(100, n));
    setF(prev => ({ ...prev, score: String(clamped) }));
  };
  const rentNum = parseFloat(f.rent) || 0; const camNum = parseFloat(f.cam) || 0;
  const totalOpCost = (rentNum + camNum) * 1.18;
  const REQUIRED = ['model','googlePin','score','estSales','nearestStarbucks','nearestTWC','carpet','cam','rentType','cadex','deposit','brokerage'];
  const errors = {};
  REQUIRED.forEach(k => { if (!f[k] && f[k] !== 0) errors[k] = 'Required'; });
  if (f.rentType === 'fixed') {
    if (!f.rent) errors.rent = 'Required';
    if (!f.escalation) errors.escalation = 'Set escalation %';
  }
  if (f.rentType === 'revshare' && !f.revshare) errors.revshare = 'Set revenue share %';
  if (f.rentType === 'mg_revshare') {
    if (!f.rent) errors.rent = 'Set minimum guarantee';
    if (!f.revshare) errors.revshare = 'Set revenue share %';
  }
  const filled = Object.keys(errors).length === 0;
  // The conditional rent fields (rent/escalation/revshare) count as essentials
  // once a rent type is picked. Photos block is one essential. Anything else is
  // bonus / nice-to-have so it never lands in the headline count.
  const RENT_EXTRAS = {
    fixed: ['rent', 'escalation'],
    revshare: ['revshare'],
    mg_revshare: ['rent', 'revshare'],
  };
  const rentExtras = RENT_EXTRAS[f.rentType] || [];
  const totalFields = REQUIRED.length + rentExtras.length;
  const conditionalFilled = rentExtras.filter(k => f[k]).length;
  const filledCount =
    REQUIRED.filter(k => f[k] || f[k] === 0).length
    + conditionalFilled;
  const resumed = !!item.details;
  const lastSavedAt = item.details?._savedAt;
  const payloadWithoutSpoc = () => {
    const { spocName, spoc_name, ...rest } = f;
    return { ...rest, totalOpCost };
  };
  const handleSubmit = () => { if (!filled) return; onSubmit(payloadWithoutSpoc()); };
  const handleSaveDraft = () => {
    if (savingDraft) return;
    onSaveDraft?.({ ...payloadWithoutSpoc(), _savedAt: new Date().toISOString() });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.50)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-bg)', borderLeft: '1px solid var(--zm-line)', width: 880, maxWidth: '96%', display: 'flex', flexDirection: 'column', boxShadow: 'var(--zm-shadow-pop)', animation: 'zm-slide 280ms var(--zm-ease-emp)' }}>
        <header style={{ padding: '20px 28px', background: 'var(--zm-surface)', borderBottom: '1px solid var(--zm-line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{item.code}</span><StatusPill stage="shortlist"/></span>
            <h2 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Add site details · {f.name}</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>{resumed ? <>Resumed draft · last saved <strong style={{ color: 'var(--zm-fg-2)' }}>{lastSavedAt ? new Date(lastSavedAt).toLocaleString('en', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</strong>. Pick up where you left off, or send for review.</> : <><strong style={{ color: 'var(--zm-fg-2)' }}>{totalFields}</strong> essential fields. Enter rupee values in <strong>full rupees, no commas</strong> (e.g. 125000 — not 1.25L). Total op cost is auto-calculated. Save partial progress anytime; hit <strong>Send for review</strong> when ready.</>}</p>
          </div>
          <button onClick={onClose} disabled={savingDraft} className="zm-icon-btn" style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: savingDraft ? 'var(--zm-fg-4)' : 'var(--zm-fg-2)', cursor: savingDraft ? 'wait' : 'pointer', opacity: savingDraft ? 0.65 : 1 }}><Icon name="x" size={14}/></button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <FormSection n="1·3" title="Identity"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}><TextField label="Name" value={f.name} onChange={upd('name')} required hint="Editable from draft"/><TextField label="Visit date" value={f.visitDate} mono readOnly hint="Locked from pipeline"/><TextField label="City" value={f.city} onChange={upd('city')} required/></div></FormSection>
            <FormSection n="4·5" title="Model · Google pin"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}><SelectField label="Model" value={f.model} onChange={upd('model')} required options={MODELS}/><TextField label="Google pin" value={f.googlePin} onChange={upd('googlePin')} required mono placeholder="19.1183, 72.9089"/></div></FormSection>
            <FormSection n="7" title="Storefront photos"><PhotoPicker photos={f.photos} onAdd={handlePhotoAdd} onRemove={(id) => setF(prev => ({ ...prev, photos: prev.photos.filter(x => x.id !== id) }))} uploadingIds={uploadingPhotoIds}/></FormSection>
            <FormSection n="8·11" title="Score + adjacency sales"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}><TextField label="Score" value={f.score} onChange={updScore} required type="number" min="0" max="100" hint="0–100 footfall + visibility" error={Number(f.score) > 100 ? 'Max 100' : undefined}/><TextField label="Estimated sales" value={f.estSales} onChange={upd('estSales')} required mono prefix="₹" suffix="/mo" placeholder="e.g. 1250000" hint="Full rupees · no commas"/><TextField label="Nearest Starbucks sales" value={f.nearestStarbucks} onChange={upd('nearestStarbucks')} required mono prefix="₹" suffix="/mo" placeholder="e.g. 900000" hint="Full rupees"/><TextField label="Nearest TWC sales" value={f.nearestTWC} onChange={upd('nearestTWC')} required mono prefix="₹" suffix="/mo" placeholder="e.g. 700000" hint="Third-Wave Coffee · full rupees"/></div></FormSection>
            <FormSection n="12·14" title="Carpet · CAM · rent">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}><TextField label="Carpet / covered area" value={f.carpet} onChange={upd('carpet')} required mono suffix="sqft" placeholder="e.g. 850"/><TextField label="CAM" value={f.cam} onChange={upd('cam')} required mono prefix="₹" suffix="/mo" placeholder="e.g. 25000" hint="Full rupees · no commas"/><div/></div>
              <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><label style={{ display: 'block', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)', marginBottom: 8 }}>Rent type <span style={{ color: 'var(--zm-danger)', fontWeight: 700 }}>*</span></label><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>{RENT_TYPES.map(rt => (<button type="button" key={rt.id} onClick={() => upd('rentType')(rt.id)} className="zm-btn" style={{ textAlign: 'left', padding: 12, borderRadius: 8, border: '1px solid ' + (f.rentType === rt.id ? 'var(--zm-accent)' : 'var(--zm-line)'), background: f.rentType === rt.id ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10, fontFamily: 'inherit' }}><span style={{ width: 16, height: 16, borderRadius: 999, marginTop: 1, border: '1.5px solid ' + (f.rentType === rt.id ? 'var(--zm-accent)' : 'var(--zm-line-strong)'), background: f.rentType === rt.id ? 'var(--zm-accent)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 16px' }}>{f.rentType === rt.id && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }}/>}</span><span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--zm-fg)' }}>{rt.label}</span><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{rt.sub}</span></span></button>))}</div></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  {f.rentType === 'fixed' && (<><TextField label="Rent (monthly)" value={f.rent} onChange={upd('rent')} required mono prefix="₹" suffix="/mo" placeholder="e.g. 180000" hint="Full rupees · no commas" error={errors.rent}/><TextField label="Escalation" value={f.escalation} onChange={upd('escalation')} required mono suffix="% / yr" placeholder="e.g. 5" error={errors.escalation}/><TextField label="Rent-free days" value={f.rentFreeDays} onChange={upd('rentFreeDays')} mono suffix="days" hint="Optional fit-out grace"/></>)}
                  {f.rentType === 'revshare' && (<><TextField label="Revenue share" value={f.revshare} onChange={upd('revshare')} required mono suffix="% of sales" placeholder="e.g. 12" error={errors.revshare}/><TextField label="Rent-free days" value={f.rentFreeDays} onChange={upd('rentFreeDays')} mono suffix="days" hint="Optional"/><div/></>)}
                  {f.rentType === 'mg_revshare' && (<><TextField label="Minimum guarantee" value={f.rent} onChange={upd('rent')} required mono prefix="₹" suffix="/mo" placeholder="e.g. 80000" hint="MG floor · full rupees" error={errors.rent}/><TextField label="Revenue share" value={f.revshare} onChange={upd('revshare')} required mono suffix="% of sales" placeholder="e.g. 12" hint="Above MG threshold" error={errors.revshare}/><TextField label="Rent-free days" value={f.rentFreeDays} onChange={upd('rentFreeDays')} mono suffix="days" hint="Optional"/></>)}
                  {!f.rentType && (<div style={{ gridColumn: 'span 3', padding: 16, background: 'var(--zm-surface-2)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)', textAlign: 'center' }}>Pick a rent type above to reveal the rent fields.</div>)}
                </div>
              </div>
              <div style={{ background: 'var(--zm-accent-soft)', border: '1px solid var(--zm-accent-line)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Auto · total op cost</span>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>= (rent + CAM) × 1.18</span>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 22, fontWeight: 600, color: 'var(--zm-fg)' }}>{formatINR(totalOpCost)}<span style={{ fontSize: 12, color: 'var(--zm-fg-3)', marginLeft: 4 }}>/mo</span></span>
              </div>
            </FormSection>
            <FormSection n="13·15" title="Capex · deposit · brokerage"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}><TextField label="Cadex (capex)" value={f.cadex} onChange={upd('cadex')} required mono prefix="₹" placeholder="e.g. 4500000" hint="Fit-out budget · full rupees"/><TextField label="Security deposit" value={f.deposit} onChange={upd('deposit')} required mono prefix="₹" placeholder="e.g. 1080000" hint="Full rupees · no commas"/><TextField label="Brokerage" value={f.brokerage} onChange={upd('brokerage')} required mono prefix="₹" placeholder="e.g. 360000" hint="Full rupees · no commas"/></div></FormSection>
            <FormSection n="opt" title="Lock-in + tenure · optional"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}><TextField label="Lock-in period" value={f.lockin} onChange={upd('lockin')} mono suffix="months" hint="Optional"/><TextField label="Tenure" value={f.tenure} onChange={upd('tenure')} mono suffix="months" hint="Optional"/><div/></div></FormSection>
          </div>
        </div>
        <footer style={{ padding: '14px 28px', borderTop: '1px solid var(--zm-line)', background: 'var(--zm-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {filled ? (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-success)', fontWeight: 600 }}><Icon name="check" size={14}/> All essentials filled · ready for review</span>) : (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}><Icon name="alert" size={14} style={{ color: 'var(--zm-warning)' }}/><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span><strong style={{ color: 'var(--zm-fg)' }}>{filledCount}</strong> <span style={{ color: 'var(--zm-fg-3)' }}>/ {totalFields}</span> filled</span><span aria-hidden="true" style={{ width: 84, height: 5, borderRadius: 999, background: 'var(--zm-surface-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.round((filledCount / totalFields) * 100)}%`, background: 'var(--zm-accent)', borderRadius: 999, transition: 'width 280ms var(--zm-ease-emp)' }}/></span></span></span>)}
          <span style={{ flex: 1 }}/>
          {saveError && <span style={{ maxWidth: 260, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-danger)' }}>Save failed: {saveError}</span>}
          <button onClick={onClose} disabled={savingDraft} className="zm-btn" style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: savingDraft ? 'var(--zm-fg-4)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: savingDraft ? 'wait' : 'pointer', opacity: savingDraft ? 0.65 : 1 }}>Cancel</button>
          <button onClick={handleSaveDraft} disabled={savingDraft} className="zm-btn" title="Save partial progress · continue later" style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: savingDraft ? 'var(--zm-fg-3)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: savingDraft ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: savingDraft ? 0.75 : 1 }}><Icon name="folder" size={13}/> {savingDraft ? 'Saving...' : 'Save draft'}</button>
          <button onClick={handleSubmit} disabled={!filled || savingDraft} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: filled && !savingDraft ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: filled && !savingDraft ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: filled && !savingDraft ? 'pointer' : 'not-allowed', boxShadow: filled && !savingDraft ? 'var(--zm-shadow-1)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Send for review <Icon name="arrow" size={14}/></button>
        </footer>
      </div>
    </div>
  );
}

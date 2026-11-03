// skipcq: JS-0833
// Business-admin portal → Vendors. Everything about the vendor platform a
// workspace can customise lives here:
//   Vendors    — vendor companies, their entry/staff codes, owner invites
//   Approvals  — people waiting to join a vendor workspace
//   Settings   — admission rule, self-signup, daily cutoff, durations, branding
//   Templates  — plan phases per site type, mobilisation checklists
import React from 'react';
import {
  createVendor, decideVendorPending, getVendorChecklists, getVendorPhases, getVendorSettings,
  inviteVendorOwner, listVendorPending, listVendors, rotateVendorCode, saveVendorChecklists,
  saveVendorPhases, updateVendor, updateVendorSettings, uploadVendorLogo,
} from '../../../services/api/vendorAdminApi.js';
import {
  Button, Card, EmptyState, ErrorState, Icon, SectionHeader, SegmentedNav, Skeleton, T,
} from '../ui/kit.jsx';

const SUB_TABS = [
  { key: 'vendors', label: 'Vendors', icon: Icon.box },
  { key: 'approvals', label: 'Approvals', icon: Icon.check },
  { key: 'settings', label: 'Settings', icon: Icon.wrench },
  { key: 'templates', label: 'Templates', icon: Icon.layers },
];

const inputStyle = {
  width: '100%', boxSizing: 'border-box', height: 36, padding: '0 10px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.panel, color: T.text, font: 'inherit', fontSize: 13,
};
const labelStyle = { display: 'grid', gap: 4, fontSize: 12, color: T.textMuted, fontWeight: 600 };
const grid = (min) => ({ display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` });
const errText = (err, fallback) => err?.detail || err?.message || fallback;

function useLoad(fn) {
  const [state, setState] = React.useState({ status: 'loading' });
  const load = React.useCallback(() => {
    setState((s) => (s.status === 'ready' ? { ...s, refreshing: true } : { status: 'loading' }));
    fn().then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: errText(err, 'Could not load.') }));
  }, [fn]);
  React.useEffect(() => { load(); }, [load]);
  return [state, load];
}

function Notice({ msg }) {
  if (!msg) return null;
  return (
    <div role="status" style={{
      padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12,
      background: msg.tone === 'bad' ? T.dangerSoft : T.successSoft, color: msg.tone === 'bad' ? T.dangerText : T.successText,
    }}>{msg.text}</div>
  );
}

function Loading() {
  return <div style={{ display: 'grid', gap: 8 }}><Skeleton h={18} w="40%" /><Skeleton h={60} /><Skeleton h={60} /></div>;
}

// ── Vendors ─────────────────────────────────────────────────────────────────
function CodeCell({ label, code, onRotate, busy }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: T.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ fontSize: 12.5, padding: '3px 8px', borderRadius: 6, background: T.chip, border: `1px solid ${T.line}` }}>{code || '—'}</code>
        <Button size="sm" onClick={onRotate} loading={busy} icon={<Icon.rotate size={14} />}>{code ? 'Rotate' : 'Create'}</Button>
      </div>
    </div>
  );
}

function VendorsPanel() {
  const [state, load] = useLoad(listVendors);
  const [form, setForm] = React.useState({ name: '', legalName: '', gstin: '', ownerEmail: '' });
  const [invite, setInvite] = React.useState({});
  const [busy, setBusy] = React.useState(null);
  const [msg, setMsg] = React.useState(null);

  const run = async (key, fn, done) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ tone: 'ok', text: done }); load(); } catch (err) { setMsg({ tone: 'bad', text: errText(err, 'That did not work.') }); }
    finally { setBusy(null); }
  };
  const create = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setMsg({ tone: 'bad', text: 'Enter the vendor company name.' }); return; }
    run('create', () => createVendor(form), `${form.name} added with a new vendor code.`)
      .then(() => setForm({ name: '', legalName: '', gstin: '', ownerEmail: '' }));
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Notice msg={msg} />
      <Card style={{ padding: 18 }}>
        <SectionHeader icon={Icon.box} title="Add a vendor company"
          description="Each vendor gets its own vendor code. They enter it in the same workspace-code box on the welcome page." />
        <form onSubmit={create} style={grid(200)}>
          <label style={labelStyle} htmlFor="va-name">Company name<input id="va-name" style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label style={labelStyle} htmlFor="va-legal">Legal name<input id="va-legal" style={inputStyle} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></label>
          <label style={labelStyle} htmlFor="va-gst">GSTIN<input id="va-gst" style={inputStyle} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></label>
          <label style={labelStyle} htmlFor="va-owner">Owner email (optional)<input id="va-owner" type="email" style={inputStyle} value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} /></label>
          <div style={{ alignSelf: 'end' }}><Button type="submit" variant="solid" loading={busy === 'create'}>Add vendor</Button></div>
        </form>
      </Card>
      <Card style={{ padding: 18 }}>
        <SectionHeader icon={Icon.users} title="Vendor companies" count={state.data?.vendors?.length} tone="neutral" onRefresh={load} refreshing={state.refreshing} />
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <ErrorState message={state.message} onRetry={load} />}
        {state.status === 'ready' && (state.data.vendors?.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {state.data.vendors.map((v) => (
              <div key={v.id} style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div><b style={{ fontSize: 15 }}>{v.name}</b>
                    <div style={{ fontSize: 12, color: T.textMuted }}>{[v.legalName, v.gstin].filter(Boolean).join(' · ') || 'No legal details yet'}</div>
                    <div style={{ fontSize: 12, color: T.textMuted }}>{v.userCount} users · {v.pendingCount} waiting · {v.projectCount} sites</div></div>
                  <Button size="sm" variant={v.status === 'active' ? 'subtle' : 'solid'} loading={busy === `s-${v.id}`}
                    onClick={() => run(`s-${v.id}`, () => updateVendor(v.id, { ...v, status: v.status === 'active' ? 'suspended' : 'active' }),
                      v.status === 'active' ? `${v.name} suspended. Its users can no longer sign in.` : `${v.name} reactivated.`)}>
                    {v.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
                </div>
                {v.status !== 'active' && <div style={{ fontSize: 12.5, color: T.dangerText }}>Suspended: sign-in and joining are blocked.</div>}
                <div style={grid(220)}>
                  <CodeCell label="Vendor code (sign-in)" code={v.entryCode} busy={busy === `e-${v.id}`}
                    onRotate={() => run(`e-${v.id}`, () => rotateVendorCode(v.id, 'entry'), `New vendor code for ${v.name}. The old one stops working.`)} />
                  <CodeCell label="Staff code (join)" code={v.staffCode} busy={busy === `t-${v.id}`}
                    onRotate={() => run(`t-${v.id}`, () => rotateVendorCode(v.id, 'staff'), `New staff code for ${v.name}.`)} />
                  <form style={{ display: 'grid', gap: 4 }} onSubmit={(e) => { e.preventDefault(); const em = (invite[v.id] || '').trim(); if (!em) return; run(`i-${v.id}`, () => inviteVendorOwner(v.id, em), `${em} invited as owner. They sign in with the vendor code and set a password.`).then(() => setInvite({ ...invite, [v.id]: '' })); }}>
                    <label style={labelStyle} htmlFor={`va-inv-${v.id}`}>Invite an owner</label>
                    <div style={{ display: 'flex', gap: 6 }}><input id={`va-inv-${v.id}`} type="email" placeholder="owner@vendor.com" style={inputStyle} value={invite[v.id] || ''} onChange={(e) => setInvite({ ...invite, [v.id]: e.target.value })} />
                      <Button type="submit" size="sm" loading={busy === `i-${v.id}`}>Invite</Button></div>
                  </form>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No vendor companies yet" hint="Add the first one above." />)}
      </Card>
    </div>
  );
}

// ── Approvals ───────────────────────────────────────────────────────────────
function ApprovalsPanel() {
  const [state, load] = useLoad(listVendorPending);
  const [busy, setBusy] = React.useState(null);
  const [msg, setMsg] = React.useState(null);
  const decide = async (u, approve) => {
    setBusy(u.id); setMsg(null);
    try { await decideVendorPending(u.id, approve); setMsg({ tone: 'ok', text: approve ? `${u.email} approved. They set a password at first sign-in.` : `${u.email}'s request removed.` }); load(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'That did not work.') }); }
    finally { setBusy(null); }
  };
  return (
    <Card style={{ padding: 18 }}>
      <Notice msg={msg} />
      <SectionHeader icon={Icon.check} title="People waiting to join a vendor workspace" count={state.data?.pending?.length} onRefresh={load} refreshing={state.refreshing}
        description="Who decides depends on Settings → Admission. When vendor owners approve their own staff, those requests show here as read-only." />
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={load} />}
      {state.status === 'ready' && (state.data.pending?.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {state.data.pending.map((u) => (
            <div key={u.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 12px', border: `1px solid ${T.line}`, borderRadius: 10 }}>
              <div><b>{u.email}</b><div style={{ fontSize: 12, color: T.textMuted }}>{u.vendorName} · {u.vendorRole === 'owner' ? 'Owner' : 'Site staff'}</div></div>
              {u.approver === 'admin'
                ? <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="sm" variant="success" loading={busy === u.id} onClick={() => decide(u, true)}>Approve</Button>
                    <Button size="sm" variant="danger" disabled={busy === u.id} onClick={() => decide(u, false)}>Reject</Button></div>
                : <span style={{ fontSize: 12, color: T.textMuted }}>The vendor owner decides</span>}
            </div>
          ))}
        </div>
      ) : <EmptyState title="No one is waiting" />)}
    </Card>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
function SettingsPanel() {
  const [state, load] = useLoad(getVendorSettings);
  const [s, setS] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  React.useEffect(() => { if (state.status === 'ready') setS(state.data.settings); }, [state]);

  if (state.status === 'loading' || (state.status === 'ready' && !s)) return <Card style={{ padding: 18 }}><Loading /></Card>;
  if (state.status === 'error') return <Card style={{ padding: 18 }}><ErrorState message={state.message} onRetry={load} /></Card>;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (!/^#[0-9a-fA-F]{6}$/.test(s.accentColor || '')) { setMsg({ tone: 'bad', text: 'The accent colour must be a hex value like #1D3F8C.' }); return; }
    setBusy(true); setMsg(null);
    try { await updateVendorSettings(s); setMsg({ tone: 'ok', text: 'Vendor settings saved. Vendors see the change on their next page load.' }); load(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not save settings.') }); }
    finally { setBusy(false); }
  };
  const onLogo = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg(null);
    try { await uploadVendorLogo(file); setMsg({ tone: 'ok', text: 'Logo updated.' }); load(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not upload the logo.') }); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 16 }}>
      <Notice msg={msg} />
      <Card style={{ padding: 18 }}>
        <SectionHeader icon={Icon.users} title="Admission" description="How new people get into a vendor workspace." />
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}><input type="radio" name="adm" checked={s.admissionMode === 'owner_approves_staff'} onChange={() => setS({ ...s, admissionMode: 'owner_approves_staff' })} />
            <span><b>Vendor owners approve their own staff.</b> You approve owners; each owner approves people who join with their company&#39;s staff code.</span></label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}><input type="radio" name="adm" checked={s.admissionMode === 'admin_approves_all'} onChange={() => setS({ ...s, admissionMode: 'admin_approves_all' })} />
            <span><b>You approve everyone.</b> Every join request, owner or staff, comes to the Approvals list here.</span></label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={Boolean(s.allowSelfSignup)} onChange={set('allowSelfSignup')} />
            <span>Let people request access with the vendor code itself, not only the staff code</span></label>
        </div>
      </Card>
      <Card style={{ padding: 18 }}>
        <SectionHeader icon={Icon.clock} title="Daily updates and programme" />
        <div style={grid(180)}>
          <label style={labelStyle} htmlFor="vs-cut">Daily update due by<input id="vs-cut" type="time" style={inputStyle} value={(s.updateCutoffLocal || '19:00').slice(0, 5)} onChange={set('updateCutoffLocal')} /></label>
          <label style={labelStyle} htmlFor="vs-tz">Time zone<input id="vs-tz" style={inputStyle} value={s.timezone || ''} onChange={set('timezone')} /></label>
          <label style={labelStyle} htmlFor="vs-mall">Mall sites (days)<input id="vs-mall" type="number" min="5" max="365" style={inputStyle} value={s.mallDurationDays} onChange={set('mallDurationDays')} /></label>
          <label style={labelStyle} htmlFor="vs-nonmall">Non-mall sites (days)<input id="vs-nonmall" type="number" min="5" max="365" style={inputStyle} value={s.nonMallDurationDays} onChange={set('nonMallDurationDays')} /></label>
        </div>
      </Card>
      <Card style={{ padding: 18 }}>
        <SectionHeader icon={Icon.panel} title="Portal branding" description="What vendors see in their portal." />
        <div style={grid(220)}>
          <label style={labelStyle} htmlFor="vs-title">Portal title<input id="vs-title" style={inputStyle} value={s.portalTitle || ''} onChange={set('portalTitle')} /></label>
          <label style={labelStyle} htmlFor="vs-accent">Accent colour<div style={{ display: 'flex', gap: 6 }}>
            <input id="vs-accent" style={inputStyle} value={s.accentColor || ''} onChange={set('accentColor')} placeholder="#1D3F8C" />
            <input type="color" aria-label="Pick accent colour" value={/^#[0-9a-fA-F]{6}$/.test(s.accentColor || '') ? s.accentColor : '#1D3F8C'} onChange={set('accentColor')} style={{ width: 40, height: 36, border: 0, background: 'none' }} /></div></label>
          <label style={labelStyle} htmlFor="vs-support">Support contact<input id="vs-support" style={inputStyle} value={s.supportContact || ''} onChange={set('supportContact')} placeholder="projects@yourbrand.com" /></label>
          <label style={labelStyle} htmlFor="vs-logo">Logo<input id="vs-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogo} style={{ fontSize: 12.5 }} /></label>
        </div>
        <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="vs-welcome">Welcome message<textarea id="vs-welcome" style={{ ...inputStyle, height: 70, padding: 10 }} value={s.welcomeText || ''} onChange={set('welcomeText')} /></label>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${T.line}` }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: /^#[0-9a-fA-F]{6}$/.test(s.accentColor || '') ? s.accentColor : T.accent, overflow: 'hidden', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 800 }}>
            {s.logoUrl ? <img src={s.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'BT'}</span>
          <b>{s.portalTitle || 'Fit-out portal'}</b><span style={{ fontSize: 12, color: T.textMuted }}>Preview of the vendor portal header</span>
        </div>
      </Card>
      <div><Button type="submit" variant="solid" loading={busy}>Save settings</Button></div>
    </form>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────
function PhaseEditor({ siteType, rows, onSaved }) {
  const [list, setList] = React.useState(rows);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  React.useEffect(() => setList(rows), [rows]);
  const total = list.reduce((a, p) => a + (Number(p.weight) || 0), 0);
  const upd = (i, k, v) => setList(list.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const save = async () => {
    if (total !== 100) { setMsg({ tone: 'bad', text: `Weights add up to ${total}%. They must total 100%.` }); return; }
    setBusy(true); setMsg(null);
    try { await saveVendorPhases(siteType, list); setMsg({ tone: 'ok', text: 'Phases saved. New calculations use them straight away.' }); onSaved(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not save phases.') }); }
    finally { setBusy(false); }
  };
  const cell = { ...inputStyle, height: 32 };
  return (
    <Card style={{ padding: 18 }}>
      <SectionHeader icon={Icon.layers} title={`Plan phases · ${siteType === 'mall' ? 'Mall' : 'Non-mall'}`}
        description="Days are counted from the start date. Weights decide how much each phase counts toward overall progress." />
      <Notice msg={msg} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead><tr>{['Phase', 'Start day', 'End day', 'Weight %', ''].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: T.textFaint }}>{h}</th>)}</tr></thead>
          <tbody>{list.map((p, i) => (
            <tr key={p.phaseKey || i}>
              <td style={{ padding: 4 }}><input aria-label="Phase name" style={cell} value={p.name} onChange={(e) => upd(i, 'name', e.target.value)} /></td>
              <td style={{ padding: 4, width: 100 }}><input aria-label="Start day" type="number" min="1" style={cell} value={p.startDay} onChange={(e) => upd(i, 'startDay', e.target.value)} /></td>
              <td style={{ padding: 4, width: 100 }}><input aria-label="End day" type="number" min="1" style={cell} value={p.endDay} onChange={(e) => upd(i, 'endDay', e.target.value)} /></td>
              <td style={{ padding: 4, width: 100 }}><input aria-label="Weight" type="number" min="0" max="100" style={cell} value={p.weight} onChange={(e) => upd(i, 'weight', e.target.value)} /></td>
              <td style={{ padding: 4, width: 40 }}><Button size="sm" aria-label="Remove phase" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon.trash size={14} /></Button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => setList([...list, { phaseKey: `p${Date.now().toString(36)}`, name: 'New phase', startDay: 1, endDay: 1, weight: 0 }])}>Add phase</Button>
        <span style={{ fontSize: 12.5, color: total === 100 ? T.textMuted : T.dangerText }}>Total weight {total}%</span>
        <Button size="sm" variant="solid" loading={busy} onClick={save}>Save phases</Button>
      </div>
    </Card>
  );
}

function ChecklistEditor({ items, onSaved }) {
  const [list, setList] = React.useState(items);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  React.useEffect(() => setList(items), [items]);
  const save = async () => {
    if (list.some((it) => !it.label.trim())) { setMsg({ tone: 'bad', text: 'Every checklist item needs a label.' }); return; }
    setBusy(true); setMsg(null);
    try { await saveVendorChecklists(list); setMsg({ tone: 'ok', text: 'Checklists saved.' }); onSaved(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not save checklists.') }); }
    finally { setBusy(false); }
  };
  const section = (kind, title) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <b style={{ fontSize: 13 }}>{title}</b>
      {list.map((it, i) => (it.kind !== kind ? null : (
        <div key={it.id || `n${i}`} style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Checklist item" style={inputStyle} value={it.label} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Button size="sm" aria-label="Remove item" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon.trash size={14} /></Button>
        </div>
      )))}
      <div><Button size="sm" onClick={() => setList([...list, { id: null, kind, label: '', active: true }])}>Add item</Button></div>
    </div>
  );
  return (
    <Card style={{ padding: 18 }}>
      <SectionHeader icon={Icon.check} title="Mobilisation checklists" description="Shown on every site's Initiation tab. Vendors tick their own list; your team ticks yours." />
      <Notice msg={msg} />
      <div style={grid(280)}>{section('mobilisation_vendor', 'Vendor ticks')}{section('mobilisation_brand', 'Your team ticks')}</div>
      <div style={{ marginTop: 12 }}><Button size="sm" variant="solid" loading={busy} onClick={save}>Save checklists</Button></div>
    </Card>
  );
}

function TemplatesPanel() {
  const [phases, loadPhases] = useLoad(getVendorPhases);
  const [lists, loadLists] = useLoad(getVendorChecklists);
  const bySite = (t) => (phases.data?.phases || []).filter((p) => p.siteType === t);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {phases.status === 'loading' && <Card style={{ padding: 18 }}><Loading /></Card>}
      {phases.status === 'error' && <Card style={{ padding: 18 }}><ErrorState message={phases.message} onRetry={loadPhases} /></Card>}
      {phases.status === 'ready' && <><PhaseEditor siteType="non_mall" rows={bySite('non_mall')} onSaved={loadPhases} /><PhaseEditor siteType="mall" rows={bySite('mall')} onSaved={loadPhases} /></>}
      {lists.status === 'loading' && <Card style={{ padding: 18 }}><Loading /></Card>}
      {lists.status === 'error' && <Card style={{ padding: 18 }}><ErrorState message={lists.message} onRetry={loadLists} /></Card>}
      {lists.status === 'ready' && <ChecklistEditor items={lists.data.items || []} onSaved={loadLists} />}
    </div>
  );
}

export default function VendorsTab() {
  const [sub, setSub] = React.useState('vendors');
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text }}>Vendor platform</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: T.textMuted }}>Fit-out vendor companies, who can join them, and how their portal works.</p>
      </div>
      <SegmentedNav tabs={SUB_TABS} active={sub} onChange={setSub} />
      {sub === 'vendors' && <VendorsPanel />}
      {sub === 'approvals' && <ApprovalsPanel />}
      {sub === 'settings' && <SettingsPanel />}
      {sub === 'templates' && <TemplatesPanel />}
    </div>
  );
}

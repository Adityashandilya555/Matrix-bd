/**
 * LaunchApprovalTab — Business Admin portal tab for the post-NSO launch chain.
 *
 * Admin flow:
 *   1. Site appears here (status='pending') after NSO final approval.
 *   2. Admin opens the site, edits commercial fields, clicks "Approve".
 *   3. Once BD confirms (status='bd_confirmed'), shows "BD Verified ✓".
 *   4. Supervisor must approve (status='supervisor_approved').
 *   5. Admin does super-admin approval → Launch button unlocks.
 *   6. Admin clicks Launch → site.is_launched = true.
 */
import React from 'react';
import {
  T, Icon, Button, Card, SectionHeader, EmptyState, ErrorState, Skeleton,
  TABULAR, Drawer,
} from '../ui/kit.jsx';
import {
  getLaunchQueue, getLaunchApproval, saveLaunchFields,
  adminApproveLaunch, superAdminApproveLaunch, launchSite,
} from '../../../services/api/launchApprovalApi.js';

// ── Status display map ─────────────────────────────────────────────────────────
const STATUS_LABELS = {
  pending:             { label: 'Pending Admin Review', color: '#E09A3C' },
  admin_approved:      { label: 'Awaiting BD Confirmation', color: '#6C9FE6' },
  bd_confirmed:        { label: 'BD Verified ✓', color: '#4CAF82' },
  supervisor_approved: { label: 'Awaiting Super Admin', color: '#9B8AF2' },
  super_admin_approved:{ label: 'Ready to Launch', color: '#58E0A4' },
  launched:            { label: 'LAUNCHED 🚀', color: '#58E0A4' },
};

// ── Number formatter ──────────────────────────────────────────────────────────
const inr = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;
const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN');

// ── Editable field spec ───────────────────────────────────────────────────────
const FIELDS = [
  { key: 'rent_type',               label: 'Rent Type',                  type: 'select', options: ['fixed','revshare','mg_revshare'] },
  { key: 'fixed_rent_amt',          label: 'Fixed Rent (₹)',             type: 'number' },
  { key: 'expected_rent',           label: 'Expected Rent (₹)',          type: 'number' },
  { key: 'rev_share_pct',           label: 'Rev Share %',                type: 'number' },
  { key: 'escalation_pct',          label: 'Escalation %',               type: 'number' },
  { key: 'escalation_date',         label: 'Escalation Date',            type: 'date' },
  { key: 'expected_escalation_years', label: 'Escalation Every (yrs)',   type: 'number' },
  { key: 'cam_charges',             label: 'CAM Charges (₹)',            type: 'number' },
  { key: 'security_deposit',        label: 'Security Deposit (₹)',       type: 'number' },
  { key: 'brokerage',               label: 'Brokerage (₹)',              type: 'number' },
  { key: 'lock_in_months',          label: 'Lock-in (months)',           type: 'number' },
  { key: 'tenure_months',           label: 'Tenure (months)',            type: 'number' },
  { key: 'rent_free_days',          label: 'Rent-free Days',             type: 'number' },
  { key: 'carpet_area_sqft',        label: 'Carpet Area (sqft)',         type: 'number' },
  { key: 'estimated_monthly_sales', label: 'Est. Monthly Sales (₹)',     type: 'number' },
  { key: 'capex',                   label: 'CAPEX (₹)',                  type: 'number' },
  { key: 'score',                   label: 'Score',                      type: 'number' },
  { key: 'notes',                   label: 'Notes',                      type: 'textarea' },
];

// ── Field input ───────────────────────────────────────────────────────────────
function FieldInput({ spec, value, onChange, readOnly }) {
  const baseStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.line}`,
    background: readOnly ? T.bg : T.surface, color: T.text,
    fontFamily: 'var(--ac-font, system-ui)', fontSize: 13,
    boxSizing: 'border-box', outline: 'none',
    cursor: readOnly ? 'default' : 'text',
  };

  if (spec.type === 'select') {
    return (
      <select value={value ?? ''} disabled={readOnly} onChange={(e) => onChange(spec.key, e.target.value || null)}
        style={{ ...baseStyle }}>
        <option value="">—</option>
        {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (spec.type === 'textarea') {
    return (
      <textarea value={value ?? ''} readOnly={readOnly} rows={3}
        onChange={(e) => onChange(spec.key, e.target.value || null)}
        style={{ ...baseStyle, resize: 'vertical' }}/>
    );
  }
  if (spec.type === 'date') {
    return (
      <input type="date" value={value ?? ''} readOnly={readOnly}
        onChange={(e) => onChange(spec.key, e.target.value || null)}
        style={{ ...baseStyle }}/>
    );
  }
  return (
    <input type="number" step="any" value={value ?? ''} readOnly={readOnly}
      onChange={(e) => onChange(spec.key, e.target.value !== '' ? Number(e.target.value) : null)}
      style={{ ...baseStyle, ...TABULAR }}/>
  );
}

// ── Site detail drawer ─────────────────────────────────────────────────────────
function LaunchDetailDrawer({ siteId, onClose, onRefresh }) {
  const [data, setData] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await getLaunchApproval(siteId);
      setData(d);
      // Initialize form with current values
      const f = {};
      FIELDS.forEach(({ key }) => { f[key] = d[key] ?? null; });
      setForm(f);
    } catch (e) {
      setErr(e?.detail || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  React.useEffect(() => { if (siteId) load(); }, [load, siteId]);

  const handleFieldChange = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const d = await saveLaunchFields(siteId, form);
      setData(d);
    } catch (e) {
      setErr(e?.detail || e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action) => {
    setActing(true);
    setErr(null);
    try {
      let d;
      if (action === 'admin_approve') d = await adminApproveLaunch(siteId);
      else if (action === 'super_admin_approve') d = await superAdminApproveLaunch(siteId);
      else if (action === 'launch') d = await launchSite(siteId);
      setData(d);
      onRefresh();
    } catch (e) {
      setErr(e?.detail || e?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  const status = data?.status;
  const canEdit = status === 'pending' || status === 'admin_approved';
  const canAdminApprove = status === 'pending';
  const canSuperApprove = status === 'supervisor_approved';
  const canLaunch = status === 'super_admin_approved';

  const statusInfo = STATUS_LABELS[status] || { label: status, color: T.textMuted };

  return (
    <Drawer
      open={!!siteId}
      onClose={onClose}
      title={loading ? 'Loading…' : `${data?.site_code || ''} · ${data?.site_name || ''}`}
      subtitle={loading ? '' : data?.city}
      headerRight={
        data && (
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: statusInfo.color, background: `${statusInfo.color}22`, padding: '3px 10px', borderRadius: 20 }}>
            {statusInfo.label}
          </span>
        )
      }
      footer={
        data && !loading && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {canEdit && (
              <Button variant="subtle" loading={saving} onClick={handleSave}>
                Save Changes
              </Button>
            )}
            {canAdminApprove && (
              <Button variant="primary" loading={acting} onClick={() => handleAction('admin_approve')}>
                Approve & Send to BD
              </Button>
            )}
            {canSuperApprove && (
              <Button variant="primary" loading={acting} onClick={() => handleAction('super_admin_approve')}>
                Super Admin Approve
              </Button>
            )}
            {canLaunch && (
              <Button variant="success" loading={acting} onClick={() => handleAction('launch')}
                style={{ background: '#2EA86A', color: '#fff' }}>
                🚀 Launch Site
              </Button>
            )}
          </div>
        )
      }
    >
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 0' }}>
          {[1,2,3,4,5].map((i) => <Skeleton key={i} h={36}/>)}
        </div>
      )}

      {err && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(192,65,63,0.12)',
          border: '1px solid rgba(192,65,63,0.35)', color: '#F4A6A4', fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {data && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* Approval chain summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Admin Approved', ts: data.admin_approved_at, by: data.admin_approved_by_name },
              { label: 'BD Confirmed',   ts: data.bd_confirmed_at,   by: data.bd_confirmed_by_name },
              { label: 'Supervisor',     ts: data.supervisor_approved_at, by: data.supervisor_approved_by_name },
              { label: 'Super Admin',    ts: data.super_admin_approved_at, by: data.super_admin_approved_by_name },
            ].map(({ label, ts, by }) => (
              <div key={label} style={{ padding: '8px 12px', borderRadius: 8,
                background: ts ? 'rgba(46,168,106,0.10)' : T.bg,
                border: `1px solid ${ts ? 'rgba(46,168,106,0.3)' : T.line}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: ts ? '#4CAF82' : T.textFaint, marginBottom: 2 }}>
                  {ts ? '✓ ' : ''}{label}
                </div>
                <div style={{ fontSize: 12, color: T.textMuted }}>
                  {ts ? (by || '—') + ' · ' + new Date(ts).toLocaleDateString('en-IN') : 'Pending'}
                </div>
              </div>
            ))}
          </div>

          {/* Commercial fields */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: T.textMuted, marginBottom: 14 }}>
              Commercial Fields {canEdit && <span style={{ color: '#E09A3C' }}>· Editable</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {FIELDS.filter(f => f.type !== 'textarea').map((spec) => (
                <div key={spec.key}>
                  <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 4, fontWeight: 600 }}>{spec.label}</div>
                  <FieldInput spec={spec} value={form[spec.key]} onChange={handleFieldChange} readOnly={!canEdit}/>
                </div>
              ))}
            </div>
            {/* Notes spans full width */}
            {FIELDS.filter(f => f.type === 'textarea').map((spec) => (
              <div key={spec.key} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 4, fontWeight: 600 }}>{spec.label}</div>
                <FieldInput spec={spec} value={form[spec.key]} onChange={handleFieldChange} readOnly={!canEdit}/>
              </div>
            ))}
          </div>

          {status === 'launched' && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(46,168,106,0.12)',
              border: '1px solid rgba(46,168,106,0.35)', color: '#4CAF82', fontWeight: 700, fontSize: 14,
              textAlign: 'center' }}>
              🚀 Site launched on {data.launched_at ? new Date(data.launched_at).toLocaleDateString('en-IN') : '—'}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Queue row ──────────────────────────────────────────────────────────────────
function QueueRow({ item, onClick }) {
  const info = STATUS_LABELS[item.status] || { label: item.status, color: T.textMuted };
  return (
    <div onClick={onClick}
      style={{ display: 'grid', gridTemplateColumns: '0.7fr 1.4fr 0.8fr 1.4fr 1fr',
        gap: 12, padding: '13px 18px', borderBottom: `1px solid ${T.line}`,
        cursor: 'pointer', transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.hoverBg || 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: T.textMuted }}>{item.site_code || '—'}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.site_name}</span>
      <span style={{ fontSize: 13, color: T.textMuted }}>{item.city}</span>
      <span>
        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: info.color,
          background: `${info.color}22` }}>
          {info.label}
        </span>
      </span>
      <span style={{ fontSize: 11.5, color: T.textFaint, ...TABULAR }}>
        {item.updated_at ? new Date(item.updated_at).toLocaleDateString('en-IN') : '—'}
      </span>
    </div>
  );
}

// ── Main tab component ─────────────────────────────────────────────────────────
export default function LaunchApprovalTab() {
  const [queue, setQueue] = React.useState({ status: 'loading', items: [], error: null });
  const [selectedSiteId, setSelectedSiteId] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('all');

  const load = React.useCallback(async (silent = false) => {
    setQueue((s) => silent ? { ...s, refreshing: true } : { status: 'loading', items: [], error: null });
    try {
      const d = await getLaunchQueue();
      setQueue({ status: 'ready', items: d.items || [], error: null });
    } catch (e) {
      setQueue({ status: 'error', items: [], error: e?.detail || e?.message || 'Failed to load' });
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const STATUS_TABS = [
    { key: 'all',                label: 'All' },
    { key: 'pending',            label: 'Pending Review' },
    { key: 'admin_approved',     label: 'Awaiting BD' },
    { key: 'bd_confirmed',       label: 'BD Verified' },
    { key: 'supervisor_approved',label: 'Awaiting Super Admin' },
    { key: 'super_admin_approved',label: 'Ready to Launch' },
    { key: 'launched',           label: 'Launched' },
  ];

  const displayedItems = statusFilter === 'all'
    ? queue.items
    : queue.items.filter((i) => i.status === statusFilter);

  const pendingCount = queue.items.filter((i) => i.status === 'pending').length;
  const readyCount = queue.items.filter((i) => i.status === 'super_admin_approved').length;

  return (
    <div>
      <SectionHeader
        icon={Icon.flag}
        title="Launch Approvals"
        description="Post-NSO multi-step sign-off for site launches."
        count={pendingCount + readyCount}
        tone={readyCount > 0 ? 'success' : 'warn'}
        onRefresh={() => load(true)}
        refreshing={queue.refreshing}
      />

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18, marginTop: 14 }}>
        {STATUS_TABS.map(({ key, label }) => {
          const count = key === 'all' ? queue.items.length : queue.items.filter(i => i.status === key).length;
          const active = statusFilter === key;
          return (
            <button key={key} onClick={() => setStatusFilter(key)}
              style={{ padding: '5px 14px', borderRadius: 20, border: `1px solid ${active ? T.accent : T.line}`,
                background: active ? `${T.accent}22` : 'transparent', color: active ? T.accent : T.textMuted,
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}{count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      <Card>
        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '0.7fr 1.4fr 0.8fr 1.4fr 1fr',
          gap: 12, padding: '9px 18px', borderBottom: `1px solid ${T.line}`,
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: T.textFaint }}>
          <span>Code</span><span>Site</span><span>City</span><span>Status</span><span>Updated</span>
        </div>

        {queue.status === 'loading' && (
          <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <Skeleton key={i} h={40}/>)}
          </div>
        )}

        {queue.status === 'error' && (
          <div style={{ padding: 24 }}>
            <ErrorState message={queue.error} onRetry={() => load(false)}/>
          </div>
        )}

        {queue.status === 'ready' && displayedItems.length === 0 && (
          <div style={{ padding: '36px 24px' }}>
            <EmptyState icon={Icon.check} title="Nothing to show"
              hint={statusFilter === 'all' ? 'Sites will appear here after NSO final approval.' : 'No sites in this status.'}/>
          </div>
        )}

        {queue.status === 'ready' && displayedItems.map((item) => (
          <QueueRow key={item.site_id} item={item} onClick={() => setSelectedSiteId(item.site_id)}/>
        ))}
      </Card>

      <LaunchDetailDrawer
        siteId={selectedSiteId}
        onClose={() => setSelectedSiteId(null)}
        onRefresh={() => load(true)}
      />
    </div>
  );
}

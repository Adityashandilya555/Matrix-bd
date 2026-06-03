import React from 'react';
import { getAuthToken } from '../../services/api/authToken.js';
import { getSiteActivity, labelForEntry } from '../../services/api/audit.js';
import {
  approveFinanceApproval,
  approveSupervisor,
  getTenantAudit,
  listBusinessAdminSites,
  listFinanceApprovals,
  listPendingSupervisors,
  rejectSupervisor,
} from '../../services/api/adapters/httpAdapter.js';
import { getDesignAdminQueue, getDesignGfcQueue } from '../../services/api/designApi.js';
import { adminReviewProjectBudget, getProjectBudgetAdminQueue } from '../../services/api/projectApi.js';
import DeptCodeManager from './DeptCodeManager.jsx';
import DesignGfcQueue from './DesignGfcQueue.jsx';
import DesignDeliverableApprovals from './DesignDeliverableApprovals.jsx';
import { decodeJwtPayload } from './jwt.js';
import './TeamDashboard.css';

const MODULES = [
  { key: 'all', label: 'All' },
  { key: 'bd', label: 'BD' },
  { key: 'legal', label: 'Legal' },
  { key: 'payment', label: 'Finance / CA' },
  { key: 'design', label: 'Design' },
  { key: 'project', label: 'Project' },
];

const MODULE_LABEL = {
  bd: 'BD',
  legal: 'Legal',
  payment: 'Finance / CA',
  design: 'Design',
  project: 'Project',
};

const STATUS_LABEL = {
  draft_submitted: 'Pipeline created',
  shortlisted: 'Shortlisted',
  details_submitted: 'Details submitted',
  approved: 'Ready for LOI',
  loi_uploaded: 'LOI uploaded',
  legal_review: 'Legal review',
  legal_approved: 'Legal approved',
  legal_rejected: 'Legal rejected',
  pushed_to_payments: 'Payments handoff',
  rejected: 'Rejected',
  archived: 'Archived',
};

const ADMIN_SOURCE_LABELS = {
  supervisors: 'Supervisor requests',
  finance: 'Finance / CA approvals',
  sites: 'Site timeline',
  designAdmin: '2D / 3D design approvals',
  designGfc: 'GFC design approvals',
  projectBudget: 'Project budget approvals',
  audit: 'Tenant audit log',
};

const OPTIONAL_ADMIN_SOURCES = new Set(['sites', 'projectBudget', 'audit']);

function emptyQueue() {
  return { items: [], total: 0 };
}

function initialAdminState() {
  return {
    status: 'loading',
    supervisors: [],
    finance: [],
    sites: [],
    designAdmin: emptyQueue(),
    designGfc: emptyQueue(),
    projectBudget: emptyQueue(),
    audit: emptyQueue(),
    error: null,
    errors: [],
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function toQueue(value) {
  const items = toArray(value);
  const total = Number(value?.total);
  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
  };
}

function errorMessage(err) {
  if (!err) return 'Request failed.';
  return err.detail || err.message || String(err);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatShortDate(value) {
  const date = parseDate(value);
  if (!date) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function waitingAge(value) {
  const date = parseDate(value);
  if (!date) return 'New';
  const diff = Date.now() - date.getTime();
  const hours = Math.max(0, Math.floor(diff / 36e5));
  if (hours < 1) return 'Under 1h';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function money(value) {
  if (value == null || value === '') return 'Not set';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not set';
  return `₹${amount.toLocaleString('en-IN')}`;
}

function statusText(value) {
  if (!value) return 'Pending';
  return STATUS_LABEL[value] || String(value).replace(/_/g, ' ');
}

function iconFor(key) {
  const map = {
    approvals: '✓',
    supervisors: '👥',
    finance: '₹',
    design: '◇',
    project: '▣',
    blocked: '!',
    audit: '↺',
  };
  return map[key] || '•';
}

function normalizeStageStatus(status) {
  if (status === 'Done') return 'done';
  if (status === 'In review' || status === 'Waiting') return 'review';
  if (status === 'Blocked') return 'blocked';
  if (status === 'Rejected') return 'rejected';
  return 'waiting';
}

function buildTimeline(site) {
  if (!site) return [];
  const rejected = site.siteStatus === 'legal_rejected' || site.siteStatus === 'rejected';
  const legalDone = site.siteStatus === 'legal_approved' || site.siteStatus === 'pushed_to_payments' || site.legalDdStatus === 'positive';
  const agreementDone = ['signed', 'executed', 'registered'].includes(site.agreementStatus);
  const licensingDone = site.licensingStatus === 'complete';
  const financeStarted = site.financeStatus && site.financeStatus !== 'pending';
  const financeDone = site.financeStatus === 'approved';
  const designDone = site.designStatus === 'approved';
  const designReady = legalDone && financeDone;

  return [
    {
      key: 'pipeline',
      stage: 'Pipeline Created',
      team: 'BD',
      status: site.draftSubmittedAt || site.createdAt ? 'Done' : 'Waiting',
      sentAt: site.createdAt,
      approvedAt: site.draftSubmittedAt,
      owner: site.submittedByName,
      blocker: null,
    },
    {
      key: 'shortlist',
      stage: 'Shortlisted',
      team: 'BD supervisor',
      status: site.shortlistedAt ? 'Done' : site.siteStatus === 'draft_submitted' ? 'In review' : 'Waiting',
      sentAt: site.draftSubmittedAt,
      approvedAt: site.shortlistedAt,
      owner: site.supervisorName || 'BD supervisor',
      blocker: site.siteStatus === 'draft_submitted' ? 'Waiting for shortlist decision' : null,
    },
    {
      key: 'details',
      stage: 'Details Submitted',
      team: 'BD executive',
      status: site.detailsSubmittedAt ? 'Done' : site.siteStatus === 'shortlisted' ? 'In review' : 'Waiting',
      sentAt: site.shortlistedAt,
      approvedAt: site.detailsSubmittedAt,
      owner: site.assignedToName || site.submittedByName,
      blocker: site.siteStatus === 'shortlisted' ? 'Waiting for executive details' : null,
    },
    {
      key: 'loi',
      stage: 'LOI Uploaded',
      team: 'BD',
      status: site.loiUploadedAt ? 'Done' : site.siteStatus === 'approved' ? 'In review' : 'Waiting',
      sentAt: site.approvedAt,
      approvedAt: site.loiUploadedAt,
      owner: site.submittedByName,
      blocker: site.siteStatus === 'approved' ? 'Waiting for LOI upload' : null,
    },
    {
      key: 'legal-ddr',
      stage: 'Legal DDR',
      team: 'Legal',
      status: rejected ? 'Rejected' : legalDone ? 'Done' : site.siteStatus === 'legal_review' ? 'In review' : 'Waiting',
      sentAt: site.legalReviewAt,
      approvedAt: site.legalApprovedAt || site.legalRejectedAt,
      owner: 'Legal supervisor',
      blocker: rejected ? (site.rejectionReason || 'DDR rejected') : null,
    },
    {
      key: 'agreement',
      stage: 'Agreement',
      team: 'Legal',
      status: agreementDone ? 'Done' : legalDone ? 'In review' : 'Waiting',
      sentAt: site.legalApprovedAt,
      approvedAt: agreementDone ? site.updatedAt : null,
      owner: 'Legal supervisor',
      blocker: legalDone && !agreementDone ? 'Waiting for agreement execution' : 'Not reached yet',
    },
    {
      key: 'licensing',
      stage: 'Licensing',
      team: 'Legal',
      status: licensingDone ? 'Done' : agreementDone ? 'In review' : 'Waiting',
      sentAt: agreementDone ? site.updatedAt : null,
      approvedAt: licensingDone ? site.updatedAt : null,
      owner: 'Legal executive',
      blocker: agreementDone ? 'Waiting for licensing checklist' : 'Blocked by agreement',
    },
    {
      key: 'finance',
      stage: 'Finance / CA',
      team: 'Finance / CA',
      status: financeDone ? 'Done' : financeStarted || site.loiUploadedAt ? 'In review' : 'Waiting',
      sentAt: site.loiUploadedAt,
      approvedAt: site.pushedToPaymentsAt,
      owner: 'Finance supervisor',
      blocker: site.financeStatus === 'awaiting_admin'
        ? 'Waiting for business admin approval'
        : site.financeStatus === 'awaiting_supervisor'
          ? 'Waiting for supervisor approval'
          : site.loiUploadedAt ? 'Finance can start in parallel with Legal' : 'Waiting for LOI upload',
    },
    {
      key: 'design',
      stage: 'Design',
      team: 'Design',
      status: designDone ? 'Done' : designReady ? 'In review' : 'Blocked',
      sentAt: financeDone ? site.pushedToPaymentsAt : null,
      approvedAt: site.designApprovedAt,
      owner: 'Design supervisor',
      blocker: designReady
        ? 'Waiting for design package'
        : site.legalDdStatus !== 'positive'
          ? 'Waiting for positive DDR'
          : 'Waiting for Finance admin approval',
    },
    {
      key: 'project',
      stage: 'Project Execution',
      team: 'Project',
      status: site.projectStatus === 'done' ? 'Done' : designDone ? 'In review' : 'Waiting',
      sentAt: site.designApprovedAt,
      approvedAt: site.projectCompletedAt,
      owner: 'Project supervisor',
      blocker: designDone ? (site.projectBudgetStatus === 'pending_admin' ? 'Budget waiting for business admin approval' : 'Waiting for project allocation') : 'Not reached yet',
    },
    {
      key: 'final',
      stage: 'Final Approval',
      team: 'Business admin',
      status: 'Waiting',
      sentAt: null,
      approvedAt: null,
      owner: 'Business admin',
      blocker: 'Not reached yet',
    },
  ];
}

function primarySite(sites = [], financeApprovals = []) {
  const safeSites = toArray(sites);
  const safeFinance = toArray(financeApprovals);
  if (safeFinance[0]) {
    return safeSites.find((s) => s.siteId === safeFinance[0].siteId) || null;
  }
  return safeSites.find((s) => s.financeStatus === 'awaiting_admin')
    || safeSites.find((s) => s.siteStatus === 'legal_review')
    || safeSites.find((s) => s.designStatus === 'gfc_pending')
    || safeSites[0]
    || null;
}

function deriveDepartments({ sites, supervisors, financeApprovals, designAdmin, designGfc, projectBudget } = {}) {
  const safeSites = toArray(sites);
  const safeSupervisors = toArray(supervisors);
  const safeFinance = toArray(financeApprovals);
  const safeDesignAdmin = toQueue(designAdmin);
  const safeDesignGfc = toQueue(designGfc);
  const safeProjectBudget = toQueue(projectBudget);
  const siteCount = (predicate) => safeSites.filter(predicate).length;
  return [
    {
      key: 'bd',
      label: 'BD',
      pending: siteCount((s) => ['draft_submitted', 'details_submitted'].includes(s.siteStatus)),
      ready: siteCount((s) => ['shortlisted', 'approved', 'loi_uploaded'].includes(s.siteStatus)),
      blocked: siteCount((s) => ['rejected', 'archived'].includes(s.siteStatus)),
      latest: safeSites.find((s) => ['draft_submitted', 'details_submitted'].includes(s.siteStatus))?.siteName || 'No BD queue items',
    },
    {
      key: 'legal',
      label: 'Legal',
      pending: siteCount((s) => s.siteStatus === 'legal_review'),
      ready: siteCount((s) => s.siteStatus === 'legal_approved'),
      blocked: siteCount((s) => s.siteStatus === 'legal_rejected'),
      latest: safeSites.find((s) => s.siteStatus === 'legal_review')?.siteName || 'No legal review waiting',
    },
    {
      key: 'payment',
      label: 'Finance / CA',
      pending: safeFinance.length,
      ready: siteCount((s) => s.financeStatus === 'approved'),
      blocked: siteCount((s) => s.financeStatus === 'pending' && !s.loiUploadedAt),
      latest: safeFinance[0]?.siteName || 'No admin approvals waiting',
    },
    {
      key: 'design',
      label: 'Design',
      pending: safeDesignAdmin.total + safeDesignGfc.total,
      ready: siteCount((s) => s.designStatus === 'approved'),
      blocked: siteCount((s) => s.legalDdStatus === 'positive' && s.financeStatus !== 'approved'),
      latest: safeDesignGfc.items[0]?.siteName || safeDesignAdmin.items[0]?.siteName || 'No design handoff waiting',
    },
    {
      key: 'project',
      label: 'Project',
      pending: safeProjectBudget.total,
      ready: siteCount((s) => s.projectStatus === 'done'),
      blocked: 0,
      latest: safeProjectBudget.items[0]?.siteName || safeSites.find((s) => s.designStatus === 'approved')?.siteName || 'No project budget waiting',
    },
  ].map((dept) => ({
    ...dept,
    supervisorRequests: safeSupervisors.filter((s) => s.module === dept.key).length,
  }));
}

function KPI({ icon, label, value, hint, tone }) {
  return (
    <div className="ba-card ba-kpi">
      <span className={`ba-icon ${tone || ''}`}>{iconFor(icon)}</span>
      <div>
        <p className="ba-kpi-value">{String(value).padStart(2, '0')}</p>
        <div className="ba-kpi-label">{label}</div>
        <div className="ba-muted" style={{ fontSize: 12, lineHeight: 1.35 }}>{hint}</div>
      </div>
    </div>
  );
}

const ADMIN_NAV = [
  { key: 'overview', label: 'Overview', icon: '▦' },
  { key: 'approvals', label: 'Approval center', icon: '✓' },
  { key: 'timeline', label: 'Process timeline', icon: '↗' },
  { key: 'design', label: 'Design approvals', icon: '◇' },
  { key: 'project', label: 'Project budgets', icon: '▣' },
  { key: 'codes', label: 'Department codes', icon: '#' },
  { key: 'audit', label: 'Audit / History', icon: '↺' },
];

function AdminSidebar({ active, collapsed, counts, onSelect, onToggle, onLogout }) {
  return (
    <aside className={`ba-admin-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="ba-admin-brand">
        <span className="ba-admin-mark">S</span>
        {!collapsed && (
          <div>
            <div className="ba-label">Scale</div>
            <strong>Business admin</strong>
          </div>
        )}
        <button
          type="button"
          className="ba-sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand business admin sidebar' : 'Collapse business admin sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <nav className="ba-admin-nav" aria-label="Business admin sections">
        {ADMIN_NAV.map((item) => {
          const count = counts[item.key];
          return (
            <button
              key={item.key}
              type="button"
              className={`ba-admin-nav-item ${active === item.key ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              onClick={() => onSelect(item.key)}
            >
              <span className="ba-admin-nav-icon">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
              {count != null && count > 0 && <span className="ba-admin-nav-badge">{count}</span>}
            </button>
          );
        })}
      </nav>
      <button type="button" className="ba-admin-signout" onClick={onLogout} title={collapsed ? 'Sign out' : undefined}>
        <span className="ba-admin-nav-icon">⎋</span>
        {!collapsed && <span>Sign out</span>}
      </button>
    </aside>
  );
}

function ErrorBlock({ message, messages, onRetry }) {
  const details = toArray(messages);
  return (
    <div className="ba-error">
      <strong>{details.length ? 'Some admin data could not load.' : 'Unable to load approvals.'}</strong>
      <p style={{ margin: '6px 0 12px' }}>{message || 'Check backend connection or retry.'}</p>
      {details.length > 0 && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          {details.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      <button className="ba-button" type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}

function ApprovalCenter({ items, filter, onFilter, onOpen }) {
  const safeItems = toArray(items);
  const visible = filter === 'all' ? safeItems : safeItems.filter((item) => item.module === filter);
  return (
    <section className="ba-section">
      <div className="ba-section-head">
        <div>
          <div className="ba-label">Supervisor approval center</div>
          <h2 className="ba-section-title">Access requests by department</h2>
        </div>
      </div>
      <div className="ba-tabs">
        {MODULES.map((module) => {
          const count = module.key === 'all'
            ? safeItems.length
            : safeItems.filter((item) => item.module === module.key).length;
          return (
            <button
              key={module.key}
              type="button"
              className={`ba-tab ${filter === module.key ? 'active' : ''}`}
              onClick={() => onFilter(module.key)}
            >
              {module.label} <span className="ba-mono">{count}</span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <div className="ba-empty">No supervisor requests in this lane.</div>
      ) : (
        <div className="ba-list">
          {visible.map((item) => (
            <button key={item.id} className="ba-approval-row" type="button" onClick={() => onOpen({ type: 'supervisor', item })}>
              <div>
                <div className="ba-row">
                  <span className="ba-chip warning">Supervisor access</span>
                  <span className="ba-chip muted">{MODULE_LABEL[item.module] || item.module}</span>
                  <span className="ba-chip muted ba-mono">{waitingAge(item.createdAt)} waiting</span>
                </div>
                <div className="ba-row-title">{MODULE_LABEL[item.module] || item.module} supervisor request</div>
                <div className="ba-muted">
                  {item.email} · Sent {formatShortDate(item.createdAt)}
                </div>
              </div>
              <div className="ba-row-actions">
                <span className="ba-button">Review</span>
                <span className="ba-button">View history</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineBrowser({ sites, query, selectedSite, onQuery, onSelect, onOpen }) {
  const safeSites = toArray(sites);
  const q = query.trim().toLowerCase();
  const filtered = safeSites.filter((site) => {
    if (!q) return true;
    return [
      site.siteName,
      site.siteCode,
      site.caCode,
      site.city,
      statusText(site.siteStatus),
      site.financeStatus,
      site.designStatus,
    ].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  if (selectedSite) {
    return (
      <div>
        <div className="ba-timeline-toolbar">
          <button className="ba-button" type="button" onClick={() => onSelect(null)}>Back to sites</button>
          <span className="ba-chip success">Timeline selected</span>
        </div>
        <ProcessTimeline site={selectedSite} onOpen={onOpen}/>
      </div>
    );
  }

  return (
    <section className="ba-section">
      <div className="ba-section-head">
        <div>
          <div className="ba-label">Process timeline</div>
          <h2 className="ba-section-title">Choose a site to inspect the full flow</h2>
        </div>
        <span className="ba-chip muted">{filtered.length} sites</span>
      </div>
      <input
        className="ba-search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search by site, code, city or status..."
      />
      {filtered.length === 0 ? (
        <div className="ba-empty" style={{ marginTop: 12 }}>No sites match this search.</div>
      ) : (
        <div className="ba-site-list">
          {filtered.map((site) => (
            <button key={site.siteId} className="ba-site-row" type="button" onClick={() => onSelect(site.siteId)}>
              <div>
                <div className="ba-mono ba-muted">{site.siteCode || site.caCode || site.siteId}</div>
                <div className="ba-row-title">{site.siteName}</div>
                <div className="ba-muted">{site.city} · {statusText(site.siteStatus)}</div>
              </div>
              <div className="ba-site-row-meta">
                <span className={`ba-chip ${site.financeStatus === 'approved' ? 'success' : site.financeStatus === 'awaiting_admin' ? 'warning' : 'muted'}`}>
                  Finance: {site.financeStatus || 'pending'}
                </span>
                <span className={`ba-chip ${site.designStatus === 'approved' ? 'success' : site.designStatus ? 'warning' : 'muted'}`}>
                  Design: {site.designStatus || 'pending'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DepartmentQueues({ departments, onOpen }) {
  const safeDepartments = toArray(departments);
  return (
    <section className="ba-section">
      <div className="ba-section-head">
        <div>
          <div className="ba-label">Department approval queues</div>
          <h2 className="ba-section-title">Where work is waiting</h2>
        </div>
      </div>
      <div className="ba-dept-grid">
        {safeDepartments.map((dept) => (
          <button key={dept.key} className="ba-card ba-dept-card" type="button" onClick={() => onOpen({ type: 'department', item: dept })} style={{ textAlign: 'left', color: 'inherit', cursor: 'pointer' }}>
            <div className="ba-row" style={{ justifyContent: 'space-between' }}>
              <strong>{dept.label}</strong>
              <span className="ba-icon" style={{ width: 30, height: 30 }}>{dept.pending}</span>
            </div>
            <div className="ba-mini-grid" style={{ margin: '14px 0' }}>
              <span><span className="ba-label">Pending</span><br/><strong className="ba-mono">{dept.pending}</strong></span>
              <span><span className="ba-label">Ready</span><br/><strong className="ba-mono">{dept.ready}</strong></span>
              <span><span className="ba-label">Blocked</span><br/><strong className="ba-mono">{dept.blocked}</strong></span>
            </div>
            <div className="ba-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>Latest: {dept.latest}</div>
            {dept.supervisorRequests > 0 && (
              <div className="ba-chip warning" style={{ marginTop: 10 }}>{dept.supervisorRequests} supervisor request</div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function ProcessTimeline({ site, onOpen }) {
  const stages = buildTimeline(site);
  return (
    <section className="ba-section">
      <div className="ba-section-head">
        <div>
          <div className="ba-label">Full process timeline</div>
          <h2 className="ba-section-title">{site ? site.siteName : 'No active site selected'}</h2>
          {site && (
            <div className="ba-muted" style={{ marginTop: 5 }}>
              <span className="ba-mono">{site.siteCode || 'NO-CODE'}</span> · {site.city} · {statusText(site.siteStatus)}
            </div>
          )}
        </div>
        {site && <span className="ba-chip success">Tenant scoped</span>}
      </div>
      {!site ? (
        <div className="ba-empty">No site timeline is available yet.</div>
      ) : (
        <div className="ba-timeline">
          {stages.map((stage) => (
            <button key={stage.key} type="button" className={`ba-stage ${normalizeStageStatus(stage.status)}`} onClick={() => onOpen({ type: 'timeline', site, item: stage })}>
              <div>
                <div className="ba-label">{stage.team}</div>
                <strong>{stage.stage}</strong>
              </div>
              <div className="ba-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
                <div>Sent: {formatDate(stage.sentAt) || stage.blocker || 'Not reached yet'}</div>
                <div>Approved: {formatDate(stage.approvedAt) || (stage.status === 'Done' ? 'Recorded' : stage.blocker || 'Waiting for supervisor')}</div>
              </div>
              <span className={`ba-chip ${stage.status === 'Done' ? 'success' : stage.status === 'Rejected' || stage.status === 'Blocked' ? 'danger' : 'warning'}`}>
                {stage.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AuditSection({ audit, onOpen }) {
  const queue = toQueue(audit);
  return (
    <section className="ba-section">
      <div className="ba-section-head">
        <div>
          <div className="ba-label">Audit / History</div>
          <h2 className="ba-section-title">Recent tenant activity</h2>
        </div>
        <button className="ba-button" type="button" onClick={() => onOpen({ type: 'audit', item: { label: 'Tenant audit log' } })}>
          Open drawer
        </button>
      </div>
      {queue.items.length === 0 ? (
        <div className="ba-empty">No recent audit activity.</div>
      ) : (
        <div className="ba-history ba-history-list">
          {queue.items.slice(0, 18).map((entry) => (
            <div key={entry.id} className="ba-history-item">
              <strong>{labelForEntry(entry)}</strong>
              <div className="ba-muted" style={{ fontSize: 12 }}>
                {entry.actor} · {formatDate(entry.createdAt)}
              </div>
              {entry.detail && <div className="ba-muted" style={{ fontSize: 12, marginTop: 3 }}>{entry.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectBudgetApprovals({ queue, busy, onReview }) {
  const safeQueue = toQueue(queue);
  return (
    <section className="ba-section">
      <div className="ba-section-head">
        <div>
          <div className="ba-label">Project budget approvals</div>
          <h2 className="ba-section-title">Budgets waiting for admin decision</h2>
        </div>
        <span className="ba-chip muted">{safeQueue.total} pending</span>
      </div>
      {safeQueue.items.length === 0 ? (
        <div className="ba-empty">No project budgets are waiting for business-admin approval.</div>
      ) : (
        <div className="ba-list">
          {safeQueue.items.map((item) => (
            <article key={item.siteId} className="ba-approval-row">
              <div>
                <div className="ba-row">
                  <span className="ba-chip warning">Budget approval</span>
                  <span className="ba-chip muted ba-mono">{item.siteCode}</span>
                </div>
                <div className="ba-row-title">{item.siteName}</div>
                <div className="ba-muted">
                  {item.city} · {money(item.budgetTotal)} · {item.allocatedToName || 'Project owner not set'}
                </div>
              </div>
              <div className="ba-row-actions">
                <button
                  className="ba-button primary"
                  type="button"
                  disabled={busy}
                  onClick={() => onReview(item.siteId, 'approve')}
                >
                  Approve budget
                </button>
                <button
                  className="ba-button danger"
                  type="button"
                  disabled={busy}
                  onClick={() => onReview(item.siteId, 'reject')}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Drawer({ selection, history, busy, onClose, onApproveSupervisor, onRejectSupervisor, onApproveFinance }) {
  if (!selection) return null;
  const item = selection.item || {};
  const historyItems = toArray(history?.items);
  const isSupervisor = selection.type === 'supervisor';
  const isFinance = selection.type === 'finance';
  const isTimeline = selection.type === 'timeline';
  const title = isSupervisor
    ? `${MODULE_LABEL[item.module] || item.module || 'Module'} supervisor request`
    : isFinance
      ? item.siteName
      : isTimeline
        ? item.stage
        : item.label || 'Approval detail';
  const site = selection.site || item;
  return (
    <div className="ba-overlay" role="dialog" aria-modal="true">
      <aside className="ba-drawer">
        <div className="ba-drawer-head">
          <div>
            <div className="ba-label">Approval detail</div>
            <h2 style={{ margin: '6px 0 4px', fontSize: 24, letterSpacing: '-0.035em' }}>{title}</h2>
            <div className="ba-muted">
              {isSupervisor
                ? `${item.email || 'No email'} · ${MODULE_LABEL[item.module] || item.module || 'Module'}`
                : `${site?.siteCode || 'Workspace'} · ${site?.city || 'Tenant scope'}`}
            </div>
          </div>
          <button className="ba-button" type="button" onClick={onClose}>Close</button>
        </div>

        <div className="ba-grid">
          <div className="ba-card">
            <div className="ba-label">Current stage</div>
            <p style={{ margin: '8px 0 0', fontWeight: 800 }}>
              {isSupervisor ? 'Supervisor access review' : isTimeline ? item.status : statusText(site?.siteStatus)}
            </p>
          </div>
          <div className="ba-card">
            <div className="ba-label">Department owner</div>
            <p style={{ margin: '8px 0 0', fontWeight: 800 }}>
              {isSupervisor ? MODULE_LABEL[item.module] : isTimeline ? item.team : 'Finance / CA'}
            </p>
          </div>
          <div className="ba-card">
            <div className="ba-label">Current blocker</div>
            <p style={{ margin: '8px 0 0', color: 'rgba(248,250,247,0.78)' }}>
              {isTimeline ? item.blocker || 'No blocker recorded' : isFinance ? 'Waiting for business admin approval' : 'Waiting for admin decision'}
            </p>
          </div>
        </div>

        <div style={{ marginTop: 18 }} className="ba-card">
          <div className="ba-label">Approval trail</div>
          {history.status === 'loading' && <div className="ba-loading" style={{ marginTop: 12 }}>Loading history…</div>}
          {history.status === 'error' && <div className="ba-error" style={{ marginTop: 12 }}>{history.error}</div>}
          {history.status === 'ready' && historyItems.length === 0 && <div className="ba-empty" style={{ marginTop: 12 }}>No site history available for this item.</div>}
          {history.status === 'ready' && historyItems.length > 0 && (
            <div className="ba-history">
              {historyItems.slice(0, 10).map((entry) => (
                <div key={entry.id} className="ba-history-item">
                  <strong>{labelForEntry(entry)}</strong>
                  <div className="ba-muted" style={{ fontSize: 12 }}>
                    {entry.actor} · {formatDate(entry.createdAt)}
                  </div>
                  {entry.detail && <div className="ba-muted" style={{ fontSize: 12, marginTop: 3 }}>{entry.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ba-row" style={{ marginTop: 18 }}>
          {isSupervisor && (
            <>
              <button className="ba-button primary" type="button" disabled={busy} onClick={() => onApproveSupervisor(item)}>
                Approve
              </button>
              <button className="ba-button danger" type="button" disabled={busy} onClick={() => onRejectSupervisor(item)}>
                Reject
              </button>
            </>
          )}
          {isFinance && (
            <button className="ba-button primary" type="button" disabled={busy} onClick={() => onApproveFinance(item.siteId)}>
              Approve Finance / CA
            </button>
          )}
          {!isSupervisor && !isFinance && (
            <button className="ba-button primary" type="button" onClick={onClose}>Open module</button>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function TeamDashboard({ onLogout }) {
  const payload = decodeJwtPayload(getAuthToken());
  const company = payload.workspace_name || payload.tenant_name || payload.company || 'Workspace';
  const [state, setState] = React.useState(() => initialAdminState());
  const [filter, setFilter] = React.useState('all');
  const [activeSection, setActiveSection] = React.useState('overview');
  const [timelineQuery, setTimelineQuery] = React.useState('');
  const [timelineSiteId, setTimelineSiteId] = React.useState(null);
  const [selection, setSelection] = React.useState(null);
  const [history, setHistory] = React.useState({ status: 'idle', items: [], error: null });
  const [busy, setBusy] = React.useState(false);
  const [lastSync, setLastSync] = React.useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    try {
      return window.localStorage.getItem('matrix-business-admin-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const load = React.useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null, errors: [] }));
    const requests = [
      ['supervisors', listPendingSupervisors],
      ['finance', listFinanceApprovals],
      ['sites', () => listBusinessAdminSites(100)],
      ['designAdmin', getDesignAdminQueue],
      ['designGfc', getDesignGfcQueue],
      ['projectBudget', getProjectBudgetAdminQueue],
      ['audit', () => getTenantAudit(30)],
    ];
    const results = await Promise.allSettled(requests.map(([, request]) => request()));
    const next = initialAdminState();
    const errors = [];

    results.forEach((result, index) => {
      const [key] = requests[index];
      if (result.status === 'fulfilled') {
        if (['designAdmin', 'designGfc', 'projectBudget', 'audit'].includes(key)) {
          next[key] = toQueue(result.value);
        } else {
          next[key] = toArray(result.value);
        }
        return;
      }
      if (OPTIONAL_ADMIN_SOURCES.has(key)) {
        return;
      }
      errors.push(`${ADMIN_SOURCE_LABELS[key] || key}: ${errorMessage(result.reason)}`);
    });

    next.status = errors.length === requests.length ? 'error' : errors.length ? 'partial' : 'ready';
    next.errors = errors;
    next.error = errors.length
      ? `${errors.length} admin data source${errors.length === 1 ? '' : 's'} failed to load.`
      : null;
    setState(next);
    setLastSync(new Date());
  }, []);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem('matrix-business-admin-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {
      // Ignore persistence failures in private/restricted browser contexts.
    }
  }, [sidebarCollapsed]);

  React.useEffect(() => {
    if (!selection) return;
    const auditQueue = toQueue(state.audit);
    if (selection.type === 'audit') {
      setHistory({ status: 'ready', items: auditQueue.items, error: null });
      return;
    }
    const siteId = selection.site?.siteId || selection.item?.siteId;
    if (!siteId) {
      setHistory({ status: 'ready', items: [], error: null });
      return;
    }
    setHistory({ status: 'loading', items: [], error: null });
    getSiteActivity(siteId)
      .then((data) => setHistory({ status: 'ready', items: toArray(data), error: null }))
      .catch((err) => setHistory({ status: 'error', items: [], error: errorMessage(err) || 'Failed to load history' }));
  }, [selection, state.audit]);

  const refresh = () => load();
  const openAudit = () => {
    setSelection({ type: 'audit', item: { label: 'Tenant audit log' } });
  };

  const handleApproveSupervisor = async (item) => {
    setBusy(true);
    try {
      await approveSupervisor(item.id, item.module);
      setSelection(null);
      await load();
    } catch (err) {
      setHistory({ status: 'error', items: [], error: err?.detail || err?.message || 'Supervisor approval failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleRejectSupervisor = async (item) => {
    setBusy(true);
    try {
      await rejectSupervisor(item.id);
      setSelection(null);
      await load();
    } catch (err) {
      setHistory({ status: 'error', items: [], error: err?.detail || err?.message || 'Supervisor rejection failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveFinance = async (siteId) => {
    setBusy(true);
    try {
      await approveFinanceApproval(siteId);
      setSelection(null);
      await load();
    } catch (err) {
      setHistory({ status: 'error', items: [], error: err?.detail || err?.message || 'Finance approval failed' });
    } finally {
      setBusy(false);
    }
  };

  const supervisors = toArray(state.supervisors);
  const finance = toArray(state.finance);
  const sites = toArray(state.sites);
  const designAdmin = toQueue(state.designAdmin);
  const designGfc = toQueue(state.designGfc);
  const projectBudget = toQueue(state.projectBudget);
  const departments = deriveDepartments({ sites, supervisors, financeApprovals: finance, designAdmin, designGfc, projectBudget });
  const focusSite = primarySite(sites, finance);
  const selectedTimelineSite = timelineSiteId
    ? sites.find((site) => site.siteId === timelineSiteId) || null
    : null;
  const blockedSites = sites.filter((s) => ['legal_rejected', 'rejected', 'archived'].includes(s.siteStatus)).length;
  const pendingApprovalCount = supervisors.length + finance.length + designAdmin.total + designGfc.total + projectBudget.total;
  const adminCounts = {
    approvals: pendingApprovalCount,
    timeline: sites.length,
    design: designAdmin.total + designGfc.total,
    project: projectBudget.total,
    codes: 5,
    audit: toQueue(state.audit).total,
  };

  return (
    <div className={`ba-shell ${sidebarCollapsed ? 'admin-sidebar-collapsed' : ''}`}>
      <AdminSidebar
        active={activeSection}
        collapsed={sidebarCollapsed}
        counts={adminCounts}
        onSelect={setActiveSection}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onLogout={onLogout}
      />
      <main className="ba-page">
        <header className="ba-hero">
          <div>
            <div className="ba-eyebrow">Scale · Business admin · {company}</div>
            <h1 className="ba-title">Business Admin Command Center</h1>
            <p className="ba-subtitle">Approve cross-functional handoffs and keep store openings moving.</p>
            <div className="ba-pills">
              <span className="ba-pill">● Live</span>
              <span className="ba-pill">Tenant scope</span>
              <span className="ba-pill">Last synced {lastSync ? formatShortDate(lastSync) : 'not yet'}</span>
            </div>
          </div>
          <div className="ba-actions">
            <button className="ba-button" type="button" onClick={refresh}>Refresh</button>
            <button className="ba-button" type="button" onClick={openAudit}>View audit log</button>
          </div>
        </header>

        <div className="ba-grid kpis">
          <KPI icon="approvals" label="Pending approvals" value={pendingApprovalCount} hint="Supervisor, finance and design decisions"/>
          <KPI icon="supervisors" label="Supervisor requests" value={supervisors.length} hint="Workspace access awaiting review"/>
          <KPI icon="finance" label="Finance / CA approvals" value={finance.length} hint="Forwarded by module supervisors"/>
          <KPI icon="design" label="Design approvals" value={designAdmin.total + designGfc.total} hint="2D / 3D and GFC gates"/>
          <KPI icon="project" label="Project budget approvals" value={projectBudget.total} hint="Budget gates before execution"/>
          <KPI icon="blocked" label="Blocked sites" value={blockedSites} hint="Rejected or archived workflow items"/>
        </div>

        {(state.status === 'error' || state.status === 'partial') && (
          <ErrorBlock message={state.error} messages={state.errors} onRetry={refresh}/>
        )}
        {state.status === 'loading' && <div className="ba-loading">Loading command center…</div>}

        {state.status !== 'loading' && (
          <>
            {activeSection === 'overview' && (
              <>
                <div className="ba-main-grid">
                  <section className="ba-section">
                    <div className="ba-section-head">
                      <div>
                        <div className="ba-label">Priority handoff</div>
                        <h2 className="ba-section-title">{finance[0]?.siteName || focusSite?.siteName || 'No urgent handoff'}</h2>
                      </div>
                      <span className="ba-chip warning">{finance.length ? 'Finance waiting' : 'Stable'}</span>
                    </div>
                    {finance[0] ? (
                      <button className="ba-approval-row" type="button" onClick={() => setSelection({ type: 'finance', item: finance[0] })}>
                        <div>
                          <div className="ba-row">
                            <span className="ba-chip warning">Awaiting admin</span>
                            <span className="ba-chip muted ba-mono">{finance[0].caCode || finance[0].siteCode}</span>
                          </div>
                          <div className="ba-row-title">Approve CA / finance handoff</div>
                          <div className="ba-muted">{finance[0].city} · {money(finance[0].financeAmount)}</div>
                        </div>
                        <span className="ba-button primary">Review</span>
                      </button>
                    ) : (
                      <div className="ba-empty">No Finance / CA request is waiting for business-admin approval.</div>
                    )}
                  </section>
                  <section className="ba-section">
                    <div className="ba-section-head">
                      <div>
                        <div className="ba-label">Process timeline</div>
                        <h2 className="ba-section-title">{focusSite?.siteName || 'No active site selected'}</h2>
                      </div>
                      <button className="ba-button" type="button" onClick={() => setActiveSection('timeline')}>Open timeline</button>
                    </div>
                    {focusSite ? (
                      <div className="ba-empty">
                        <strong>{statusText(focusSite.siteStatus)}</strong>
                        <div className="ba-muted" style={{ marginTop: 6 }}>
                          Open the Process timeline section to inspect every stage for this site.
                        </div>
                      </div>
                    ) : (
                      <div className="ba-empty">No active site timeline is available yet.</div>
                    )}
                  </section>
                </div>
                <DepartmentQueues departments={departments} onOpen={setSelection}/>
              </>
            )}

            {activeSection === 'approvals' && (
              <ApprovalCenter items={supervisors} filter={filter} onFilter={setFilter} onOpen={setSelection}/>
            )}

            {activeSection === 'timeline' && (
              <TimelineBrowser
                sites={sites}
                query={timelineQuery}
                selectedSite={selectedTimelineSite}
                onQuery={setTimelineQuery}
                onSelect={setTimelineSiteId}
                onOpen={setSelection}
              />
            )}

            {activeSection === 'design' && (
              <section className="ba-section">
                <div className="ba-section-head">
                  <div>
                    <div className="ba-label">Live design approval workbench</div>
                    <h2 className="ba-section-title">Design handoffs that still need admin action</h2>
                  </div>
                </div>
                <div className="ba-main-grid">
                  <div>
                    <div className="ba-label" style={{ marginBottom: 10 }}>2D / 3D approvals</div>
                    <DesignDeliverableApprovals/>
                  </div>
                  <div>
                    <div className="ba-label" style={{ marginBottom: 10 }}>GFC approvals</div>
                    <DesignGfcQueue/>
                  </div>
                </div>
              </section>
            )}

            {activeSection === 'project' && (
              <ProjectBudgetApprovals
                queue={projectBudget}
                busy={busy}
                onReview={async (siteId, decision) => {
                  setBusy(true);
                  try {
                    await adminReviewProjectBudget(siteId, { decision, comments: decision === 'reject' ? 'Budget needs revision.' : null });
                    await load();
                  } catch (err) {
                    setState((prev) => ({
                      ...prev,
                      error: errorMessage(err),
                    }));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}

            {activeSection === 'codes' && (
              <section className="ba-section">
                <div className="ba-section-head">
                  <div>
                    <div className="ba-label">Access & routing codes</div>
                    <h2 className="ba-section-title">Department codes</h2>
                  </div>
                </div>
                <DeptCodeManager/>
              </section>
            )}

            {activeSection === 'audit' && (
              <AuditSection audit={state.audit} onOpen={setSelection}/>
            )}
          </>
        )}
      </main>

      <Drawer
        selection={selection}
        history={history}
        busy={busy}
        onClose={() => setSelection(null)}
        onApproveSupervisor={handleApproveSupervisor}
        onRejectSupervisor={handleRejectSupervisor}
        onApproveFinance={handleApproveFinance}
      />
    </div>
  );
}

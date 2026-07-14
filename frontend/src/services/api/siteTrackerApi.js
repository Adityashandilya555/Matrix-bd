// Site tracker API client — BD-facing read of the cross-module legal/agreement/
// licensing projection used by the per-site node-diagram view.
//
// Endpoints used:
//   GET /sites/{site_id}/tracker
//
// Schema: snake_case on the wire, camelCase on the React side. Mirrors the
// pattern in legalApi.js / changeRequestApi.js.

import { createApiClient } from './axiosClient.js';
import { adapter } from './adapters/index.js';
import { notifySiteDataChanged } from './siteEvents.js';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;

const client = createApiClient();

function trackerFromServer(row) {
  if (!row) return row;
  return {
    siteId:           row.site_id,
    siteCode:         row.site_code,
    siteName:         row.site_name,
    city:             row.city,
    siteStatus:       row.site_status,
    legalDdStatus:    row.legal_dd_status,
    agreementStatus:  row.agreement_status,
    licensingStatus:  row.licensing_status,
    designStatus:     row.design_status ?? 'pending',
    projectStatus:    row.project_status ?? null,
    projectCurrentStage: row.project_current_stage ?? null,
    projectBudgetStatus: row.project_budget_status ?? null,
    nsoStatus:        row.nso_status ?? null,
    nsoCurrentStage:  row.nso_current_stage ?? null,
    launchStatus:     row.launch_status ?? null,
    isLaunched:       Boolean(row.is_launched),
    launchedAt:       row.launched_at ?? null,
    dd:               row.dd        ? { ...row.dd } : null,
    agreement:        row.agreement ? { ...row.agreement } : null,
    licensing:        row.licensing ? { ...row.licensing } : null,
    submittedBy:      row.submitted_by,
    submittedByName:  row.submitted_by_name,
    // Finance sub-workflow
    kycVerified:      row.kyc_verified  ?? false,
    caCode:           row.ca_code       ?? null,
    financeAmount:    row.finance_amount ?? null,
    financeStatus:    row.finance_status ?? 'pending',
  };
}

function trackerFromMockSite(site) {
  if (!site) return site;
  return {
    siteId:           site.id,
    siteCode:         site.code || '',
    siteName:         site.name,
    city:             site.city,
    siteStatus:       site.status,
    legalDdStatus:    site.legalDdStatus || 'pending',
    agreementStatus:  site.agreementStatus || 'pending',
    licensingStatus:  site.licensingStatus || 'pending',
    designStatus:     site.designStatus || 'pending',
    projectStatus:    site.projectStatus || null,
    projectCurrentStage: site.projectCurrentStage || null,
    projectBudgetStatus: site.projectBudgetStatus || null,
    nsoStatus:        site.nsoStatus || null,
    nsoCurrentStage:  site.nsoCurrentStage || null,
    launchStatus:     site.launchStatus || null,
    isLaunched:       Boolean(site.isLaunched),
    launchedAt:       site.launchedAt || null,
    dd:               site.dd || null,
    agreement:        site.agreement || null,
    licensing:        site.licensing || null,
    submittedBy:      site.createdBy?.id || '',
    submittedByName:  site.createdBy?.name || site.createdBy || '',
    // Finance sub-workflow
    kycVerified:      site.kycVerified  ?? false,
    caCode:           site.caCode       ?? null,
    financeAmount:    site.financeAmount ?? null,
    financeStatus:    site.financeStatus ?? 'pending',
  };
}

export async function getSiteTrackerView(siteId) {
  if (USE_MOCK) {
    const site = await adapter.getSite(siteId);
    return trackerFromMockSite(site);
  }
  const data = await client.get(`/sites/${siteId}/tracker`).then((r) => r.data);
  return trackerFromServer(data);
}

// ── Read-only per-stage status detail (BD process-flow visibility) ─────────────
// Powers the "View status" popup and clickable pipeline nodes: sub-status for
// each downstream module (recce/2D/3D/BOQ, quality audit, licences) + a recent
// stage-events timeline. Visibility only — no action controls.

function stageStatusFromServer(row) {
  if (!row) return row;
  return {
    siteId:   row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city:     row.city,
    headline: row.headline,
    stages: (row.stages || []).map((s) => ({
      id:         s.id,
      title:      s.title,
      state:      s.state,
      stateLabel: s.state_label,
      note:       s.note ?? null,
      rows:       (s.rows || []).map((r) => ({ label: r.label, value: r.value, tone: r.tone })),
    })),
    timeline: (row.timeline || []).map((t) => ({
      eventType:  t.event_type,
      fromStatus: t.from_status,
      toStatus:   t.to_status,
      actorRole:  t.actor_role,
      actorName:  t.actor_name,
      occurredAt: t.occurred_at,
    })),
  };
}

// Minimal mock projection built from the tracker view — keeps mock-mode / tests
// working without a live backend.
function stageStatusFromTracker(t) {
  const row = (label, value) => ({ label, value: value || 'Pending', tone: 'neutral' });
  const block = (id, title, rows, note = null) => ({ id, title, state: 'future', stateLabel: 'QUEUED', rows, note });
  return {
    siteId: t.siteId, siteCode: t.siteCode, siteName: t.siteName, city: t.city,
    headline: 'Stage status',
    stages: [
      block('loi', 'BD LOI Signed', [row('LOI', 'Signed')]),
      block('legal', 'Legal & Compliance', [
        row('Due-diligence verdict', t.legalDdStatus),
        row('Agreement', t.agreementStatus),
        row('Licensing', t.licensingStatus),
      ]),
      block('ca', 'CA / Commercial Code', [
        row('CA / commercial code', t.caCode || 'Not set'),
        row('Finance approval', t.financeStatus),
      ]),
      block('design', 'Design / Technical', [row('Design', t.designStatus)]),
      block('project', 'Project Execution', [row('Project status', t.projectStatus)]),
      block('nso', 'NSO', [row('NSO status', t.nsoStatus)]),
      block('launch', 'Site Launched', [row('Launch', t.launchStatus)]),
    ],
    timeline: [],
  };
}

export async function getSiteStageStatus(siteId) {
  if (USE_MOCK) {
    const site = await adapter.getSite(siteId);
    return stageStatusFromTracker(trackerFromMockSite(site));
  }
  const data = await client.get(`/sites/${siteId}/stage-status`).then((r) => r.data);
  return stageStatusFromServer(data);
}

// ── Finance actions ───────────────────────────────────────────────────────────

export async function saveFinanceDraft(siteId, { kycVerified, caCode, financeAmount } = {}) {
  if (USE_MOCK) {
    const result = await adapter.saveFinanceDraft(siteId, { kycVerified, caCode, financeAmount });
    notifySiteDataChanged({ source: 'siteTrackerApi', action: 'save_finance', siteId });
    return result;
  }
  const body = {};
  if (kycVerified !== undefined) body.kyc_verified = kycVerified;
  if (caCode !== undefined) body.ca_code = caCode;
  if (financeAmount !== undefined) body.finance_amount = financeAmount;
  const data = await client.patch(`/sites/${siteId}/finance`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'siteTrackerApi', action: 'save_finance', siteId });
  return data;
}

export async function requestFinanceApproval(siteId, { kycVerified, caCode, financeAmount } = {}) {
  if (USE_MOCK) {
    const result = await adapter.requestFinanceApproval(siteId, { kycVerified, caCode, financeAmount });
    notifySiteDataChanged({ source: 'siteTrackerApi', action: 'request_finance', siteId });
    return result;
  }
  const body = {};
  if (kycVerified !== undefined) body.kyc_verified = kycVerified;
  if (caCode !== undefined) body.ca_code = caCode;
  if (financeAmount !== undefined) body.finance_amount = financeAmount;
  const data = await client.post(`/sites/${siteId}/finance/request-approval`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'siteTrackerApi', action: 'request_finance', siteId });
  return data;
}

export async function approveFinance(siteId) {
  if (USE_MOCK) {
    const result = await adapter.approveFinance(siteId);
    notifySiteDataChanged({ source: 'siteTrackerApi', action: 'approve_finance', siteId });
    return result;
  }
  const data = await client.post(`/sites/${siteId}/finance/approve`, {}).then((r) => r.data);
  notifySiteDataChanged({ source: 'siteTrackerApi', action: 'approve_finance', siteId });
  return data;
}

export async function rejectFinance(siteId, reason) {
  if (USE_MOCK) {
    const result = await adapter.rejectFinance?.(siteId, reason);
    notifySiteDataChanged({ source: 'siteTrackerApi', action: 'reject_finance', siteId });
    return result;
  }
  const body = reason ? { reason } : {};
  const data = await client.post(`/sites/${siteId}/finance/reject`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'siteTrackerApi', action: 'reject_finance', siteId });
  return data;
}

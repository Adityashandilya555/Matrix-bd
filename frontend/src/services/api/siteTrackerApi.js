// Site tracker API client — BD-facing read of the cross-module legal/agreement/
// licensing projection used by the per-site node-diagram view.
//
// Endpoints used:
//   GET /sites/{site_id}/tracker
//
// Schema: snake_case on the wire, camelCase on the React side. Mirrors the
// pattern in legalApi.js / changeRequestApi.js.

import axios from 'axios';
import { getAuthToken, notifySessionExpired } from './authToken.js';
import { ApiError, ensureFreshAuthToken } from './adapters/httpAdapter.js';
import { adapter } from './adapters/index.js';
import { notifySiteDataChanged } from './siteEvents.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

client.interceptors.request.use(async (cfg) => {
  const token = await ensureFreshAuthToken() || getAuthToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.code === 'ECONNABORTED') {
      throw new ApiError({ status: 0, code: 'TIMEOUT', detail: 'Request timed out', cause: err });
    }
    const status = err.response?.status ?? 0;
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    if (status === 401) notifySessionExpired({ reason: 'unauthorized', detail });
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

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

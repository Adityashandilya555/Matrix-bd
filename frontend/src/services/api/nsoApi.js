import axios from 'axios';
import { getAuthToken, notifySessionExpired } from './authToken.js';
import { ApiError, ensureFreshAuthToken, requestCarriedToken } from './adapters/httpAdapter.js';
import { notifySiteDataChanged } from './siteEvents.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);

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
    const raw = err.response?.data?.detail || err.message || 'Request failed';
    const detail = status === 0 && raw === 'Network Error'
      ? `Network Error contacting API at ${BASE_URL}. Check backend deployment, CORS, and migration status.`
      : raw;
    if (status === 401 && requestCarriedToken(err.config)) notifySessionExpired({ reason: 'unauthorized', detail });
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

function triggerFromServer(row) {
  return {
    key: row.key,
    label: row.label,
    unlocked: Boolean(row.unlocked),
    complete: Boolean(row.complete),
    reason: row.reason,
  };
}

function queueItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    financeStatus: row.finance_status,
    caCode: row.ca_code,
    projectStatus: row.project_status,
    projectCurrentStage: row.project_current_stage,
    nsoStatus: row.nso_status,
    currentStage: row.current_stage,
    nextAction: row.next_action,
    updatedAt: row.updated_at,
  };
}

function propertySnapshotFromServer(row = {}) {
  return {
    siteName: row.site_name,
    siteCode: row.site_code,
    city: row.city,
    visitDate: row.visit_date,
    model: row.model,
    googleMapsPin: row.google_maps_pin,
    googleMapsUrl: row.google_maps_url,
    caCode: row.ca_code,
    financeAmount: row.finance_amount,
    kycVerified: Boolean(row.kyc_verified),
    rentType: row.rent_type,
    expectedRent: row.expected_rent,
    expectedRevsharePct: row.expected_revshare_pct,
    expectedEscalationPct: row.expected_escalation_pct,
    expectedEscalationYears: row.expected_escalation_years,
    score: row.score,
    estimatedMonthlySales: row.estimated_monthly_sales,
    carpetAreaSqft: row.carpet_area_sqft,
    camCharges: row.cam_charges,
    securityDeposit: row.security_deposit,
    brokerage: row.brokerage,
    lockInMonths: row.lock_in_months,
    tenureMonths: row.tenure_months,
    rentFreeDays: row.rent_free_days,
    nearestStarbucksM: row.nearest_starbucks_m,
    nearestTwcM: row.nearest_twc_m,
  };
}

function legalLicensingSnapshotFromServer(row = {}) {
  return {
    overallStatus: row.overall_status || 'pending',
    stage: row.stage || null,
    complete: Boolean(row.complete),
    fssai: row.fssai || 'pending',
    healthTrade: row.health_trade || 'pending',
    shopsEstabReg: row.shops_estab_reg || 'pending',
    fireNoc: row.fire_noc || 'pending',
    storageLicense: row.storage_license || 'pending',
  };
}

function stateFromServer(row) {
  if (!row) return row;
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    tenantId: row.tenant_id,
    submittedByName: row.submitted_by_name,
    siteStatus: row.site_status,
    financeStatus: row.finance_status,
    caCode: row.ca_code,
    projectStatus: row.project_status,
    projectCurrentStage: row.project_current_stage,
    projectInitializationDate: row.project_initialization_date,
    projectInitializationStatus: row.project_initialization_status,
    projectFinalCompletionDate: row.project_final_completion_date,
    projectCompletedAt: row.project_completed_at,
    nsoStatus: row.nso_status,
    currentStage: row.current_stage,
    triggers: (row.triggers || []).map(triggerFromServer),
    propertySnapshot: propertySnapshotFromServer(row.property_snapshot || {}),
    legalLicensingSnapshot: legalLicensingSnapshotFromServer(row.legal_licensing_snapshot || {}),
    propertyDetails: row.property_details,
    communicationFloated: row.communication_floated,
    fssaiStatus: row.fssai_status,
    healthTradeStatus: row.health_trade_status,
    shopsEstabStatus: row.shops_estab_status,
    fireNocStatus: row.fire_noc_status,
    storageLicenseStatus: row.storage_license_status,
    dryStockOrderStatus: row.dry_stock_order_status,
    onlineDeliveryStatus: row.online_delivery_status,
    handoverChecklistSigned: row.handover_checklist_signed,
    launchDate: row.launch_date,
    launchReady: row.launch_ready,
    finalApprovalSignoff1: row.final_approval_signoff_1,
    finalApprovalSignoff2: row.final_approval_signoff_2,
    stageOneCompletedAt: row.stage_one_completed_at,
    stageTwoCompletedAt: row.stage_two_completed_at,
    stageThreeCompletedAt: row.stage_three_completed_at,
    finalApprovedAt: row.final_approved_at,
    updatedAt: row.updated_at,
    isLaunched: Boolean(row.is_launched),
    launchedAt: row.launched_at,
  };
}

export async function getNsoQueue() {
  const data = await client.get('/nso/queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function listNsoHistory(statusFilter = 'all') {
  const data = await client.get('/nso/history', { params: { status_filter: statusFilter } }).then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function getNso(siteId) {
  const data = await client.get(`/nso/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function getNsoHistoryDetail(siteId) {
  const data = await client.get(`/nso/history/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function saveNsoStageOne(siteId, { propertyDetails, communicationFloated }) {
  const body = { communication_floated: communicationFloated };
  if (propertyDetails) body.property_details = propertyDetails;
  const data = await client.post(`/nso/${siteId}/stage-one`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'nso', action: 'stage_one_save', siteId });
  return stateFromServer(data);
}

export async function saveNsoStageTwo(siteId, fields) {
  const data = await client.post(`/nso/${siteId}/stage-two`, {
    fssai_status: fields.fssaiStatus,
    health_trade_status: fields.healthTradeStatus,
    shops_estab_status: fields.shopsEstabStatus,
    fire_noc_status: fields.fireNocStatus,
    storage_license_status: fields.storageLicenseStatus,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'nso', action: 'stage_two_save', siteId });
  return stateFromServer(data);
}

export async function saveNsoStageThree(siteId, fields) {
  const data = await client.post(`/nso/${siteId}/stage-three`, {
    dry_stock_order_status: fields.dryStockOrderStatus,
    online_delivery_status: fields.onlineDeliveryStatus,
    handover_checklist_signed: fields.handoverChecklistSigned,
    launch_date: fields.launchDate,
    launch_ready: fields.launchReady,
    final_approval_signoff_1: fields.finalApprovalSignoff1,
    final_approval_signoff_2: fields.finalApprovalSignoff2,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'nso', action: 'stage_three_save', siteId });
  return stateFromServer(data);
}

export async function finalApproveNso(siteId) {
  const data = await client.post(`/nso/${siteId}/final-approval`, {}).then((r) => r.data);
  notifySiteDataChanged({ source: 'nso', action: 'final_approval', siteId });
  return stateFromServer(data);
}

// Site tracker API client — BD-facing read of the cross-module legal/agreement/
// licensing projection used by the per-site node-diagram view.
//
// Endpoints used:
//   GET /sites/{site_id}/tracker
//
// Schema: snake_case on the wire, camelCase on the React side. Mirrors the
// pattern in legalApi.js / changeRequestApi.js.

import axios from 'axios';
import { getAuthToken, clearAuthToken } from './authToken.js';
import { ApiError } from './adapters/httpAdapter.js';
import { adapter } from './adapters/index.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

client.interceptors.request.use((cfg) => {
  const token = getAuthToken();
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
    if (status === 401) clearAuthToken();
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
    dd:               row.dd        ? { ...row.dd } : null,
    agreement:        row.agreement ? { ...row.agreement } : null,
    licensing:        row.licensing ? { ...row.licensing } : null,
    submittedBy:      row.submitted_by,
    submittedByName:  row.submitted_by_name,
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
    dd:               site.dd || null,
    agreement:        site.agreement || null,
    licensing:        site.licensing || null,
    submittedBy:      site.createdBy?.id || '',
    submittedByName:  site.createdBy?.name || site.createdBy || '',
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

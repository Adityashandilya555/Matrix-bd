// skipcq: JS-0833
import axios from 'axios';
import { getAuthToken, setAuthToken, notifySessionExpired } from './authToken.js';
import { ApiError, ensureFreshAuthToken, requestCarriedToken } from './adapters/httpAdapter.js';
import { getActiveOverride } from './adminOverride.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);
export const UPLOAD_TIMEOUT_MS = Number(import.meta.env.VITE_API_UPLOAD_TIMEOUT_MS ?? 120000);

function isBootstrapAuthRequest(config) {
  const url = config?.url || '';
  return url.endsWith('/auth/whoami') || url.endsWith('/auth/refresh');
}

let refreshPromise = null;

async function refreshBearerToken() {
  const token = getAuthToken();
  if (!token) return null;
  if (!refreshPromise) {
    refreshPromise = axios.post(
      `${BASE_URL}/auth/refresh`,
      {},
      { timeout: TIMEOUT_MS, headers: { Authorization: `Bearer ${token}` } },
    )
      .then((res) => {
        const next = res.data?.access_token;
        if (next) setAuthToken(next);
        return next || null;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export function createApiClient() {
  const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

  client.interceptors.request.use(async (cfg) => {
    const token = await ensureFreshAuthToken() || getAuthToken();
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    const override = getActiveOverride();
    if (override?.role) cfg.headers['X-Override-Role'] = override.role;
    if (override?.module) cfg.headers['X-Override-Module'] = override.module;
    return cfg;
  });

  client.interceptors.response.use(
    (r) => r,
    async (err) => {
      if (err.code === 'ECONNABORTED') {
        throw new ApiError({ status: 0, code: 'TIMEOUT', detail: 'Request timed out', cause: err });
      }
      const status = err.response?.status ?? 0;
      const rawDetail = err.response?.data?.detail;
      const parsedDetail = Array.isArray(rawDetail)
        ? rawDetail.map((item) => item?.msg || item?.message || JSON.stringify(item)).join('; ')
        : rawDetail && typeof rawDetail === 'object'
          ? rawDetail.message || rawDetail.detail || JSON.stringify(rawDetail)
          : rawDetail || err.message || 'Request failed';
      const detail = status === 0 && parsedDetail === 'Network Error'
        ? `Network Error contacting API at ${BASE_URL}. Check backend deployment, CORS (Railway CORS_ORIGINS must include this site's domain), and that the backend is running.`
        : parsedDetail;

      const tokenWasSent = requestCarriedToken(err.config);
      if (status === 401 && tokenWasSent && !err.config?._retriedAfterRefresh) {
        try {
          const newToken = await refreshBearerToken();
          if (newToken) {
            const retryConfig = {
              ...err.config,
              _retriedAfterRefresh: true,
              headers: { ...(err.config?.headers || {}), Authorization: `Bearer ${newToken}` },
            };
            return client.request(retryConfig);
          }
        } catch (refreshErr) {
          if (!isBootstrapAuthRequest(err.config)) {
            notifySessionExpired({ reason: 'unauthorized', error: refreshErr });
          }
        }
      }
      if (status === 401 && tokenWasSent && !isBootstrapAuthRequest(err.config)) {
        notifySessionExpired({ reason: 'unauthorized', detail });
      }
      throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
    },
  );

  return client;
}

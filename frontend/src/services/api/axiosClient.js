import axios from 'axios';
import { getAuthToken, notifySessionExpired } from './authToken.js';
import { ApiError, ensureFreshAuthToken, requestCarriedToken } from './adapters/httpAdapter.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);
export const UPLOAD_TIMEOUT_MS = Number(import.meta.env.VITE_API_UPLOAD_TIMEOUT_MS ?? 120000);

export function createApiClient() {
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
        ? `Network Error contacting API at ${BASE_URL}. Check backend deployment, CORS (Railway CORS_ORIGINS must include this site's domain), and that the backend is running.`
        : raw;
      if (status === 401 && requestCarriedToken(err.config)) notifySessionExpired({ reason: 'unauthorized', detail });
      throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
    },
  );

  return client;
}

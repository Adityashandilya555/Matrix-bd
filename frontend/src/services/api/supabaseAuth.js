// Sign-in client.
//
// The platform issues its own JWTs from POST /api/auth/login. The "Supabase"
// in the filename is historical — we deliberately don't depend on the
// supabase-js SDK anymore. The function name `signInWithPassword` is kept
// for callers, but the second argument is the WORKSPACE CODE, not a password.
//
// Auth flow:
//   1. UI calls signInWithWorkspaceCode(email, code)
//   2. Backend validates → either 200 + access_token, or 202 "pending"
//   3. On 200 → we stash the token in authToken.js → HTTP adapter attaches
//      it on every subsequent request via the Authorization header.
//   4. On 202 → we throw a recognisable PendingApprovalError so the UI can
//      render a "your supervisor needs to assign you a role" message.

import axios from 'axios';
import { clearAuthToken, setAuthToken } from './authToken.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';

export class PendingApprovalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PendingApprovalError';
    this.isPending = true;
  }
}

export async function signInWithWorkspaceCode(email, workspaceCode) {
  let res;
  try {
    res = await axios.post(`${API_BASE}/auth/login`, {
      email,
      workspace_code: workspaceCode,
    }, {
      // 202 is a success-shaped response (the user is in the queue) — don't
      // let axios throw on it.
      validateStatus: (s) => s === 200 || s === 202,
    });
  } catch (err) {
    const detail = err.response?.data?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      : detail || err.message || 'Sign-in failed';
    throw new Error(message);
  }

  if (res.status === 202) {
    throw new PendingApprovalError(
      res.data?.message ||
      "You're in the queue — your supervisor needs to assign you a role.",
    );
  }

  const token = res.data?.access_token;
  if (!token) throw new Error('Server did not return an access token.');
  setAuthToken(token);
  return res.data;
}

// Back-compat alias for any caller that still imports the old name.
export const signInWithPassword = signInWithWorkspaceCode;

// Self-service join requests. Backend returns 202 + { message } when the
// request is queued for review (the typical happy path) and a 4xx with a
// detail payload when validation fails. We surface the queued case as a
// PendingApprovalError so callers can render warm "we're on it" messaging
// instead of an alarming red banner.
async function postSignup(path, body) {
  let res;
  try {
    res = await axios.post(`${API_BASE}${path}`, body, {
      validateStatus: (s) => s === 200 || s === 202,
    });
  } catch (err) {
    const detail = err.response?.data?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      : detail || err.message || 'Signup failed';
    throw new Error(message);
  }
  if (res.status === 202) {
    throw new PendingApprovalError(res.data?.message || 'Request submitted.');
  }
  return res.data;
}

export function signupAsSupervisor(email, deptCode) {
  return postSignup('/auth/signup/supervisor', { email, dept_code: deptCode });
}

export function signupAsExecutive(email, supervisorCode) {
  return postSignup('/auth/signup/executive', { email, supervisor_code: supervisorCode });
}

export async function signOut() {
  try {
    await axios.post(`${API_BASE}/auth/logout`);
  } catch { /* ignore — courtesy call */ }
  clearAuthToken();
}

// configureSupabase is now a no-op kept for main.jsx backwards-compat.
// Remove the call from main.jsx in a follow-up cleanup.
export function configureSupabase(_unusedClient) { /* noop */ }

export function getSupabase() {
  throw new Error('Supabase SDK is no longer used. Call signInWithWorkspaceCode().');
}

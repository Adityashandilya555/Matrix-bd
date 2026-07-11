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

// Wrong password on an account that has one set. The branded login page uses
// this to reveal the "Request password reset" affordance after a failed try.
export class InvalidCredentialsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidCredentialsError';
    this.isInvalidCredentials = true;
  }
}

function _detailMessage(err, fallback) {
  const detail = err.response?.data?.detail;
  return Array.isArray(detail)
    ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
    : detail || err.message || fallback;
}

export async function signInWithWorkspaceCode(email, workspaceCode, password) {
  let res;
  try {
    res = await axios.post(`${API_BASE}/auth/login`, {
      email,
      workspace_code: workspaceCode,
      // Only send a password when the branded page collected one; legacy
      // passwordless callers omit it and stay backward-compatible.
      ...(password != null && password !== '' ? { password } : {}),
    }, {
      // 202 is a success-shaped response (the user is in the queue) — don't
      // let axios throw on it.
      validateStatus: (s) => s === 200 || s === 202,
    });
  } catch (err) {
    const message = _detailMessage(err, 'Sign-in failed');
    if (err.response?.status === 401) throw new InvalidCredentialsError(message);
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

// ── Branded login helpers ───────────────────────────────────────────────────

// Does (email, workspace_code) already have a password? Drives the choice
// between "set a password" (with confirm) and "enter your password".
export async function checkPasswordSet(email, workspaceCode) {
  const res = await axios.post(`${API_BASE}/auth/login/check`, {
    email, workspace_code: workspaceCode,
  }, { headers: { 'X-Matrix-Internal': '1' } });
  return Boolean(res.data?.password_set);
}

// Account state for (email, workspace_code), used to route the email step:
//   'unknown'        → not a member of this workspace (show an error)
//   'pending'        → approved-by-admin not granted yet
//   'needs_password' → approved but no password → self-service setup
//   'active'         → has a password → ask for it
// Falls back to deriving from `password_set` for older backends.
export async function checkAccountState(email, workspaceCode) {
  const res = await axios.post(`${API_BASE}/auth/login/check`, {
    email, workspace_code: workspaceCode,
  }, { headers: { 'X-Matrix-Internal': '1' } });

  if (res.data?.account_state === 'checked') {
    return 'active';
  }

  return res.data?.account_state
    || (res.data?.password_set ? 'active' : 'needs_password');
}

// First-time, self-service password for an approved account that has none yet
// (post-approval onboarding). No reset code — the account was already approved
// by an admin. Surfaces the server's `detail` on error (e.g. "already has a
// password", "pending approval", "not registered in this workspace").
export async function setupPassword(email, workspaceCode, newPassword) {
  let res;
  try {
    res = await axios.post(`${API_BASE}/auth/password-setup`, {
      email, workspace_code: workspaceCode, new_password: newPassword,
    });
  } catch (err) {
    throw new Error(_detailMessage(err, 'Could not set your password'));
  }
  return res.data;
}

// First wrong attempt → route a reset request to the platform admin.
export async function requestPasswordReset(email, workspaceCode) {
  const res = await axios.post(`${API_BASE}/auth/password-reset/request`, {
    email, workspace_code: workspaceCode,
  });
  return res.data;
}

// After the platform admin approves, the user sets a new password here.
// `resetToken` is the single-use code the admin relays out-of-band at
// approval — completion is bound to it (#85), (email, workspace_code) alone
// can no longer overwrite a password.
export async function completePasswordReset(email, workspaceCode, newPassword, resetToken) {
  let res;
  try {
    res = await axios.post(`${API_BASE}/auth/password-reset/complete`, {
      email, workspace_code: workspaceCode, new_password: newPassword,
      reset_token: resetToken,
    });
  } catch (err) {
    throw new Error(_detailMessage(err, 'Password reset failed'));
  }
  return res.data;
}

// Public branding for a workspace code → { name, logo_url }. Used by the
// workspace-code dialog (to validate the code) and the branded login page.
export async function getWorkspaceBranding(workspaceCode) {
  const res = await axios.get(`${API_BASE}/tenancy/branding`, {
    params: { code: workspaceCode },
  });
  return res.data;
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

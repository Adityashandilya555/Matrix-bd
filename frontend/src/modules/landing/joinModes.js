// skipcq: JS-0833
// The three ways to request access to an existing workspace.
//
// Both join forms (the marketing landing and the branded login) rendered this
// as a pair of ternaries on `joinMode === 'supervisor'` in five places each,
// which is why the observer route shipped with a backend endpoint, an API
// helper and no way to reach either. A table means adding a fourth way is one
// entry rather than ten ternaries, and the two pages cannot drift apart.
import {
  signupAsSupervisor,
  signupAsExecutive,
  signupAsObserver,
  signupAsVendor,
} from '../../services/api/supabaseAuth.js';

export const JOIN_MODES = {
  supervisor: {
    tab: 'As supervisor',
    short: 'Supervisor',
    codeLabel: 'Department code',
    placeholder: 'DEPT-AB12',
    hint: 'From your business admin',
    submitted: 'Request submitted. Business admin will review.',
    signup: signupAsSupervisor,
  },
  executive: {
    tab: 'As executive',
    short: 'Executive',
    codeLabel: 'Supervisor code',
    placeholder: 'SUP-AB12',
    hint: 'From your supervisor',
    submitted: 'Request submitted. Your supervisor will review.',
    signup: signupAsExecutive,
  },
  observer: {
    // Read-only, workspace-wide. One code for the whole workspace rather than a
    // per-department one, and the business admin approves — nobody else can
    // (POST /users/{id}/assign-role refuses a pending observer).
    tab: 'As observer',
    short: 'Observer',
    codeLabel: 'Observer code',
    placeholder: 'OBS-AB12',
    hint: 'From your business admin',
    submitted: 'Request submitted. Business admin will review your read-only access.',
    signup: signupAsObserver,
  },
};

export const JOIN_MODE_KEYS = ['supervisor', 'executive', 'observer'];

// The one way to join a VENDOR workspace. Kept out of JOIN_MODES on purpose:
// a Matrix workspace code must keep offering exactly the three modes above,
// and a vendor code offers only this one (see BrandedLoginPage JoinPanel).
export const VENDOR_JOIN_MODE = {
  tab: 'As vendor staff',
  short: 'Vendor staff',
  codeLabel: 'Staff code',
  placeholder: 'VND-…',
  hint: 'From your company owner',
  submitted: 'Request submitted. You can sign in once your request is approved.',
  signup: signupAsVendor,
};

export function joinMode(key) {
  return JOIN_MODES[key] || JOIN_MODES.supervisor;
}

// skipcq: JS-0833
// launchRentAdapter — the form-boundary translation that lets RentTermsFormV2
// (canonical snake_case, FEATURE_RENT_V2) drive the two launch-review EDIT
// surfaces (LaunchReviewModal, LaunchApprovalTab), whose form state and the
// PATCH /launch-approvals/{id}/rent-fields body speak the launch_approvals
// staging keys.
//
// The two surfaces are near-duplicates (identical RENT_KEYS / hydrate / save),
// so the shared hydrate + payload builders live here once. Keeping `form` in
// launch keys end-to-end means rentSummary() (which reads the server record, not
// `form`) and the save endpoint need no changes.
//
// The ONLY key that differs between the two contracts is the escalation percent:
//
//     launch / backend  escalation_pct  <->  RentTermsFormV2  expected_escalation_pct
//
// Everything else — rent_type, expected_rent, rev_share_pct, the dine-in/delivery
// split, staggered_escalation, expected_escalation_years, rent_free_days,
// lock_in_months, tenure_months — is already the same name on both sides.
//
// This is the third consumer of the established "rentV2Value + RENT_V2_TO_*" idiom
// (App.jsx, AddDetailsPage.jsx); it lives in one module here because the two
// launch files are duplicates.
//
// COMMENT STYLE: line comments only, no JSDoc blocks. DeepSource's JavaScript
// analyzer parses a newly-added file containing a JSDoc block as a script rather
// than a module and reports JS-0833 at its first import/export — and because that
// is a PARSE failure, skipcq cannot suppress it (see .deepsource.toml). Every new
// frontend module that passes the analyzer (lib/mime.js, ImageLightbox.jsx,
// LOIDialog.jsx) has this exact shape: the marker on line 1, then // comments.

// The launch-approvals rent staging keys the surfaces hydrate + submit. A subset
// of the backend RENT_EDITABLE_FIELDS (13): fixed_rent_amt / escalation_date are
// server-only and never touched from these forms. Hoisted to module scope so the
// surfaces' hydrate useCallback stays zero-dep without an exhaustive-deps warning.
export const LAUNCH_RENT_KEYS = [
  'rent_type', 'expected_rent', 'rev_share_pct',
  'revshare_dinein_pct', 'revshare_delivery_pct',
  'escalation_pct', 'expected_escalation_years', 'staggered_escalation',
  'rent_free_days', 'lock_in_months', 'tenure_months',
];

// The single divergent key, in both directions.
const LAUNCH_TO_V2 = { escalation_pct: 'expected_escalation_pct' };
const V2_TO_LAUNCH = { expected_escalation_pct: 'escalation_pct' };

// Launch form state -> the value RentTermsFormV2 reads. Renames escalation_pct to
// expected_escalation_pct and DELETES the old key, so a stray read of the wrong
// name renders blank (loud) rather than half-working (silent).
export function toV2Value(form) {
  const out = { ...(form || {}) };
  for (const [launchKey, v2Key] of Object.entries(LAUNCH_TO_V2)) {
    if (launchKey in out) {
      out[v2Key] = out[launchKey];
      delete out[launchKey];
    }
  }
  return out;
}

// A key RentTermsFormV2 emits -> the launch form / payload key. Unlike App.jsx's
// map (which silently drops anything unmapped), an unknown key PASSES THROUGH and
// logs — the silent drop is the exact bug this work fixes. The backend's
// extra="forbid" then turns a genuinely-unknown key into a loud 422 instead of a
// discarded 200-OK no-op. The key-set lock test asserts nothing V2 emits is
// unknown, so this console.error is a canary that only fires on a future rename.
export function fromV2Key(key) {
  if (key in V2_TO_LAUNCH) return V2_TO_LAUNCH[key];
  if (!LAUNCH_RENT_KEYS.includes(key)) {
    console.error(
      `[launchRentAdapter] RentTermsFormV2 emitted an unmapped key "${key}". It is not a launch rent field and PATCH /launch-approvals/{id}/rent-fields (extra="forbid") will reject it. Add it to LAUNCH_RENT_KEYS or V2_TO_LAUNCH.`,
    );
  }
  return key;
}

// Shared hydrate body: pick just the rent keys off the server record.
export function pickLaunchRentFields(d) {
  const f = {};
  LAUNCH_RENT_KEYS.forEach((k) => { f[k] = d?.[k] ?? null; });
  return f;
}

// Shared payload builder for saveLaunchRentFields. It:
//  - drops incomplete staggered rows (a blank "Add year") so the backend's
//    StaggeredEscalationItem (year>0, percent required) doesn't 422;
//  - PRESERVES the per-year dine-in/delivery split (V1's builder stripped every
//    row to {year, percent}, silently discarding the split V2 collects);
//  - sends an absent/empty schedule as null when the rent isn't staggered;
//  - clears values the user can no longer see, so the final confirm cannot write
//    them onto the canonical site (the two blocks at the end).
export function buildLaunchRentPayload(form) {
  const payload = { ...(form || {}) };
  payload.staggered_escalation =
    form?.rent_type === 'staggered' && Array.isArray(form.staggered_escalation)
      ? form.staggered_escalation
          .filter((e) => e && e.year != null && e.year !== '' && e.percent != null && e.percent !== '')
          .map((e) => {
            const row = { year: Number(e.year), percent: Number(e.percent) };
            // Omit — not null — an unset extra: _apply_rent_edits strips null keys
            // from each row (launch_service.py), so omitting keeps the stored dict
            // byte-identical and stops the diff timeline churning on no-op saves.
            if (e.mg != null && e.mg !== '') row.mg = Number(e.mg);
            if (e.dine_in_pct != null && e.dine_in_pct !== '') row.dine_in_pct = Number(e.dine_in_pct);
            if (e.delivery_pct != null && e.delivery_pct !== '') row.delivery_pct = Number(e.delivery_pct);
            return row;
          })
      : null;
  // Converting a rev-share type to flat/staggered must drop the old single
  // rev-share %, or _commit_rent_to_canonical writes it onto a non-rev-share site
  // (site.expected_revshare_pct = row.rev_share_pct, unconditionally). Mirrors the
  // backend already nulling the schedule when the type isn't staggered. Legacy
  // revshare / mg_revshare edits keep their type, so rev_share_pct is preserved.
  if (form?.rent_type === 'fixed' || form?.rent_type === 'staggered') payload.rev_share_pct = null;
  // Same rule for the FLAT dine-in/delivery split once the rent is staggered: V2
  // edits that split PER YEAR (inside staggered_escalation), and renders the
  // top-level pair only for rent_type='fixed'. A row switched fixed -> staggered
  // would otherwise keep submitting scalars the user can no longer see, and
  // _commit_rent_to_canonical would write them to site.revshare_dinein_pct /
  // _delivery_pct — a split the staggered schedule never showed.
  if (form?.rent_type === 'staggered') {
    payload.revshare_dinein_pct = null;
    payload.revshare_delivery_pct = null;
  }
  return payload;
}

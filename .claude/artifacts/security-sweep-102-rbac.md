# Sweep for: missing/weak RBAC on mutating routes (#102 class) — 2026-06-12

Patterns: `rg -n "@router\.(post|put|patch|delete)" backend/app/routers` + manual read of every
mutating route's dependency list and the called services. 17 router files, 90 mutating routes.

## Vulnerable
None. (The #102 dispatcher fix was verified complete: REJECTED / ARCHIVED / SHORTLISTED /
APPROVED / PUSHED_TO_PAYMENTS / LEGAL_REVIEW are supervisor-gated, matching bd.py / staging.py.)

## Needs human judgment (surfaced in PR; decide deliberately)
- `backend/app/routers/nso.py:117` — POST /nso/{site_id}/final-approval allows EXECUTIVE and
  `svc_final_approval` does no role re-check, while every other module's final approve is
  supervisor/admin-only. Mitigation: launch chain stays admin-gated downstream.
- `backend/app/routers/supervisor_codes.py:71` — reject_my_pending_exec deleted ANY inactive
  tenant user → **FIXED in this PR** (notes-marker scope, same class as #86).
- `backend/app/routers/sites.py` DETAILS_SUBMITTED dispatcher branch allows SUPERVISOR while
  the dedicated /bd/shortlist/{id}/submit is EXECUTIVE-only (supervisor ≥ exec; likely benign).
- `backend/app/routers/sites.py` finance_request_approval allows SUPERVISOR though the flow is
  "executive requests" (admin gate still holds downstream).

## Summary
0 vulnerable, ~86 safe (incl. public-by-design auth/signup/join and platform-admin routes),
4 judgment (1 of them fixed).

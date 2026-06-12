# Sweep for: IDOR / write-before-validate / unsafe href (#104, #88, #87 classes) — 2026-06-12

Patterns: `rg "upload_bytes|storage_upload"`, `rg "href=\{"`, `rg "dangerouslySetInnerHTML"`,
`rg "fetch_site_or_404|require_role|svc_is_delegated|assert_executive_owns_site"` + manual read
of every executive-reachable route. 19 routers + 14 services + 8 frontend files.

## Class A — IDOR (vulnerable → ALL FIXED in this PR stack)
- `backend/app/routers/audit.py` GET /audit/site/{site_id} — tenant-scoped only → ownership added.
- `backend/app/routers/bd.py` GET /bd/sites/{site_id}/legal-status → ownership added.
- `backend/app/routers/project.py` GET /project/history/{site_id} → delegation check added.
- `backend/app/services/change_request_service.py` svc_create_change_request → ownership added
  (was read+write IDOR: current legal field value readable + CRs openable on any tenant site).
- Delegation-list name/email leaks: `delegations.py` /sites/{id}/delegations (owner-or-delegate),
  `legal.py` + `design.py` /{id}/delegations (svc_is_delegated), `project.py` /{id}/delegations
  (svc_assigned_sites) — all gated for executives now.

### Class A judgment (NOT changed; decide deliberately)
- NSO module has no ownership/delegation model at all — all stage writes AND final-approval are
  open to any nso-module executive (nso.py:67-125). Possibly by design; final-approval looks wrong.
- launch_approval.py queue + detail readable by any authenticated role (docstring says deliberate).
- project.py /project/nso-queue has no `restrict_to` filter for executives, unlike /project/queue.

## Class B — write-before-validate (0 vulnerable; 2 hardening items FIXED)
- `project_service.py` quality-audit key now tenant-prefixed (`quality_audit/{tenant}/{site}/…`).
- `design.py` upload now checks executive delegation BEFORE the storage write.
- Safe: loi_service, tenancy branding upload, photo_service (fixed reference shape).

## Class C — unsafe href (1 vulnerable → FIXED)
- `frontend/src/App.jsx` maps-link preview now goes through `safeHref()`.
- Judgment: SiteDrawer document `d.url` is server-signed today; belt-and-braces wrap optional.
- `dangerouslySetInnerHTML`: zero hits.

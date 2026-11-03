# Vendor platform

Outside fit-out vendor companies get real accounts inside the brand's tenant. They sign in from the same welcome page and workspace-code box as Matrix users and work in their own portal at `#/vendor`. The brand's Project team follows their sites from **Project → Vendor fit-out**, and the business admin configures the whole platform from **Business admin → Vendors**.

## Sign-in flow

```text
#/welcome → Sign in → workspace-code dialog → GET /tenancy/branding
  tenant code         → #/login/<code>   Matrix sign-in, unchanged
  vendor ENTRY code   → #/login/<code>   vendor variant (platform: "vendor")
POST /auth/login
  tenant code         → Matrix token, module home (unchanged)
  vendor ENTRY code   → token with role "vendor" + vendor_id → #/vendor
```

- **Matrix first:** the vendor lookup runs only when no tenant owns the code. A Matrix workspace always wins, and Matrix responses are unchanged.
- **Code shape:** vendor codes are `VND-` plus 16 hex characters, the same entropy as a workspace code.
- **Wrong code:** a vendor account trying the tenant's workspace code is refused with "Sign in with your vendor code".
- **Shared routes:** `/auth/login/check`, `/auth/password-setup` and both password-reset routes accept vendor codes the same way.
- **Refresh:** `/auth/refresh` keeps the `vendor_id` and refuses a suspended vendor.

> **Source of Truth**
> - `backend/app/routers/auth.py` — `login`, `_vendor_login`, `_vendor_account`, `signup_vendor`, `refresh`.
> - `backend/app/services/auth_repo.py` — `get_vendor_login_row`, `get_vendor_join_code`, `get_vendor_link`.
> - `backend/app/routers/tenancy.py` — `public_branding`; `backend/app/services/vendor_service.py` — `public_vendor_branding`.
> - `frontend/src/modules/landing/BrandedLoginPage.jsx` — vendor variant, `routeFromToken`.

## Access boundary

| Rule | Where |
| --- | --- |
| A vendor token reaches only `/vendor/*` and `/auth/*`; everything else gets 403 | `_assert_vendor_scope` in `get_current_user`, keyed on `real_role`, after `db.rollback()` |
| The vendor link is re-read on every request. A suspended vendor is signed out on its next request. | `_load_vendor_link` |
| `X-Override-*` headers never change a vendor session | `_apply_workspace_override` has no vendor branch; the frontend interceptors skip the headers for vendor tokens |
| Vendor portal routes need the real vendor role, so business admins and observers cannot drive them | `require_real_role(Role.VENDOR)` in `backend/app/routers/vendor_portal.py` |
| Portal queries use the session's `vendor_id`, never a request value. Another vendor's site is a 404. | `backend/app/services/vendor_project_service.py` |
| The Matrix pending queue and assign-role ignore vendor signups | `backend/app/routers/users.py` |
| Vendor users do not count as workspace seats | `tenancy_service.get_workspace_info` |
| A vendor token never enters the Matrix shell | `RequireAuth`, `homeForRoleModule`, `homeForSession` send it to `/vendor` |

> **Source of Truth**
> - `backend/app/core/deps.py` — `_load_vendor_link`, `_assert_vendor_scope`.
> - `backend/tests/test_vendor_scope.py`, `backend/tests/test_observer_readonly.py`.

## Admission

| Admission mode (Settings) | Owners | Site staff |
| --- | --- | --- |
| `owner_approves_staff` (default) | Business admin invites or approves | The vendor owner approves on the portal's Team page |
| `admin_approves_all` | Business admin | Business admin, in Vendors → Approvals |

- **Owner invites:** the business admin invites an owner directly (Vendors → Invite an owner). The owner sets a password at first sign-in.
- **Staff joining:** site staff join on the login page's Join tab with the company's **staff code**.
  - The workspace setting **allow self-signup** also accepts the vendor entry code there.
  - A request is an inactive `users` row plus a `vendor_users` link, like the Matrix signups.
- **Codes:** entry and staff codes are rotated revoke-then-insert. A rotated code stops working at once, and existing accounts are unaffected.

> **Source of Truth**
> - `backend/app/services/vendor_service.py` — `approver_for`, `decide_pending`, `rotate_code`, `invite_owner`.
> - `backend/tests/test_vendor_admission.py`.

## What a workspace can customise

| Setting | Effect |
| --- | --- |
| Admission mode, allow self-signup | Who approves new people, and which codes can request access |
| Daily update cutoff, time zone | When an update counts as late, and when a missing one counts as missed |
| Mall and non-mall durations | Standard programme length per site type |
| Plan phases per site type | Name, start and end day, and weight (weights must total 100) |
| Mobilisation checklists | The vendor's items and the brand team's items on every site's Initiation tab |
| Portal title, accent colour, logo, welcome text, support contact | What vendors see in their portal |

- **Starting values:** templates are seeded from the demo's plan on a tenant's first read.
- **Progress:** every progress, status and forecast figure is computed on the server from these templates.
- **Delay:** the delay is the larger of the schedule slip and the days past the target, so it keeps growing until handover.

> **Source of Truth**
> - `backend/app/domain/vendor_schedule.py` — `compute`, `validate_phases`; `backend/tests/test_vendor_schedule.py`.
> - `frontend/src/modules/business-admin/vendors/VendorsTab.jsx`.

## Data

The migration `backend/database/migrations/20261104_vendor_platform_foundation.sql` adds:

- `vendors`, `vendor_users`, `vendor_codes`
- `vendor_settings`, `vendor_plan_phases`, `vendor_checklist_items`
- `vendor_projects`, `vendor_project_checks`
- `vendor_daily_updates`, `vendor_update_progress`

It also widens `users.role` with `vendor`. Every statement is idempotent.

## Not in this phase

- Quality gates and inspections, snags, the hindrance sign-off register, handover, payment milestones and penalties, and scorecards. Blockers typed in daily updates are recorded and shown, but not routed for sign-off.
- Photo uploads on daily updates, and scheduled reminders.

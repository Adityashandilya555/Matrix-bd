# Vendor platform

Outside fit-out vendor companies get real accounts inside the brand's tenant. They use the same welcome page and the same workspace code as Matrix users, then choose **Vendor login** and work in their own portal at `#/vendor`. The brand's Project team follows their sites from **Project → Vendor fit-out**, and the business admin configures the whole platform from **Business admin → Vendors**.

## Sign-in flow: the login fork

```text
#/welcome → Sign in → workspace-code dialog → GET /tenancy/branding (unchanged)
  #/login/<code>          choose Retail login or Vendor login
  #/login/<code>/retail   Matrix sign-in, unchanged → module home
  #/login/<code>/vendor   POST /auth/login {…, platform: "vendor"} → token role "vendor" + vendor_id → #/vendor
```

- **One workspace code:** there is no separate vendor code. Vendor accounts are vendor-role users of the tenant.
- **Retail unchanged:** the Retail side sends no `platform`, so its requests and every Matrix response are the same as before the fork. `/tenancy/branding` and the password setup and reset routes are byte-identical to `main`.
- **Wrong side:**
  - A vendor account on the Retail side is refused with "Go back and choose Vendor login". `/auth/login/check` reports `vendor_account` to the page, which links to the Vendor side.
  - A Matrix user on the Vendor side reads as "not registered as a vendor", with a link to Retail.
- **Unknown codes:** both sides share `_unknown_code_reply`: the soft 202 for legacy short codes, 404 otherwise.
- **Vendor gates:** an active vendor company, not pending, and a password. The first password is set through the normal first-sign-in step.
- **Password resets:** vendor reset requests go to the same platform-admin queue as Matrix ones.
- **Refresh:** `/auth/refresh` keeps the `vendor_id` and refuses a suspended vendor.
- **Old links:** an unknown side, such as `/login/<code>/x`, returns to the chooser. Old `/login/<code>` links land on the chooser.

> **Source of Truth**
> - `backend/app/routers/auth.py` — `login`, `_vendor_login`, `_unknown_code_reply`, `_refuse_vendor_account`, `_side_mismatch`, `login_check`, `signup_vendor`, `refresh`.
> - `backend/app/services/auth_repo.py` — `get_vendor_join_code`, `get_vendor_link`.
> - `frontend/src/modules/landing/BrandedLoginPage.jsx` — `SideChooser`, `LoginPanel platform`, `routeFromToken`; route `/login/:code/:side?` in `frontend/src/router/AppRouter.jsx`.

## Starting from an empty database

No vendor data exists until a business admin creates it:

1. Business admin → **Vendors** → add the company. It gets a staff code.
2. Invite its owner by email. The account is approved, with no password yet.
3. The owner enters the workspace code, chooses **Vendor login** and creates a password at first sign-in.
4. The owner shares the staff code. Site staff join on the Vendor side's **Join** tab with their email and the staff code.
5. Depending on the admission mode, the owner or the business admin approves them.
6. A project supervisor issues a PO from **Project → Vendor fit-out**, and the site appears in the vendor's portal.

Plan templates are seeded on the tenant's first read. Every screen has an empty state until then.

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
  - A request is an inactive `users` row plus a `vendor_users` link, like the Matrix signups.
- **Codes:** the staff code must belong to the workspace whose login page is used. It is rotated revoke-then-insert. A rotated code stops working at once, and existing accounts are unaffected.

> **Source of Truth**
> - `backend/app/services/vendor_service.py` — `approver_for`, `decide_pending`, `rotate_code`, `invite_owner`.
> - `backend/tests/test_vendor_admission.py`.

## What a workspace can customise

| Setting | Effect |
| --- | --- |
| Admission mode | Who approves new vendor people |
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

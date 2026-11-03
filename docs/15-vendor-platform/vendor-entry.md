# Vendor platform entry

A vendor reaches the vendor fit-out page from the same welcome page and workspace-code box as Matrix users. The vendor page is a standalone static file. It has its own sign-in, keeps its data in the visitor's browser, and never calls the Matrix API.

## Flow

```text
#/welcome  →  Sign in  →  workspace-code dialog
    │
    ▼
GET /tenancy/branding?code=…          (unchanged)
    │
    ├── found: true          →  #/login/<code>   Matrix sign-in, exactly as before
    ├── no `found` key       →  #/login/<code>   legacy short code, exactly as before
    └── found: false
          ├── code in VITE_VENDOR_WORKSPACE_CODES  →  #/vendor/<code>
          │                                          →  /vendor/fit-out-tracker.html
          └── otherwise                            →  "That workspace code doesn't exist"
```

The vendor list is consulted only after the server says the code is not a Matrix workspace, so a Matrix workspace always wins if the two ever share a code. The older sign-in tab inside the landing page's auth modal follows the same rule.

`#/vendor/<code>` sits outside `RequireAuth` and the `App` shell, like `#/login/<code>`. It forwards with `location.replace`, so Back from the vendor page does not loop through the forwarder. An unknown or rotated code shows "Vendor workspace not found".

> **Source of Truth**
> - `frontend/src/modules/landing/WorkspaceCodeDialog.jsx` — `submit`, the `found === false` branch.
> - `frontend/src/modules/landing/ScaleLandingPage.jsx` — `AuthModal.handleLogin`.
> - `frontend/src/lib/vendorAccess.js` — code list, page URL, redirect.
> - `frontend/src/modules/vendor/VendorEntryPage.jsx` — the `#/vendor/:code` route.
> - `frontend/src/router/AppRouter.jsx` — route registration outside the auth tree.

## Configuring vendor codes

Vendor codes are set at build time in the frontend environment:

```text
VITE_VENDOR_WORKSPACE_CODES="VND-9C2E7A41B03D5F68=Shreeji Interiors;VND-31D8F0C6A92B47E5=Northline Buildtech"
```

| Rule | Reason |
| --- | --- |
| Unset or empty turns vendor entry off | The code box then behaves exactly as before |
| A code is `VND-` plus 16 to 28 letters or digits | Always longer than legacy short codes, so `/tenancy/branding` answers `found: false` for it, and within the 32-character code limit |
| Malformed or duplicate entries are skipped | A typo can only remove a code, never invent one |
| Changing the list needs a rebuild and redeploy | `VITE_` variables are baked into the bundle |

Generate a code with `python3 -c "import secrets; print('VND-' + secrets.token_hex(8).upper())"`.

> **Source of Truth**
> - `frontend/src/lib/vendorAccess.js` — `parseVendorCodes`, `VENDOR_CODE_RE`.
> - `frontend/src/lib/__tests__/vendorAccess.test.js` — parsing rules.

## What this does not do

| Limit | Consequence |
| --- | --- |
| The vendor page is a public static file | Anyone with its URL can open it. The vendor code routes people; it does not protect the page. |
| Vendor codes are in the built JavaScript | They are not secrets. Treat them as convenience links. |
| The vendor page stores data in the browser | Nothing a vendor enters reaches Blue Tokai or the Matrix database. |
| The vendor page shares the app's origin | It can technically read the same browser storage as Matrix. It is our own page and does not, but a future vendor platform with real data should move to its own subdomain. |
| The global CSP header is report-only | The page's inline scripts produce CSP reports, not failures. If the CSP is ever enforced, this path needs its own policy. |

Real vendor accounts, server-side vendor codes and shared data are the later phases in the vendor platform specification.

> **Source of Truth**
> - `frontend/public/vendor/fit-out-tracker.html` — the vendor page, unmodified.
> - `frontend/vercel.json` — `Content-Security-Policy-Report-Only` header; static files are served before the SPA rewrite.

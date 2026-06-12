# Deployment guide (internal testing)

Run order: **backend first → frontend second.** The frontend needs the backend's public URL at build time.

> [!IMPORTANT]
> Do **NOT** deploy the FastAPI backend on Vercel serverless functions. The async SQLAlchemy pool + asyncpg cold-starts badly. Use Railway, Render, or Fly.io for the backend. Vercel hosts the React frontend only.

---

## Topology

| Piece | Host | Notes |
| --- | --- | --- |
| Frontend (Vite/React) | Vercel | Static SPA, `HashRouter`, zero rewrite config needed |
| Backend (FastAPI) | **Railway** (recommended) / Render / Fly | Long-running ASGI, persistent Supabase pooler connection |
| Database | Supabase (existing) | Project `xybgldzpvzkkrxrbhzit` |

---

## Pre-flight — applied once per Supabase project

If this is a brand new Supabase project, run the migration in **SQL Editor → New query**:

```
backend/database/migrations/202605221_add_workspace_requests.sql
```

For the current dev project (where Aditya tested), this has already been applied. Verify with:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='tenants' AND column_name IN ('seat_limit','workspace_code');
SELECT 1 FROM information_schema.tables WHERE table_name='workspace_requests';
```

If both queries return rows, you're good.

---

## Step 1 — Deploy the backend on Railway

1. Sign in to https://railway.app → **New Project → Deploy from GitHub repo → Adityashandilya555/Matrix-bd**.
2. **Root directory**: `backend`
3. **Build command** (Settings → Build): `pip install -e .`
4. **Start command** (Settings → Deploy): `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. **Variables** tab — paste these. **Do not commit them anywhere; set only in Railway:**

   | Key | Value |
   | --- | --- |
   | `APP_NAME` | `Z-Matrix BD Platform` |
   | `API_PREFIX` | `/api` |
   | `DEBUG` | `false` |
   | `LOG_LEVEL` | `INFO` |
   | `CORS_ORIGINS` | *Set AFTER step 2 — needs the Vercel URL* |
   | `DATABASE_URL` | *Same value Aditya has in his local `backend/.env`. Comes from Supabase → Settings → Database → Connection string → URI. Replace `postgresql://` with `postgresql+asyncpg://` and URL-encode `@` in the password as `%40`.* |
   | `DB_POOL_SIZE` | `5` |
   | `DB_MAX_OVERFLOW` | `10` |
   | `DB_POOL_RECYCLE_SECONDS` | `300` |
   | `SUPABASE_JWT_SECRET` | *Same value as Aditya's `backend/.env` line 27. **Rotate this in Supabase first** — it was shared over WhatsApp.* |
   | `SUPABASE_JWT_AUDIENCE` | `authenticated` |
   | `ALLOW_ANON_DEMO_USER` | `false` |
   | `SUPABASE_PROJECT_URL` | `https://xybgldzpvzkkrxrbhzit.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | *Aditya's `.env` line 41. **Rotate this in Supabase first** — also shared over WhatsApp.* |
   | `SUPABASE_STORAGE_BUCKET` | `site-files` |
   | `PLATFORM_ADMIN_TOKEN` | *Aditya's `.env` line 47. This gates `POST /api/tenancy/requests/{id}/approve` — keep it secret. Rotate via `python -c "import secrets; print(secrets.token_urlsafe(32))"` and replace.* |

6. **Networking** tab → **Generate Domain**. Note the URL (e.g. `https://matrix-bd-production.up.railway.app`).
7. **Smoke test** the backend:
   ```bash
   curl https://<your-railway-domain>/api/health
   curl https://<your-railway-domain>/api/health/db
   ```
   Both should return `{"status":"ok"}`. If `/api/health/db` returns 500, the `DATABASE_URL` is wrong.

---

## Step 2 — Deploy the frontend on Vercel

1. Sign in to https://vercel.com → **Add New → Project → Import Git Repository → Adityashandilya555/Matrix-bd**.
2. **Root Directory**: `frontend`
3. **Framework Preset**: Vite (auto-detected)
4. **Build Command**: `npm run build` (default)
5. **Output Directory**: `dist` (default)
6. **Environment Variables** — set these:

   | Key | Value |
   | --- | --- |
   | `VITE_API_BASE_URL` | `https://<your-railway-domain>/api` (note the trailing `/api`) |
   | `VITE_USE_MOCK` | `false` |
   | `VITE_API_TIMEOUT_MS` | `20000` |

   *Do NOT set `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` — the frontend no longer uses the Supabase JS SDK.*

7. Click **Deploy**. Wait for the build (~2 min). Note the URL (e.g. `https://matrix-bd.vercel.app`).
8. **Smoke test** the frontend:
   - Open `https://<your-vercel-app>.vercel.app` in a browser.
   - You should be redirected to the landing page with Login / Register tabs.
   - DevTools network tab: requests to `/api/...` should go to the Railway URL.

---

## Step 3 — Wire CORS back to the Vercel domain

The backend rejects requests from origins not in `CORS_ORIGINS`. Add the Vercel domain:

1. Back to Railway → backend project → **Variables** → edit `CORS_ORIGINS`:
   ```
   https://<your-vercel-app>.vercel.app
   ```
   (Comma-separated for multiple **exact** origins. Starlette matches these by
   exact string compare — glob entries like `https://project-*.vercel.app`
   silently never match, and `*` is **refused at boot**: this app sends
   credentials, and wildcard-with-credentials would let any website on the
   internet make credentialed calls against the API.)

   For Vercel **preview** deployments (unpredictable hostnames), set the regex
   variable instead:
   ```
   CORS_ORIGIN_REGEX=^https://<vercel-project>-[a-z0-9-]+\.vercel\.app$
   ```
   Local Vite ports (5100–5199) are no longer allowed by default in
   production; set `CORS_ALLOW_LOCALHOST=true` only on dev machines.
2. Railway will redeploy automatically. Wait ~30s.
3. Refresh the Vercel app → try a real action. Network tab should show no CORS errors.

---

## Step 4 — End-to-end test on the live URLs

1. Open `https://<vercel>/`.
2. **Register** a workspace: company name, your email, team size → submit. Should see green "Request received" message.
3. **Approve** as platform admin from your local terminal (only Aditya / Shrey have the token):
   ```bash
   # Find the pending request id in Supabase SQL editor:
   SELECT id, company, admin_email FROM workspace_requests WHERE status='pending';

   # Approve it:
   curl -X POST https://<your-railway-domain>/api/tenancy/requests/<REQUEST_ID>/approve \
     -H "Content-Type: application/json" \
     -H "X-Platform-Admin-Key: <PLATFORM_ADMIN_TOKEN value>" \
     -d '{"city":"Mumbai","admin_name":"Your Name"}'
   ```
   Response gives you the `workspace_code` (e.g. `BTOKAI-7X9F`).
4. **Sign in**: on the Vercel app, click **Login** tab → email + workspace_code → submit.
5. You should land in the dashboard. Click **Team** in the sidebar → see your workspace code with a Copy button.
6. Share the workspace code with anyone for internal testing — they sign in with their email + the code, get queued, and you assign them a role from `/team`.

---

## Where the platform admin token lives

Aditya generated `PLATFORM_ADMIN_TOKEN` locally and it's in his `backend/.env` (line 47). Before deployment:

- **Rotate it**: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- Put the new value in Railway's `PLATFORM_ADMIN_TOKEN` env var.
- Share the new value with Shrey via 1Password / encrypted channel — **not WhatsApp / email / Slack DM**.

Aditya's local copy should be updated to match so his local dev can still approve.

---

## Known limitations (acceptable for internal testing)

These are documented and intentional for this phase. Revisit before opening to outside users:

1. **No password.** Anyone with the workspace code can sign in as any email in that workspace. First-login-wins. Fine for trusted teams; fatal for public sign-up.
2. **No rate limiting** on `POST /api/auth/login` and `POST /api/tenancy/request-workspace`. A bot could spam either.
3. **No transactional email** — the supervisor copy-pastes the workspace code to teammates manually.
4. **Workspace code rotation** has no UI — if a code leaks, rotate via SQL: `UPDATE tenants SET workspace_code = 'NEW-CODE' WHERE id = '<id>';`.
5. **Initial-session flash** — for ~200ms after a real sign-in, the dashboard briefly shows the wrong identity ("Riya Sharma / supervisor") before `/auth/whoami` hydrates the real user. Cosmetic.
6. **Console 401s on load** — three `GET /api/sites 401` requests fire before the auth gate redirects unauthed visitors to `/welcome`. Cosmetic; no functional impact.
7. **Pre-existing tests in `backend/tests/`** were written against the old Supabase auth path and will fail on a CI run. They're not run in this deploy flow, so it doesn't block deployment.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/api/health/db` returns 500 | `DATABASE_URL` is wrong, missing `+asyncpg`, or password not URL-encoded | Re-copy from Supabase, swap scheme, `@` → `%40` |
| Sign-in says `That workspace code does not match any active workspace` | Migration not applied to that Supabase project | Apply `202605221_add_workspace_requests.sql` |
| Sign-in says `String should have at least 4 characters` | Frontend posted an empty `workspace_code` field | Check the input is named `#login-code`, not `#login-password` |
| CORS error in browser DevTools | `CORS_ORIGINS` on backend doesn't include the Vercel domain | Add it, redeploy backend |
| Approve curl returns `401 Invalid or missing X-Platform-Admin-Key` | Header missing or token mismatch | Confirm the env var matches your local `.env` value |
| Approve curl returns `503 Approve endpoint disabled` | `PLATFORM_ADMIN_TOKEN` is unset on the backend host | Set it in Railway variables |
| Backend logs `DuplicatePreparedStatementError` | Old code (pre `NullPool` fix) deployed | Make sure you're on the latest commit |
| Vercel build fails | `package-lock.json` mismatch | `cd frontend && npm install && git commit && git push` |

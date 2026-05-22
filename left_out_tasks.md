# Left-out tasks — Supabase wiring, env handoff, and Vercel deployment

This document is the **explicit todo list** for finishing the integration. The code is in `main`. The Supabase migration (`Matrix_dev/02_Data_&_State/run_alter_table.md`) has already been handed to the teammate running migrations. What's left is connecting the running code to Supabase and getting it onto Vercel for end-to-end testing.

---

## 1. Connect the app to Supabase (env handoff)

Aditya will share **two `.env` files** with the teammate over a secure channel (1Password / Signal / Bitwarden — **not** Slack, not email, not committed to git). The files are:

| File | Where it lives | What it contains |
| --- | --- | --- |
| `backend/.env` | drop into `backend/` after pulling | DATABASE_URL (Supabase pooler), SUPABASE_JWT_SECRET, SUPABASE_PROJECT_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, CORS_ORIGINS |
| `frontend/.env` | drop into `frontend/` after pulling | VITE_API_BASE_URL, VITE_USE_MOCK=false, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY |

Both files are gitignored — they never end up on GitHub. Templates live in `backend/.env.example` and `frontend/.env.example` so anyone can see *what* keys are needed without seeing the *values*.

### Teammate's local-run checklist (after receiving the .env files)

```bash
git pull
cd backend  && python -m venv .venv && source .venv/bin/activate && pip install -e .
cd ../frontend && npm install
# paste backend/.env  and  frontend/.env  into their respective folders
cd .. && make dev          # boots uvicorn + vite together
```

Smoke-test:
```bash
curl http://localhost:8000/api/health       # → {"status":"ok"}
curl http://localhost:8000/api/health/db    # → {"status":"ok"} — proves Supabase reachable
```

If either curl fails, see §4 below for the error → root cause table.

---

## 2. Pre-Vercel: one auth user with proper claims

Before any deployment makes sense, the Supabase project needs **at least one auth user with `app_metadata` set** so the backend's JWT decoder doesn't reject every request.

In **Supabase dashboard → Authentication → Users → click a user → "Raw user meta data" → `app_metadata`**:

```json
{
  "role": "executive",
  "tenant_id": "<the tenant uuid from the migration §9.1>",
  "city": "Mumbai"
}
```

Also INSERT a row in `public.users` whose `id` matches `auth.users.id` for that user (see §9.2 of the migration). Without this row the FK constraint blows up the first time the user touches a site.

---

## 3. Vercel deployment for end-to-end testing

Vercel hosts the **frontend** natively. The FastAPI backend is awkward on Vercel (serverless cold starts kill async DB pooling) — host it on Railway, Render, or Fly.io instead, and point the Vercel-hosted frontend at it via `VITE_API_BASE_URL`.

### 3a. Frontend → Vercel

1. **Push the branch** (if not already): `git push -u origin main` (or whichever branch you want to deploy).
2. **Import the repo** in the Vercel dashboard:
   - Framework preset: **Vite**
   - Root directory: `frontend`
   - Build command: `npm run build` (default)
   - Output directory: `dist` (default)
3. **Environment variables** (Vercel → Project → Settings → Environment Variables) — paste these for the *Production* and *Preview* environments:
   ```
   VITE_API_BASE_URL      = https://<your-backend-host>/api
   VITE_USE_MOCK          = false
   VITE_SUPABASE_URL      = https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY = <anon public key>
   VITE_API_TIMEOUT_MS    = 20000
   ```
   The anon key is safe in the browser. The service-role key is **NOT** — never put it here.
4. **Deploy.** Vercel will give you a `https://<project>.vercel.app` URL.

### 3b. Backend → choose a host (Vercel is not recommended)

Pick one — all three are zero-config for a `pip install -e .` + `uvicorn` app:

| Host | Strength | Notes |
| --- | --- | --- |
| **Railway** | Easiest. `railway up` from the backend dir, set env vars in dashboard. | Set Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| **Render** | Generous free tier; persistent connections survive between requests. | Use a **Web Service**, runtime Python, build `pip install -e .`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. |
| **Fly.io** | Best for low-latency Postgres pairing (deploy in same region as Supabase). | Need a `fly.toml` + Dockerfile; slightly more setup. |

Whichever you pick, copy these into the host's env vars (one-time, from `backend/.env`):

```
DATABASE_URL                  = postgresql+asyncpg://...
SUPABASE_JWT_SECRET           = ...
SUPABASE_JWT_AUDIENCE         = authenticated
SUPABASE_PROJECT_URL          = https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY     = ...
SUPABASE_STORAGE_BUCKET       = site-files
CORS_ORIGINS                  = https://<project>.vercel.app
ALLOW_ANON_DEMO_USER          = false       # critical for prod
DEBUG                         = false
LOG_LEVEL                     = INFO
```

The `CORS_ORIGINS` must include the *exact* Vercel URL (no trailing slash). Get this wrong and the browser blocks every request with a CORS error before it ever reaches the backend.

### 3c. Wire them together

1. Deploy backend first → note its URL (e.g. `https://matrix-api.up.railway.app`).
2. In Vercel, set `VITE_API_BASE_URL = https://matrix-api.up.railway.app/api` and redeploy the frontend.
3. In the backend host, set `CORS_ORIGINS = https://<your-vercel-url>` and restart.
4. Open the Vercel URL in an incognito window. Sign in. Open the Network tab — every request to `/api/...` should hit the backend host with an `Authorization: Bearer …` header attached.

---

## 4. Error → root cause cheat sheet

For both local and deployed environments:

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `Database connection failed at startup` in backend logs | DATABASE_URL wrong, or asyncpg prefix missing | Confirm prefix is `postgresql+asyncpg://`, password not URL-escaped wrong |
| Every signed-in request 401 | `SUPABASE_JWT_SECRET` doesn't match the project | Re-copy from dashboard → API → JWT Settings |
| `403 Token missing app_metadata.tenant_id` | Auth user's `app_metadata` not set | Add the JSON from §2 |
| Browser shows CORS error before request reaches backend | `CORS_ORIGINS` doesn't list the exact Vercel URL | Update env var + restart backend |
| LOI upload returns 502 | Wrong `SUPABASE_SERVICE_ROLE_KEY` or missing bucket | Verify key + create bucket named `site-files` (Private) |
| LOI upload returns 503 | `SUPABASE_PROJECT_URL` or `SUPABASE_SERVICE_ROLE_KEY` empty | Fill them in the backend env |

---

## 5. What's already done

- ✅ Backend code: real async SQLAlchemy + Supabase JWT + outbox notifications (commit `c18a645`)
- ✅ Frontend code: HTTP adapter hardened + Supabase auth wired (commit `2d07efe`)
- ✅ Migration SQL: sent to teammate (lives at `Matrix_dev/02_Data_&_State/run_alter_table.md`, Aditya's local vault)
- ✅ Makefile + .env.example templates: in repo

## 6. What's left

- [ ] Teammate runs the migration SQL in the Supabase SQL editor (if not already done)
- [ ] Aditya hands over `backend/.env` + `frontend/.env` via 1Password
- [ ] Both verify local run with `make dev` + the two `curl` smoke tests
- [ ] At least one Supabase auth user gets `app_metadata` set (§2)
- [ ] Backend deployed to Railway / Render / Fly with env vars from §3b
- [ ] Frontend deployed to Vercel with env vars from §3a
- [ ] CORS_ORIGINS updated to include the live Vercel URL
- [ ] End-to-end smoke: sign in on the live Vercel URL, create a pipeline draft, verify it appears in Supabase `sites` table

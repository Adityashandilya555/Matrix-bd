# Notification Outbox Worker — Operational Runbook

**Status:** spec only. No worker is running in production yet. Outbox rows accumulate with `status='pending'` until a worker is deployed.

## Why an outbox

The backend never calls SendGrid / SES / Slack from a request handler. Doing so would:

1. Couple request latency to a third-party SLA.
2. Risk "phantom notifications" — email sent, DB transaction rolled back.
3. Re-send on retry without idempotency.

Instead, every domain service that wants to notify someone writes a row to `notification_outbox` **in the same transaction as the business write**. Both commit together or both roll back. An out-of-process worker drains the table.

See `backend/app/services/notification_service.py::enqueue` — that is the only blessed entry point.

## Table contract

`public.notification_outbox` (live schema in `backend/database/schema.sql`):

| column            | notes                                                         |
| ----------------- | ------------------------------------------------------------- |
| `id`              | uuid, PK                                                      |
| `tenant_id`       | uuid, FK tenants — RLS scope                                  |
| `site_id`         | uuid, nullable — most events relate to a site                 |
| `recipient_id`    | uuid, FK users — resolved by service helpers, not by callers  |
| `recipient_email` | text, denormalised at send time (worker fills this in)        |
| `type`            | event name, e.g. `draft_submitted`, `shortlist_approved`      |
| `channel`         | `email` \| `slack` \| `in_app`                                 |
| `status`          | `pending` \| `sending` \| `sent` \| `failed`                  |
| `attempts`        | int, incremented by worker                                    |
| `payload`         | jsonb — template variables                                    |
| `subject` / `body`| optional pre-rendered text                                    |
| `sent_at`         | timestamptz, set when status flips to `sent`                  |
| `failed_reason`   | text, populated on terminal failure                           |

## Worker loop (spec)

A single worker process. Either a long-lived Python service or a Supabase Edge Function on a cron trigger.

```
loop forever:
    rows = SELECT * FROM notification_outbox
             WHERE status = 'pending' AND attempts < 5
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 50
    for r in rows:
        UPDATE notification_outbox SET status='sending', attempts=attempts+1 WHERE id=r.id
        try:
            if r.channel == 'email':  send_via_resend(r)        # or SES / SendGrid
            elif r.channel == 'slack': post_to_slack(r)
            elif r.channel == 'in_app': pass  # already visible via /api/notifications
            UPDATE ... SET status='sent', sent_at=now() WHERE id=r.id
        except RetryableError as e:
            UPDATE ... SET status='pending', failed_reason=str(e) WHERE id=r.id
        except FatalError as e:
            UPDATE ... SET status='failed', failed_reason=str(e) WHERE id=r.id
    sleep 5s
```

Key requirements:

- **`FOR UPDATE SKIP LOCKED`** lets multiple worker replicas run safely.
- **`attempts < 5`** is a backstop against poison messages. After 5 tries the row is left for manual review (`status` still `pending`, but `attempts` reveals the loop count).
- Mark `status='sending'` before the outbound call so a crashed worker doesn't double-send when it restarts (the row is now visibly stuck and an operator can reset it).
- For email channel, resolve `recipient_email` lazily from `users.email` if blank — keeps the enqueue path cheap.

## Templates

`type` maps to a Jinja template (`backend/app/services/notification_templates/<type>.txt` + `.html`). The worker renders against `payload`. Today no templates exist; the worker should fall back to `subject` / `body` if pre-rendered, otherwise log and mark failed.

Templates needed for current events:

| event                     | trigger                                                  | recipients                                          |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `draft_submitted`         | exec moves draft → shortlist                             | supervisors + sub_supervisors of that city          |
| `shortlist_sent_review`   | exec completes 13/15 fields and clicks Send for review   | supervisors (+ sub_supervisors with delegation)     |
| `shortlist_approved`      | supervisor approves shortlist, sets LOI deadline         | site owner (assigned_to)                            |
| `loi_uploaded`            | exec uploads signed LOI                                  | supervisors                                         |
| `loi_overdue`             | cron — days since approval > expected_loi_days           | site owner + supervisors                            |
| `pushed_to_payments`      | supervisor pushes site to payments stage                 | finance distribution list (TBD)                     |
| `site_rejected`           | supervisor rejects shortlist                             | site owner                                          |
| `site_archived`           | supervisor archives                                      | site owner                                          |
| `site_revived`            | supervisor revives an archived site                      | site owner                                          |
| `delegation_granted`      | supervisor delegates a site to a sub_supervisor          | the named delegate                                  |
| `delegation_revoked`      | supervisor revokes a delegation                          | the named delegate                                  |
| `workspace_request_approved` | platform admin approves a tenant signup              | admin email captured at signup                      |

Recipient resolution lives in `notification_service.recipients_for_*` helpers — callers must use those, not pass user IDs directly. This keeps "who hears about X" answerable in one file.

## Operational tasks

**Observability**

```sql
-- queue depth
SELECT channel, status, count(*)
FROM notification_outbox
GROUP BY 1, 2
ORDER BY 1, 2;

-- stuck rows (sending > 5 min ago — worker crashed mid-flight)
SELECT * FROM notification_outbox
WHERE status = 'sending' AND created_at < now() - interval '5 minutes';

-- poison messages
SELECT type, count(*), max(failed_reason)
FROM notification_outbox
WHERE attempts >= 5 AND status = 'pending'
GROUP BY type;
```

**Replay a single message** (operator action):

```sql
UPDATE notification_outbox
SET status = 'pending', attempts = 0, failed_reason = NULL
WHERE id = '<uuid>';
```

**Drop all queued mail for a tenant** (e.g. test tenant cleanup):

```sql
DELETE FROM notification_outbox
WHERE tenant_id = '<uuid>' AND status = 'pending';
```

## Deployment

Two viable hosts:

1. **Railway worker service** alongside the FastAPI app. Reuses the same SQLAlchemy session factory and config. Simplest path.
2. **Supabase Edge Function** triggered every minute via pg_cron. Stays close to the DB and inherits Supabase secrets. Use this if we want to keep the Railway footprint to one process.

Either way: credentials for the email provider live in env, never committed. See `Matrix_dev/` deployment notes for the secret matrix.

## What ships before the worker

Today, in-app notifications work through `/api/notifications` reading the outbox table directly — the user sees them as soon as a row is written, no worker required. Email / Slack rows pile up silently. That's acceptable for internal testing but is the **#1 blocker** before external users can be invited.

---

Last updated: 2026-05-24

# NSO platform integration: receiving Matrix webhooks

This page is for the team building the NSO platform side. Matrix sends one HTTPS `POST` per site change, signed with a secret that the Matrix business admin gives you.

## What arrives

**Request basics**
- `POST <your endpoint URL>`
- `Content-Type: application/json`
- `User-Agent: Matrix-Webhooks/1`

**Headers**

| Header | Value |
| --- | --- |
| `X-Matrix-Event-Id` | A UUID. It is the same on every retry, so use it to drop duplicates. |
| `X-Matrix-Event-Type` | `site.updated`, `site.deleted` or `site.test` |
| `X-Matrix-Timestamp` | Unix seconds when this attempt was sent |
| `X-Matrix-Signature` | `v1=<hex>`. During a secret rotation there are two entries: `v1=<hex>,v1=<hex>` |

**Body (`site.updated`)**

The body is always a **full snapshot**, never a diff. Here is an example:

```json
{
  "event_id": "3f6c…", "event_type": "site.updated", "schema_version": "1",
  "seq": 1042, "occurred_at": "2026-11-20T09:14:03Z",
  "company": { "id": "b1e…", "name": "Example Coffee Co" },
  "site": {
    "id": "9a2…", "cafe_code": "EX-BLR-014", "name": "Indiranagar 100ft",
    "city": "Bengaluru", "model": "Cafe", "status": "nso", "archived": false,
    "google_pin": "12.9716, 77.6412", "lat": 12.9716, "lng": 77.6412,
    "google_maps_url": "https://maps.app.goo.gl/…", "work_email": null
  },
  "loi": { "uploaded": true, "uploaded_at": "2026-09-02T11:20:00Z" },
  "licences": { "fssai_status": "yes" },
  "dates": { "project_start": "2026-10-01", "handover": "2026-11-15",
             "live_planned": "2026-12-01", "live_actual": null }
}
```

| Field | Meaning |
| --- | --- |
| `company.id`, `site.id` | Stable keys. **Key your records on these**, never on names or the cafe code. |
| `site.cafe_code` | The Finance-approved cafe code. It can change, and becomes `null` if approval is withdrawn. |
| `site.lat`, `site.lng` | Parsed from `google_pin` when possible, otherwise `null` |
| `site.work_email` | Always `null` in schema version 1 |
| `licences.fssai_status` | `pending`, `yes`, `no` or `na`. It is `null` until Legal publishes the licensing checklist. |
| `dates.project_start` | The approved project start date. `null` until it is approved. |
| `dates.handover` | The date Project handed the site to NSO, in IST |
| `dates.live_planned` | The launch date planned in Matrix's NSO module |
| `dates.live_actual` | The date the site actually launched, in IST |

Dates are `YYYY-MM-DD` and timestamps are UTC ISO-8601.

**Other event types**

| Event type | Body | What to do |
| --- | --- | --- |
| `site.deleted` | `company.id`, `site.id`, `site.cafe_code`, `site.name` and `"deleted": true` | Remove or archive the site |
| `site.test` | Sent when the admin clicks "Send test". `site.id` is all zeros and `"test": true`. | Return 2xx and do nothing else |

## Which sites you receive

A site is sent from the moment Finance approves its cafe code. If a site loses its approved code, you get one last `site.updated` with `cafe_code: null`, and nothing more until it is approved again.

## Rules for your endpoint

1. **Verify the signature over the raw body bytes.** Do this before parsing the JSON.
   - Compute `hex(HMAC_SHA256(secret, f"{timestamp}.{raw_body}"))`.
   - Accept the request if it matches **any** `v1=` entry. Use a constant-time compare.
2. **Reject stale requests.** Reject any request whose `X-Matrix-Timestamp` is more than 5 minutes from your clock.
3. **Drop duplicates.** If you have already processed an `event_id`, return 200 and do nothing.
4. **Keep only the newest snapshot per site.** Store the highest `seq` you have applied for each `site.id`. If a new event's `seq` is lower or equal, return 200 and ignore it. Retries and replays can arrive out of order.
5. **Answer quickly.** Return 2xx within 10 seconds and do slow work asynchronously.

**How your responses are treated**

| Your response | What Matrix does |
| --- | --- |
| 2xx | Done |
| `408`, `429`, any 5xx, a timeout or a connection error | Retries with growing delays for about 2 days, honouring `Retry-After` |
| Any other 4xx | Treated as permanent. The event goes to the admin's "Gave up" list. |

Redirects are not followed.

## Reference check (Python)

```python
import hashlib, hmac, time

def verify(headers, raw_body: bytes, secret: str) -> bool:
    ts = headers["X-Matrix-Timestamp"]
    if abs(time.time() - int(ts)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    sigs = [p.strip()[3:] for p in headers["X-Matrix-Signature"].split(",") if p.strip().startswith("v1=")]
    return any(hmac.compare_digest(expected, s) for s in sigs)
```

## Reference check (Node)

```js
const crypto = require('crypto');

function verify(headers, rawBody /* Buffer */, secret) {
  const ts = headers['x-matrix-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${ts}.`), rawBody])).digest('hex');
  return headers['x-matrix-signature'].split(',').map((p) => p.trim())
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const a = Buffer.from(p.slice(3)), b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
}
```

## Secret rotation

When the Matrix admin rotates the secret, both the new and the old secret sign every request for 24 hours, so you have that long to switch over.

## Operations (Matrix side)

- **Server variables.** `INTEGRATION_SECRET_KEY` encrypts the stored secrets, and `INTEGRATION_SENDER_ENABLED` switches sending on.
  - Both Railway environments share one database. Give them the **same** `INTEGRATION_SECRET_KEY`, and turn the sender on in **one** environment only.
  - Leave unused variables unset rather than empty.
- **Business-admin portal → Integrations:**
  - set the URL and switch sending on or off;
  - show the secret once, or rotate it;
  - send a test;
  - "Send all current sites" (backfill);
  - replay events that gave up.
- **Code:**
  - `backend/app/integrations/` covers capture, the payload, signing and the sender.
  - `backend/app/services/integration_service.py` holds the admin actions.

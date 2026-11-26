// skipcq: JS-0833
// Business-admin portal → Integrations → NSO platform.
// Endpoint URL + on/off, the signing secret (shown once, on first save or
// rotation), a test event, "send all current sites", one row per site sent (open
// it for that site's history: what changed each time and NSO's answers) and the
// dead-letter list with Replay. "View data" opens the exact JSON body sent.
// "Send again" (in a site's history, or by CA
// code) queues a fresh event with the site's current data, for when NSO
// answered 200 but didn't keep it. Matrix only sends; nothing here reads from NSO.
import React from 'react';
import {
  backfillNso, getNsoEvent, getNsoIntegration, getNsoSiteHistory, listNsoDead, listNsoSites, lookupNsoSite,
  replayNsoEvent, resendNsoSite, rotateNsoSecret, saveNsoIntegration, sendNsoTest,
} from '../../../services/api/integrationsApi.js';
import { Button, Card, Drawer, EmptyState, ErrorState, Icon, SectionHeader, Skeleton, T } from '../ui/kit.jsx';

const inputStyle = {
  width: '100%', boxSizing: 'border-box', height: 36, padding: '0 10px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.panel, color: T.text, font: 'inherit', fontSize: 13,
};
const errText = (err, fallback) => err?.detail || err?.message || fallback;
const when = (v) => (v ? new Date(v).toLocaleString() : '—');

function Notice({ msg }) {
  if (!msg) return null;
  return (
    <div role="status" style={{
      padding: '9px 12px', borderRadius: 9, fontSize: 13, marginBottom: 12,
      background: msg.tone === 'bad' ? T.dangerSoft : T.successSoft, color: msg.tone === 'bad' ? T.dangerText : T.successText,
    }}>{msg.text}</div>
  );
}

function SecretOnce({ secret, onDone }) {
  const [copied, setCopied] = React.useState(false);
  if (!secret) return null;
  const copy = () => navigator.clipboard?.writeText(secret).then(() => setCopied(true)).catch(() => {});
  return (
    <Card style={{ padding: 16, marginBottom: 16, borderColor: T.warn }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Signing secret — copy it now</div>
      <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 10 }}>
        Give this to the NSO team so they can verify our requests. It won&apos;t be shown again;
        if it&apos;s lost, rotate it.
      </div>
      <code style={{
        display: 'block', padding: '10px 12px', borderRadius: 8, background: T.surfaceInset,
        fontFamily: T.mono, fontSize: 13, wordBreak: 'break-all', marginBottom: 10,
      }}>{secret}</code>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={copy} icon={<Icon.check size={14} />}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="solid" onClick={onDone}>I&apos;ve saved it</Button>
      </div>
    </Card>
  );
}

function Counts({ counts }) {
  const items = [['Waiting', counts.pending + counts.failed + counts.sending], ['Sent', counts.sent], ['Gave up', counts.dead]];
  return (
    <div style={{ display: 'flex', gap: 24, fontSize: 13, color: T.textMuted }}>
      {items.map(([label, n]) => (
        <span key={label}><strong style={{ color: T.text, fontSize: 18, marginRight: 6 }}>{n}</strong>{label}</span>
      ))}
    </div>
  );
}

const ok = (code) => code >= 200 && code < 300;
const STATUS_LABEL = { pending: 'Waiting', sending: 'Sending', failed: 'Will retry', sent: 'Sent', dead: 'Gave up' };
const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
};

// Which site an event was about. The test event is about none.
function SiteCell({ site }) {
  if (!site) return <span style={{ color: T.textMuted }}>Test event</span>;
  return (
    <span>
      <span style={{ fontWeight: 600, color: T.text }}>{site.name || 'Unnamed site'}</span>
      {site.code && <span style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 11.5 }}> {site.code}</span>}
      {site.deleted && <span style={{ color: T.textMuted }}> (deleted)</span>}
    </span>
  );
}

// NSO's answer to a failed attempt (the first part of its response body).
function Reply({ text, max = 140 }) {
  if (!text) return null;
  const short = text.length > max ? `${text.slice(0, max)}…` : text;
  return (
    <div title={text} style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 11.5, marginTop: 2, wordBreak: 'break-word' }}>
      NSO said: {short}
    </div>
  );
}

function Result({ code, error, reply }) {
  return (
    <>
      <span style={{ color: ok(code) ? T.successText : T.dangerText, fontWeight: 600 }}>
        {code ?? (error ? error.slice(0, 60) : '—')}
      </span>
      {!ok(code) && <Reply text={reply} />}
    </>
  );
}

function ViewButton({ id, onView }) {
  return <Button size="sm" onClick={() => onView(id)}>View data</Button>;
}

// A new event with the site's current data (not a replay of the old one, which
// NSO would skip as already seen). Not offered for the test event or a deleted site.
const resendKey = (site) => `resend:${site.id}`;
function SendAgain({ site, actions }) {
  if (!site || site.deleted || !actions.enabled) return null;
  return (
    <Button size="sm" loading={actions.busy === resendKey(site)} disabled={actions.resending}
      onClick={() => actions.onResend(site)}
      title="Send this site's current data to NSO again">
      Send again
    </Button>
  );
}

// ── One row per site ─────────────────────────────────────────────────────────
// Each site sent to NSO appears once, however many updates it has had: when it
// was first sent, the latest update, and what that update is doing now. Opening
// a row shows the site's history: what changed each time and NSO's answers.

const STATE = {
  up_to_date: { label: 'Up to date', tone: 'good' },
  sending: { label: 'Sending', tone: 'neutral' },
  retrying: { label: 'Retrying', tone: 'warn' },
  gave_up: { label: 'Gave up', tone: 'bad' },
};
const toneColor = { good: T.successText, warn: T.warnText, bad: T.dangerText, neutral: T.text };

// What the latest event is waiting for, in words.
function stateDetail(state, latest, enabled) {
  if (state === 'sending' && !enabled) return 'Waiting: sending is switched off';
  if (state === 'retrying') {
    const why = latest.lastHttpStatus ? `NSO answered ${latest.lastHttpStatus}` : (latest.lastError || 'no response').slice(0, 60);
    return `${why} · next try ${when(latest.nextAttemptAt)}`;
  }
  if (state === 'gave_up') return latest.lastHttpStatus ? `NSO answered ${latest.lastHttpStatus}` : (latest.lastError || '').slice(0, 60);
  if (state === 'up_to_date' && latest.lastHttpStatus) return `NSO answered ${latest.lastHttpStatus}`;
  return '';
}

function StateCell({ state, latest, enabled }) {
  const s = STATE[state] || { label: state, tone: 'neutral' };
  const detail = stateDetail(state, latest, enabled);
  return (
    <span>
      <span style={{ fontWeight: 600, color: toneColor[s.tone] }}>{s.label}</span>
      {detail && <span style={{ display: 'block', color: T.textMuted, fontSize: 11.5 }}>{detail}</span>}
    </span>
  );
}

const FIELD_LABEL = {
  'site.cafe_code': 'CA code', 'site.status': 'Status', 'site.name': 'Name', 'site.city': 'City',
  'site.model': 'Model', 'site.archived': 'Archived', 'site.google_pin': 'Map pin', 'site.lat': 'Latitude',
  'site.lng': 'Longitude', 'site.google_maps_url': 'Maps link', 'company.name': 'Workspace name',
  'loi.uploaded': 'LOI uploaded', 'loi.uploaded_at': 'LOI date', 'licences.fssai_status': 'FSSAI',
  'dates.project_start': 'Project start', 'dates.handover': 'Handover to NSO',
  'dates.live_planned': 'Planned launch', 'dates.live_actual': 'Launched',
};
// Derived fields that always change with another one: not worth a line each.
const QUIET_FIELDS = new Set(['site.lat', 'site.lng', 'loi.uploaded']);
const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

function whatChanged(ev) {
  if (ev.eventType === 'site.test') return 'Test event';
  if (ev.eventType === 'site.deleted') return 'Site deleted';
  // "First sent" only for an event NSO actually received.
  if (ev.first) return ev.status === 'sent' ? 'First sent' : 'First event';
  if (!ev.changes) return 'Update';
  const shown = ev.changes.filter((c) => !QUIET_FIELDS.has(c.field));
  if (!shown.length) return 'Sent again (no change)';
  return shown.map((c) => `${FIELD_LABEL[c.field] || c.field}: ${show(c.from)} → ${show(c.to)}`).join(' · ');
}

function SiteHistory({ siteId, version, actions }) {
  const [res, setRes] = React.useState({ status: 'loading' });
  React.useEffect(() => {
    let live = true;
    getNsoSiteHistory(siteId)
      .then((h) => { if (live) setRes({ status: 'ready', h }); })
      .catch((err) => { if (live) setRes({ status: 'error', message: errText(err, 'Could not load this site.') }); });
    return () => { live = false; };
  }, [siteId, version]);
  if (res.status === 'loading') return <div style={{ display: 'grid', gap: 6 }}><Skeleton h={14} w="60%" /><Skeleton h={14} /></div>;
  if (res.status === 'error') return <div style={{ fontSize: 13, color: T.dangerText }}>{res.message}</div>;
  const { h } = res;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: h.reason ? T.dangerText : T.textMuted }}>
          {h.reason || (h.site ? 'Changes to this site are sent automatically.' : 'Events from the "Send test" button.')}
        </span>
        {!h.reason && <SendAgain site={h.site} actions={actions} />}
      </div>
      <ol aria-label="History" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {h.events.map((ev) => {
          const last = ev.tries[0];
          return (
            <li key={ev.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: `1px solid ${T.line}`, padding: '8px 0', fontSize: 12.5 }}>
              <span style={{ width: 150, flexShrink: 0, color: T.textMuted }}>{when(ev.createdAt)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: T.text }}>{whatChanged(ev)}</span>
                <span style={{ display: 'block', color: T.textMuted, fontSize: 11.5 }}>
                  #{ev.seq} · {STATUS_LABEL[ev.status] || ev.status}
                  {ev.tries.length > 1 ? ` after ${ev.tries.length} tries` : ''}
                  {ev.status === 'failed' && ev.nextAttemptAt ? ` · next try ${when(ev.nextAttemptAt)}` : ''}
                </span>
                {last && !ok(last.httpStatus) && <Reply text={last.responseSnippet || last.error} />}
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>
                {last ? <Result code={last.httpStatus} error={last.error} /> : <span style={{ color: T.textMuted }}>not tried yet</span>}
              </span>
              <ViewButton id={ev.id} onView={actions.onView} />
            </li>
          );
        })}
      </ol>
      <div style={{ fontSize: 12, color: T.textMuted }}>
        {h.truncated ? 'Showing the latest 100 events. ' : ''}
        Delivered updates older than 30 days are cleared (the first one is kept), so one line can cover several updates.
      </div>
    </div>
  );
}

function SiteRow({ row, open, onToggle, version, actions }) {
  const panelId = `nso-site-${row.siteId}`;
  return (
    <li style={{ borderTop: `1px solid ${T.line}` }}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
        style={{
          width: '100%', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 4px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 12.5, color: T.text,
        }}>
        <Icon.caret className={`ac-caret${open ? ' is-open' : ''}`} size={14} style={{ color: T.textFaint, marginTop: 2, flexShrink: 0 }} />
        <span style={{ flex: '1 1 260px', minWidth: 0 }}>
          {row.site ? <SiteCell site={row.site} /> : <span style={{ fontWeight: 600 }}>Test events</span>}
          <span style={{ display: 'block', color: T.textMuted, fontSize: 11.5, marginTop: 2 }}>
            {row.firstSentAt ? `First sent ${when(row.firstSentAt)}` : `First queued ${when(row.firstAt)} · not received yet`} · Last update {when(row.latest.createdAt)} · {row.events} {row.events === 1 ? 'event' : 'events'}
          </span>
        </span>
        <span style={{ flex: '0 1 220px', minWidth: 150 }}><StateCell state={row.state} latest={row.latest} enabled={actions.enabled} /></span>
      </button>
      {open && (
        <div id={panelId} style={{ padding: '4px 4px 12px 30px' }}>
          <SiteHistory siteId={row.siteId} version={version} actions={actions} />
        </div>
      )}
    </li>
  );
}

function SitesSent({ version, actions }) {
  const [q, setQ] = React.useState('');
  const [query, setQuery] = React.useState({ q: '', page: 1 });
  const [res, setRes] = React.useState({ status: 'loading' });
  const [openId, setOpenId] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    listNsoSites(query.q, query.page)
      .then((data) => { if (live) setRes({ status: 'ready', data }); })
      // Keep the rows on screen if a refresh fails; only a first load shows the error.
      .catch((err) => { if (live) setRes((prev) => (prev.data ? prev : { status: 'error', message: errText(err, 'Could not load the sites.') })); });
    return () => { live = false; };
  }, [query, version]);
  const search = (e) => {
    e.preventDefault();
    setOpenId(null);
    // Drop the previous rows so they can't be read as matches for the new search.
    setRes({ status: 'loading' });
    setQuery({ q: q.trim(), page: 1 });
  };
  const data = res.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const go = (page) => { setOpenId(null); setQuery((cur) => ({ ...cur, page })); };
  return (
    <div>
      <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label htmlFor="nso-site-search" style={srOnly}>Site name or code</label>
        <input id="nso-site-search" style={inputStyle} placeholder="Find a site by name or code" value={q} maxLength={100}
          onChange={(e) => setQ(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      {res.status === 'loading' && <div style={{ display: 'grid', gap: 8 }}><Skeleton h={16} /><Skeleton h={16} /></div>}
      {res.status === 'error' && <div style={{ fontSize: 13, color: T.dangerText }}>{res.message}</div>}
      {data && !data.sites.length && (
        <div style={{ fontSize: 13, color: T.textMuted }}>
          {query.q ? `Nothing has been sent for a site matching “${query.q}”.` : 'Nothing has been sent yet.'}
        </div>
      )}
      {data && data.sites.length > 0 && (
        <>
          <ul aria-label="Sites sent to NSO" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.sites.map((row) => (
              <SiteRow key={row.siteId} row={row} version={version} actions={actions}
                open={openId === row.siteId} onToggle={() => setOpenId((cur) => (cur === row.siteId ? null : row.siteId))} />
            ))}
          </ul>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', fontSize: 12.5, color: T.textMuted, marginTop: 8 }}>
              <Button size="sm" disabled={query.page <= 1} onClick={() => go(query.page - 1)}>Previous</Button>
              <span>Page {query.page} of {pages} · {data.total} sites</span>
              <Button size="sm" disabled={query.page >= pages} onClick={() => go(query.page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeadList({ rows, onReplay, onView, busyId }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: T.textMuted }}>Nothing has given up.</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 13, borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SiteCell site={r.site} />
            <div style={{ color: T.textMuted, fontSize: 12.5 }}>
              {r.eventType} #{r.seq} · <span style={{ color: T.dangerText }}>{r.lastHttpStatus ?? 'no response'}</span> · {when(r.createdAt)}
              {r.lastError && !r.responseSnippet ? <> · {r.lastError.slice(0, 80)}</> : null}
            </div>
            <Reply text={r.responseSnippet} max={200} />
          </div>
          <ViewButton id={r.id} onView={onView} />
          <Button size="sm" loading={busyId === r.id} onClick={() => onReplay(r.id)}>Replay</Button>
        </div>
      ))}
    </div>
  );
}

// Send one site by its CA code: check it exists here and is shared with NSO
// (pushed to Legal, or Finance-approved), show when it was last sent, then send
// its current data.
function SendByCaCode({ actions }) {
  const [code, setCode] = React.useState('');
  const [res, setRes] = React.useState({ status: 'idle' });
  const [sent, setSent] = React.useState(false);
  const seq = React.useRef(0);
  const check = async (e) => {
    e.preventDefault();
    const term = code.trim();
    if (!term) return;
    const mine = ++seq.current;
    setRes({ status: 'loading' }); setSent(false);
    try {
      const found = await lookupNsoSite(term);
      if (mine === seq.current) setRes({ status: 'ready', found });
    } catch (err) {
      if (mine === seq.current) setRes({ status: 'error', message: errText(err, 'Could not check that CA code.') });
    }
  };
  const { found } = res;
  const last = found?.lastEvent;
  const send = async () => {
    if (await actions.onResend(found.site)) setSent(true);
  };
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Send a site by CA code</div>
      <div style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 10 }}>
        Enter a CA code to check the site, then send its current data to NSO as a new event.
      </div>
      <form onSubmit={check} style={{ display: 'flex', gap: 8 }}>
        <label htmlFor="nso-ca-code" style={srOnly}>CA code</label>
        <input id="nso-ca-code" style={inputStyle} placeholder="CA code, e.g. CA-400" value={code} maxLength={100}
          onChange={(e) => {
            // A result belongs to the code that was checked: editing the code
            // clears it, so Send can never queue a different site than shown.
            setCode(e.target.value); setSent(false); seq.current += 1; setRes({ status: 'idle' });
          }} />
        <Button type="submit" loading={res.status === 'loading'} disabled={!code.trim()}>Check</Button>
      </form>
      {res.status === 'error' && <div role="alert" style={{ fontSize: 13, color: T.dangerText, marginTop: 10 }}>{res.message}</div>}
      {found && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 9, border: `1px solid ${T.line}`,
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220, fontSize: 13 }}>
            <SiteCell site={found.site} />
            {found.site.city && <span style={{ color: T.textMuted }}> · {found.site.city}</span>}
            <div style={{ color: T.textMuted, fontSize: 12.5, marginTop: 2 }}>
              {last
                ? `Last event #${last.seq}: ${STATUS_LABEL[last.status] || last.status}${last.lastHttpStatus ? ` (${last.lastHttpStatus})` : ''} · ${when(last.sentAt || last.createdAt)}`
                : 'Never sent to NSO.'}
            </div>
            {!found.shareable && <div style={{ color: T.dangerText, fontSize: 12.5, marginTop: 4 }}>{found.reason}</div>}
            {sent && (
              <div role="status" style={{ color: T.successText, fontSize: 12.5, marginTop: 4 }}>
                Queued. It goes out within a few seconds and shows in the sites list above.
              </div>
            )}
          </div>
          {found.shareable && (
            <Button variant="solid" loading={actions.busy === resendKey(found.site)} disabled={actions.resending}
              onClick={send}>Send to NSO</Button>
          )}
        </div>
      )}
    </Card>
  );
}
// One event: the exact body Matrix posts, and NSO's reply to every attempt.
function EventDrawer({ id, onClose, actions }) {
  const [state, setState] = React.useState({ status: 'loading' });
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setState({ status: 'loading' }); setCopied(false);
    getNsoEvent(id)
      .then((ev) => { if (live) setState({ status: 'ready', ev }); })
      .catch((err) => { if (live) setState({ status: 'error', message: errText(err, 'Could not load this event.') }); });
    return () => { live = false; };
  }, [id]);
  const ev = state.ev;
  const json = ev ? JSON.stringify(ev.body, null, 2) : '';
  const copy = () => navigator.clipboard?.writeText(json).then(() => setCopied(true)).catch(() => {});
  return (
    <Drawer open={Boolean(id)} onClose={onClose}
      footer={ev?.site && !ev.site.deleted ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: T.textMuted }}>
          <span>NSO answered but doesn&apos;t have it? Send the site&apos;s current data as a new event.</span>
          <SendAgain site={ev.site} actions={actions} />
        </div>
      ) : null}
      subtitle={ev ? `${ev.eventType} #${ev.seq} · ${STATUS_LABEL[ev.status] || ev.status}` : 'Event'}
      title={ev ? (ev.site ? (ev.site.name || 'Unnamed site') : 'Test event') : 'Loading…'}>
      {state.status === 'loading' && <div style={{ display: 'grid', gap: 8 }}><Skeleton h={16} w="50%" /><Skeleton h={220} /></div>}
      {state.status === 'error' && <div style={{ fontSize: 13, color: T.dangerText }}>{state.message}</div>}
      {ev && (
        <div style={{ display: 'grid', gap: 18, fontSize: 13 }}>
          <section>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Attempts</div>
            {!ev.attempts.length && <div style={{ color: T.textMuted }}>Not sent yet.</div>}
            {ev.attempts.map((a) => (
              <div key={a.attemptNo} style={{ borderTop: `1px solid ${T.line}`, padding: '6px 0' }}>
                <span style={{ color: T.textMuted }}>#{a.attemptNo} · {when(a.attemptedAt)} · </span>
                <Result code={a.httpStatus} error={a.error} reply={a.responseSnippet} />
                {ok(a.httpStatus) && a.durationMs != null && <span style={{ color: T.textMuted }}> · {a.durationMs} ms</span>}
              </div>
            ))}
          </section>
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>Data sent</div>
              <Button size="sm" onClick={copy} icon={<Icon.check size={14} />}>{copied ? 'Copied' : 'Copy JSON'}</Button>
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>
              The JSON body posted to NSO for this event (signed; headers not shown).
            </div>
            <pre style={{
              margin: 0, padding: 12, borderRadius: 8, background: T.surfaceInset, color: T.text,
              fontFamily: T.mono, fontSize: 12, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre',
            }}>{json}</pre>
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function IntegrationsTab() {
  const [state, setState] = React.useState({ status: 'loading' });
  const [dead, setDead] = React.useState([]);
  const [form, setForm] = React.useState({ endpointUrl: '', enabled: false });
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState(null);
  const [secret, setSecret] = React.useState('');
  const [viewing, setViewing] = React.useState(null);
  // Bumped on every reload, so the sites list and an open history refresh too.
  const [version, setVersion] = React.useState(0);
  const closeView = React.useCallback(() => setViewing(null), []);

  const load = React.useCallback(async () => {
    try {
      const [cfg, deadRows] = await Promise.all([getNsoIntegration(), listNsoDead()]);
      setState({ status: 'ready', data: cfg });
      setDead(deadRows);
      setVersion((v) => v + 1);
      setForm((f) => (f.touched ? f : { endpointUrl: cfg.endpointUrl || '', enabled: cfg.enabled }));
    } catch (err) {
      // Keep what is on screen (including a just-shown secret) if a refresh fails;
      // only a first load with nothing to show becomes an error page.
      setState((prev) => (prev.status === 'ready'
        ? prev
        : { status: 'error', message: errText(err, 'Could not load the integration.') }));
      setMsg((m) => m || { tone: 'bad', text: errText(err, 'Could not refresh — showing the last loaded state.') });
    }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // `submitted` = the form values a save sent; edits made while it was in
  // flight stay "touched" so the reload doesn't overwrite them.
  // Returns whether the action succeeded.
  const run = async (key, fn, okText, submitted) => {
    let done = false;
    setBusy(key); setMsg(null);
    try {
      const out = await fn();
      done = true;
      if (out?.secret) setSecret(out.secret);
      setMsg({ tone: 'good', text: typeof okText === 'function' ? okText(out) : okText });
      // Only a save makes the server's values the form's; an unsaved edit must
      // survive "Send test", "Rotate", "Replay"…
      if (submitted) {
        setForm((f) => (f.endpointUrl === submitted.endpointUrl && f.enabled === submitted.enabled
          ? { ...f, touched: false } : f));
      }
      await load();
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err, 'That did not work.') });
    } finally {
      setBusy('');
    }
    return done;
  };
  // One resend at a time: `busy` holds a single key, so a second concurrent
  // resend would clear the first one's spinner and let it be clicked twice.
  const actions = {
    busy,
    resending: busy.startsWith('resend:'),
    enabled: Boolean(state.data?.enabled),
    onView: setViewing,
    onResend: (site) => run(resendKey(site), () => resendNsoSite(site.id),
      `${site.name || 'Site'} queued again with its current data. It goes out within a few seconds.`),
  };

  if (state.status === 'loading') {
    return <div style={{ display: 'grid', gap: 8 }}><Skeleton h={18} w="40%" /><Skeleton h={80} /><Skeleton h={120} /></div>;
  }
  if (state.status === 'error') return <ErrorState message={state.message} onRetry={load} />;
  const cfg = state.data;

  return (
    <div>
      <SectionHeader icon={Icon.external} title="NSO platform"
        description="Matrix sends each site to the NSO platform as a signed webhook from the moment it is pushed to Legal (or once Finance approves its CA code), and again whenever its details change."
        onRefresh={load} />

      {!cfg.keyConfigured && (
        <>
          <Notice msg={msg} />
          <EmptyState icon={Icon.alert} title="Not available yet"
            hint="The server has no integration key (INTEGRATION_SECRET_KEY). Ask the platform team to set it." />
          {cfg.enabled && (
            <div style={{ marginTop: 12 }}>
              <Button variant="danger" loading={busy === 'off'}
                onClick={() => run('off', () => saveNsoIntegration({ endpointUrl: cfg.endpointUrl, enabled: false }), 'Switched off.')}>
                Switch off sending
              </Button>
            </div>
          )}
        </>
      )}

      {cfg.keyConfigured && (
        <>
          <Notice msg={msg} />
          <SecretOnce secret={secret} onDone={() => setSecret('')} />

          <Card style={{ padding: 16, marginBottom: 16 }}>
            <label htmlFor="nso-url" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
              Endpoint URL (from the NSO team)
            </label>
            <input id="nso-url" style={inputStyle} placeholder="https://…" value={form.endpointUrl}
              onChange={(e) => setForm({ ...form, endpointUrl: e.target.value, touched: true })} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '12px 0' }}>
              <input type="checkbox" checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked, touched: true })} />
              Send site updates to the NSO platform
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="solid" loading={busy === 'save'} disabled={!form.endpointUrl}
                onClick={() => {
                  const submitted = { endpointUrl: form.endpointUrl, enabled: form.enabled };
                  run('save', () => saveNsoIntegration(submitted), (o) => (o.justEnabled
                    ? 'Saved and switched on. Changes made while it was off were not sent — click "Send all current sites" below.'
                    : 'Saved.'), submitted);
                }}>Save</Button>
              {cfg.configured && (
                <Button icon={<Icon.rotate size={14} />} loading={busy === 'rotate'}
                  onClick={() => run('rotate', rotateNsoSecret, 'New secret created. The old one keeps working for 24 hours.')}>
                  Rotate secret
                </Button>
              )}
            </div>
            {cfg.rotationInProgress && (
              <div style={{ fontSize: 12, color: T.textMuted, marginTop: 8 }}>
                Rotation in progress: requests are signed with both the new and the old secret for 24 hours.
              </div>
            )}
          </Card>

          {cfg.enabled && (
            <Card style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Counts counts={cfg.counts} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button loading={busy === 'test'} onClick={() => run('test', sendNsoTest, 'Test event queued; it goes out shortly.')}>
                    Send test
                  </Button>
                  <Button loading={busy === 'backfill'}
                    onClick={() => run('backfill', backfillNso, (o) => `${o.queued} of ${o.eligible} eligible sites queued (the rest are already up to date).`)}>
                    Send all current sites
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {cfg.configured && (
            <Card style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Sites sent</div>
              <div style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 10 }}>
                One row per site. Open a row to see every update sent for it, what changed, and NSO&apos;s answer.
              </div>
              <SitesSent version={version} actions={actions} />
            </Card>
          )}

          {cfg.configured && (
            <Card style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Gave up</div>
              <div style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 10 }}>
                Events the NSO platform rejected, or that kept failing for about 2 days. Fix the cause, then replay.
              </div>
              <DeadList rows={dead} busyId={busy} onView={setViewing}
                onReplay={(id) => run(id, () => replayNsoEvent(id), 'Queued again.')} />
            </Card>
          )}

          {cfg.configured && (
            <div style={{ marginTop: 16 }}>
              {cfg.enabled && <SendByCaCode actions={actions} />}
            </div>
          )}
          <EventDrawer id={viewing} onClose={closeView} actions={actions} />
        </>
      )}
    </div>
  );
}

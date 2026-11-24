// skipcq: JS-0833
// Business-admin portal → Integrations → NSO platform.
// Endpoint URL + on/off, the signing secret (shown once, on first save or
// rotation), a test event, "send all current sites", recent deliveries and the
// dead-letter list with Replay. Every event names its site and shows NSO's
// reply; "View data" opens the exact JSON body sent, and the site search answers
// "what did we send for this site?". Matrix only sends; nothing here reads from NSO.
import React from 'react';
import {
  backfillNso, getNsoEvent, getNsoIntegration, listNsoDead, replayNsoEvent, rotateNsoSecret, saveNsoIntegration,
  searchNsoEvents, sendNsoTest,
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
const cell = { padding: '7px 6px', verticalAlign: 'top' };
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

function Deliveries({ rows, onView }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: T.textMuted }}>No deliveries yet.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: T.textMuted, textAlign: 'left' }}>
            <th style={cell}>When</th><th style={cell}>Site</th><th style={cell}>Event</th>
            <th style={cell}>Result</th><th style={cell}>Time</th><th style={cell}><span style={srOnly}>Data</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={`${d.outboxId}-${d.attemptNo}`} style={{ borderTop: `1px solid ${T.line}` }}>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>{when(d.attemptedAt)}</td>
              <td style={cell}><SiteCell site={d.site} /></td>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>{d.eventType} #{d.seq}</td>
              <td style={{ ...cell, maxWidth: 320 }}><Result code={d.httpStatus} error={d.error} reply={d.responseSnippet} /></td>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>{d.durationMs != null ? `${d.durationMs} ms` : '—'}</td>
              <td style={{ ...cell, textAlign: 'right' }}><ViewButton id={d.outboxId} onView={onView} /></td>
            </tr>
          ))}
        </tbody>
      </table>
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

// "What did we send for site X?": the latest events for matching sites.
function SiteSearch({ onView }) {
  const [q, setQ] = React.useState('');
  const [res, setRes] = React.useState({ status: 'idle', rows: [] });
  const seq = React.useRef(0);
  const search = async (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    const mine = ++seq.current;
    // Drop the previous results so they can't be read as matches for the new query.
    setRes({ status: 'loading', rows: [] });
    try {
      const rows = await searchNsoEvents(term);
      if (mine === seq.current) setRes({ status: 'ready', rows, term });
    } catch (err) {
      if (mine === seq.current) setRes({ status: 'error', rows: [], message: errText(err, 'Search failed.') });
    }
  };
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>What was sent for a site</div>
      <div style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 10 }}>
        Search by site name or code to see every event sent for it, whether NSO accepted it, and the exact data.
      </div>
      <form onSubmit={search} style={{ display: 'flex', gap: 8, marginBottom: res.status === 'idle' ? 0 : 12 }}>
        <label htmlFor="nso-site-search" style={srOnly}>Site name or code</label>
        <input id="nso-site-search" style={inputStyle} placeholder="Site name or code" value={q} maxLength={100}
          onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="solid" loading={res.status === 'loading'} disabled={!q.trim()}>Search</Button>
      </form>
      {res.status === 'error' && <div style={{ fontSize: 13, color: T.dangerText }}>{res.message}</div>}
      {res.status === 'ready' && !res.rows.length && (
        <div style={{ fontSize: 13, color: T.textMuted }}>Nothing has been sent for a site matching “{res.term}”.</div>
      )}
      {res.rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: T.textMuted, textAlign: 'left' }}>
                <th style={cell}>Queued</th><th style={cell}>Site</th><th style={cell}>Event</th>
                <th style={cell}>Status</th><th style={cell}><span style={srOnly}>Data</span></th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                  <td style={cell}><SiteCell site={r.site} /></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{r.eventType} #{r.seq}</td>
                  <td style={{ ...cell, color: r.status === 'sent' ? T.successText : r.status === 'dead' ? T.dangerText : T.text }}>
                    {STATUS_LABEL[r.status] || r.status}{r.lastHttpStatus ? ` · ${r.lastHttpStatus}` : ''}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}><ViewButton id={r.id} onView={onView} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// One event: the exact body Matrix posts, and NSO's reply to every attempt.
function EventDrawer({ id, onClose }) {
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
  const closeView = React.useCallback(() => setViewing(null), []);

  const load = React.useCallback(async () => {
    try {
      const [cfg, deadRows] = await Promise.all([getNsoIntegration(), listNsoDead()]);
      setState({ status: 'ready', data: cfg });
      setDead(deadRows);
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
  const run = async (key, fn, okText, submitted) => {
    setBusy(key); setMsg(null);
    try {
      const out = await fn();
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
  };

  if (state.status === 'loading') {
    return <div style={{ display: 'grid', gap: 8 }}><Skeleton h={18} w="40%" /><Skeleton h={80} /><Skeleton h={120} /></div>;
  }
  if (state.status === 'error') return <ErrorState message={state.message} onRetry={load} />;
  const cfg = state.data;

  return (
    <div>
      <SectionHeader icon={Icon.external} title="NSO platform"
        description="Matrix sends each eligible site to the NSO platform as a signed webhook whenever its details change. Sites are shared once Finance has approved them (they have a cafe code)."
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
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
              <Deliveries rows={cfg.recentDeliveries} onView={setViewing} />
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

          {cfg.configured && <div style={{ marginTop: 16 }}><SiteSearch onView={setViewing} /></div>}
          <EventDrawer id={viewing} onClose={closeView} />
        </>
      )}
    </div>
  );
}

// skipcq: JS-0833
// Business-admin portal → Integrations → NSO platform.
// Endpoint URL + on/off, the signing secret (shown once, on first save or
// rotation), a test event, "send all current sites", recent deliveries and the
// dead-letter list with Replay. Matrix only sends; nothing here reads from NSO.
import React from 'react';
import {
  backfillNso, getNsoIntegration, listNsoDead, replayNsoEvent, rotateNsoSecret, saveNsoIntegration, sendNsoTest,
} from '../../../services/api/integrationsApi.js';
import { Button, Card, EmptyState, ErrorState, Icon, SectionHeader, Skeleton, T } from '../ui/kit.jsx';

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

function Deliveries({ rows }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: T.textMuted }}>No deliveries yet.</div>;
  return (
    <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ color: T.textMuted, textAlign: 'left' }}>
          <th style={{ padding: '6px 4px' }}>When</th><th>Event</th><th>Result</th><th>Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={`${d.outboxId}-${d.attemptNo}`} style={{ borderTop: `1px solid ${T.line}` }}>
            <td style={{ padding: '6px 4px' }}>{when(d.attemptedAt)}</td>
            <td>{d.eventType} #{d.seq}</td>
            <td style={{ color: d.httpStatus >= 200 && d.httpStatus < 300 ? T.successText : T.dangerText }}>
              {d.httpStatus ?? (d.error ? d.error.slice(0, 60) : '—')}
            </td>
            <td>{d.durationMs != null ? `${d.durationMs} ms` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeadList({ rows, onReplay, busyId }) {
  if (!rows.length) return <div style={{ fontSize: 13, color: T.textMuted }}>Nothing has given up.</div>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
          <span style={{ flex: 1 }}>
            {r.eventType} #{r.seq} · {r.lastHttpStatus ?? 'no response'} · {when(r.createdAt)}
            {r.lastError ? <span style={{ color: T.textMuted }}> · {r.lastError.slice(0, 80)}</span> : null}
          </span>
          <Button size="sm" loading={busyId === r.id} onClick={() => onReplay(r.id)}>Replay</Button>
        </div>
      ))}
    </div>
  );
}

export default function IntegrationsTab() {
  const [state, setState] = React.useState({ status: 'loading' });
  const [dead, setDead] = React.useState([]);
  const [form, setForm] = React.useState({ endpointUrl: '', enabled: false });
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState(null);
  const [secret, setSecret] = React.useState('');

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

  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(null);
    try {
      const out = await fn();
      if (out?.secret) setSecret(out.secret);
      setMsg({ tone: 'good', text: typeof okText === 'function' ? okText(out) : okText });
      // Only a save makes the server's values the form's; an unsaved edit must
      // survive "Send test", "Rotate", "Replay"…
      if (key === 'save') setForm((f) => ({ ...f, touched: false }));
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
                onClick={() => run('save', () => saveNsoIntegration(form), (o) => (o.justEnabled
                  ? 'Saved and switched on. Changes made while it was off were not sent — click "Send all current sites" below.'
                  : 'Saved.'))}>Save</Button>
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
              <Deliveries rows={cfg.recentDeliveries} />
            </Card>
          )}

          {cfg.configured && (
            <Card style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Gave up</div>
              <div style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 10 }}>
                Events the NSO platform rejected, or that kept failing for about 2 days. Fix the cause, then replay.
              </div>
              <DeadList rows={dead} busyId={busy}
                onReplay={(id) => run(id, () => replayNsoEvent(id), 'Queued again.')} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

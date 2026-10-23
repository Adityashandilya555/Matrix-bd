// skipcq: JS-0833
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../state/SessionContext.jsx';
import { ROLE } from '../../rbac/roles.js';
import { WORKSPACE_MODULES, workspaceModuleRoute } from '../shared/workspaceModules.js';
import {
  cancelExecModuleAccessRequest,
  listModuleSupervisors,
  listMyExecModuleAccess,
  requestExecModuleAccess,
} from '../../services/api/adapters/httpAdapter.js';

// Module access, executive edition (migration 20261022).
//
// The executive's own surface for working in a second module. One row per
// module. A requestable row expands into a supervisor picker: the request goes
// to a business admin and names who the executive will report to there. Once
// approved, "Enter workspace" makes this session act as an executive of that
// module; the backend re-checks the grant on every request.
//
// NSO is the exception (migration 20261023). It has no executive role, so its
// grant is NSO supervisor access: no supervisor is chosen, and inside NSO the
// executive works as its supervisor.
//
// Rows come from WORKSPACE_MODULES, like the supervisor page, so the switchers
// cannot drift from one another.

const EXECUTIVE_MODULES = WORKSPACE_MODULES;

// The module whose grant is supervisor access and names no supervisor.
const SUPERVISOR_ACCESS_MODULE = 'nso';

const LAST_DECISION = {
  rejected:  'A previous request was declined',
  revoked:   'Access was withdrawn',
  cancelled: 'You withdrew a previous request',
};

export default function ExecutiveModuleAccessPage() {
  const { session, switchAs, effectiveModule, borrowedModule } = useSession();
  const navigate = useNavigate();
  const [states, setStates] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  // The row whose supervisor picker is open, and what it has loaded.
  const [picking, setPicking] = useState(null);
  const [supervisors, setSupervisors] = useState({ module: null, status: 'idle', items: [] });
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  // Which module's supervisor list a response may still be applied to.
  const pickingRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const rows = await listMyExecModuleAccess();
      setStates(Object.fromEntries(rows.map((r) => [r.module, r])));
      setStatus('ready');
      setError(null);
    } catch (e) {
      // 'error', not 'ready': with no rows loaded every module would default to
      // "none" and offer Request access — including the executive's own module.
      setStatus('error');
      setError(e?.detail || e?.message || 'Could not load your module access.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPicker = async (moduleKey) => {
    setPicking(moduleKey); setChoice(''); setNote(''); setError(null);
    if (moduleKey === SUPERVISOR_ACCESS_MODULE) {
      // Nobody to choose, so nothing to load.
      pickingRef.current = moduleKey;
      setSupervisors({ module: moduleKey, status: 'ready', items: [] });
      return;
    }
    setSupervisors({ module: moduleKey, status: 'loading', items: [] });
    // Applied only while this module is still the one being picked. Opening
    // another row before this resolves would otherwise let the late answer
    // overwrite the newer row's state, which the render then reads as not
    // its own and leaves on "Loading supervisors…" for good.
    pickingRef.current = moduleKey;
    try {
      const items = await listModuleSupervisors(moduleKey);
      if (pickingRef.current !== moduleKey) return;
      setSupervisors({ module: moduleKey, status: 'ready', items });
    } catch (e) {
      if (pickingRef.current !== moduleKey) return;
      setSupervisors({ module: moduleKey, status: 'error', items: [] });
      setError(e?.detail || e?.message || 'Could not load that module’s supervisors.');
    }
  };

  const closePicker = () => { pickingRef.current = null; setPicking(null); setChoice(''); setNote(''); };

  const submit = async (moduleKey) => {
    const supervisorAccess = moduleKey === SUPERVISOR_ACCESS_MODULE;
    if (!choice && !supervisorAccess) return;
    setBusy(moduleKey); setError(null);
    try {
      await requestExecModuleAccess({
        module: moduleKey,
        targetSupervisorId: supervisorAccess ? null : choice,
        note,
      });
      closePicker();
      await load();
    } catch (e) {
      setError(e?.detail || e?.message || 'Could not send that request.');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (moduleKey, requestId) => {
    setBusy(moduleKey); setError(null);
    try {
      await cancelExecModuleAccessRequest(requestId);
      await load();
    } catch (e) {
      setError(e?.detail || e?.message || 'Could not withdraw that request.');
    } finally {
      setBusy(null);
    }
  };

  const enter = (moduleKey) => {
    switchAs(ROLE.EXECUTIVE, moduleKey);
    navigate(workspaceModuleRoute(moduleKey));
  };

  const exit = () => {
    switchAs(null, null);
    navigate(workspaceModuleRoute(session?.module));
  };

  return (
    <div style={{ padding: '22px 26px', maxWidth: 820 }}>
      <h1 style={{ margin: 0, font: '600 20px/1.3 var(--zm-font-body)', color: 'var(--zm-fg)' }}>
        Module access
      </h1>
      <p style={{ margin: '6px 0 18px', font: '13px/1.5 var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
        Ask a business admin to make you an executive of another module too. Pick the supervisor you
        will work under there. Once approved you can enter it; your own module stays yours.
      </p>

      {error && (
        <div role="alert" style={{
          marginBottom: 14, padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--zm-danger-border, #f3c2c2)',
          background: 'var(--zm-danger-bg, #fdf1f1)',
          font: '12.5px/1.45 var(--zm-font-body)', color: 'var(--zm-danger-fg, #9b1c1c)',
        }}>{error}</div>
      )}

      {status === 'loading' ? (
        <div style={{ font: '13px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>Loading…</div>
      ) : status === 'error' ? (
        <button
          type="button"
          onClick={() => { setStatus('loading'); load(); }}
          style={btnStyle(false)}
        >
          Try again
        </button>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {EXECUTIVE_MODULES.map((m) => {
            const row = states[m.value] || { state: 'none' };
            const isHere = borrowedModule === m.value && effectiveModule === m.value;
            const open = picking === m.value && row.state === 'none';
            return (
              <li key={m.value} data-testid={`exec-access-${m.value}`} style={{
                padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '600 14px var(--zm-font-body)', color: 'var(--zm-fg)' }}>
                      {m.label}
                    </div>
                    <div style={{ font: '12px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
                      {subLabel(row, isHere, m.value)}
                    </div>
                  </div>
                  {row.state === 'home' && (
                    <span style={{
                      font: '11.5px var(--zm-font-body)', color: 'var(--zm-fg-muted)',
                      border: '1px solid var(--zm-line)', borderRadius: 999, padding: '3px 10px',
                    }}>Your module</span>
                  )}
                  {row.state === 'pending' && (
                    <button
                      type="button"
                      onClick={() => cancel(m.value, row.requestId)}
                      disabled={busy === m.value || !row.requestId}
                      style={btnStyle(false)}
                    >
                      {busy === m.value ? 'Withdrawing…' : 'Withdraw request'}
                    </button>
                  )}
                  {row.state === 'granted' && (
                    isHere ? (
                      <button type="button" onClick={exit} style={btnStyle(false)}>Exit workspace</button>
                    ) : (
                      <button type="button" onClick={() => enter(m.value)} style={btnStyle(true)}>
                        Enter workspace
                      </button>
                    )
                  )}
                  {row.state === 'none' && !open && (
                    <button type="button" onClick={() => openPicker(m.value)} style={btnStyle(false)}>
                      Request access
                    </button>
                  )}
                </div>

                {open && (
                  <SupervisorPicker
                    moduleLabel={m.label}
                    supervisorAccess={m.value === SUPERVISOR_ACCESS_MODULE}
                    supervisors={supervisors.module === m.value ? supervisors : { status: 'loading', items: [] }}
                    choice={choice}
                    onChoice={setChoice}
                    note={note}
                    onNote={setNote}
                    busy={busy === m.value}
                    onSubmit={() => submit(m.value)}
                    onCancel={closePicker}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function subLabel(row, isHere, moduleKey) {
  if (isHere) return 'You are working here now';
  if (moduleKey === SUPERVISOR_ACCESS_MODULE) {
    if (row.state === 'granted') return 'NSO supervisor access granted';
    if (row.state === 'pending') return 'Awaiting a business admin · NSO supervisor access';
    if (row.state === 'none') return LAST_DECISION[row.lastDecision] || 'You would work here as its supervisor';
  }
  if (row.state === 'granted') {
    return row.supervisorName ? `Access granted · under ${row.supervisorName}` : 'Access granted';
  }
  if (row.state === 'pending') {
    return row.supervisorName
      ? `Awaiting a business admin · under ${row.supervisorName}`
      : 'Awaiting a business admin';
  }
  if (row.state === 'none') return LAST_DECISION[row.lastDecision] || '';
  return '';
}

function SupervisorPicker({
  moduleLabel, supervisorAccess, supervisors, choice, onChoice, note, onNote, busy, onSubmit, onCancel,
}) {
  const selectId = `exec-access-supervisor-${moduleLabel}`;
  const noteId = `exec-access-note-${moduleLabel}`;
  const empty = supervisors.status === 'ready' && supervisors.items.length === 0;
  const canSend = (supervisorAccess || Boolean(choice)) && !busy;
  return (
    <div style={{
      marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--zm-line)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {supervisorAccess ? (
        <p style={{ margin: 0, font: '12.5px/1.5 var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
          {moduleLabel} has no executive role, so this asks for {moduleLabel} supervisor access. Once
          approved you work there as its supervisor, including final approval. Nobody is chosen to
          work under.
        </p>
      ) : (
        <label htmlFor={selectId} style={labelStyle}>Supervisor in {moduleLabel}</label>
      )}
      {supervisorAccess ? null : supervisors.status === 'loading' ? (
        <div style={{ font: '12.5px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
          Loading supervisors…
        </div>
      ) : supervisors.status === 'error' ? (
        <div style={{ font: '12.5px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
          Could not load {moduleLabel}’s supervisors. Cancel and try again.
        </div>
      ) : empty ? (
        <div style={{ font: '12.5px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
          {moduleLabel} has no active supervisors yet, so there is no one to work under.
        </div>
      ) : (
        <select
          id={selectId}
          value={choice}
          onChange={(e) => onChoice(e.target.value)}
          style={fieldStyle}
        >
          <option value="">Choose a supervisor…</option>
          {supervisors.items.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.email}</option>
          ))}
        </select>
      )}
      <label htmlFor={noteId} style={labelStyle}>Note for the business admin (optional)</label>
      <textarea
        id={noteId}
        value={note}
        maxLength={500}
        rows={2}
        onChange={(e) => onNote(e.target.value)}
        style={{ ...fieldStyle, height: 'auto', padding: '7px 10px', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle(false)}>Cancel</button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          style={{ ...btnStyle(true), opacity: canSend ? 1 : 0.6 }}
        >
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </div>
  );
}

const labelStyle = { font: '600 12px var(--zm-font-body)', color: 'var(--zm-fg)' };

const fieldStyle = {
  height: 34, padding: '0 10px', borderRadius: 8,
  border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
  color: 'var(--zm-fg)', font: '13px var(--zm-font-body)',
};

function btnStyle(primary) {
  return {
    font: '12.5px var(--zm-font-body)', padding: '7px 13px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${primary ? 'var(--zm-accent, #2a78d6)' : 'var(--zm-line)'}`,
    background: primary ? 'var(--zm-accent, #2a78d6)' : 'transparent',
    color: primary ? '#fff' : 'var(--zm-fg)',
  };
}

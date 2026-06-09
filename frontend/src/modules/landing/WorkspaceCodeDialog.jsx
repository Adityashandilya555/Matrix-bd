import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useRive, useStateMachineInput, Layout, Fit, Alignment } from '@rive-app/react-canvas';
import RiveErrorBoundary from './RiveErrorBoundary.jsx';
import { getWorkspaceBranding } from '../../services/api/supabaseAuth.js';
import riveUrl from '../../assets/rive/workspace-code.riv?url';
import './branded-auth.css';

const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

/**
 * The decorative left panel. Rive runs here only — it is purely visual.
 * `Main` is the state machine inside the .riv; `hover` is a boolean input we
 * drive on mouse enter/leave so the hover effect plays. If the SM is named
 * differently, the runtime-discovery effect still starts whatever exists.
 */
function RivePanel() {
  const { rive, RiveComponent } = useRive({
    src: riveUrl,
    stateMachines: 'Main',
    autoplay: true,
    layout: new Layout({ fit: Fit.Cover, alignment: Alignment.Center }),
  });
  const hoverInput = useStateMachineInput(rive, 'Main', 'hover');

  // Belt-and-suspenders: make sure *some* state machine is running, whatever
  // it is named, so pointer/hover forwarding works.
  React.useEffect(() => {
    if (!rive) return;
    try {
      const names = rive.stateMachineNames || [];
      if (names.length) rive.play(names);
    } catch { /* ignore — fallback static panel still shows */ }
  }, [rive]);

  const setHover = (v) => { if (hoverInput) hoverInput.value = v; };

  return (
    <div
      className="wsc-rive"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <RiveComponent className="wsc-rive-canvas" />
    </div>
  );
}

export default function WorkspaceCodeDialog({ open, onClose }) {
  const navigate = useNavigate();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) { setCode(''); setError(''); setBusy(false); }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!CODE_RE.test(c)) {
      setError('That workspace code looks off — ask your admin for the exact code.');
      return;
    }
    setBusy(true); setError('');
    try {
      // Validates the code exists (and warms the branding for the next page).
      await getWorkspaceBranding(c);
      onClose?.();
      navigate(`/login/${encodeURIComponent(c)}`);
    } catch (err) {
      setError(err?.response?.status === 404
        ? 'No workspace matches that code.'
        : 'Could not verify that code right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wsc-overlay" role="presentation" onMouseDown={onClose}>
      <div className="wsc-card" role="dialog" aria-modal="true" aria-label="Enter workspace code"
        onMouseDown={(e) => e.stopPropagation()}>

        <aside className="wsc-left">
          <RiveErrorBoundary fallback={<div className="wsc-rive wsc-rive-fallback" />}>
            <RivePanel />
          </RiveErrorBoundary>
          <div className="wsc-left-copy">
            <span className="wsc-left-brand">Z-Matrix</span>
            <h3>Find your workspace</h3>
            <p>Your admin shared a workspace code. Enter it to reach your company&#39;s sign-in.</p>
          </div>
        </aside>

        <form className="wsc-right" onSubmit={submit}>
          <button type="button" className="wsc-close" onClick={onClose} aria-label="Close">×</button>
          <span className="wsc-eyebrow">Sign in</span>
          <h2 className="wsc-title">Enter your workspace code</h2>
          <p className="wsc-sub">We&#39;ll take you to your company&#39;s sign-in page.</p>

          <label className="wsc-label" htmlFor="wsc-code">Workspace code</label>
          <input
            id="wsc-code"
            className="wsc-input"
            value={code}
            onChange={(e) => { setCode(e.target.value); if (error) setError(''); }}
            placeholder="e.g. BTOKAI-7X9F"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
          />
          {error && <div className="wsc-error" role="alert">{error}</div>}

          <button type="submit" className="wsc-submit" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>

          <p className="wsc-foot">
            Don&#39;t have a code? Ask your workspace admin, or request a new workspace from the home page.
          </p>
        </form>
      </div>
    </div>
  );
}

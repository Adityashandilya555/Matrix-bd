import React from 'react';
import { useNavigate } from 'react-router-dom';
import LottiePanel from './LottiePanel.jsx';
import { getWorkspaceBranding } from '../../services/api/supabaseAuth.js';
import communityAnim from '../../assets/lottie/workspace-community.json';
import './branded-auth.css';

const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

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
      // Warm branding for the next page. We no longer treat an unknown code as
      // a hard error here: /tenancy/branding intentionally returns a uniform
      // response for known vs unknown codes so it can't be used to enumerate
      // valid workspaces (#84). Whether the code is real is revealed on the
      // login page (a wrong code lands on the soft "pending" message), not by
      // this lookup. A thrown error now means a genuine network failure.
      await getWorkspaceBranding(c);
      onClose?.();
      navigate(`/login/${encodeURIComponent(c)}`);
    } catch {
      setError('Could not reach the server right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wsc-overlay" role="presentation" onMouseDown={onClose}>
      {/* onMouseDown only stops the click from bubbling to the overlay scrim
          (which closes the dialog); the dialog body is not itself an
          interactive control — its inner controls own their own keyboard. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div className="wsc-card" role="dialog" aria-modal="true" aria-label="Enter workspace code"
        onMouseDown={(e) => e.stopPropagation()}>

        <aside className="wsc-left">
          <LottiePanel
            data={communityAnim}
            className="wsc-anim"
            fallbackClassName="wsc-anim wsc-anim-fallback"
          />
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

import React from 'react';
import { useNavigate } from 'react-router-dom';
import LottiePanel from './LottiePanel.jsx';
import { PRODUCT_NAME } from '../../router/routes.js';
import { getWorkspaceBranding } from '../../services/api/supabaseAuth.js';
import { getStoredWorkspaceCodes, getLastWorkspaceCode, addWorkspaceCode } from '../../utils/workspaceStorage.js';
import communityAnim from '../../assets/lottie/workspace-community.json';
import './branded-auth.css';

const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

export default function WorkspaceCodeDialog({ open, onClose }) {
  const navigate = useNavigate();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  // -1 = nothing highlighted; drives aria-activedescendant for screen readers.
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // Read localStorage once per open rather than on every render — a render is
  // not the place for IO, and the list can't change while the dialog is up.
  // Initialised lazily rather than in the open-effect alone: the input carries
  // autoFocus, so it focuses on mount BEFORE effects run, and an already-focused
  // input never fires onFocus again — the list would stay shut until the user
  // blurred and came back.
  const [storedCodes, setStoredCodes] = React.useState(getStoredWorkspaceCodes);
  const wrapperRef = React.useRef(null);

  // Pre-fill with the last-used code when the dialog opens.
  React.useEffect(() => {
    if (open) {
      const last = getLastWorkspaceCode();
      setCode(last || '');
      setError('');
      setBusy(false);
      setShowSuggestions(false);
      setActiveIndex(-1);
      setStoredCodes(getStoredWorkspaceCodes());
    } else {
      setCode(''); setError(''); setBusy(false); setShowSuggestions(false);
      setActiveIndex(-1);
    }
  }, [open]);

  // Close suggestions when clicking outside the input wrapper.
  React.useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSuggestions]);

  if (!open) return null;

  const query = code.trim().toUpperCase();
  // Which remembered codes to offer, never including the one already in the box:
  //   ''         → all of them (the user cleared the field)
  //   'ALPHA'    → the ones containing it (narrowing as they type)
  //   'AAAA'     → the OTHERS, when AAAA is itself a remembered code. The dialog
  //                opens pre-filled with the last-used code, so this is the
  //                "switch to a different workspace" case; substring-matching it
  //                would show nothing and strand the user.
  //   'ZZZZ'     → nothing. The previous code fell back to listing every stored
  //                code here, which surfaced three unrelated ones as noise.
  const queryIsStoredCode = storedCodes.includes(query);
  const suggestions = storedCodes.filter(
    (c) => c !== query && (queryIsStoredCode || c.includes(query)),
  );
  const listOpen = showSuggestions && suggestions.length > 0;

  const pickSuggestion = (c) => {
    setCode(c);
    setShowSuggestions(false);
    setActiveIndex(-1);
    if (error) setError('');
  };

  // Full keyboard support for the listbox — without this the suggestions are
  // reachable only by mouse, since the options are not tab stops (they must not
  // be: the combobox pattern keeps focus on the input and moves a virtual
  // cursor via aria-activedescendant).
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (listOpen) { e.stopPropagation(); setShowSuggestions(false); setActiveIndex(-1); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      if (!listOpen) { setShowSuggestions(true); setActiveIndex(0); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = (activeIndex + step + suggestions.length) % suggestions.length;
      setActiveIndex(activeIndex === -1 && step === -1 ? suggestions.length - 1 : next);
      return;
    }
    if (e.key === 'Enter' && listOpen && activeIndex >= 0) {
      // Take the highlighted suggestion instead of submitting the form.
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
      return;
    }
    if (e.key === 'Tab' && listOpen) {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  };

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
      addWorkspaceCode(c);
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
            <span className="wsc-left-brand">{PRODUCT_NAME}</span>
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
          <div className="wsc-input-wrapper" ref={wrapperRef}>
            <input
              id="wsc-code"
              className="wsc-input"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError('');
                setShowSuggestions(true);
                setActiveIndex(-1);
              }}
              onFocus={() => { if (storedCodes.length > 0) setShowSuggestions(true); }}
              // onClick as well as onFocus: the dialog opens with this input
              // already focused (autoFocus) and pre-filled with the last-used
              // code, so onFocus has fired before the user can act on it and
              // will not fire again. Without this, clicking the box to see your
              // other workspaces does nothing.
              onClick={() => { if (storedCodes.length > 0) setShowSuggestions(true); }}
              onKeyDown={onKeyDown}
              placeholder="e.g. BTOKAI-7X9F"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="wsc-code-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={
                listOpen && activeIndex >= 0 ? `wsc-suggestion-${activeIndex}` : undefined
              }
            />
            {listOpen && (
              <ul className="wsc-suggestions" id="wsc-code-suggestions" role="listbox"
                aria-label="Previously used workspace codes">
                {suggestions.map((c, i) => (
                  <li key={c} id={`wsc-suggestion-${i}`} role="option"
                    aria-selected={i === activeIndex}
                    className={`wsc-suggestion-item${i === activeIndex ? ' wsc-suggestion-active' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(c); }}>
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
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

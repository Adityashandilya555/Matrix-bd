import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PRODUCT_NAME } from '../../router/routes.js';
import {
  signInWithWorkspaceCode,
  checkAccountState,
  setupPassword,
  requestPasswordReset,
  completePasswordReset,
  getWorkspaceBranding,
  signupAsSupervisor,
  signupAsExecutive,
  PendingApprovalError,
  InvalidCredentialsError,
} from '../../services/api/supabaseAuth.js';
import blueTokaiLogo from '../../assets/brands/blue-tokai.png';
import gotTeaLogo from '../../assets/brands/got-tea.png';
import suchaliLogo from '../../assets/brands/suchali.png';
import './branded-auth.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

// Brands showcased on the workspace-access panel ("Powering operations for").
const BRAND_LOGOS = [
  { name: 'Blue Tokai', src: blueTokaiLogo },
  { name: 'Got Tea', src: gotTeaLogo },
  { name: "Suchali's", src: suchaliLogo },
];

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const raw = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return { ...raw, ...(raw?.app_metadata || {}) };
  } catch {
    return null;
  }
}
function routeFromToken(token) {
  const p = decodeJwtPayload(token);
  if (p?.role === 'business_admin') return '/business-admin';
  if (p?.module === 'legal') return '/legal';
  if (p?.module === 'design') return '/design';
  if (p?.module === 'project') return '/project';
  return '/overview';
}

function Banner({ msg }) {
  if (!msg) return null;
  return <div className={`bl-banner bl-banner--${msg.tone || 'error'}`} role="alert">{msg.text}</div>;
}

// ── Login (email → set-or-enter password → optional reset) ───────────────────
function LoginPanel({ code, onAuthed }) {
  const [step, setStep] = React.useState('email'); // email | enter | setup | reset
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [tok, setTok] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [wrong, setWrong] = React.useState(0);

  const say = (text, tone = 'error') => setMsg({ text, tone });
  const em = () => email.trim().toLowerCase();
  const resetFields = () => { setPw(''); setPw2(''); setTok(''); };

  const continueEmail = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(em())) { say('Enter a valid work email.'); return; }
    setBusy(true); setMsg(null);
    try {
      const state = await checkAccountState(em(), code);
      resetFields();
      if (state === 'unknown') {
        // Not a member of this workspace. Don't push strangers into the reset
        // flow — tell them plainly and point at the Join tab.
        say("This email isn't part of this workspace. If you're joining, switch to the Join tab or ask your admin for an invite.", 'error');
      } else if (state === 'pending') {
        say('Your request is still pending admin approval. You can sign in once an admin approves you.', 'info');
      } else if (state === 'needs_password') {
        // Approved but no password yet → set one directly (no admin code).
        setStep('setup');
        say('Welcome! Create a password to finish setting up your account.', 'info');
      } else {
        setStep('enter');
      }
    } catch {
      say('Could not reach the server. Please try again.');
    } finally { setBusy(false); }
  };

  const doLogin = async (e) => {
    e.preventDefault();
    if (!pw) { say('Enter your password.'); return; }
    setBusy(true); setMsg(null);
    try {
      const data = await signInWithWorkspaceCode(em(), code, pw);
      onAuthed(data?.access_token);
    } catch (err) {
      if (err instanceof PendingApprovalError || err?.isPending) say(err.message || 'Your access is pending approval.', 'info');
      else if (err instanceof InvalidCredentialsError || err?.isInvalidCredentials) { setWrong((w) => w + 1); say('Incorrect password. Try again, or request a reset.'); }
      else say(err?.message || 'Sign-in failed.');
    } finally { setBusy(false); }
  };

  const doSetup = async (e) => {
    e.preventDefault();
    if (pw.length < 6) { say('Choose a password of at least 6 characters.'); return; }
    if (pw !== pw2) { say('Passwords do not match.'); return; }
    setBusy(true); setMsg(null);
    try {
      await setupPassword(em(), code, pw);
      const data = await signInWithWorkspaceCode(em(), code, pw);
      onAuthed(data?.access_token);
    } catch (err) {
      if (err?.isPending) say(err.message, 'info');
      else say(err?.message || 'Could not set your password.');
    } finally { setBusy(false); }
  };

  const askReset = async () => {
    setBusy(true); setMsg(null);
    try {
      await requestPasswordReset(em(), code);
      resetFields();
      setStep('reset');
      say('Reset request sent to your platform admin. Once they approve it, enter the reset code they share with you and set a new password below.', 'info');
    } catch {
      say('Could not send the request. Please try again.');
    } finally { setBusy(false); }
  };

  const doReset = async (e) => {
    e.preventDefault();
    if (tok.trim().length < 8) { say('Enter the reset code your platform admin shared with you.'); return; }
    if (pw.length < 6) { say('Choose a password of at least 6 characters.'); return; }
    if (pw !== pw2) { say('Passwords do not match.'); return; }
    setBusy(true); setMsg(null);
    try {
      await completePasswordReset(em(), code, pw, tok.trim());
      const data = await signInWithWorkspaceCode(em(), code, pw);
      onAuthed(data?.access_token);
    } catch (err) {
      const text = String(err?.message || '');
      if (/approved/i.test(text)) say('Not approved yet — ask your platform admin to confirm your reset, then try again.', 'info');
      else if (err?.isPending) say(err.message, 'info');
      else say(text || 'Reset failed.');
    } finally { setBusy(false); }
  };

  const changeEmail = () => { setStep('email'); resetFields(); setMsg(null); setWrong(0); };

  if (step === 'email') {
    return (
      <form className="bl-form" onSubmit={continueEmail}>
        <label className="bl-label" htmlFor="bl-email">Work email</label>
        <input id="bl-email" className="bl-input" type="email" value={email}
          onChange={(e) => { setEmail(e.target.value); if (msg) setMsg(null); }}
          placeholder="you@company.com" autoComplete="username" autoFocus />
        <Banner msg={msg} />
        <button type="submit" className="bl-btn" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
    );
  }

  const isReset = step === 'reset';
  const isSetup = step === 'setup';
  const isNewPw = isReset || isSetup; // both collect + confirm a new password
  const onSubmit = isReset ? doReset : isSetup ? doSetup : doLogin;

  return (
    <form className="bl-form" onSubmit={onSubmit}>
      <div className="bl-id">
        <span>{em()}</span>
        <button type="button" className="bl-link" onClick={changeEmail}>Change</button>
      </div>

      {isReset && (
        <>
          <label className="bl-label" htmlFor="bl-tok">Reset code</label>
          <input id="bl-tok" className="bl-input" type="text" value={tok}
            onChange={(e) => { setTok(e.target.value); if (msg) setMsg(null); }}
            placeholder="Code shared by your platform admin" autoComplete="one-time-code" autoFocus />
        </>
      )}

      <label className="bl-label" htmlFor="bl-pw">{isNewPw ? 'New password' : 'Password'}</label>
      <input id="bl-pw" className="bl-input" type="password" value={pw}
        onChange={(e) => { setPw(e.target.value); if (msg) setMsg(null); }}
        placeholder={isNewPw ? 'Create a password' : 'Enter your password'}
        autoComplete={isNewPw ? 'new-password' : 'current-password'} autoFocus={isSetup || !isNewPw} />

      {isNewPw && (
        <>
          <label className="bl-label" htmlFor="bl-pw2">Confirm password</label>
          <input id="bl-pw2" className="bl-input" type="password" value={pw2}
            onChange={(e) => { setPw2(e.target.value); if (msg) setMsg(null); }}
            placeholder="Re-enter password" autoComplete="new-password" />
        </>
      )}

      <Banner msg={msg} />

      <button type="submit" className="bl-btn" disabled={busy}>
        {busy ? 'Please wait…'
          : isSetup ? 'Create password & sign in'
          : isReset ? 'Set new password & sign in'
          : 'Sign in'}
      </button>

      {step === 'enter' && wrong > 0 && (
        <button type="button" className="bl-link bl-link--center" onClick={askReset} disabled={busy}>
          Forgot your password? Request a reset
        </button>
      )}
    </form>
  );
}

// ── Join (same supervisor / executive self-signup as before) ─────────────────
function JoinPanel() {
  const [joinMode, setJoinMode] = React.useState('supervisor');
  const [email, setEmail] = React.useState('');
  const [jcode, setJcode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    const c = jcode.trim().toUpperCase();
    if (!EMAIL_RE.test(em)) { setMsg({ tone: 'error', text: 'Enter a valid work email.' }); return; }
    if (!CODE_RE.test(c)) { setMsg({ tone: 'error', text: 'Enter the code your team gave you.' }); return; }
    setBusy(true); setMsg(null);
    try {
      if (joinMode === 'supervisor') await signupAsSupervisor(em, c);
      else await signupAsExecutive(em, c);
      setMsg({ tone: 'success', text: joinMode === 'supervisor'
        ? 'Request submitted — your business admin will review it.'
        : 'Request submitted — your supervisor will review it.' });
      setEmail(''); setJcode('');
    } catch (err) {
      if (err?.isPending) setMsg({ tone: 'info', text: err.message });
      else setMsg({ tone: 'error', text: err?.message || 'Could not submit your request.' });
    } finally { setBusy(false); }
  };

  return (
    <form className="bl-form" onSubmit={submit}>
      <div className="bl-seg" role="tablist">
        <button type="button" data-active={joinMode === 'supervisor'} onClick={() => setJoinMode('supervisor')}>Supervisor</button>
        <button type="button" data-active={joinMode === 'executive'} onClick={() => setJoinMode('executive')}>Executive</button>
      </div>

      <label className="bl-label" htmlFor="bl-jemail">Work email</label>
      <input id="bl-jemail" className="bl-input" type="email" value={email}
        onChange={(e) => { setEmail(e.target.value); if (msg) setMsg(null); }}
        placeholder="you@company.com" autoComplete="username" />

      <label className="bl-label" htmlFor="bl-jcode">{joinMode === 'supervisor' ? 'Department code' : 'Supervisor code'}</label>
      <input id="bl-jcode" className="bl-input" value={jcode}
        onChange={(e) => { setJcode(e.target.value); if (msg) setMsg(null); }}
        placeholder={joinMode === 'supervisor' ? 'From your business admin' : 'From your supervisor'}
        autoComplete="off" spellCheck={false} />

      <Banner msg={msg} />
      <button type="submit" className="bl-btn" disabled={busy}>{busy ? 'Submitting…' : 'Request access'}</button>
      <p className="bl-hint">You&#39;ll set a password the first time you sign in after approval.</p>
    </form>
  );
}

export default function BrandedLoginPage() {
  const { code: rawCode } = useParams();
  const code = (rawCode || '').toUpperCase();
  const navigate = useNavigate();

  const [brand, setBrand] = React.useState({ status: 'loading', name: '', logo: null });
  const [tab, setTab] = React.useState('login');

  React.useEffect(() => {
    let alive = true;
    if (!CODE_RE.test(code)) { setBrand({ status: 'error', name: '', logo: null }); return undefined; }
    getWorkspaceBranding(code)
      .then((b) => { if (alive) setBrand({ status: 'ready', name: b?.name || 'Your workspace', logo: b?.logo_url || null }); })
      .catch(() => { if (alive) setBrand({ status: 'error', name: '', logo: null }); });
    return () => { alive = false; };
  }, [code]);

  if (brand.status === 'error') {
    return (
      <div className="bl-shell">
        <div className="bl-card bl-card--narrow">
          <h2 className="bl-title">Workspace not found</h2>
          <p className="bl-sub">We couldn&#39;t find a workspace for <strong>{code}</strong>. Double-check the code with your admin.</p>
          <button type="button" className="bl-btn" onClick={() => navigate('/welcome')}>Back to home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bl-shell">
      <div className="bl-card bl-card--split">
        <aside className="bl-aside">
          <span className="bl-aurora bl-aurora--1" aria-hidden="true" />
          <span className="bl-aurora bl-aurora--2" aria-hidden="true" />
          <span className="bl-aurora bl-aurora--3" aria-hidden="true" />
          <span className="bl-dotgrid" aria-hidden="true" />

          <div className="bl-aside-top">
            <span className="bl-aside-brand">{PRODUCT_NAME}</span>
            <h2>One platform.<br />Every brand.</h2>
            <p>From site scouting to store handover — run every location in one place.</p>
          </div>

          <div className="bl-aside-bottom">
            <div className="bl-trust">
              <span className="bl-trust-label">Powering operations for</span>
              <div className="bl-trust-logos">
                {BRAND_LOGOS.map((b) => (
                  <div className="bl-trust-item" key={b.name}>
                    <span className="bl-trust-token"><img src={b.src} alt={b.name} /></span>
                    <span className="bl-trust-name">{b.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="bl-aside-tagline">
              Sign in to continue to <b>{brand.status === 'ready' ? brand.name : 'your workspace'}</b>.
            </p>
          </div>
        </aside>

        <div className="bl-main">
          <header className="bl-head">
            {brand.logo
              ? <img className="bl-logo" src={brand.logo} alt={brand.name} />
              : <div className="bl-logo bl-logo--ph" aria-hidden>{(brand.name || 'W').slice(0, 1).toUpperCase()}</div>}
            <div className="bl-head-text">
              <span className="bl-eyebrow">Workspace</span>
              <h1 className="bl-brand">{brand.status === 'loading' ? '…' : brand.name}</h1>
            </div>
          </header>

          <div className="bl-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'login'} data-active={tab === 'login'} onClick={() => setTab('login')}>Log in</button>
            <button type="button" role="tab" aria-selected={tab === 'join'} data-active={tab === 'join'} onClick={() => setTab('join')}>Join</button>
          </div>

          {tab === 'login'
            ? <LoginPanel code={code} onAuthed={(token) => navigate(routeFromToken(token))} />
            : <JoinPanel />}
        </div>
      </div>
      <p className="bl-foot">Powered by {PRODUCT_NAME} &middot; {code}</p>
    </div>
  );
}

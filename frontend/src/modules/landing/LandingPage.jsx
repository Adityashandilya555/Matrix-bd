import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithWorkspaceCode,
  signupAsSupervisor,
  signupAsExecutive,
  PendingApprovalError,
} from '../../services/api/supabaseAuth.js';

// Decode a JWT payload without verifying the signature. Used to read the role
// claim so we can route business_admin users to their dedicated portal. The
// backend already signed and stamped the token; we trust it for routing only.
function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// Mount the full static landing page (kept in /public/landing) as the
// unauthenticated entry surface. We slot the demo's <style> block and <body>
// content into the React tree, then re-implement the modal's open/close,
// tab-switch, and form-submit handlers in scoped JS that talks to Supabase.
//
// Why this shape instead of a JSX port: the static file is the design source
// of truth — keeping it intact means visual tweaks land by editing one HTML
// file, not by re-syncing two parallel representations.

const LANDING_HTML_URL = '/landing/matrix_bd_landing_page_demo.html';
const ASSET_PREFIX_REWRITE = [
  // The static page references `matrix_landing_assets/foo.jpg` relative to its
  // own URL. When rendered at the app root, those paths must be absolute.
  [/matrix_landing_assets\//g, '/landing/matrix_landing_assets/'],
];

function splitDocument(text) {
  const style = text.match(/<style>([\s\S]*?)<\/style>/);
  const body  = text.match(/<body>([\s\S]*?)<\/body>/);
  let bodyHtml = body ? body[1] : '';
  // Strip the inline <script> — we re-implement its behavior in React below.
  bodyHtml = bodyHtml.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const [pattern, replacement] of ASSET_PREFIX_REWRITE) {
    bodyHtml = bodyHtml.replace(pattern, replacement);
  }
  return { css: style ? style[1] : '', body: bodyHtml };
}

export default function LandingPage() {
  const wrapperRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    fetch(LANDING_HTML_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => alive && setDoc(splitDocument(text)))
      .catch((err) => alive && setError(err.message || String(err)));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!doc || !wrapperRef.current) return;
    const root = wrapperRef.current;
    const modal = root.querySelector('.auth-modal');
    if (!modal) return; // bail if the HTML doesn't include the modal

    // ── Rewrite the Login form's "password" field as a "workspace code" ──
    // The static landing HTML ships with a generic Login + Register modal.
    // Auth model is email + workspace_code (no passwords). We mutate the
    // Login panel's second field at runtime instead of touching the HTML.
    const loginPanelEl = modal.querySelector('[data-panel="login"]');
    if (loginPanelEl) {
      const intro = loginPanelEl.querySelector('h2');
      if (intro) intro.textContent = 'Sign in to your workspace';
      const sub = loginPanelEl.querySelector('p');
      if (sub) sub.textContent = 'Enter the work email you used and your workspace code.';

      const passInput = loginPanelEl.querySelector('#login-password');
      if (passInput) {
        passInput.type        = 'text';
        passInput.id          = 'login-code';
        passInput.placeholder = 'BTOKAI-7X9F';
        passInput.setAttribute('autocomplete', 'off');
        passInput.setAttribute('spellcheck', 'false');
        passInput.style.textTransform = 'uppercase';
        passInput.style.letterSpacing = '0.1em';
        const passLabel = loginPanelEl.querySelector('label[for="login-password"]');
        if (passLabel) {
          passLabel.setAttribute('for', 'login-code');
          passLabel.textContent = 'Workspace code';
        }
      }

      // The "Forgot password?" mini-link is meaningless in this auth model.
      const miniLink = loginPanelEl.querySelector('.mini-link');
      if (miniLink) miniLink.remove();

      const securityNote = loginPanelEl.querySelector('.security-note');
      if (securityNote) {
        securityNote.textContent =
          'First time signing in? You\'ll land in your supervisor\'s queue until they assign you a role.';
      }
    }

    // ── Inject the "Join" tab + panel ──
    // The static HTML ships with Login + Register only. We add a third tab
    // for self-service signup as supervisor or executive. Doing it here (vs.
    // editing the HTML) keeps the static demo file design-only.
    const tabsStrip = modal.querySelector('.tabs');
    const dialog    = modal.querySelector('.auth-dialog');
    if (tabsStrip && dialog && !tabsStrip.querySelector('[data-tab="join"]')) {
      const joinTab = document.createElement('button');
      joinTab.className = 'tab';
      joinTab.type = 'button';
      joinTab.setAttribute('data-tab', 'join');
      joinTab.setAttribute('role', 'tab');
      joinTab.setAttribute('aria-selected', 'false');
      joinTab.textContent = 'Join';
      tabsStrip.appendChild(joinTab);

      const joinPanel = document.createElement('form');
      joinPanel.className = 'form-panel';
      joinPanel.setAttribute('data-panel', 'join');
      joinPanel.innerHTML = `
        <div>
          <h2>Join an existing workspace</h2>
          <p>Pick how you're joining — your request goes to whoever can approve it.</p>
        </div>
        <div class="tabs" role="tablist" aria-label="Join as" data-join-tabs>
          <button class="tab active" type="button" data-join-tab="supervisor" role="tab" aria-selected="true">As supervisor</button>
          <button class="tab" type="button" data-join-tab="executive" role="tab" aria-selected="false">As executive</button>
        </div>
        <div data-join-sub="supervisor">
          <div class="field">
            <label for="join-sup-email">Work email</label>
            <input id="join-sup-email" type="email" placeholder="you@company.com" autocomplete="email">
          </div>
          <div class="field">
            <label for="join-sup-dept">Department code</label>
            <input id="join-sup-dept" type="text" placeholder="DEPT-AB12" autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:0.1em;">
          </div>
          <button class="btn btn-primary" type="submit" data-join-submit="supervisor">Request supervisor access</button>
        </div>
        <div data-join-sub="executive" style="display:none;">
          <div class="field">
            <label for="join-exec-email">Work email</label>
            <input id="join-exec-email" type="email" placeholder="you@company.com" autocomplete="email">
          </div>
          <div class="field">
            <label for="join-exec-code">Supervisor code</label>
            <input id="join-exec-code" type="text" placeholder="SUP-AB12" autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:0.1em;">
          </div>
          <button class="btn btn-primary" type="submit" data-join-submit="executive">Request executive access</button>
        </div>
      `;
      dialog.appendChild(joinPanel);
    }

    const tabs   = root.querySelectorAll('[data-tab]');
    const panels = root.querySelectorAll('[data-panel]');

    const setMode = (mode) => {
      tabs.forEach((t) => {
        const active = t.getAttribute('data-tab') === mode;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      panels.forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === mode));
    };

    const open = (mode = 'login') => {
      setMode(mode);
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      const firstField = root.querySelector('.form-panel.active input');
      window.setTimeout(() => firstField && firstField.focus(), 180);
    };

    const close = () => {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };

    // Track listeners so cleanup can remove them.
    const cleanup = [];

    root.querySelectorAll('[data-open-auth]').forEach((btn) => {
      const handler = () => open(btn.getAttribute('data-open-auth'));
      btn.addEventListener('click', handler);
      cleanup.push(() => btn.removeEventListener('click', handler));
    });

    root.querySelectorAll('[data-close-auth]').forEach((btn) => {
      btn.addEventListener('click', close);
      cleanup.push(() => btn.removeEventListener('click', close));
    });

    tabs.forEach((tab) => {
      const handler = () => setMode(tab.getAttribute('data-tab'));
      tab.addEventListener('click', handler);
      cleanup.push(() => tab.removeEventListener('click', handler));
    });

    // In-page anchor links (e.g. href="#workflow") would otherwise pollute the
    // HashRouter URL. Intercept them and scrollIntoView the target.
    root.querySelectorAll('a[href^="#"]').forEach((a) => {
      const handler = (e) => {
        const targetId = a.getAttribute('href').slice(1);
        if (!targetId || targetId === '/') return; // bare "#" is just a no-op brand link
        const target = root.querySelector(`#${CSS.escape(targetId)}`);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
      a.addEventListener('click', handler);
      cleanup.push(() => a.removeEventListener('click', handler));
    });

    const onKey = (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    };
    window.addEventListener('keydown', onKey);
    cleanup.push(() => window.removeEventListener('keydown', onKey));

    // Login form submit. The static page uses type="button" so there's no
    // native submit; we trigger on click of the primary button inside the
    // login panel.
    const loginPanel = root.querySelector('[data-panel="login"]');
    const loginBtn   = loginPanel ? loginPanel.querySelector('button.btn-primary') : null;
    const errorSlot  = (() => {
      if (!loginPanel) return null;
      const el = document.createElement('div');
      el.className = 'security-note';
      el.style.borderColor = 'rgba(222, 117, 111, 0.5)';
      el.style.background  = 'rgba(222, 117, 111, 0.12)';
      el.style.color       = '#fcd5d2';
      el.style.display     = 'none';
      loginPanel.appendChild(el);
      return el;
    })();
    const showError = (msg) => {
      if (!errorSlot) return;
      errorSlot.textContent = msg;
      errorSlot.style.display = 'flex';
    };
    const clearError = () => { if (errorSlot) errorSlot.style.display = 'none'; };

    if (loginBtn && loginPanel) {
      const loginForm  = loginPanel; // the panel IS the <form> element
      const emailInput = loginPanel.querySelector('#login-email');
      // The field id flipped from #login-password to #login-code when we
      // rewrote the panel above. Fall back to the old id if the rewrite
      // didn't happen (defensive).
      const codeInput  = loginPanel.querySelector('#login-code')
                      || loginPanel.querySelector('#login-password');
      const originalLabel = loginBtn.textContent;
      loginBtn.setAttribute('type', 'submit');
      const EMAIL_RE_L = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const CODE_RE_L  = /^[A-Za-z0-9\-]{4,32}$/;

      const onSubmit = async (e) => {
        e.preventDefault();
        clearError();
        const email = emailInput ? emailInput.value.trim() : '';
        const code  = codeInput  ? codeInput.value.trim().toUpperCase() : '';
        if (!email || !code) {
          showError('Enter your work email and workspace code.');
          return;
        }
        if (!EMAIL_RE_L.test(email)) {
          showError('Email looks invalid — use the form you@company.com.');
          return;
        }
        if (!CODE_RE_L.test(code)) {
          showError('Workspace code looks invalid. Ask your supervisor for the exact code.');
          return;
        }
        loginBtn.disabled    = true;
        loginBtn.textContent = 'Signing in…';
        try {
          const data = await signInWithWorkspaceCode(email, code);
          close();
          // Route by role. /business-admin lands when Unit 9's router entry
          // exists; until then the catch-all in AppRouter falls through to /.
          const payload = decodeJwtPayload(data?.access_token);
          if (payload?.role === 'business_admin') navigate('/business-admin');
          else                                    navigate('/overview');
        } catch (err) {
          if (err && err.isPending) {
            // Special-case the "queued" response so the messaging is warm,
            // not alarming.
            showError(err.message);
          } else {
            const msg = err && err.message ? err.message : String(err);
            showError(`Sign-in failed: ${msg}`);
          }
          loginBtn.disabled    = false;
          loginBtn.textContent = originalLabel;
        }
      };
      loginForm.addEventListener('submit', onSubmit);
      cleanup.push(() => loginForm.removeEventListener('submit', onSubmit));
    }

    // Register form ("Request workspace"). The backend doesn't yet expose a
    // self-service tenant-provisioning endpoint, so we validate inputs, queue
    // the request in sessionStorage for the future POST /api/tenancy/request,
    // and surface a friendly success state. When that endpoint lands the only
    // change here is swapping `queueRequest` for a real fetch().
    const registerPanel = root.querySelector('[data-panel="register"]');
    const registerBtn   = registerPanel ? registerPanel.querySelector('button.btn-primary') : null;
    const registerStatus = (() => {
      if (!registerPanel) return null;
      const el = document.createElement('div');
      el.className = 'security-note';
      el.style.display = 'none';
      registerPanel.appendChild(el);
      return el;
    })();
    const showRegisterStatus = (msg, tone = 'success') => {
      if (!registerStatus) return;
      registerStatus.textContent = msg;
      registerStatus.style.display = 'flex';
      if (tone === 'error') {
        registerStatus.style.borderColor = 'rgba(222, 117, 111, 0.5)';
        registerStatus.style.background  = 'rgba(222, 117, 111, 0.12)';
        registerStatus.style.color       = '#fcd5d2';
      } else {
        registerStatus.style.borderColor = 'rgba(70, 234, 209, 0.32)';
        registerStatus.style.background  = 'rgba(70, 234, 209, 0.12)';
        registerStatus.style.color       = 'rgba(249, 241, 223, 0.86)';
      }
    };

    if (registerBtn && registerPanel) {
      const registerForm  = registerPanel; // the panel IS the <form>
      const companyInput  = registerPanel.querySelector('#company-name');
      const adminInput    = registerPanel.querySelector('#admin-email');
      const sizeInput     = registerPanel.querySelector('#company-size');
      const originalLabel = registerBtn.textContent;
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      registerBtn.setAttribute('type', 'submit'); // Enter key submits

      const onSubmit = async (e) => {
        e.preventDefault();
        const company    = companyInput ? companyInput.value.trim() : '';
        const adminEmail = adminInput   ? adminInput.value.trim()   : '';
        const teamSize   = sizeInput    ? sizeInput.value           : '';

        if (!company || !adminEmail) {
          showRegisterStatus('Company name and admin email are required.', 'error');
          return;
        }
        if (!EMAIL_RE.test(adminEmail)) {
          showRegisterStatus('Admin email looks invalid — use the form name@company.com.', 'error');
          return;
        }

        registerBtn.disabled    = true;
        registerBtn.textContent = 'Submitting…';

        // Hit the public POST /api/tenancy/request-workspace endpoint. This is
        // the ONE unauthenticated POST in the platform — it captures the
        // workspace request into the workspace_requests table for admin review.
        const apiBase = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE_URL) || '/api';
        try {
          const res = await fetch(`${apiBase}/tenancy/request-workspace`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ company, admin_email: adminEmail, team_size: teamSize }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            const detail = body && body.detail ? body.detail : `HTTP ${res.status}`;
            const detailStr = Array.isArray(detail)
              ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
              : String(detail);
            throw new Error(detailStr);
          }
          showRegisterStatus(
            body.message || `Request received for ${company}. We will email ${adminEmail} once provisioned.`,
            'success',
          );
          if (companyInput) companyInput.value = '';
          if (adminInput)   adminInput.value   = '';
          registerBtn.textContent = 'Request submitted ✓';
          window.setTimeout(() => {
            registerBtn.disabled    = false;
            registerBtn.textContent = originalLabel;
          }, 2400);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          showRegisterStatus(`Could not submit request: ${msg}`, 'error');
          registerBtn.disabled    = false;
          registerBtn.textContent = originalLabel;
        }
      };
      registerForm.addEventListener('submit', onSubmit);
      cleanup.push(() => registerForm.removeEventListener('submit', onSubmit));
    }

    // ── Join panel ──
    // Two flavors share one form: supervisor (email + dept_code) and executive
    // (email + supervisor_code). The inner tabs swap which sub-form is visible
    // and which submit handler runs.
    const joinPanel = root.querySelector('[data-panel="join"]');
    if (joinPanel) {
      const joinForm    = joinPanel;
      const joinSubTabs = joinPanel.querySelectorAll('[data-join-tab]');
      const joinSubs    = joinPanel.querySelectorAll('[data-join-sub]');
      const joinStatus  = (() => {
        const el = document.createElement('div');
        el.className = 'security-note';
        el.style.display = 'none';
        joinPanel.appendChild(el);
        return el;
      })();
      const showJoinStatus = (msg, tone = 'success') => {
        joinStatus.textContent = msg;
        joinStatus.style.display = 'flex';
        if (tone === 'error') {
          joinStatus.style.borderColor = 'rgba(222, 117, 111, 0.5)';
          joinStatus.style.background  = 'rgba(222, 117, 111, 0.12)';
          joinStatus.style.color       = '#fcd5d2';
        } else {
          joinStatus.style.borderColor = 'rgba(70, 234, 209, 0.32)';
          joinStatus.style.background  = 'rgba(70, 234, 209, 0.12)';
          joinStatus.style.color       = 'rgba(249, 241, 223, 0.86)';
        }
      };

      let joinMode = 'supervisor';
      const setJoinMode = (mode) => {
        joinMode = mode;
        joinSubTabs.forEach((t) => {
          const active = t.getAttribute('data-join-tab') === mode;
          t.classList.toggle('active', active);
          t.setAttribute('aria-selected', String(active));
        });
        joinSubs.forEach((s) => {
          s.style.display = s.getAttribute('data-join-sub') === mode ? '' : 'none';
        });
        joinStatus.style.display = 'none';
      };
      joinSubTabs.forEach((t) => {
        const handler = () => setJoinMode(t.getAttribute('data-join-tab'));
        t.addEventListener('click', handler);
        cleanup.push(() => t.removeEventListener('click', handler));
      });

      const EMAIL_RE_J = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const CODE_RE_J  = /^[A-Za-z0-9\-]{4,32}$/;

      const onJoinSubmit = async (e) => {
        e.preventDefault();
        const btn = joinPanel.querySelector(`[data-join-submit="${joinMode}"]`);
        if (!btn) return;
        const isSup = joinMode === 'supervisor';
        const emailEl = joinPanel.querySelector(isSup ? '#join-sup-email' : '#join-exec-email');
        const codeEl  = joinPanel.querySelector(isSup ? '#join-sup-dept'  : '#join-exec-code');
        const email   = emailEl ? emailEl.value.trim()                   : '';
        const code    = codeEl  ? codeEl.value.trim().toUpperCase()      : '';

        if (!email || !code) {
          showJoinStatus('Enter your work email and the code from your team.', 'error');
          return;
        }
        if (!EMAIL_RE_J.test(email)) {
          showJoinStatus('Email looks invalid — use the form you@company.com.', 'error');
          return;
        }
        if (!CODE_RE_J.test(code)) {
          showJoinStatus('Code looks invalid. Ask your team for the exact value.', 'error');
          return;
        }

        const successMsg = isSup
          ? 'Request submitted, business admin will review.'
          : 'Request submitted, your supervisor will review.';
        const reportSuccess = () => {
          showJoinStatus(successMsg, 'success');
          if (emailEl) emailEl.value = '';
          if (codeEl)  codeEl.value  = '';
        };

        const originalLabel = btn.textContent;
        btn.disabled    = true;
        btn.textContent = 'Submitting…';
        try {
          // 200 and 202 are both "received" — caller treats them identically.
          if (isSup) await signupAsSupervisor(email, code);
          else       await signupAsExecutive(email, code);
          reportSuccess();
        } catch (err) {
          if (err && err.isPending) {
            reportSuccess();
          } else {
            const msg = err && err.message ? err.message : String(err);
            showJoinStatus(`Could not submit: ${msg}`, 'error');
          }
        } finally {
          btn.disabled    = false;
          btn.textContent = originalLabel;
        }
      };
      joinForm.addEventListener('submit', onJoinSubmit);
      cleanup.push(() => joinForm.removeEventListener('submit', onJoinSubmit));
    }

    return () => {
      cleanup.forEach((fn) => { try { fn(); } catch { /* noop */ } });
      document.body.style.overflow = '';
    };
  }, [doc, navigate]);

  if (error) {
    return (
      <div style={{ padding: 24, color: '#fff', background: '#111', minHeight: '100vh' }}>
        Landing page failed to load: {error}
      </div>
    );
  }
  if (!doc) {
    return (
      <div style={{ padding: 24, color: '#bbb', background: '#0b1114', minHeight: '100vh' }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: doc.css }} />
      <div ref={wrapperRef} dangerouslySetInnerHTML={{ __html: doc.body }} />
    </>
  );
}

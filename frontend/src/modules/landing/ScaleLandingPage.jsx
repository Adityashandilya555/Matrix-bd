import React, { useEffect, useMemo, useRef, useState } from 'react';
import WorkspaceCodeDialog from './WorkspaceCodeDialog.jsx';
import { useNavigate } from 'react-router-dom';
import { PRODUCT_NAME } from '../../constants/brand.js';
import {
  signInWithWorkspaceCode,
  signupAsSupervisor,
  signupAsExecutive,
} from '../../services/api/supabaseAuth.js';
import './ScaleLanding.css';

/* -----------------------------------------------------------------
   Scale · Retail Expansion OS landing
   Ported from the Claude Design handoff bundle (scale/project/*).
   The existing AuthModal (Sign in / Join / Create workspace) is kept
   intact — the nav now exposes an inline email + "Request membership"
   action that opens AuthModal in join mode with the email prefilled.
   ----------------------------------------------------------------- */

const LOTTIE_SRC = 'https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js';
const HERO_VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4';

const ASSET_BASE = '/landing/scale/assets';

const PHASE_DATA = [
  {
    id: 1,
    code: '01',
    short: 'BD · Initiation',
    eyebrow: 'STAGE 01 · BUSINESS DEVELOPMENT & SITE INITIATION',
    headline: 'A signed LOI instantiates',
    em: 'the digital expansion.',
    sub: 'Business Development secures the LOI. The moment it executes, the virtual project is instantiated for downstream phases.',
    steps: [
      { t: 0.25, icon: 'pin',  label: 'Site Selection',       hint: 'Optimal Location Identified', desc: 'Targeting high-growth zones. Market analysis complete.' },
      { t: 0.55, icon: 'doc',  label: 'Signed LOI',           hint: 'Agreement Executed',          desc: 'Letter of Intent secured. Legal review finalized.' },
      { t: 0.85, icon: 'node', label: 'Project instantiated', hint: 'status → ACTIVE',             desc: 'Plant Object created. Downstream phases armed.', highlight: true },
    ],
    lottie: `${ASSET_BASE}/phase1-lottie.json`,
    caption: { title: 'Phase 01', sub: 'Business Development & Site Initiation' },
  },
  {
    id: 2,
    code: '02',
    short: 'Parallel Setup',
    eyebrow: 'STAGE 02 · PARALLEL SETUP',
    headline: 'Parallel tracks instantiate',
    em: 'the setup.',
    sub: '',
    tracks: [
      {
        side: 'A',
        title: 'Legal',
        icon: 'scale',
        items: [
          { icon: 'search', label: 'Due Diligence' },
          { icon: 'doc',    label: 'Lease' },
          { icon: 'badge',  label: 'Permits' },
        ],
      },
      {
        side: 'B',
        title: 'Commercials',
        icon: 'rupee',
        items: [
          { icon: 'code', label: 'CA Code' },
          { icon: 'cart', label: 'Equipment' },
          { icon: 'card', label: 'Payment' },
        ],
      },
    ],
    steps: [],
    lottie: `${ASSET_BASE}/phase2-lottie.json`,
    caption: { title: 'Phase 02', sub: 'Parallel Setup · The Smart Split' },
  },
  {
    id: 3,
    code: '03',
    short: 'Spatial Design',
    eyebrow: 'STAGE 03 · SPATIAL DESIGN & PLANNING',
    headline: 'Spatial design instantiates',
    em: 'the environment.',
    sub: 'The virtual blueprint is translated into a physical experience. Every dimension is planned for the real world.',
    steps: [
      { t: 0.20, icon: 'pin',    label: 'Site Recce',  hint: 'Field survey complete' },
      { t: 0.40, icon: 'layout', label: '2D Layout',   hint: 'Floor plan finalized' },
      { t: 0.60, icon: 'cube',   label: '3D Approval', hint: 'Visualizations signed off' },
      { t: 0.85, icon: 'docket', label: 'GFC Docket',  hint: 'Good For Construction', highlight: true },
    ],
    lottie: `${ASSET_BASE}/phase3-lottie.json`,
    caption: { title: 'Phase 03', sub: 'Spatial Design & Planning' },
  },
  {
    id: 4,
    code: '04',
    short: 'Build & Audits',
    eyebrow: 'STAGE 04 · BUILD · TRACKING · AUDITS',
    headline: 'Build, Tracking &',
    em: 'Quality Audits.',
    sub: '',
    timeline: [
      { t: 0.15, label: 'Mall & Lessor Approvals', date: 'completed · 20 Dec 2026' },
      { t: 0.30, label: 'Estimated BOQ submitted', date: '05 Jan 2027' },
      { t: 0.50, label: 'Project In progress',     date: '15 Jan 2027' },
      { t: 0.70, label: 'Mid-Project Audit',       date: '01 Feb 2027' },
      { t: 0.85, label: 'Quality Audit & Snagging', date: '08 Feb 2027' },
      { t: 0.95, label: 'Final BOQ',               date: '15 Feb 2027' },
    ],
    steps: [],
    lottie: `${ASSET_BASE}/phase4-lottie.json`,
    caption: { title: 'Phase 04', sub: 'Build · Tracking · Quality Audits' },
  },
  {
    id: 5,
    code: '05',
    short: 'Launch · Handover',
    eyebrow: 'STAGE 05 · LAUNCH & HANDOVER',
    headline: 'Handover & Digital Twin',
    em: 'Activation.',
    sub: '',
    timeline: [
      { t: 0.15, label: 'Site Recce completed',         date: '12 Oct 2026' },
      { t: 0.30, label: '2D Layout drafted',            date: '01 Nov 2026, 10:45 AM' },
      { t: 0.50, label: 'Material Selection finalized', date: '15 Nov 2026' },
      { t: 0.70, label: 'Handover & L-1 Checklist',     date: 'completed · 12 Dec 2026' },
      { t: 0.90, label: 'Launch Day',                   date: '15 Dec 2026, 09:00 AM' },
    ],
    steps: [],
    lottie: `${ASSET_BASE}/phase5-lottie.json`,
    caption: { title: 'Phase 05', sub: 'Launch & Handover · Digital Twin' },
  },
];

const ONTOLOGY_ROWS = [
  { k: 'node_id',         v: 'CA-2026-A2-714',  from: 'P1' },
  { k: 'node_status',     v: 'RUNNING',         from: 'P5' },
  { k: 'site_coords',     v: '28.5612, 77.31',  from: 'P1' },
  { k: 'plot_area',       v: '1,240 sq·ft',     from: 'P1' },
  { k: 'loi_signed_at',   v: '19 May 2026',     from: 'P1' },
  { k: 'ca_code',         v: 'CA-2026-A2-714',  from: 'P2' },
  { k: 'license_count',   v: '3',               from: 'P2' },
  { k: 'initial_capital', v: '₹ 2,50,000',      from: 'P2' },
  { k: 'gfc_locked_at',   v: '24 Jun 2026',     from: 'P3' },
  { k: 'final_boq',       v: '₹ 12,84,000',     from: 'P4' },
  { k: 'qa_score',        v: '94 / 100',        from: 'P4' },
  { k: 'opened_at',       v: '15 Dec 2026',     from: 'P5' },
  { k: 'cam_monthly',     v: '₹ 1,76,080',      from: 'P5' },
  { k: 'uptime_pct',      v: '99.98',           from: 'P5' },
];

const ICON_SVGS = {
  pin: (<><path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></>),
  doc: (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></>),
  node: (<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></>),
  scale: (<><path d="M12 4v16"/><path d="M6 8h12"/><path d="M3 12l3-4 3 4a3 3 0 0 1-6 0z"/><path d="M15 12l3-4 3 4a3 3 0 0 1-6 0z"/></>),
  search: (<><circle cx="11" cy="11" r="6"/><path d="M21 21l-4.35-4.35"/></>),
  badge: (<path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z"/>),
  rupee: (<><path d="M6 4h12"/><path d="M6 9h12"/><path d="M9 4c3 0 5 1.5 5 4s-2 4-5 4H6l8 8"/></>),
  code: (<><path d="M8 7l-5 5 5 5"/><path d="M16 7l5 5-5 5"/><path d="M14 4l-4 16"/></>),
  cart: (<><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l3 11h11l2-7H7"/></>),
  card: (<><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 11h18"/><path d="M7 16h3"/></>),
  layout: (<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 9v12"/></>),
  cube: (<><path d="M12 3l9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></>),
  docket: (<><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 3v3h6V3"/><path d="M9 11h6"/><path d="M9 15h6"/><path d="M9 19h3"/></>),
};

function IconBox({ name, size = 44, lit = true }) {
  const Body = ICON_SVGS[name] || ICON_SVGS.node;
  return (
    <div className="icon-box" data-lit={lit ? 'on' : 'off'} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {Body}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------
   Lottie loader — single CDN script shared across all phase frames.
------------------------------------------------------------------ */
let lottiePromise = null;
function ensureLottie() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.lottie) return Promise.resolve(window.lottie);
  if (lottiePromise) return lottiePromise;
  lottiePromise = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${LOTTIE_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.lottie || null));
      return;
    }
    const script = document.createElement('script');
    script.src = LOTTIE_SRC;
    script.async = true;
    script.onload = () => resolve(window.lottie || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return lottiePromise;
}

function PhaseLottieOverlay({ progress, path, caption }) {
  const containerRef = useRef(null);
  const animRef = useRef(null);
  const loadedRef = useRef(false);
  const opacity = Math.max(0, Math.min(1, (progress - 0.02) / 0.18));
  const isVisible = opacity > 0.05;

  useEffect(() => {
    if (!isVisible) return;
    if (loadedRef.current) {
      try { animRef.current?.play(); } catch { /* best-effort animation control */ }
      return;
    }
    let cancelled = false;
    ensureLottie().then((lottie) => {
      if (cancelled || !lottie || !containerRef.current) return;
      loadedRef.current = true;
      animRef.current = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true },
      });
    });
    return () => { cancelled = true; };
  }, [isVisible, path]);

  useEffect(() => {
    const inst = animRef.current;
    if (!inst) return;
    try { isVisible ? inst.play() : inst.pause(); } catch { /* best-effort animation control */ }
  }, [isVisible]);

  useEffect(() => () => {
    try { animRef.current?.destroy(); } catch { /* best-effort animation control */ }
  }, []);

  return (
    <div className="phase-lottie-overlay" style={{ opacity }}>
      <div className="phase-lottie-stack">
        <div className="phase-lottie-frame">
          <div className="phase-lottie-target" ref={containerRef} />
        </div>
        <div className="phase-lottie-caption">
          <div className="phase-lottie-caption-rule" />
          <div className="phase-lottie-caption-title">{caption.title}</div>
          <div className="phase-lottie-caption-sub">{caption.sub}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Scene — vertical stack of 5 phase slots translated by activePhase.
------------------------------------------------------------------ */
function Scene({ phaseProgresses, currentPhase, transitionT }) {
  const activeFloat = currentPhase + transitionT;
  return (
    <div className="scene-wrap">
      <div className="scene-camera">
        <div className="world" style={{ transform: `translateY(${-activeFloat * 100}vh)` }}>
          {PHASE_DATA.map((phase, i) => (
            <div key={phase.id} className="phase-slot">
              <PhaseLottieOverlay
                progress={phaseProgresses[i]}
                path={phase.lottie}
                caption={phase.caption}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CentralThread({ phaseOpacity, activePhase, phaseProgresses }) {
  return (
    <div className="central-thread" style={{ opacity: phaseOpacity }}>
      <div className="thread-bar" />
      <div className="thread-glow-strip" />
      {[0, 1, 2, 3, 4].map((i) => {
        const passed = i < activePhase || (i === activePhase && phaseProgresses[activePhase] > 0.5);
        const active = i === activePhase;
        const topPct = 10 + i * 18;
        return (
          <div
            key={i}
            className={`thread-node ${active ? 'active' : ''} ${passed ? 'passed' : ''}`}
            style={{ top: `${topPct}%` }}
          />
        );
      })}
    </div>
  );
}

function PhaseNarrative({ phase, progress, opacity }) {
  const isTimeline = !!phase.timeline;
  const isTracks = !!phase.tracks;
  return (
    <div className="phase-narrative" style={{ opacity, pointerEvents: opacity < 0.4 ? 'none' : 'auto' }}>
      {!isTimeline && (
        <>
          <div className="phase-eyebrow-line">{phase.eyebrow}</div>
          <h2 className="phase-headline">
            {phase.headline}<br />
            <em>{phase.em}</em>
          </h2>
          {phase.sub && <p className="phase-sub">{phase.sub}</p>}
        </>
      )}

      {!isTimeline && !isTracks && (
        <div className="step-icon-list">
          {phase.steps.map((s, i) => {
            const done = progress >= s.t;
            const active = !done && progress >= s.t - 0.06;
            return (
              <div key={i} className={`step-icon ${done ? 'done' : ''} ${active ? 'active' : ''} ${s.highlight ? 'highlight' : ''}`}>
                <IconBox name={s.icon} lit={done || active} />
                <div className="step-icon-text">
                  <div className="step-icon-label">{s.label}</div>
                  {s.hint && <div className="step-icon-hint">{s.hint}</div>}
                  {s.desc && <div className="step-icon-desc">{s.desc}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isTracks && (
        <div className="track-cards">
          {phase.tracks.map((track, i) => {
            const cardOn = progress >= 0.25 + i * 0.2;
            return (
              <div key={track.side} className={`track-card ${cardOn ? 'lit' : ''}`}>
                <div className="track-card-header">
                  <IconBox name={track.icon} size={32} lit={cardOn} />
                  <div className="track-card-title">
                    <div className="track-card-side">Track {track.side}:</div>
                    <div className="track-card-name">{track.title}</div>
                  </div>
                </div>
                <div className="track-card-items">
                  {track.items.map((it, j) => {
                    const itemOn = progress >= 0.35 + i * 0.2 + j * 0.04;
                    return (
                      <div key={j} className={`track-card-item ${itemOn ? 'lit' : ''}`}>
                        <IconBox name={it.icon} size={26} lit={itemOn} />
                        <span>{it.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isTimeline && (
        <div className="timeline-card">
          <h3 className="timeline-card-title">
            {phase.headline} <em>{phase.em}</em>
          </h3>
          <div className="timeline-list">
            {phase.timeline.map((item, i) => {
              const nextT = phase.timeline[i + 1]?.t ?? (item.t + 0.05);
              const isLast = i === phase.timeline.length - 1;
              let stateNow;
              if (progress < item.t) stateNow = 'pending';
              else if (isLast && progress >= item.t + 0.04) stateNow = 'done';
              else if (progress < nextT) stateNow = 'active';
              else stateNow = 'done';
              return (
                <div key={i} className={`timeline-row state-${stateNow}`}>
                  <div className="timeline-tick">
                    {stateNow === 'done' && (
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {stateNow === 'active' && <span className="tick-pulse" />}
                  </div>
                  <div className="timeline-text">
                    <span>{item.label}</span>
                    {stateNow === 'pending'
                      ? <em className="timeline-meta"> pending</em>
                      : item.date && <em className="timeline-meta"> {item.date}</em>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NarrativeStack({ activePhase, phaseProgresses, phaseOpacity }) {
  return (
    <div className="narrative-stack">
      {PHASE_DATA.map((phase, i) => (
        <PhaseNarrative
          key={phase.id}
          phase={phase}
          progress={phaseProgresses[i]}
          opacity={(i === activePhase ? 1 : 0) * phaseOpacity}
        />
      ))}
    </div>
  );
}

function OntologyReveal({ progress }) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const enterOn = smoothstep(clamp((progress - 0.02) / 0.3, 0, 1));
  return (
    <div className="ontology-reveal" style={{ opacity: enterOn }}>
      <div className="ontology-header">
        <div className="phase-eyebrow-line">SCHEMA · PLANT OBJECT</div>
        <h2 className="phase-headline">
          Every milestone wrote<br />
          <em>a line in the schema.</em>
        </h2>
        <p className="phase-sub">
          Five phases collapsed into one live digital twin. Every operator action,
          every executed document, every audit result — captured as structured
          ontology, ready to drive enterprise systems-of-action.
        </p>
      </div>
      <div className="ontology-table">
        {ONTOLOGY_ROWS.map((row, i) => {
          const rowDelay = 0.1 + i * 0.018;
          const rowOn = smoothstep(clamp((progress - rowDelay) / 0.06, 0, 1));
          return (
            <div key={row.k} className="ontology-row" style={{ opacity: rowOn, transform: `translateX(${(1 - rowOn) * -8}px)` }}>
              <span className="row-from">{row.from}</span>
              <span className="row-key">{row.k}</span>
              <span className="row-value">{row.v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Hero copy (video + serif headline + email + manifesto + socials)
------------------------------------------------------------------ */
function HeroCopy({ heroOpacity, onHeroSubmit, heroEmail, setHeroEmail }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = null;
    let fadingOut = false;
    const cancelFade = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
    const fade = (to, duration = 500) => {
      cancelFade();
      const from = parseFloat(v.style.opacity || '0');
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / duration);
        v.style.opacity = String(from + (to - from) * k);
        if (k < 1) raf = requestAnimationFrame(step);
        else { raf = null; if (to === 0) fadingOut = true; }
      };
      raf = requestAnimationFrame(step);
    };
    const onLoaded = () => fade(1, 500);
    const onTimeUpdate = () => {
      if (!v.duration) return;
      if (!fadingOut && v.duration - v.currentTime < 0.55) {
        fadingOut = true;
        fade(0, 500);
      }
    };
    const onEnded = () => {
      v.style.opacity = '0';
      setTimeout(() => {
        v.currentTime = 0;
        v.play().catch(() => {});
        fadingOut = false;
        fade(1, 500);
      }, 100);
    };
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
    v.play().catch(() => {});
    return () => {
      cancelFade();
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnded);
    };
  }, []);

  return (
    <>
      <div className="hero-video-wrap" style={{ opacity: heroOpacity }}>
        <video ref={videoRef} className="hero-video" muted autoPlay playsInline preload="auto" src={HERO_VIDEO_SRC} />
      </div>
      <div
        className="hero-copy"
        style={{
          opacity: heroOpacity,
          transform: `translate(-50%, calc(-50% - ${(1 - heroOpacity) * 24}px))`,
        }}
      >
        <h1 className="hero-title-serif">
          Built for <em>retail expansion.</em>
        </h1>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form className="hero-email liquid-glass" onSubmit={onHeroSubmit}>
            <input
              type="email"
              placeholder="Enter your work email"
              aria-label="Email"
              value={heroEmail}
              onChange={(e) => setHeroEmail(e.target.value)}
            />
            <button type="submit" aria-label="Request membership">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
          <p className="hero-sub-bright">
            {PRODUCT_NAME} is the operating system that turns every site you open — BD, legal, build,
            handover, ops — into one live digital twin. Get early access.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <a href="#manifesto" className="hero-manifesto liquid-glass">
              Read the manifesto
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
        <div className="hero-social">
          <a href="#" className="liquid-glass" aria-label="LinkedIn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/>
              <rect x="2" y="9" width="4" height="12"/>
              <circle cx="4" cy="4" r="2"/>
            </svg>
          </a>
          <a href="#" className="liquid-glass" aria-label="X">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4l16 16M20 4L4 20"/>
            </svg>
          </a>
          <a href="#" className="liquid-glass" aria-label="GitHub">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
          </a>
        </div>
      </div>
    </>
  );
}

function ScrollCue({ heroOpacity }) {
  return (
    <div className="scroll-cue" style={{ opacity: heroOpacity }}>
      <span>Scroll to begin</span>
      <span className="line" />
    </div>
  );
}

/* ------------------------------------------------------------------
   Top navigation — brand + workflow links + membership input + sign in
------------------------------------------------------------------ */
function Nav({ onRequestMembership, membershipEmail, setMembershipEmail, onSignIn }) {
  return (
    <nav className="nav">
      <div className="nav-pill liquid-glass">
        <div className="nav-brand">
          <span className="mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7 L 20 7 L 12 12 L 20 17 L 4 17 L 12 12 Z"
                stroke="var(--scale-accent)" strokeWidth="1.4" strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 0 4px var(--scale-glow))' }}
              />
            </svg>
          </span>
          {PRODUCT_NAME}
        </div>
        <div className="nav-links">
          <button type="button">Platform</button>
          <button type="button">Pipeline</button>
          <button type="button">Customers</button>
          <button type="button">Docs</button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="nav-signin" onClick={onSignIn}>Sign in</button>
          <form
            className="nav-membership"
            onSubmit={(e) => { e.preventDefault(); onRequestMembership(); }}
          >
            <input
              type="email"
              placeholder="Enter your email"
              aria-label="Email for membership request"
              value={membershipEmail}
              onChange={(e) => setMembershipEmail(e.target.value)}
            />
            <button type="submit">
              Request membership
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------
   Auth modal — preserved verbatim from the previous landing.
   Wiring: receives optional prefillEmail and initialJoinMode so the
   nav membership flow opens directly into the join form with email
   already populated.
------------------------------------------------------------------ */
function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const raw = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const md = raw?.app_metadata || {};
    return { ...raw, ...md };
  } catch {
    return null;
  }
}

function AuthModal({ mode, onMode, onClose, prefillEmail, lockRegister = false }) {
  const navigate = useNavigate();
  const [joinMode, setJoinMode] = useState('supervisor');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    setBusy(false);
  }, [mode, joinMode]);

  if (!mode) return null;

  const isRegister = mode === 'register';
  const isJoin = mode === 'join';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;
  const statusTone = status?.tone || 'success';

  const showStatus = (message, tone = 'success') => setStatus({ message, tone });

  const routeFromToken = (token) => {
    const payload = decodeJwtPayload(token);
    if (payload?.role === 'business_admin') return '/business-admin';
    if (payload?.module === 'legal')   return '/legal';
    if (payload?.module === 'design')  return '/design';
    if (payload?.module === 'project') return '/project';
    return '/overview';
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const code = form.elements.workspace_code.value.trim().toUpperCase();
    if (!email || !code) { showStatus('Enter your work email and workspace code.', 'error'); return; }
    if (!EMAIL_RE.test(email)) { showStatus('Email looks invalid. Use the format you@company.com.', 'error'); return; }
    if (!CODE_RE.test(code)) { showStatus('Workspace code looks invalid. Ask your supervisor for the exact code.', 'error'); return; }
    setBusy(true);
    try {
      const data = await signInWithWorkspaceCode(email, code);
      onClose();
      navigate(routeFromToken(data?.access_token));
    } catch (error) {
      if (error?.isPending) showStatus(error.message || 'Your access is pending approval.');
      else showStatus(`Sign-in failed: ${error?.message || String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const company = form.elements.company.value.trim();
    const adminEmail = form.elements.admin_email.value.trim();
    const teamSize = form.elements.team_size.value;
    if (!company || !adminEmail) { showStatus('Company name and admin work email are required.', 'error'); return; }
    if (!EMAIL_RE.test(adminEmail)) { showStatus('Admin email looks invalid. Use the format name@company.com.', 'error'); return; }
    const apiBase = import.meta.env.VITE_API_BASE_URL || '/api';
    setBusy(true);
    try {
      const response = await fetch(`${apiBase}/tenancy/request-workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, admin_email: adminEmail, team_size: teamSize }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body?.detail || `HTTP ${response.status}`;
        const message = Array.isArray(detail)
          ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
          : String(detail);
        throw new Error(message);
      }
      showStatus(body?.message || `Request received for ${company}. We will email ${adminEmail} once provisioned.`);
      form.reset();
    } catch (error) {
      showStatus(`Could not submit request: ${error?.message || String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const code = form.elements.code.value.trim().toUpperCase();
    if (!email || !code) { showStatus('Enter your work email and the code from your team.', 'error'); return; }
    if (!EMAIL_RE.test(email)) { showStatus('Email looks invalid. Use the format you@company.com.', 'error'); return; }
    if (!CODE_RE.test(code)) { showStatus('Code looks invalid. Ask your team for the exact value.', 'error'); return; }
    setBusy(true);
    try {
      if (joinMode === 'supervisor') await signupAsSupervisor(email, code);
      else await signupAsExecutive(email, code);
      showStatus(joinMode === 'supervisor'
        ? 'Request submitted. Business admin will review.'
        : 'Request submitted. Your supervisor will review.');
      form.reset();
    } catch (error) {
      if (error?.isPending) showStatus(error.message);
      else showStatus(`Could not submit: ${error?.message || String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitHandler = isRegister ? handleRegister : isJoin ? handleJoin : handleLogin;
  const title = isRegister
    ? 'Create company workspace'
    : isJoin
      ? 'Join an existing workspace'
      : 'Sign in to your workspace';
  const intro = isRegister
    ? 'Register a tenant, invite your expansion team, and start the first pipeline.'
    : isJoin
      ? 'Enter the membership code from your team to request access.'
      : 'Enter the work email you used and your workspace code.';

  return (
    <div className="scale-auth-overlay" role="presentation" onMouseDown={onClose}>
      {/* onMouseDown only stops the click from bubbling to the overlay scrim
          (which closes the dialog); the form itself is not an interactive
          control and the real Close button below handles keyboard dismissal. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <form className="scale-auth-card" onSubmit={submitHandler} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="scale-auth-close" onClick={onClose} aria-label="Close auth">×</button>
        {!lockRegister && (
          <div className="scale-auth-tabs">
            <button type="button" data-active={mode === 'login'}    onClick={() => onMode('login')}>Sign in</button>
            <button type="button" data-active={mode === 'join'}     onClick={() => onMode('join')}>Join</button>
            <button type="button" data-active={mode === 'register'} onClick={() => onMode('register')}>Create</button>
          </div>
        )}
        <span>{isRegister ? 'Company setup' : isJoin ? 'Membership' : 'Enter workspace'}</span>
        <h2>{title}</h2>
        <p>{intro}</p>

        {isJoin && (
          <div className="scale-auth-join-mode" role="tablist" aria-label="Join as">
            <button type="button" data-active={joinMode === 'supervisor'} onClick={() => setJoinMode('supervisor')}>As supervisor</button>
            <button type="button" data-active={joinMode === 'executive'}  onClick={() => setJoinMode('executive')}>As executive</button>
          </div>
        )}

        {isRegister && (
          <label>
            Company name
            <input name="company" type="text" placeholder="Blue Tokai Coffee" autoComplete="organization" required autoFocus />
          </label>
        )}

        <label>
          Work email
          <input
            name={isRegister ? 'admin_email' : 'email'}
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            defaultValue={prefillEmail || ''}
            required
            autoFocus={!isRegister && !prefillEmail}
          />
        </label>

        {isRegister ? (
          <label>
            Team size
            <select name="team_size" defaultValue="51-200 users">
              <option>1-10 users</option>
              <option>11-50 users</option>
              <option>51-200 users</option>
              <option>200+ users</option>
            </select>
          </label>
        ) : (
          <label>
            {isJoin ? (joinMode === 'supervisor' ? 'Department code' : 'Supervisor code') : 'Workspace code'}
            <input
              name={isJoin ? 'code' : 'workspace_code'}
              type="text"
              placeholder={isJoin ? (joinMode === 'supervisor' ? 'DEPT-AB12' : 'SUP-AB12') : 'BTOKAI-7X9F'}
              autoComplete="off"
              spellCheck="false"
              required
              autoFocus={isJoin && !!prefillEmail}
            />
          </label>
        )}

        <button type="submit" className="scale-primary-btn" disabled={busy}>
          {busy ? 'Working...' : isRegister ? 'Request workspace' : isJoin ? `Request ${joinMode} access` : 'Continue to dashboard'}
        </button>
        <div className="scale-auth-note">
          {isRegister
            ? 'Workspace requests are sent to platform admins for approval. Once approved, the workspace code is emailed to the admin work email.'
            : isJoin
              ? 'Supervisor requests route to the business admin. Executive requests route to the supervisor code owner.'
              : "First time signing in? You'll land in the right queue until your role and module access are approved."}
        </div>
        {status && <div className={`scale-auth-status is-${statusTone}`}>{status.message}</div>}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------
   Root component
------------------------------------------------------------------ */
const TOTAL_VH = 900;
const REGIONS = [
  { kind: 'hero',  startVh:   0, endVh: 100 },
  { kind: 'phase', id: 0, startVh: 100, endVh: 240 },
  { kind: 'phase', id: 1, startVh: 240, endVh: 380 },
  { kind: 'phase', id: 2, startVh: 380, endVh: 520 },
  { kind: 'phase', id: 3, startVh: 520, endVh: 660 },
  { kind: 'phase', id: 4, startVh: 660, endVh: 800 },
  { kind: 'outro', startVh: 800, endVh: 900 },
];

export default function ScaleLandingPage() {
  const trackRef = useRef(null);
  const [scrolledVh, setScrolledVh] = useState(0);
  const [authMode, setAuthMode] = useState(null);
  const [membershipEmail, setMembershipEmail] = useState('');
  const [heroEmail, setHeroEmail] = useState('');
  const [prefillEmail, setPrefillEmail] = useState('');
  const [showCodeDialog, setShowCodeDialog] = useState(false);

  // Body data attributes drive accent + theme via CSS. Landing is always dark,
  // but we must NOT delete the theme on unmount — that would strip
  // body[data-theme="dark"] for users who toggled dark inside the app and
  // happened to pass through landing. Restore the user's preference instead.
  useEffect(() => {
    const prevTheme = document.body.dataset.theme;
    document.documentElement.dataset.scaleRoute = 'true';
    document.body.dataset.theme = 'dark';
    document.body.dataset.accent = 'cyan';
    document.body.dataset.scaleRoute = 'true';
    return () => {
      delete document.documentElement.dataset.scaleRoute;
      delete document.body.dataset.accent;
      delete document.body.dataset.scaleRoute;
      // Restore whatever the SessionContext established (persisted choice).
      let restored = prevTheme;
      try {
        const stored = window.localStorage.getItem('zm:dark');
        if (stored === '1') restored = 'dark';
        else if (stored === '0') restored = 'light';
      } catch { /* storage disabled */ }
      if (restored) document.body.dataset.theme = restored;
      else delete document.body.dataset.theme;
    };
  }, []);

  // Lock scroll while the auth modal is open.
  useEffect(() => {
    document.body.style.overflow = (authMode || showCodeDialog) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [authMode, showCodeDialog]);

  // Scroll → scrolledVh (0..900) tied to the sticky track height.
  useEffect(() => {
    let raf = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const vh = window.innerHeight;
        const scrolled = -rect.top;
        const totalPx = rect.height - vh;
        const raw = totalPx > 0 ? Math.max(0, Math.min(1, scrolled / totalPx)) : 0;
        setScrolledVh(raw * TOTAL_VH);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  const heroOpacity = Math.max(0, Math.min(1, 1 - scrolledVh / 80));
  const phaseOpacity = Math.max(0, Math.min(1, (scrolledVh - 80) / 30));
  const outroOpacity = Math.max(0, Math.min(1, (scrolledVh - 800) / 30));

  const phaseProgresses = useMemo(() => (
    REGIONS.filter((r) => r.kind === 'phase').map((r) => {
      const local = (scrolledVh - r.startVh) / (r.endVh - r.startVh);
      return Math.max(0, Math.min(1.01, local));
    })
  ), [scrolledVh]);

  let activePhase = 0;
  let transitionT = 0;
  if (scrolledVh < 100) {
    activePhase = 0;
  } else if (scrolledVh >= 800) {
    activePhase = 4;
  } else {
    for (let i = 0; i < 5; i++) {
      const r = REGIONS[i + 1];
      if (scrolledVh < r.endVh) {
        activePhase = i;
        const local = (scrolledVh - r.startVh) / (r.endVh - r.startVh);
        transitionT = Math.max(0, Math.min(1, (local - 0.85) / 0.15));
        if (i === 4) transitionT = 0;
        break;
      }
    }
  }

  const openMembershipFlow = (email) => {
    setPrefillEmail(email || '');
    setAuthMode('register');
  };

  const handleHeroSubmit = (event) => {
    event.preventDefault();
    openMembershipFlow(heroEmail.trim());
  };

  const requestMembership = () => {
    openMembershipFlow(membershipEmail.trim());
  };

  return (
    <main className="scale-landing-root">
      <Nav
        onRequestMembership={requestMembership}
        membershipEmail={membershipEmail}
        setMembershipEmail={setMembershipEmail}
        onSignIn={() => setShowCodeDialog(true)}
      />

      <div className="track" ref={trackRef} style={{ height: `${TOTAL_VH}vh` }}>
        <div className="stage">
          <div className="blueprint-grid" />
          <div className="blueprint-grid fine" />

          <Scene
            phaseProgresses={phaseProgresses}
            currentPhase={activePhase}
            transitionT={transitionT}
          />

          <CentralThread
            phaseOpacity={phaseOpacity}
            activePhase={activePhase}
            phaseProgresses={phaseProgresses}
          />

          <NarrativeStack
            activePhase={activePhase}
            phaseProgresses={phaseProgresses}
            phaseOpacity={phaseOpacity}
          />

          {outroOpacity > 0.01 && (
            <OntologyReveal progress={Math.min(1, (scrolledVh - 800) / 100)} />
          )}

          <ScrollCue heroOpacity={heroOpacity} />

          <HeroCopy
            heroOpacity={heroOpacity}
            onHeroSubmit={handleHeroSubmit}
            heroEmail={heroEmail}
            setHeroEmail={setHeroEmail}
          />
        </div>
      </div>

      <AuthModal
        mode={authMode}
        onMode={(m) => { setAuthMode(m); if (m !== 'join') setPrefillEmail(''); }}
        onClose={() => { setAuthMode(null); setPrefillEmail(''); }}
        prefillEmail={prefillEmail}
        lockRegister
      />

      <WorkspaceCodeDialog open={showCodeDialog} onClose={() => setShowCodeDialog(false)} />
    </main>
  );
}

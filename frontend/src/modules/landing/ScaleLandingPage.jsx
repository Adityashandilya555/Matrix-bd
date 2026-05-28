import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { framerLayoutSpec } from './scaleDesignTokens.js';
import {
  signInWithWorkspaceCode,
  signupAsSupervisor,
  signupAsExecutive,
} from '../../services/api/supabaseAuth.js';

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

const MODULES = [
  {
    id: 'pipeline',
    label: 'Pipeline',
    eyebrow: 'BD Intake',
    title: 'Site pipeline that keeps every visit accountable.',
    metric: '142',
    accent: '#5DF5DC',
    angle: -90,
    radius: 43,
    body: [
      'Capture site basics, model fit, SPOC context, Google pin, rent type, escalation, and expected rent in one structured workspace.',
      'Every change becomes part of the decision trail, so supervisors can approve, reject, delegate, or archive without losing context.',
    ],
    bullets: ['Draft to shortlist', 'Tenant-isolated records', 'Activity trail'],
    flow: ['DRAFT_CREATED', 'SHORTLIST_REVIEW', 'SHORTLISTED', 'LOI_STAGING'],
  },
  {
    id: 'shortlist',
    label: 'Shortlist',
    eyebrow: 'Supervisor Review',
    title: 'Shortlist decisions with controlled handoffs.',
    metric: '04',
    accent: '#D49A66',
    angle: -30,
    radius: 43,
    body: [
      'Supervisors review model, rent, score, owner, and site feasibility before a location moves into LOI staging.',
      'Delegation lets executives act on selected sites while approvals stay controlled by the right owner.',
    ],
    bullets: ['Yes / No decisions', 'Delegated actions', 'SLA visibility'],
    flow: ['VISIT_COMPLETE', 'SUPERVISOR_REVIEW', 'SHORTLISTED', 'LOI_REQUESTED'],
  },
  {
    id: 'legal',
    label: 'Legal',
    eyebrow: 'DDR + Agreement',
    title: 'Legal review before payment handoff.',
    metric: '07',
    accent: '#8D71FF',
    angle: 30,
    radius: 43,
    body: [
      'DDR captures title, sanctioned plan, OC / CC, commercial use, property tax, electricity, fire NOC, and custom checks.',
      'A positive legal decision moves toward agreement. A negative decision terminates the path and notifies BD.',
    ],
    bullets: ['DDR checklist', 'Agreement state', 'BD status mirror'],
    flow: ['LOI_UPLOADED', 'LEGAL_REVIEW', 'LEGAL_APPROVED', 'PUSHED_TO_PAYMENTS'],
  },
  {
    id: 'licensing',
    label: 'Licensing',
    eyebrow: 'Payment Readiness',
    title: 'Licensing checks before the final module handoff.',
    metric: '05',
    accent: '#9DFF65',
    angle: 90,
    radius: 43,
    body: [
      'Payment-side operators verify FSSAI, health trade, shop establishment registration, fire NOC, storage/signage, and custom checks.',
      'Completion is mirrored back to the site record so BD can see final readiness without reading payment tables.',
    ],
    bullets: ['Yes / No checks', 'Custom other rows', 'Handoff complete'],
    flow: ['PAYMENT_READY', 'LICENSING_CHECKS', 'LICENSING_COMPLETE', 'HANDOFF_DONE'],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    eyebrow: 'Three Role Model',
    title: 'Business admin, supervisors, and executives in one tenant scope.',
    metric: '03',
    accent: '#F4F0E8',
    angle: 150,
    radius: 43,
    body: [
      'Business admins approve supervisors, supervisors approve executives, and each user lands in the module they belong to.',
      'There is no sub-supervisor layer. Module membership and role are the clean control points.',
    ],
    bullets: ['Business admin', 'Supervisor', 'Executive'],
    flow: ['TENANT_REQUESTED', 'ADMIN_APPROVED', 'ROLE_ASSIGNED', 'WORKSPACE_ACTIVE'],
  },
  {
    id: 'ontology',
    label: 'Ontology',
    eyebrow: 'MCP Ready',
    title: 'A database shape ready for knowledge-layer tooling.',
    metric: 'AI',
    accent: '#C8BFFF',
    angle: 210,
    radius: 43,
    body: [
      'The product surface maps statuses, timestamps, module ownership, and tenant isolation into predictable backend contracts.',
      'That makes it easier to build ontology, query assistants, and audit views over the entire expansion pipeline later.',
    ],
    bullets: ['Status graph', 'Timestamp mapping', 'Tenant isolation'],
    flow: ['STATUS_EVENTS', 'TIMESTAMPS', 'TENANT_GRAPH', 'MCP_QUERY'],
  },
];

const SCALE_PILLARS = [
  {
    id: 'demographic-analytics',
    label: 'Demographic Analytics',
    eyebrow: 'Heatmaps + Density',
    title: 'Know where demand is already forming before a site is shortlisted.',
    metric: '01',
    accent: '#ff8a2a',
    angle: -18,
    radius: 43,
    body: [
      'Demographic layers turn footfall, residential density, income bands, and catchment movement into one expansion-readiness view.',
      'Teams can compare neighborhoods with the same scoring language before rent, legal, or payment effort is spent on the site.',
    ],
    bullets: ['Footprint density maps', 'Catchment heatmaps', 'Demand confidence'],
    flow: ['MARKET_SIGNAL', 'DENSITY_LAYERED', 'SITE_PRIORITY', 'BD_REVIEW'],
  },
  {
    id: 'site-selection',
    label: 'Site Selection',
    eyebrow: 'Spatial Matching',
    title: 'Match real-estate options to the right model, rent type, and location logic.',
    metric: '02',
    accent: '#5df5dc',
    angle: 72,
    radius: 43,
    body: [
      'Site selection connects model fit, Google pin, city, rent format, score, and SPOC data to a clean shortlist-ready workspace.',
      'The goal is not just to store a visit; it is to make every site comparable enough for a supervisor to decide quickly.',
    ],
    bullets: ['Real-estate matching', 'Model fit scoring', 'Pin-based context'],
    flow: ['SITE_VISIT', 'MODEL_MATCHED', 'SHORTLIST_REVIEW', 'LOI_STAGING'],
  },
  {
    id: 'competitor-tracking',
    label: 'Competitor Tracking',
    eyebrow: 'Market Clusters',
    title: 'Read competitor proximity, cluster pressure, and whitespace before committing.',
    metric: '03',
    accent: '#8d71ff',
    angle: 162,
    radius: 43,
    body: [
      'Competitor tracking lets teams see nearby stores, cluster saturation, market share pressure, and whitespace in the same expansion frame.',
      'A site can be strong on rent and weak on market context; this layer makes that tradeoff visible before approval.',
    ],
    bullets: ['Proximity clusters', 'Whitespace signal', 'Market pressure'],
    flow: ['COMPETITOR_SCAN', 'CLUSTER_MAPPED', 'RISK_WEIGHTED', 'DECISION_READY'],
  },
  {
    id: 'revenue-modeling',
    label: 'Revenue Modeling',
    eyebrow: 'Predictive Finance',
    title: 'Project revenue, rent exposure, and payoff confidence for each footprint call.',
    metric: '04',
    accent: '#9dff65',
    angle: 252,
    radius: 43,
    body: [
      'Revenue modeling ties expected sales, rent type, escalation, lock-in, CAPEX exposure, and repayment assumptions into one forecast surface.',
      'It gives BD, supervisors, and finance a shared view of upside and risk before the site moves deeper into handoffs.',
    ],
    bullets: ['Revenue forecast', 'Rent exposure', 'Payback confidence'],
    flow: ['ASSUMPTIONS_SET', 'FORECAST_BUILT', 'RISK_REVIEWED', 'FINANCE_READY'],
  },
];

const THREE_TRANSITION_STATES = {
  carousel: {
    route: '#/scale',
    cameraZ: 7.2,
    blobScale: 1,
    cardMode: 'elliptical-depth-orbit',
    pageScroll: 'window',
  },
  focus: {
    route: '#/scale?pillar=:id',
    cameraZ: 3.1,
    blobScale: 4.45,
    cardMode: 'selected-card-swallow-viewport',
    pageScroll: 'detail-panel',
  },
  reverse: {
    trigger: 'browser-back | close-button | top-pull-gesture',
    cameraZ: 7.2,
    blobScale: 1,
    cardMode: 'return-to-orbit-position',
    pageScroll: 'window',
  },
};

const PRODUCT_ROWS = [
  {
    number: '01',
    title: 'Qualify',
    owner: 'BD executive',
    date: 'Visit to draft',
    detail: 'Site name, city, model fit, SPOC, Google pin, rent type, commercial score, and visit context enter the system once.',
    chips: ['Pipeline', 'Draft', 'Visit data'],
  },
  {
    number: '02',
    title: 'Shortlist',
    owner: 'Supervisor',
    date: 'Decision gate',
    detail: 'Supervisors review feasibility, compare queue health, and make Yes or No decisions with a visible timestamp trail.',
    chips: ['Approval', 'SLA', 'Owner'],
  },
  {
    number: '03',
    title: 'Legal',
    owner: 'Legal team',
    date: 'DDR + agreement',
    detail: 'LOI upload moves a site into legal review, DDR checklists collect Yes or No answers, and rejected sites notify BD.',
    chips: ['DDR', 'Agreement', 'Reject path'],
  },
  {
    number: '04',
    title: 'License',
    owner: 'Payment team',
    date: 'Readiness checks',
    detail: 'FSSAI, health trade, shop establishment, fire NOC, storage, signage, and custom rows confirm final readiness.',
    chips: ['FSSAI', 'NOC', 'Custom rows'],
  },
];

const HANDOFF_STEPS = [
  ['DRAFT_CREATED', 'BD executive', 'First site request is saved with tenant id, creator, city, visit date, and model context.'],
  ['SHORTLIST_REVIEW', 'Supervisor', 'Supervisor sees the queue, reviews the field record, and decides whether the site should move forward.'],
  ['LOI_UPLOADED', 'BD / Supervisor', 'LOI document is attached and the site leaves pure BD flow for legal review.'],
  ['LEGAL_REVIEW', 'Legal', 'DDR questions, agreement status, and legal decision are tracked before payments can receive the site.'],
  ['LEGAL_APPROVED', 'Legal', 'Approved sites move forward; rejected sites become terminal and BD is notified with the reason.'],
  ['PUSHED_TO_PAYMENTS', 'Payment / Licensing', 'Payment readiness and licensing checklists complete the final module handoff.'],
];

const OPERATING_SIGNALS = [
  ['Three roles', 'Business admin, supervisor, and executive access. No sub-supervisor layer is needed.'],
  ['Tenant safe', 'Every site, user, document, and timestamp stays inside the company workspace.'],
  ['Audit first', 'Stage changes are not just labels; each transition should write who, when, and why.'],
  ['Ontology ready', 'Clean states and module ownership make the database easier to expose through MCP tooling later.'],
];

const COMPONENTS = [
  {
    name: 'ScaleHeader',
    detail: 'Fixed editorial header with Footprint, Modules, Architecture, Login, and Register actions.',
  },
  {
    name: 'OrbitalConstellation',
    detail: 'Positioning system for preview cards, orbit rings, hover lift, and central value proposition.',
  },
  {
    name: 'OrbitPreviewCard',
    detail: 'Small circular module preview with metric, tone color, caption, and shared-origin measurements.',
  },
  {
    name: 'ExpandedModuleView',
    detail: 'Full-screen detail state with scrollable module copy, status flow, and close/swipe gestures.',
  },
  {
    name: 'AuthModal',
    detail: 'Login/Register overlay that keeps workspace entry available without leaving the experimental nav.',
  },
];

const ARCHITECTURE_POINTS = [
  ['Route', '/scale is isolated from the production /welcome auth surface.'],
  ['Tokens', 'scaleDesignTokens.js exports Tailwind colors, type, radius, shadows, and motion spec.'],
  ['Motion', 'Three.js renders the morphing core while DOM cards stay readable and route-aware.'],
  ['Scroll', 'Wheel input now drives the carousel directly; detail view owns its own scroll while expanded.'],
];

function orbitToStyle(module) {
  return {
    '--orbit-angle': `${module.angle}deg`,
    '--orbit-angle-inverse': `${module.angle * -1}deg`,
    '--orbit-radius': 'clamp(260px, 32vmin, 430px)',
    '--orbit-duration': '34s',
  };
}

let activeScrollFrame = null;

const scaleCarouselMotion = {
  currentDragDegrees: 0,
  targetDragDegrees: 0,
  currentHeroProgress: 0,
  targetHeroProgress: 0,
  currentSceneOpacity: 1,
  targetSceneOpacity: 1,
  velocity: 0,
  raf: null,
  initialized: false,
  sceneInitialized: false,
};

function writeScaleHeroVisualState(heroProgress, snap = false) {
  const logoOpacity = Math.max(0, Math.min(1, 1 - heroProgress / 0.34));
  const copyOpacity = Math.max(0, Math.min(1, (heroProgress - 0.28) / 0.38));
  const logoY = -32 * heroProgress;
  const copyY = 88 - (Math.min(1, heroProgress) * 108);
  const orbitScale = 1 + heroProgress * 0.045;
  const sceneOpacityTarget = 1 - Math.min(1, Math.max(0, (heroProgress - 0.82) / 0.16));
  const sceneEase = sceneOpacityTarget < scaleCarouselMotion.currentSceneOpacity ? 0.46 : 0.18;

  scaleCarouselMotion.targetSceneOpacity = sceneOpacityTarget;
  if (snap || !scaleCarouselMotion.sceneInitialized) {
    scaleCarouselMotion.currentSceneOpacity = sceneOpacityTarget;
    scaleCarouselMotion.sceneInitialized = true;
  } else {
    scaleCarouselMotion.currentSceneOpacity += (
      sceneOpacityTarget - scaleCarouselMotion.currentSceneOpacity
    ) * sceneEase;
    if (sceneOpacityTarget === 0 && scaleCarouselMotion.currentSceneOpacity < 0.018) {
      scaleCarouselMotion.currentSceneOpacity = 0;
    }
  }

  document.documentElement.style.setProperty('--scale-hero-progress', heroProgress.toFixed(4));
  document.documentElement.style.setProperty('--scale-hero-logo-opacity', logoOpacity.toFixed(4));
  document.documentElement.style.setProperty('--scale-hero-copy-opacity', copyOpacity.toFixed(4));
  document.documentElement.style.setProperty('--scale-hero-logo-y', `${logoY.toFixed(2)}px`);
  document.documentElement.style.setProperty('--scale-hero-copy-y', `${copyY.toFixed(2)}px`);
  document.documentElement.style.setProperty('--scale-hero-orbit-scale', orbitScale.toFixed(4));
  document.documentElement.style.setProperty('--scale-cinema-scene-opacity', scaleCarouselMotion.currentSceneOpacity.toFixed(4));

  const cinemaScene = document.querySelector('.scale-cinema-scene');
  if (cinemaScene) cinemaScene.style.pointerEvents = scaleCarouselMotion.currentSceneOpacity > 0.08 ? 'auto' : 'none';
}

function requestScaleCarouselUpdate() {
  if (scaleCarouselMotion.raf) return;

  const tick = () => {
    scaleCarouselMotion.raf = null;

    if (Math.abs(scaleCarouselMotion.velocity) > 0.015) {
      scaleCarouselMotion.targetDragDegrees += scaleCarouselMotion.velocity;
      scaleCarouselMotion.velocity *= 0.78;
    } else {
      scaleCarouselMotion.velocity = 0;
    }

    scaleCarouselMotion.currentHeroProgress += (
      scaleCarouselMotion.targetHeroProgress - scaleCarouselMotion.currentHeroProgress
    ) * 0.24;
    scaleCarouselMotion.currentDragDegrees += (
      scaleCarouselMotion.targetDragDegrees - scaleCarouselMotion.currentDragDegrees
    ) * 0.32;

    writeScaleHeroVisualState(scaleCarouselMotion.currentHeroProgress);
    updateScaleCinematicPanels(scaleCarouselMotion.currentHeroProgress, scaleCarouselMotion.currentDragDegrees);

    const heroDelta = Math.abs(scaleCarouselMotion.targetHeroProgress - scaleCarouselMotion.currentHeroProgress);
    const dragDelta = Math.abs(scaleCarouselMotion.targetDragDegrees - scaleCarouselMotion.currentDragDegrees);
    const sceneDelta = Math.abs(scaleCarouselMotion.targetSceneOpacity - scaleCarouselMotion.currentSceneOpacity);
    if (heroDelta > 0.001 || dragDelta > 0.08 || sceneDelta > 0.01 || Math.abs(scaleCarouselMotion.velocity) > 0.015) {
      requestScaleCarouselUpdate();
    } else {
      scaleCarouselMotion.currentHeroProgress = scaleCarouselMotion.targetHeroProgress;
      scaleCarouselMotion.currentDragDegrees = scaleCarouselMotion.targetDragDegrees;
      writeScaleHeroVisualState(scaleCarouselMotion.currentHeroProgress, true);
      updateScaleCinematicPanels(scaleCarouselMotion.currentHeroProgress, scaleCarouselMotion.currentDragDegrees);
    }
  };

  scaleCarouselMotion.raf = window.requestAnimationFrame(tick);
}

function nudgeScaleCarouselFromWheel(deltaY) {
  const clamped = Math.max(-90, Math.min(90, deltaY));
  scaleCarouselMotion.targetDragDegrees -= clamped * 0.11;
  scaleCarouselMotion.velocity = Math.max(-2.4, Math.min(2.4, scaleCarouselMotion.velocity + (-clamped * 0.0026)));
  requestScaleCarouselUpdate();
}

function updateScaleScrollVars() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
  const hero = document.querySelector('.scale-hero');
  let heroProgress = 0;
  if (hero) {
    const start = hero.offsetTop;
    const end = Math.max(start + 1, hero.offsetTop + hero.offsetHeight - window.innerHeight);
    heroProgress = Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
  }
  document.documentElement.style.setProperty('--scale-scroll-progress', progress.toFixed(4));
  scaleCarouselMotion.targetHeroProgress = heroProgress;
  if (!scaleCarouselMotion.initialized) {
    scaleCarouselMotion.initialized = true;
    scaleCarouselMotion.currentHeroProgress = heroProgress;
    writeScaleHeroVisualState(heroProgress, true);
    updateScaleCinematicPanels(heroProgress, scaleCarouselMotion.currentDragDegrees);
    return;
  }
  requestScaleCarouselUpdate();
}

function updateScaleCinematicPanels(heroProgress, dragDegrees = scaleCarouselMotion.currentDragDegrees) {
  const panels = Array.from(document.querySelectorAll('.scale-cinema-panel'));
  if (!panels.length) return;

  const isCompact = window.innerWidth <= 900;
  const total = panels.length;
  const radiusX = Math.min(window.innerWidth * (isCompact ? 0.58 : 0.43), isCompact ? 320 : 760);
  const baseOffset = isCompact ? -18 : -34;
  const rotation = baseOffset - heroProgress * (isCompact ? 300 : 390) + dragDegrees;
  const fade = 1 - Math.min(1, Math.max(0, (heroProgress - 0.64) / 0.3));

  panels.forEach((panel, index) => {
    const angle = (((index * (360 / total)) + rotation) * Math.PI) / 180;
    const depth = Math.cos(angle);
    const x = Math.sin(angle) * radiusX;
    const y = Math.sin(angle * 1.35) * (isCompact ? 18 : 34);
    const depthProgress = (depth + 1) / 2;
    const scale = 0.68 + depthProgress * 0.42;
    const behindSphere = depth < -0.04;
    const sideOpacity = 0.28 + depthProgress * 0.72;
    const opacity = fade * sideOpacity * (behindSphere ? 0.38 : 1);
    const tilt = Math.sin(angle) * (isCompact ? -10 : -17);

    panel.style.transform = [
      'translate3d(-50%, -50%, 0)',
      `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`,
      `rotateY(${tilt.toFixed(2)}deg)`,
      `scale(${scale.toFixed(4)})`,
    ].join(' ');
    panel.style.opacity = opacity.toFixed(4);
    panel.style.zIndex = behindSphere ? '2' : String(6 + Math.round(depthProgress * 6));
    panel.style.pointerEvents = opacity > 0.28 && !behindSphere ? 'auto' : 'none';
  });
}

function animatePageScroll(targetY, duration = 920) {
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const startY = window.scrollY;
  const distance = targetY - startY;
  if (prefersReduced || Math.abs(distance) < 4) {
    window.scrollTo(0, targetY);
    return;
  }

  if (activeScrollFrame) {
    window.cancelAnimationFrame(activeScrollFrame);
    activeScrollFrame = null;
  }

  const started = performance.now();
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const tick = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    window.scrollTo(0, startY + distance * easeInOutCubic(progress));
    updateScaleScrollVars();
    if (progress < 1) {
      activeScrollFrame = window.requestAnimationFrame(tick);
    } else {
      activeScrollFrame = null;
    }
  };

  activeScrollFrame = window.requestAnimationFrame(tick);
}

function useScrollProgress() {
  useEffect(() => {
    let ticking = false;

    const update = () => {
      updateScaleScrollVars();
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.documentElement.style.removeProperty('--scale-scroll-progress');
      document.documentElement.style.removeProperty('--scale-hero-progress');
      document.documentElement.style.removeProperty('--scale-hero-logo-opacity');
      document.documentElement.style.removeProperty('--scale-hero-copy-opacity');
      document.documentElement.style.removeProperty('--scale-hero-logo-y');
      document.documentElement.style.removeProperty('--scale-hero-copy-y');
      document.documentElement.style.removeProperty('--scale-hero-orbit-scale');
      document.documentElement.style.removeProperty('--scale-cinema-scene-opacity');
      if (scaleCarouselMotion.raf) {
        window.cancelAnimationFrame(scaleCarouselMotion.raf);
        scaleCarouselMotion.raf = null;
      }
      if (activeScrollFrame) {
        window.cancelAnimationFrame(activeScrollFrame);
        activeScrollFrame = null;
      }
      scaleCarouselMotion.initialized = false;
      scaleCarouselMotion.sceneInitialized = false;
      scaleCarouselMotion.currentSceneOpacity = 1;
      scaleCarouselMotion.targetSceneOpacity = 1;
    };
  }, []);
}

function ScaleLogoMark({ className = '' }) {
  const gradientId = useId().replace(/:/g, '');

  return (
    <svg className={`scale-logo-mark ${className}`} viewBox="0 0 240 240" role="img" aria-label="Scale logo mark">
      <defs>
        <linearGradient id={gradientId} x1="40" y1="34" x2="196" y2="210" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f4f0e8" />
          <stop offset="0.46" stopColor="#5df5dc" />
          <stop offset="1" stopColor="#d49a66" />
        </linearGradient>
      </defs>
      <circle className="scale-logo-mark-disc" cx="120" cy="120" r="82" />
      <ellipse className="scale-logo-mark-orbit scale-logo-mark-orbit-a" cx="120" cy="120" rx="100" ry="42" />
      <ellipse className="scale-logo-mark-orbit scale-logo-mark-orbit-b" cx="120" cy="120" rx="104" ry="38" />
      <path
        className="scale-logo-mark-route"
        fill={`url(#${gradientId})`}
        d="M73 76H158L143 101H108L95 120H140L169 144L151 169H66L82 144H123L134 129H91L66 105Z"
      />
      <path className="scale-logo-mark-arrow" d="M154 72L184 58L172 90" />
      <circle className="scale-logo-mark-node scale-logo-mark-node-a" cx="72" cy="105" r="5" />
      <circle className="scale-logo-mark-node scale-logo-mark-node-b" cx="169" cy="144" r="5" />
    </svg>
  );
}

function ScaleThreeHero({ selectedId }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ selectedId });
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    stateRef.current = { selectedId };
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      setFallback(true);
      return undefined;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.06, THREE_TRANSITION_STATES.carousel.cameraZ);

    const geometry = new THREE.IcosahedronGeometry(1.72, 42);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uZoom: { value: 0 },
        uPrimary: { value: new THREE.Color('#ff8a2a') },
        uSecondary: { value: new THREE.Color('#f4f0e8') },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uZoom;
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          vec3 p = position;
          float waveA = sin((p.x * 2.8) + (uTime * 1.18)) * 0.095;
          float waveB = sin((p.y * 3.6) - (uTime * 0.92)) * 0.07;
          float waveC = cos((p.z * 4.2) + (uTime * 1.42)) * 0.06;
          p += normal * (waveA + waveB + waveC + (uZoom * 0.12));
          vNormal = normalize(normalMatrix * normal);
          vPosition = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uZoom;
        uniform vec3 uPrimary;
        uniform vec3 uSecondary;
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 1.65);
          float band = smoothstep(-0.85, 0.95, vPosition.y + sin(uTime * 0.45) * 0.18);
          float heat = smoothstep(-1.2, 1.15, vPosition.x + cos(uTime * 0.3) * 0.22);
          vec3 ember = mix(vec3(0.08, 0.045, 0.018), uPrimary, 0.72 + heat * 0.24);
          vec3 highlight = mix(ember, uSecondary, band * 0.18);
          highlight += vec3(1.0, 0.33, 0.02) * fresnel * (0.34 + uZoom * 0.22);
          float alpha = 0.93 + (uZoom * 0.07);
          gl_FragColor = vec4(highlight, alpha);
        }
      `,
    });

    const blob = new THREE.Mesh(geometry, material);
    blob.rotation.set(-0.16, 0.38, -0.08);
    scene.add(blob);

    const ringMaterialA = new THREE.MeshBasicMaterial({
      color: 0xff8a2a,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const ringMaterialB = new THREE.MeshBasicMaterial({
      color: 0x5df5dc,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.16, 0.01, 10, 160), ringMaterialA);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(2.58, 0.008, 10, 160), ringMaterialB);
    ringA.rotation.set(1.16, 0.04, -0.36);
    ringB.rotation.set(1.32, 0.62, 0.34);
    scene.add(ringA, ringB);

    let raf = 0;
    let zoom = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const tick = (time) => {
      const targetZoom = stateRef.current.selectedId ? 1 : 0;
      zoom += (targetZoom - zoom) * 0.065;

      material.uniforms.uTime.value = time * 0.001;
      material.uniforms.uZoom.value = zoom;

      const scale = THREE_TRANSITION_STATES.carousel.blobScale
        + (THREE_TRANSITION_STATES.focus.blobScale - THREE_TRANSITION_STATES.carousel.blobScale) * zoom;
      blob.scale.setScalar(scale);
      blob.rotation.x += 0.0025 + zoom * 0.001;
      blob.rotation.y += 0.0036;
      blob.rotation.z = Math.sin(time * 0.00028) * 0.08;

      ringA.rotation.z += 0.0028;
      ringB.rotation.z -= 0.0022;
      ringA.scale.setScalar(1 + zoom * 0.22);
      ringB.scale.setScalar(1 + zoom * 0.34);
      ringMaterialA.opacity = 0.32 - zoom * 0.16;
      ringMaterialB.opacity = 0.24 - zoom * 0.12;

      camera.position.z = THREE_TRANSITION_STATES.carousel.cameraZ
        + (THREE_TRANSITION_STATES.focus.cameraZ - THREE_TRANSITION_STATES.carousel.cameraZ) * zoom;
      camera.position.y = 0.06 - zoom * 0.1;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      ringA.geometry.dispose();
      ringB.geometry.dispose();
      ringMaterialA.dispose();
      ringMaterialB.dispose();
      renderer.dispose();
    };
  }, []);

  if (fallback) {
    return <span className="scale-webgl-fallback" aria-hidden="true" />;
  }

  return <canvas ref={canvasRef} className="scale-webgl-canvas" aria-hidden="true" />;
}

function useRevealOnScroll() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('.scale-reveal'));
    if (!nodes.length) return undefined;

    if (!('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );

    nodes.forEach((node, index) => {
      node.style.setProperty('--reveal-delay', `${Math.min(index * 34, 260)}ms`);
      observer.observe(node);
    });

    return () => observer.disconnect();
  }, []);
}

function Header({ onAuth, onJump }) {
  return (
    <header className="scale-header">
      <span className="scale-header-progress" />
      <button type="button" className="scale-brand" onClick={() => onJump('top')} aria-label="Scale home">
        <ScaleLogoMark className="scale-brand-mark" />
        <span>
          <strong>Z-Matrix</strong>
          <em>Retail Expansion OS</em>
        </span>
      </button>
      <nav className="scale-nav" aria-label="Primary">
        <button type="button" onClick={() => onJump('modules')}>Workflow</button>
        <button type="button" onClick={() => onJump('handoffs')}>Tenant safety</button>
        <button type="button" onClick={() => onJump('architecture')}>Company setup</button>
      </nav>
      <div className="scale-actions">
        <button type="button" className="scale-link-btn" onClick={() => onAuth('login')}>Sign in</button>
        <button type="button" className="scale-link-btn scale-join-btn" onClick={() => onAuth('join')}>Join</button>
        <button type="button" className="scale-primary-btn" onClick={() => onAuth('register')}>Create workspace</button>
      </div>
    </header>
  );
}

function MiniPreview({ module }) {
  return (
    <div className="scale-mini-preview" style={{ '--accent': module.accent }}>
      <div className="scale-mini-top">
        <span>{module.eyebrow}</span>
        <i />
      </div>
      <div className="scale-mini-number">{module.metric}</div>
      <div className="scale-mini-bars">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function HeroProductCard({ module, index, activeId, onOpen, registerCard }) {
  return (
    <button
      ref={(node) => registerCard(module.id, node)}
      type="button"
      className="scale-hero-card"
      data-module-id={module.id}
      data-hidden={activeId === module.id ? 'true' : 'false'}
      style={{
        '--accent': module.accent,
        '--card-delay': `${index * -2.2}s`,
        '--card-enter-delay': `${1.55 + index * 0.34}s`,
        '--card-tilt': `${[-4, 3, -2, 4, -3, 2][index % 6]}deg`,
      }}
      onClick={(event) => onOpen(module, event.currentTarget)}
    >
      <span>{module.eyebrow}</span>
      <strong>{module.metric}</strong>
      <em>{module.label}</em>
      <p>{module.title}</p>
      <div className="scale-hero-card-flow">
        <b>{module.flow[0]}</b>
        <i />
        <b>{module.flow[module.flow.length - 1]}</b>
      </div>
    </button>
  );
}

function CinematicModulePanel({ module, index, activeId, onOpen, registerCard }) {
  return (
    <button
      ref={(node) => registerCard(module.id, node)}
      type="button"
      className="scale-cinema-panel"
      data-module-id={module.id}
      data-hidden={activeId === module.id ? 'true' : 'false'}
      style={{
        '--accent': module.accent,
        '--panel-angle': `${index * 60}deg`,
        '--panel-angle-inverse': `${index * -60}deg`,
        '--panel-index': index,
        '--panel-delay': `${2.45 + index * 0.12}s`,
      }}
      onClick={(event) => onOpen(module, event.currentTarget)}
    >
      <span>{module.eyebrow}</span>
      <strong>{module.label}</strong>
      <em>{module.metric}</em>
      <p>{module.title}</p>
      <i>View module</i>
    </button>
  );
}

function OrbitalCard({ module, index, activeId, onOpen, onPauseChange, registerCard }) {
  return (
    <button
      ref={(node) => registerCard(module.id, node)}
      type="button"
      className="scale-orbit-card"
      data-module-id={module.id}
      data-hidden={activeId === module.id ? 'true' : 'false'}
      style={{
        ...orbitToStyle(module),
        '--accent': module.accent,
      }}
      onClick={(event) => onOpen(module, event.currentTarget)}
      onPointerEnter={() => onPauseChange(true)}
      onPointerLeave={() => onPauseChange(false)}
      onFocus={() => onPauseChange(true)}
      onBlur={() => onPauseChange(false)}
    >
      <MiniPreview module={module} />
      <span className="scale-orbit-caption">{module.label}</span>
    </button>
  );
}

function OrbitalConstellation({
  modules,
  activeId,
  onOpen,
  registerCard,
  onJump,
  onAuth,
  onCarouselPointerDown,
  onCarouselPointerMove,
  onCarouselPointerUp,
  onCarouselWheel,
}) {
  return (
    <section id="footprint" className="scale-hero scale-cinema-hero" aria-label="Retail expansion footprint">
      <div
        className="scale-cinema-scene"
        data-zooming={activeId ? 'true' : 'false'}
        onPointerDown={onCarouselPointerDown}
        onPointerMove={onCarouselPointerMove}
        onPointerUp={onCarouselPointerUp}
        onPointerCancel={onCarouselPointerUp}
        onWheel={onCarouselWheel}
      >
        <div className="scale-cinema-glow" aria-hidden="true" />
        <ScaleThreeHero selectedId={activeId} />

        <div className="scale-cinema-type" aria-hidden="true">
          <span>Retail</span>
          <span>expansion</span>
          <span>command</span>
        </div>

        <div className="scale-cinema-orb" aria-hidden="true" />

        <div className="scale-cinema-stage" aria-label="Scale module carousel">
          <div className="scale-cinema-rail-intro">
            <div className="scale-cinema-rail-loop">
              {modules.map((module, index) => (
                <CinematicModulePanel
                  key={module.id}
                  module={module}
                  index={index}
                  activeId={activeId}
                  registerCard={registerCard}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="scale-cinema-caption">
          <span>Scale Retail Expansion OS</span>
          <h1>One command layer for every site handoff.</h1>
          <p>BD, Legal, Licensing, Payment, Admin, and ontology-ready data move through one visible trail.</p>
          <div className="scale-value-actions">
            <button type="button" onClick={() => onAuth('register')}>Start company workspace</button>
            <button type="button" onClick={() => onAuth('login')}>Enter workspace</button>
            <button type="button" onClick={() => onJump('modules')}>Explore workflow</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailView({ selected, phase, origin, onClose }) {
  const scrollRef = useRef(null);
  const touchStart = useRef(null);

  const style = {
    '--accent': selected.accent,
    '--origin-left': `${origin.left}px`,
    '--origin-top': `${origin.top}px`,
    '--origin-width': `${origin.width}px`,
    '--origin-height': `${origin.height}px`,
    '--origin-radius': `${origin.radius}px`,
  };

  const closeFromScroll = (event) => {
    const node = scrollRef.current;
    if (node && node.scrollTop <= 0 && event.deltaY < -18) onClose('gesture');
  };

  const onTouchStart = (event) => {
    const touch = event.touches[0];
    touchStart.current = {
      y: touch.clientY,
      scrollTop: scrollRef.current?.scrollTop || 0,
    };
  };

  const onTouchMove = (event) => {
    if (!touchStart.current) return;
    const dy = event.touches[0].clientY - touchStart.current.y;
    if (touchStart.current.scrollTop <= 0 && dy > 64) onClose('gesture');
  };

  return (
    <div
      className={`scale-detail-shell is-${phase}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={`${selected.label} detail`}
    >
      <button type="button" className="scale-detail-close" onClick={() => onClose('button')} aria-label="Close detail">
        X
      </button>
      <div
        ref={scrollRef}
        className="scale-detail-scroll"
        onWheel={closeFromScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        <section className="scale-detail-hero">
          <div>
            <span>{selected.eyebrow}</span>
            <h2>{selected.title}</h2>
          </div>
        </section>

        <section className="scale-detail-grid">
          <div className="scale-detail-copy">
            {selected.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <div className="scale-detail-panel">
            <span>Module signals</span>
            {selected.bullets.map((item) => (
              <div key={item} className="scale-detail-row">
                <i />
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="scale-detail-flow">
          <span>State logic</span>
          <div>
            {selected.flow.map((state, index) => (
              <React.Fragment key={state}>
                <b>{state}</b>
                {index < selected.flow.length - 1 && <i />}
              </React.Fragment>
            ))}
          </div>
        </section>

        <section className="scale-motion-note">
          <span>3D transition state map</span>
          <pre>{JSON.stringify({ webgl: THREE_TRANSITION_STATES, sharedLayout: framerLayoutSpec.sharedLayout.detail }, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}

function AuthModal({ mode, onMode, onClose }) {
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
    if (payload?.module === 'legal') return '/legal';
    if (payload?.module === 'payment') return '/payment';
    return '/overview';
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const code = form.elements.workspace_code.value.trim().toUpperCase();
    if (!email || !code) {
      showStatus('Enter your work email and workspace code.', 'error');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      showStatus('Email looks invalid. Use the format you@company.com.', 'error');
      return;
    }
    if (!CODE_RE.test(code)) {
      showStatus('Workspace code looks invalid. Ask your supervisor for the exact code.', 'error');
      return;
    }
    setBusy(true);
    try {
      const data = await signInWithWorkspaceCode(email, code);
      onClose();
      navigate(routeFromToken(data?.access_token));
    } catch (error) {
      // Pending-approval responses are not failures — show the warm message
      // as success-toned without the "Sign-in failed:" prefix.
      if (error?.isPending) {
        showStatus(error.message || 'Your access is pending approval.');
      } else {
        showStatus(`Sign-in failed: ${error?.message || String(error)}`, 'error');
      }
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
    if (!company || !adminEmail) {
      showStatus('Company name and admin work email are required.', 'error');
      return;
    }
    if (!EMAIL_RE.test(adminEmail)) {
      showStatus('Admin email looks invalid. Use the format name@company.com.', 'error');
      return;
    }

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
    if (!email || !code) {
      showStatus('Enter your work email and the code from your team.', 'error');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      showStatus('Email looks invalid. Use the format you@company.com.', 'error');
      return;
    }
    if (!CODE_RE.test(code)) {
      showStatus('Code looks invalid. Ask your team for the exact value.', 'error');
      return;
    }

    setBusy(true);
    try {
      if (joinMode === 'supervisor') await signupAsSupervisor(email, code);
      else await signupAsExecutive(email, code);
      showStatus(joinMode === 'supervisor'
        ? 'Request submitted. Business admin will review.'
        : 'Request submitted. Your supervisor will review.');
      form.reset();
    } catch (error) {
      if (error?.isPending) {
        showStatus(error.message);
      } else {
        showStatus(`Could not submit: ${error?.message || String(error)}`, 'error');
      }
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
      ? 'Pick how you are joining. Your request goes to whoever can approve it.'
      : 'Enter the work email you used and your workspace code.';

  return (
    <div className="scale-auth-overlay" role="presentation" onMouseDown={onClose}>
      <form className="scale-auth-card" onSubmit={submitHandler} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="scale-auth-close" onClick={onClose} aria-label="Close auth">×</button>
        <div className="scale-auth-tabs">
          <button type="button" data-active={mode === 'login'} onClick={() => onMode('login')}>Sign in</button>
          <button type="button" data-active={mode === 'join'} onClick={() => onMode('join')}>Join</button>
          <button type="button" data-active={mode === 'register'} onClick={() => onMode('register')}>Create</button>
        </div>
        <span>{isRegister ? 'Company setup' : isJoin ? 'Team access' : 'Enter workspace'}</span>
        <h2>{title}</h2>
        <p>{intro}</p>

        {isJoin && (
          <div className="scale-auth-join-mode" role="tablist" aria-label="Join as">
            <button type="button" data-active={joinMode === 'supervisor'} onClick={() => setJoinMode('supervisor')}>
              As supervisor
            </button>
            <button type="button" data-active={joinMode === 'executive'} onClick={() => setJoinMode('executive')}>
              As executive
            </button>
          </div>
        )}

        {isRegister && (
          <label>
            Company name
            <input
              name="company"
              type="text"
              placeholder="Blue Tokai Coffee"
              autoComplete="organization"
              required
              autoFocus
            />
          </label>
        )}

        <label>
          Work email
          <input
            name={isRegister ? 'admin_email' : 'email'}
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
            autoFocus={!isRegister}
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
            />
          </label>
        )}

        <button type="submit" className="scale-primary-btn" disabled={busy}>
          {busy
            ? 'Working...'
            : isRegister
              ? 'Request workspace'
              : isJoin
                ? `Request ${joinMode} access`
                : 'Continue to dashboard'}
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

function SupportSections() {
  return (
    <>
      <section id="modules" className="scale-section scale-product-index">
        <span className="scale-reveal">Operating map</span>
        <h2 className="scale-reveal">A retail expansion system with the important gates made visible.</h2>
        <div className="scale-index-rows">
          {PRODUCT_ROWS.map((row) => (
            <article key={row.number} className="scale-index-row scale-reveal">
              <div className="scale-index-number">{row.number}</div>
              <h3>{row.title}</h3>
              <div className="scale-index-meta">
                <b>{row.owner}</b>
                <span>{row.date}</span>
              </div>
              <p>{row.detail}</p>
              <div className="scale-index-chips" aria-label={`${row.title} signals`}>
                {row.chips.map((chip) => <span key={chip}>{chip}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="handoffs" className="scale-section scale-handoffs">
        <div className="scale-handoff-sticky scale-reveal">
          <span>Stage tracking</span>
          <h2>Every handoff should leave a timestamp, owner, and reason.</h2>
          <p>
            The product is useful because the BD view does not go blind after LOI upload. Legal,
            licensing, and payment readiness are reflected back into the same expansion record.
          </p>
        </div>
        <div className="scale-handoff-rail">
          {HANDOFF_STEPS.map(([state, owner, detail], index) => (
            <article key={state} className="scale-handoff-step scale-reveal">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <b>{state}</b>
                <em>{owner}</em>
              </div>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scale-section scale-signals">
        <span className="scale-reveal">Workspace intelligence</span>
        <h2 className="scale-reveal">Clean access, clean states, clean database meaning.</h2>
        <div className="scale-signal-grid">
          {OPERATING_SIGNALS.map(([label, value]) => (
            <article key={label} className="scale-reveal">
              <b>{label}</b>
              <p>{value}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="architecture" className="scale-section scale-architecture">
        <div className="scale-reveal">
          <span>Frontend architecture</span>
          <h2>Design tokens stay separate from interaction logic.</h2>
          <p>
            The prototype exports Tailwind theme tokens and Framer Motion layout variants in
            <code> scaleDesignTokens.js </code>
            while this preview runs with dependency-free CSS transitions.
          </p>
        </div>
        <div className="scale-architecture-list">
          {ARCHITECTURE_POINTS.map(([label, value]) => (
            <article key={label} className="scale-reveal">
              <b>{label}</b>
              <p>{value}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scale-section scale-components">
        <span className="scale-reveal">Component foundation</span>
        <h2 className="scale-reveal">The landing page is split into reusable, replaceable surfaces.</h2>
        <div className="scale-module-list">
          {COMPONENTS.map((item) => (
            <article key={item.name} className="scale-reveal">
              <b>{item.name}</b>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export default function ScaleLandingPage() {
  const cardRefs = useRef(new Map());
  const selectedRef = useRef(null);
  const dragRef = useRef({ active: false, x: 0, pointerId: null, moved: false });
  const [authMode, setAuthMode] = useState(null);
  const [selected, setSelected] = useState(null);
  const [origin, setOrigin] = useState(null);
  const [phase, setPhase] = useState('opening');
  const [orbitPaused, setOrbitPaused] = useState(false);

  const modules = useMemo(() => SCALE_PILLARS, []);

  useScrollProgress();
  useRevealOnScroll();

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const lock = Boolean(selected || authMode);
    document.documentElement.dataset.scaleRoute = 'true';
    document.body.dataset.scaleRoute = 'true';
    document.body.style.overflow = lock ? 'hidden' : '';
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      delete document.documentElement.dataset.scaleRoute;
      delete document.body.dataset.scaleRoute;
    };
  }, [selected, authMode]);

  const registerCard = (id, node) => {
    if (node) cardRefs.current.set(id, node);
    else cardRefs.current.delete(id);
  };

  const jumpTo = (id) => {
    if (id === 'hero-copy') {
      const hero = document.getElementById('footprint');
      if (!hero) return;
      animatePageScroll(hero.offsetTop + window.innerHeight * 0.98);
      return;
    }
    const target = id === 'top' ? document.querySelector('.scale-page') : document.getElementById(id);
    if (!target) return;
    const offset = id === 'top' ? 0 : 92;
    const targetY = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
    animatePageScroll(targetY);
  };

  const rectFromNode = (node) => {
    if (!node) {
      return {
        left: window.innerWidth / 2 - 100,
        top: window.innerHeight / 2 - 130,
        width: 200,
        height: 260,
        radius: 24,
      };
    }
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      radius: rect.width / 2,
    };
  };

  const routeForModule = (moduleId) => `${window.location.pathname}${window.location.search}#/scale?pillar=${moduleId}`;
  const baseRoute = () => `${window.location.pathname}${window.location.search}#/scale`;
  const pillarFromHash = () => {
    const [, query = ''] = window.location.hash.split('?');
    return new URLSearchParams(query).get('pillar');
  };

  const openModule = (module, node, options = {}) => {
    const { syncRoute = true } = options;
    setOrbitPaused(false);
    setOrigin(rectFromNode(node));
    setSelected(module);
    setPhase('opening');
    if (syncRoute && pillarFromHash() !== module.id) {
      window.history.pushState({ scalePillar: module.id }, '', routeForModule(module.id));
    }
    window.setTimeout(() => setPhase('open'), 40);
  };

  const closeModule = (source = 'button') => {
    const current = selectedRef.current;
    if (!current) return;
    const node = cardRefs.current.get(current.id);
    if (node) setOrigin(rectFromNode(node));
    setPhase('closing');
    if (source !== 'pop' && pillarFromHash()) {
      window.history.pushState({ scalePillar: null }, '', baseRoute());
    }
    window.setTimeout(() => {
      setSelected(null);
      setPhase('opening');
    }, 620);
  };

  useEffect(() => {
    const syncFromRoute = () => {
      const pillarId = pillarFromHash();
      const active = selectedRef.current;
      if (!pillarId) {
        if (active) closeModule('pop');
        return;
      }

      if (active?.id === pillarId) return;
      const module = modules.find((item) => item.id === pillarId);
      if (!module) return;
      openModule(module, cardRefs.current.get(module.id), { syncRoute: false });
    };

    syncFromRoute();
    window.addEventListener('popstate', syncFromRoute);
    window.addEventListener('hashchange', syncFromRoute);
    return () => {
      window.removeEventListener('popstate', syncFromRoute);
      window.removeEventListener('hashchange', syncFromRoute);
    };
  }, [modules]);

  const onCarouselPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest?.('.scale-cinema-panel')) return;
    dragRef.current = { active: true, x: event.clientX, pointerId: event.pointerId, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onCarouselPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) < 0.2) return;
    drag.moved = true;
    drag.x = event.clientX;
    scaleCarouselMotion.targetDragDegrees += delta * 0.18;
    scaleCarouselMotion.currentDragDegrees += delta * 0.06;
    scaleCarouselMotion.velocity = delta * 0.036;
    requestScaleCarouselUpdate();
  };

  const onCarouselPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    event.currentTarget.releasePointerCapture?.(drag.pointerId);
    dragRef.current = { active: false, x: 0, pointerId: null, moved: false };
    requestScaleCarouselUpdate();
  };

  const onCarouselWheel = (event) => {
    if (selectedRef.current) return;
    nudgeScaleCarouselFromWheel(event.deltaY);
    requestScaleCarouselUpdate();
  };

  return (
    <main id="top" className="scale-page">
      <style>{SCALE_CSS}</style>
      <Header
        onAuth={setAuthMode}
        onJump={jumpTo}
      />
      <OrbitalConstellation
        modules={modules}
        activeId={selected?.id}
        paused={orbitPaused}
        registerCard={registerCard}
        onOpen={openModule}
        onPauseChange={setOrbitPaused}
        onJump={jumpTo}
        onAuth={setAuthMode}
        onCarouselPointerDown={onCarouselPointerDown}
        onCarouselPointerMove={onCarouselPointerMove}
        onCarouselPointerUp={onCarouselPointerUp}
        onCarouselWheel={onCarouselWheel}
      />
      <SupportSections />
      {selected && origin && (
        <DetailView selected={selected} origin={origin} phase={phase} onClose={closeModule} />
      )}
      <AuthModal mode={authMode} onMode={setAuthMode} onClose={() => setAuthMode(null)} />
    </main>
  );
}

const SCALE_CSS = `
  :root {
    --scale-ink: #090a07;
    --scale-paper: #f4f0e8;
    --scale-bone: #e9e1d1;
    --scale-muted: rgba(244, 240, 232, 0.62);
    --scale-line: rgba(244, 240, 232, 0.14);
    --scale-ease: cubic-bezier(0.19, 1, 0.22, 1);
  }

  html[data-scale-route="true"],
  body[data-scale-route="true"],
  body[data-scale-route="true"] #root {
    height: auto !important;
    min-height: 100%;
    overflow-x: hidden !important;
    overflow-y: auto;
    scroll-behavior: auto;
  }

  body[data-scale-route="true"] {
    margin: 0;
    background: var(--scale-ink);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .scale-page,
  .scale-page * {
    box-sizing: border-box;
  }

  .scale-page {
    min-height: 100vh;
    color: var(--scale-paper);
    background:
      radial-gradient(circle at 74% 34%, rgba(93, 245, 220, 0.12), transparent 28vw),
      radial-gradient(circle at 18% 72%, rgba(157, 255, 101, 0.08), transparent 26vw),
      #090a07;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow-x: clip;
    isolation: isolate;
  }

  .scale-reveal {
    opacity: 0;
    transform: translateY(34px);
    transition:
      opacity 780ms var(--scale-ease) var(--reveal-delay, 0ms),
      transform 780ms var(--scale-ease) var(--reveal-delay, 0ms);
    will-change: opacity, transform;
  }

  .scale-reveal.is-visible {
    opacity: 1;
    transform: translateY(0);
  }

  .scale-header {
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    z-index: 30;
    height: 76px;
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
    align-items: center;
    padding: 0 28px;
    border-bottom: 1px solid rgba(244, 240, 232, 0.08);
    background: rgba(9, 10, 7, 0.72);
    backdrop-filter: blur(18px);
  }

  .scale-header-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    transform-origin: 0 50%;
    transform: scaleX(var(--scale-scroll-progress, 0));
    background: linear-gradient(90deg, #5df5dc, #d49a66, #f4f0e8);
    box-shadow: 0 0 20px rgba(93, 245, 220, 0.28);
    will-change: transform;
  }

  .scale-brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: var(--scale-paper);
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .scale-logo-mark {
    display: block;
    overflow: visible;
  }

  .scale-logo-mark-disc {
    fill: rgba(244, 240, 232, 0.035);
    stroke: rgba(244, 240, 232, 0.2);
    stroke-width: 1.2;
  }

  .scale-logo-mark-orbit {
    fill: none;
    stroke: rgba(93, 245, 220, 0.32);
    stroke-width: 1.3;
    transform-origin: 120px 120px;
  }

  .scale-logo-mark-orbit-a {
    transform: rotate(-26deg);
  }

  .scale-logo-mark-orbit-b {
    stroke: rgba(212, 154, 102, 0.28);
    transform: rotate(34deg);
  }

  .scale-logo-mark-route {
    filter: drop-shadow(0 18px 38px rgba(93, 245, 220, 0.18));
  }

  .scale-logo-mark-arrow {
    fill: none;
    stroke: #f4f0e8;
    stroke-width: 9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .scale-logo-mark-node {
    fill: #5df5dc;
  }

  .scale-logo-mark-node-b {
    fill: #d49a66;
  }

  .scale-brand-mark {
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }

  .scale-brand strong {
    display: block;
    font-family: Georgia, serif;
    font-size: 23px;
    line-height: 0.95;
    font-style: italic;
  }

  .scale-brand em {
    display: block;
    margin-top: 4px;
    font-style: normal;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--scale-muted);
  }

  .scale-nav {
    display: inline-flex;
    align-items: center;
    gap: 28px;
  }

  .scale-nav button,
  .scale-link-btn {
    color: rgba(244, 240, 232, 0.72);
    font-size: 13px;
    font-weight: 650;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .scale-nav button:hover,
  .scale-link-btn:hover { color: var(--scale-paper); }

  .scale-actions {
    position: absolute;
    right: 28px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
  }

  .scale-primary-btn {
    min-height: 40px;
    border: 0;
    border-radius: 999px;
    padding: 0 20px;
    background: var(--scale-paper);
    color: var(--scale-ink);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 16px 50px rgba(244, 240, 232, 0.18);
  }

  .scale-hero {
    position: relative;
    min-height: 200svh;
    overflow: hidden;
  }

  .scale-cinema-hero {
    min-height: 190svh;
    padding-top: 0;
    background: #090a07;
    color: var(--scale-paper);
    isolation: isolate;
    overflow: visible;
  }

  .scale-cinema-scene {
    position: fixed;
    inset: 0;
    z-index: 8;
    height: 100svh;
    overflow: hidden;
    padding-top: 76px;
    background: #090a07;
    opacity: var(--scale-cinema-scene-opacity, 1);
    transition: none;
    cursor: grab;
    touch-action: pan-y;
    will-change: opacity;
  }

  .scale-cinema-scene:active {
    cursor: grabbing;
  }

  .scale-cinema-scene::before {
    content: "";
    position: absolute;
    inset: 76px 0 0;
    z-index: 0;
    background:
      radial-gradient(circle at 12% 18%, rgba(255, 122, 0, 0.36), transparent 24%),
      radial-gradient(circle at 52% 38%, rgba(255, 122, 0, 0.12), transparent 20%),
      linear-gradient(90deg, rgba(255, 117, 0, 0.09), transparent 36%),
      #090a07;
    opacity: 0;
    animation: scale-cinema-ambient 8s ease both;
    pointer-events: none;
  }

  .scale-cinema-glow {
    position: absolute;
    inset: 76px auto auto 50%;
    z-index: 1;
    width: min(48vw, 620px);
    height: min(60vh, 620px);
    background: radial-gradient(circle at 50% 45%, rgba(247, 115, 30, 0.5), rgba(247, 115, 30, 0.16) 38%, transparent 72%);
    filter: blur(26px);
    opacity: 0;
    transform: translate3d(-50%, -8%, 0) scale(0.8);
    animation: scale-cinema-glow 8s var(--scale-ease) both;
    pointer-events: none;
  }

  .scale-webgl-canvas {
    position: absolute;
    inset: 76px 0 0;
    z-index: 3;
    width: 100%;
    height: calc(100% - 76px);
    display: block;
    pointer-events: none;
    opacity: 1;
    animation: scale-webgl-canvas-enter 2200ms var(--scale-ease) both;
    will-change: opacity, transform;
  }

  .scale-cinema-scene[data-zooming="true"] .scale-webgl-canvas {
    opacity: 1;
  }

  .scale-webgl-fallback {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 3;
    width: clamp(310px, 40vw, 620px);
    aspect-ratio: 1;
    border-radius: 48% 52% 45% 55% / 44% 43% 57% 56%;
    background:
      radial-gradient(circle at 40% 42%, rgba(255, 192, 88, 0.94), rgba(255, 125, 31, 0.82) 34%, rgba(21, 14, 9, 0.94) 72%),
      #150f0a;
    box-shadow:
      inset -48px -36px 72px rgba(3, 3, 2, 0.92),
      inset 36px 30px 72px rgba(255, 157, 54, 0.45),
      0 0 110px rgba(255, 122, 0, 0.34);
    transform: translate3d(-50%, -50%, 0) scale(0.98);
    opacity: 0.96;
    pointer-events: none;
    animation:
      scale-webgl-fallback-enter 2200ms var(--scale-ease) both,
      scale-cinema-orb-morph 7s ease-in-out 4s infinite;
  }

  .scale-cinema-scene[data-zooming="true"] .scale-webgl-fallback {
    transform: translate3d(-50%, -50%, 0) scale(4.35);
    transition: transform 620ms var(--scale-ease);
  }

  .scale-cinema-type {
    position: absolute;
    left: clamp(24px, 4vw, 54px);
    top: clamp(126px, 18vh, 178px);
    z-index: 2;
    display: grid;
    gap: 0;
    color: rgba(244, 240, 232, 0.76);
    font-family: Georgia, serif;
    font-size: clamp(88px, 13vw, 190px);
    font-weight: 500;
    line-height: 0.72;
    letter-spacing: 0;
    pointer-events: none;
    mix-blend-mode: screen;
  }

  .scale-cinema-type span {
    display: block;
    opacity: 0;
    transform: translate3d(-12vw, 28px, 0);
    animation: scale-cinema-word 8s var(--scale-ease) both;
  }

  .scale-cinema-type span:nth-child(1) { animation-delay: 1.25s; }
  .scale-cinema-type span:nth-child(2) { animation-delay: 1.55s; }
  .scale-cinema-type span:nth-child(3) { animation-delay: 1.85s; }

  .scale-cinema-orb {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 3;
    width: clamp(300px, 40vw, 600px);
    aspect-ratio: 1;
    border-radius: 48% 52% 45% 55% / 44% 43% 57% 56%;
    background:
      radial-gradient(circle at 42% 54%, rgba(255, 119, 0, 0.96), rgba(227, 92, 0, 0.72) 36%, rgba(25, 23, 20, 0.92) 68%),
      #15110e;
    box-shadow:
      inset -46px -34px 64px rgba(5, 5, 4, 0.9),
      inset 28px 24px 56px rgba(255, 151, 44, 0.5),
      0 0 90px rgba(255, 111, 0, 0.28);
    opacity: 0;
    transform: translate3d(-50%, -50%, 0) scale(0.38) rotate(-18deg);
    animation:
      scale-cinema-orb-enter 8s var(--scale-ease) both,
      scale-cinema-orb-morph 7s ease-in-out 4s infinite;
    pointer-events: none;
    display: none;
  }

  .scale-cinema-stage {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    z-index: auto;
    height: 1px;
    pointer-events: none;
    user-select: none;
  }

  .scale-cinema-rail-intro,
  .scale-cinema-rail-loop {
    position: absolute;
    inset: 0;
  }

  .scale-cinema-rail-intro {
    animation: none;
  }

  .scale-cinema-rail-loop {
    animation: none;
  }

  .scale-cinema-panel {
    position: absolute;
    left: 50%;
    top: 50%;
    width: clamp(210px, 25vw, 360px);
    min-height: clamp(284px, 31vw, 420px);
    display: grid;
    align-content: end;
    gap: 9px;
    padding: clamp(18px, 2.5vw, 28px);
    border: 1px solid rgba(244, 240, 232, 0.18);
    border-radius: 2px;
    background:
      linear-gradient(180deg, rgba(9, 10, 7, 0.08), rgba(9, 10, 7, 0.88) 62%, rgba(9, 10, 7, 0.96)),
      radial-gradient(circle at 80% 18%, color-mix(in srgb, var(--accent) 36%, transparent), transparent 28%),
      #10110e;
    color: var(--scale-paper);
    text-align: left;
    cursor: pointer;
    opacity: 0;
    transform:
      translate3d(-50%, -46%, 0)
      rotateY(var(--panel-angle))
      translateZ(var(--panel-z, clamp(310px, 43vw, 610px)))
      rotateY(var(--panel-angle-inverse))
      translateY(74px)
      scale(0.92);
    box-shadow: 0 34px 90px rgba(0, 0, 0, 0.52);
    animation: none;
    transition: border-color 260ms ease, box-shadow 260ms ease, scale 260ms ease;
    pointer-events: auto;
    will-change: transform, opacity;
    backface-visibility: hidden;
    transform-origin: 50% 50%;
    contain: layout paint style;
  }

  .scale-cinema-panel::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    opacity: 0.32;
    background:
      linear-gradient(180deg, transparent, rgba(9, 10, 7, 0.74)),
      repeating-linear-gradient(90deg, rgba(244, 240, 232, 0.06) 0 1px, transparent 1px 34px),
      repeating-linear-gradient(0deg, rgba(244, 240, 232, 0.04) 0 1px, transparent 1px 34px);
  }

  .scale-cinema-panel:nth-child(1)::before {
    opacity: 0.52;
    background:
      linear-gradient(180deg, transparent, rgba(9, 10, 7, 0.78)),
      radial-gradient(circle at 36% 34%, rgba(255, 138, 42, 0.42), transparent 16%),
      radial-gradient(circle at 62% 58%, rgba(255, 138, 42, 0.34), transparent 18%),
      radial-gradient(circle at 74% 30%, rgba(93, 245, 220, 0.22), transparent 15%),
      repeating-linear-gradient(90deg, rgba(244, 240, 232, 0.06) 0 1px, transparent 1px 32px);
  }

  .scale-cinema-panel:nth-child(2)::before {
    opacity: 0.48;
    background:
      linear-gradient(180deg, transparent, rgba(9, 10, 7, 0.78)),
      linear-gradient(125deg, transparent 0 42%, rgba(93, 245, 220, 0.34) 43% 45%, transparent 46%),
      repeating-linear-gradient(0deg, rgba(244, 240, 232, 0.07) 0 1px, transparent 1px 30px),
      repeating-linear-gradient(90deg, rgba(244, 240, 232, 0.05) 0 1px, transparent 1px 30px);
  }

  .scale-cinema-panel:nth-child(3)::before {
    opacity: 0.46;
    background:
      linear-gradient(180deg, transparent, rgba(9, 10, 7, 0.78)),
      radial-gradient(circle at 32% 40%, rgba(141, 113, 255, 0.46), transparent 10%),
      radial-gradient(circle at 58% 30%, rgba(141, 113, 255, 0.36), transparent 13%),
      radial-gradient(circle at 70% 62%, rgba(212, 154, 102, 0.28), transparent 11%),
      linear-gradient(52deg, transparent 0 48%, rgba(244, 240, 232, 0.1) 49% 50%, transparent 51%);
  }

  .scale-cinema-panel:nth-child(4)::before {
    opacity: 0.46;
    background:
      linear-gradient(180deg, transparent, rgba(9, 10, 7, 0.78)),
      linear-gradient(135deg, transparent 0 30%, rgba(157, 255, 101, 0.2) 31% 33%, transparent 34%),
      linear-gradient(155deg, transparent 0 47%, rgba(157, 255, 101, 0.32) 48% 50%, transparent 51%),
      repeating-linear-gradient(0deg, rgba(244, 240, 232, 0.06) 0 1px, transparent 1px 36px);
  }

  .scale-cinema-panel:hover,
  .scale-cinema-panel:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 74%, rgba(244, 240, 232, 0.26));
    box-shadow: 0 38px 110px rgba(0, 0, 0, 0.64);
    scale: 1.03;
    outline: none;
  }

  .scale-cinema-panel[data-hidden="true"] {
    opacity: 0 !important;
    pointer-events: none;
  }

  .scale-cinema-panel span,
  .scale-cinema-panel i {
    color: rgba(244, 240, 232, 0.78);
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-style: normal;
  }

  .scale-cinema-panel strong {
    max-width: 11ch;
    color: rgba(244, 240, 232, 0.94);
    font-family: Georgia, serif;
    font-size: clamp(28px, 3.2vw, 48px);
    line-height: 0.95;
    font-weight: 500;
  }

  .scale-cinema-panel em {
    color: var(--accent);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: clamp(26px, 4vw, 58px);
    font-style: normal;
    line-height: 0.86;
  }

  .scale-cinema-panel p {
    max-width: 26ch;
    margin: 0;
    color: rgba(244, 240, 232, 0.7);
    font-size: 13px;
    line-height: 1.5;
  }

  .scale-cinema-panel i {
    margin-top: 14px;
    color: rgba(244, 240, 232, 0.86);
  }

  .scale-cinema-caption {
    position: absolute;
    right: clamp(24px, 5vw, 72px);
    bottom: clamp(26px, 5vh, 54px);
    z-index: 5;
    width: min(420px, 42vw);
    opacity: var(--scale-hero-copy-opacity, 0);
    transform: translate3d(0, var(--scale-hero-copy-y, 88px), 0);
    transition: none;
    will-change: opacity, transform;
    pointer-events: none;
  }

  .scale-cinema-caption span {
    display: inline-flex;
    color: #5df5dc;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .scale-cinema-caption h1 {
    margin: 12px 0;
    font-family: Georgia, serif;
    font-size: clamp(34px, 4.2vw, 64px);
    line-height: 0.95;
    font-weight: 500;
  }

  .scale-cinema-caption p {
    margin: 0;
    color: rgba(244, 240, 232, 0.7);
    line-height: 1.58;
  }

  .scale-cinema-caption .scale-value-actions {
    justify-content: flex-start;
    pointer-events: auto;
  }

  .scale-editorial-hero {
    min-height: 100svh;
    padding-top: 76px;
    background:
      radial-gradient(circle at 76% 36%, rgba(255, 155, 50, 0.13), transparent 30%),
      linear-gradient(180deg, rgba(9, 10, 7, 0.95), rgba(9, 10, 7, 1)),
      #090a07;
  }

  .scale-editorial-hero::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 76px;
    height: calc(100svh - 76px);
    z-index: 5;
    background:
      linear-gradient(110deg, rgba(244, 240, 232, 0.18), transparent 34%),
      #ff9b32;
    transform-origin: top;
    pointer-events: none;
    animation: scale-orange-intro 8s var(--scale-ease) both;
  }

  .scale-hero-masthead {
    position: relative;
    overflow: hidden;
    min-height: 118px;
    display: grid;
    grid-template-columns: auto minmax(180px, 1fr) minmax(220px, 0.7fr);
    align-items: center;
    gap: clamp(18px, 3vw, 40px);
    padding: 20px clamp(22px, 5vw, 72px);
    background: #ff9b32;
    color: #06376b;
    animation: scale-masthead-lock 8s var(--scale-ease) both;
  }

  .scale-hero-masthead::after {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(105deg, transparent 0 34%, rgba(244, 240, 232, 0.26) 42%, transparent 52%),
      repeating-linear-gradient(90deg, rgba(6, 55, 107, 0.05) 0 1px, transparent 1px 84px);
    transform: translateX(-38%);
    animation: scale-masthead-sweep 8s ease-in-out infinite;
    pointer-events: none;
  }

  .scale-hero-masthead > * {
    position: relative;
    z-index: 1;
  }

  .scale-hero-masthead-mark {
    width: 56px;
    height: 56px;
  }

  .scale-hero-masthead-mark .scale-logo-mark {
    width: 56px;
    height: 56px;
  }

  .scale-hero-masthead span {
    display: block;
    color: rgba(6, 55, 107, 0.72);
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .scale-hero-masthead strong {
    display: block;
    margin-top: 2px;
    font-family: Georgia, serif;
    font-size: clamp(40px, 5vw, 72px);
    font-style: italic;
    line-height: 0.9;
    letter-spacing: 0;
  }

  .scale-hero-masthead p {
    justify-self: end;
    max-width: 360px;
    margin: 0;
    color: rgba(6, 55, 107, 0.86);
    font-size: 14px;
    font-weight: 760;
    line-height: 1.35;
  }

  .scale-editorial-stage {
    position: relative;
    min-height: calc(100svh - 194px);
    display: grid;
    grid-template-columns: minmax(280px, 0.68fr) minmax(560px, 1.32fr);
    gap: clamp(28px, 5vw, 76px);
    align-items: center;
    padding: clamp(42px, 6vw, 86px) clamp(22px, 5vw, 72px) 96px;
    overflow: hidden;
    animation: scale-stage-intro 8s var(--scale-ease) both;
  }

  .scale-editorial-stage::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(rgba(244, 240, 232, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(244, 240, 232, 0.035) 1px, transparent 1px);
    background-size: 92px 92px;
    mask-image: radial-gradient(circle at 72% 45%, black, transparent 72%);
    pointer-events: none;
  }

  .scale-editorial-copy {
    position: relative;
    z-index: 2;
    max-width: 680px;
    animation: scale-copy-cinematic 8s var(--scale-ease) both;
  }

  .scale-editorial-copy > span {
    display: inline-flex;
    color: #5df5dc;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .scale-editorial-copy h1 {
    margin: 20px 0 20px;
    font-family: Georgia, serif;
    font-size: clamp(46px, 5.4vw, 84px);
    line-height: 0.91;
    font-weight: 500;
    letter-spacing: 0;
  }

  .scale-editorial-copy p {
    max-width: 560px;
    margin: 0;
    color: rgba(244, 240, 232, 0.66);
    font-size: 16px;
    line-height: 1.72;
  }

  .scale-editorial-copy .scale-value-actions {
    justify-content: flex-start;
  }

  .scale-hero-deck {
    position: relative;
    z-index: 2;
    min-height: clamp(650px, 68vh, 760px);
    perspective: 1200px;
  }

  .scale-hero-deck::before {
    content: "";
    position: absolute;
    inset: 12% 2% 8% 7%;
    border-radius: 34px;
    border: 1px solid rgba(244, 240, 232, 0.16);
    background:
      linear-gradient(90deg, rgba(9, 10, 7, 0.1), rgba(9, 10, 7, 0.7)),
      linear-gradient(180deg, rgba(255, 155, 50, 0.12), rgba(93, 245, 220, 0.08)),
      url("/landing/matrix_landing_assets/pipeline_decision.jpeg") center / cover;
    box-shadow:
      0 50px 130px rgba(0, 0, 0, 0.46),
      inset 0 0 0 1px rgba(244, 240, 232, 0.06);
    opacity: 0.64;
    transform: rotate(-3.5deg) translate3d(0, 0, 0);
    clip-path: inset(0 0 0 0 round 34px);
    animation:
      scale-screen-intro 8s var(--scale-ease) both,
      scale-screen-float 10s var(--scale-ease) 8s infinite;
    will-change: transform;
  }

  .scale-hero-deck::after {
    content: "Live expansion command layer";
    position: absolute;
    right: 5%;
    top: 5%;
    z-index: 3;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid rgba(244, 240, 232, 0.2);
    background: rgba(9, 10, 7, 0.72);
    color: rgba(244, 240, 232, 0.86);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    backdrop-filter: blur(14px);
    animation: scale-label-intro 8s var(--scale-ease) both;
  }

  .scale-hero-card {
    position: absolute;
    width: clamp(172px, 14vw, 224px);
    min-height: clamp(206px, 20vw, 282px);
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 19px;
    border: 1px solid rgba(244, 240, 232, 0.18);
    border-radius: 24px;
    background:
      radial-gradient(circle at 78% 14%, color-mix(in srgb, var(--accent) 34%, transparent), transparent 30%),
      linear-gradient(145deg, rgba(244, 240, 232, 0.14), rgba(244, 240, 232, 0.045)),
      rgba(13, 14, 11, 0.92);
    color: var(--scale-paper);
    text-align: left;
    box-shadow: 0 34px 90px rgba(0, 0, 0, 0.34);
    cursor: pointer;
    opacity: 1;
    translate: 0 0;
    filter: blur(0);
    animation-name: scale-card-intro, scale-card-drift;
    animation-duration: 6.4s, 7.4s;
    animation-timing-function: var(--scale-ease), var(--scale-ease);
    animation-delay: var(--card-enter-delay), calc(8s + var(--card-delay));
    animation-iteration-count: 1, infinite;
    animation-fill-mode: both, none;
    transform: translate3d(0, 0, 0) rotate(var(--card-tilt));
    scale: 1;
    transition: border-color 260ms ease, box-shadow 260ms ease, scale 260ms ease;
    will-change: transform;
    backface-visibility: hidden;
  }

  .scale-hero-card:hover,
  .scale-hero-card:focus-visible {
    animation-play-state: paused;
    border-color: color-mix(in srgb, var(--accent) 70%, rgba(244, 240, 232, 0.24));
    box-shadow: 0 38px 110px rgba(0, 0, 0, 0.44);
    scale: 1.035;
    outline: none;
  }

  .scale-hero-card[data-hidden="true"] {
    opacity: 0;
    pointer-events: none;
    animation: none;
  }

  .scale-hero-card:nth-child(1) { left: 5%; top: 62%; z-index: 5; }
  .scale-hero-card:nth-child(2) { left: 2%; top: 8%; z-index: 2; }
  .scale-hero-card:nth-child(3) { left: 31%; top: 2%; z-index: 6; }
  .scale-hero-card:nth-child(4) { left: 34%; top: 62%; z-index: 4; }
  .scale-hero-card:nth-child(5) { left: 62%; top: 8%; z-index: 3; }
  .scale-hero-card:nth-child(6) { left: 70%; top: 62%; z-index: 1; }

  .scale-hero-card > span,
  .scale-hero-card em,
  .scale-hero-card-flow b {
    font-size: 10px;
    font-weight: 850;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .scale-hero-card > span {
    color: rgba(244, 240, 232, 0.58);
  }

  .scale-hero-card strong {
    margin-top: 10px;
    font-family: Georgia, serif;
    font-size: clamp(44px, 4.4vw, 72px);
    line-height: 0.82;
    font-weight: 500;
  }

  .scale-hero-card em {
    color: var(--accent);
    font-style: normal;
  }

  .scale-hero-card p {
    margin: 10px 0 0;
    color: rgba(244, 240, 232, 0.7);
    font-size: 14px;
    line-height: 1.45;
  }

  .scale-hero-card-flow {
    margin-top: 10px;
    display: grid;
    gap: 8px;
  }

  .scale-hero-card-flow b {
    color: rgba(244, 240, 232, 0.62);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.06em;
  }

  .scale-hero-card-flow i {
    width: 72%;
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, #5df5dc, var(--accent), rgba(244, 240, 232, 0.16));
  }

  .scale-editorial-stage .scale-hero-ledger {
    opacity: 1;
  }

  .scale-hero-sticky {
    position: relative;
    min-height: 200svh;
    display: block;
    padding: 0 28px;
    overflow: hidden;
  }

  .scale-hero-sticky::before {
    content: "FOOTPRINT";
    position: absolute;
    left: -2vw;
    bottom: -1.5vw;
    z-index: 0;
    color: rgba(244, 240, 232, 0.035);
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: clamp(72px, 17vw, 246px);
    line-height: 0.78;
    font-weight: 950;
    letter-spacing: 0;
    transform: translate3d(0, calc(var(--scale-hero-progress, 0) * -120px), 0);
    pointer-events: none;
  }

  .scale-orbit-field {
    position: absolute;
    left: 0;
    right: 0;
    top: 76px;
    height: calc(100svh - 76px);
    overflow: hidden;
    opacity: 0.94;
    transform: scale(var(--scale-hero-orbit-scale, 1));
    will-change: transform;
    contain: layout paint style;
    transform-style: preserve-3d;
  }

  .scale-orbit-ring {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 78vw;
    height: 54vh;
    border: 1px solid rgba(244, 240, 232, 0.1);
    border-radius: 50%;
    transform: translate(-50%, -50%) rotate(-12deg);
  }

  .scale-orbit-ring-b {
    width: 56vw;
    height: 72vh;
    transform: translate(-50%, -50%) rotate(31deg);
    border-color: rgba(93, 245, 220, 0.14);
  }

  .scale-logo-stage {
    position: relative;
    z-index: 4;
    width: min(440px, calc(100vw - 48px));
    min-height: 100svh;
    margin: 0 auto;
    display: grid;
    place-items: center;
    align-content: center;
    text-align: center;
    opacity: var(--scale-hero-logo-opacity, 1);
    transform: translate3d(0, var(--scale-hero-logo-y, 0px), 0);
    transition: opacity 140ms linear, transform 140ms linear;
    will-change: opacity, transform;
    pointer-events: none;
  }

  .scale-hero-logo-mark {
    width: min(300px, 58vw);
    height: auto;
  }

  .scale-logo-wordmark {
    margin-top: -18px;
    display: grid;
    gap: 9px;
    justify-items: center;
  }

  .scale-logo-wordmark strong {
    color: var(--scale-paper);
    font-family: Georgia, serif;
    font-size: clamp(56px, 10vw, 106px);
    font-style: italic;
    font-weight: 650;
    line-height: 0.86;
    letter-spacing: 0;
    text-shadow: 0 18px 60px rgba(0, 0, 0, 0.36);
  }

  .scale-logo-wordmark span {
    color: rgba(244, 240, 232, 0.68);
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .scale-scroll-cue {
    margin-top: 26px;
    min-height: 38px;
    border: 1px solid rgba(244, 240, 232, 0.18);
    border-radius: 999px;
    padding: 0 16px;
    color: rgba(244, 240, 232, 0.74);
    background: rgba(9, 10, 7, 0.52);
    backdrop-filter: blur(14px);
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    pointer-events: auto;
  }

  .scale-value-block {
    position: relative;
    z-index: 3;
    width: min(560px, calc(100vw - 40px));
    min-height: 100svh;
    margin: 0 auto;
    display: grid;
    align-content: center;
    text-align: center;
    opacity: var(--scale-hero-copy-opacity, 0);
    transform: translate3d(0, var(--scale-hero-copy-y, 88px), 0);
    transition: opacity 140ms linear, transform 140ms linear;
    will-change: opacity, transform;
    pointer-events: none;
  }

  .scale-value-block::before {
    content: "";
    position: absolute;
    inset: -38px -28px;
    z-index: -1;
    border-radius: 999px;
    background: radial-gradient(ellipse at center, rgba(9, 10, 7, 0.78), rgba(9, 10, 7, 0.4) 54%, transparent 74%);
    pointer-events: none;
  }

  .scale-value-block span,
  .scale-section > span,
  .scale-detail-hero span,
  .scale-detail-flow > span,
  .scale-motion-note > span,
  .scale-auth-card > span {
    display: inline-flex;
    color: #5df5dc;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .scale-value-block h1 {
    margin: 18px 0 16px;
    font-family: Georgia, serif;
    font-size: clamp(46px, 6.2vw, 90px);
    line-height: 0.9;
    font-weight: 500;
    letter-spacing: 0;
  }

  .scale-value-block p {
    width: min(520px, 100%);
    margin: 0 auto;
    color: var(--scale-muted);
    font-size: 15px;
    line-height: 1.7;
  }

  .scale-value-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 26px;
    flex-wrap: wrap;
  }

  .scale-value-actions button {
    height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 18px;
    border-radius: 999px;
    color: var(--scale-paper);
    font-size: 13px;
    font-weight: 800;
    border: 1px solid rgba(244, 240, 232, 0.18);
    background: rgba(9, 10, 7, 0.64);
    backdrop-filter: blur(12px);
    pointer-events: auto;
    cursor: pointer;
  }

  .scale-hero-ledger {
    position: absolute;
    left: clamp(18px, 5vw, 72px);
    right: clamp(18px, 5vw, 72px);
    bottom: 24px;
    z-index: 3;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    border-top: 1px solid rgba(244, 240, 232, 0.12);
    border-bottom: 1px solid rgba(244, 240, 232, 0.12);
    color: rgba(244, 240, 232, 0.62);
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: var(--scale-hero-copy-opacity, 0);
    transition: opacity 140ms linear;
  }

  .scale-hero-ledger span {
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    border-right: 1px solid rgba(244, 240, 232, 0.12);
    text-align: center;
  }

  .scale-hero-ledger span:last-child {
    border-right: 0;
  }

  .scale-orbit-card {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 148px;
    height: 148px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
    transform:
      translate3d(-50%, -50%, 0)
      rotate(var(--orbit-angle))
      translateX(calc(var(--orbit-radius) * var(--orbit-scale, 1)))
      rotate(var(--orbit-angle-inverse));
    transform-origin: center;
    background: transparent;
    cursor: pointer;
    z-index: 1;
    animation: scale-orbit-path var(--orbit-duration) linear infinite;
    will-change: transform;
    contain: layout style;
    backface-visibility: hidden;
    transform-style: preserve-3d;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .scale-orbit-card[data-hidden="true"] { opacity: 0; pointer-events: none; }

  .scale-orbit-field:has(.scale-orbit-card:hover) .scale-orbit-card,
  .scale-orbit-field:has(.scale-orbit-card:focus-visible) .scale-orbit-card,
  .scale-orbit-field.is-paused .scale-orbit-card,
  .scale-orbit-card:hover,
  .scale-orbit-card:focus-visible {
    animation-play-state: paused;
  }

  .scale-orbit-card:hover .scale-mini-preview {
    transform: scale(1.08) translateY(-6px);
    border-color: var(--accent);
  }

  .scale-orbit-card:focus-visible .scale-mini-preview {
    border-color: var(--accent);
    box-shadow:
      0 0 0 4px rgba(93, 245, 220, 0.16),
      0 24px 80px rgba(0, 0, 0, 0.28);
  }

  .scale-mini-preview {
    position: relative;
    width: 112px;
    height: 112px;
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(244, 240, 232, 0.2);
    background:
      linear-gradient(145deg, rgba(244, 240, 232, 0.12), rgba(244, 240, 232, 0.03)),
      radial-gradient(circle at 70% 28%, color-mix(in srgb, var(--accent) 34%, transparent), transparent 36%),
      #10120f;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    transition: transform 600ms var(--scale-ease), border-color 600ms var(--scale-ease);
    will-change: transform;
    backface-visibility: hidden;
  }

  .scale-mini-top {
    position: absolute;
    left: 18px;
    right: 18px;
    top: 18px;
    display: flex;
    justify-content: space-between;
    color: rgba(244, 240, 232, 0.64);
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .scale-mini-top i {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: var(--accent);
  }

  .scale-mini-number {
    position: absolute;
    left: 18px;
    bottom: 34px;
    font-family: Georgia, serif;
    font-size: 34px;
    line-height: 1;
    color: var(--scale-paper);
  }

  .scale-mini-bars {
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 20px;
    display: grid;
    gap: 4px;
  }

  .scale-mini-bars span {
    height: 3px;
    border-radius: 9px;
    background: rgba(244, 240, 232, 0.18);
  }

  .scale-mini-bars span:nth-child(2) { width: 72%; background: var(--accent); }
  .scale-mini-bars span:nth-child(3) { width: 46%; }

  .scale-orbit-caption {
    position: absolute;
    left: 50%;
    bottom: -22px;
    transform: translateX(-50%);
    color: rgba(244, 240, 232, 0.7);
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
  }

  .scale-detail-shell {
    position: fixed;
    z-index: 80;
    left: var(--origin-left);
    top: var(--origin-top);
    width: var(--origin-width);
    height: var(--origin-height);
    border-radius: var(--origin-radius);
    overflow: hidden;
    background: #0a0b08;
    color: var(--scale-paper);
    box-shadow: 0 30px 100px rgba(0, 0, 0, 0.45);
    transition:
      left 620ms var(--scale-ease),
      top 620ms var(--scale-ease),
      width 620ms var(--scale-ease),
      height 620ms var(--scale-ease),
      border-radius 620ms var(--scale-ease);
  }

  .scale-detail-shell.is-open {
    left: 0;
    top: 0;
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }

  .scale-detail-shell.is-closing {
    left: var(--origin-left);
    top: var(--origin-top);
    width: var(--origin-width);
    height: var(--origin-height);
    border-radius: var(--origin-radius);
  }

  .scale-detail-close,
  .scale-auth-close {
    position: fixed;
    right: 24px;
    top: 22px;
    z-index: 4;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: 1px solid rgba(244, 240, 232, 0.22);
    background: rgba(244, 240, 232, 0.08);
    color: var(--scale-paper);
    font-size: 16px;
    font-weight: 850;
    cursor: pointer;
  }

  .scale-detail-scroll {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    background:
      radial-gradient(circle at 75% 15%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 28vw),
      #0a0b08;
  }

  .scale-detail-hero {
    min-height: 92vh;
    display: grid;
    grid-template-columns: minmax(0, 1040px);
    align-items: center;
    padding: 96px clamp(24px, 7vw, 96px);
  }

  .scale-detail-hero h2 {
    max-width: 1040px;
    margin: 18px 0 0;
    font-family: Georgia, serif;
    font-size: clamp(54px, 8vw, 128px);
    line-height: 0.9;
    font-weight: 500;
    letter-spacing: 0;
  }

  .scale-detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
    gap: 34px;
    padding: 0 clamp(24px, 7vw, 96px) 88px;
  }

  .scale-detail-copy {
    max-width: 760px;
    display: grid;
    gap: 24px;
  }

  .scale-detail-copy p,
  .scale-architecture p {
    margin: 0;
    color: rgba(244, 240, 232, 0.72);
    font-size: clamp(18px, 2vw, 28px);
    line-height: 1.42;
  }

  .scale-detail-panel,
  .scale-motion-note {
    border: 1px solid rgba(244, 240, 232, 0.16);
    border-radius: 22px;
    padding: 22px;
    background: rgba(244, 240, 232, 0.06);
  }

  .scale-detail-panel > span {
    display: block;
    margin-bottom: 20px;
    color: rgba(244, 240, 232, 0.54);
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .scale-detail-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    border-top: 1px solid rgba(244, 240, 232, 0.12);
  }

  .scale-detail-row i {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: var(--accent);
  }

  .scale-detail-flow {
    padding: 70px clamp(24px, 7vw, 96px);
    border-top: 1px solid rgba(244, 240, 232, 0.1);
    border-bottom: 1px solid rgba(244, 240, 232, 0.1);
  }

  .scale-detail-flow div {
    margin-top: 22px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
  }

  .scale-detail-flow b {
    padding: 12px 14px;
    border: 1px solid rgba(244, 240, 232, 0.16);
    border-radius: 999px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: rgba(244, 240, 232, 0.82);
  }

  .scale-detail-flow i {
    width: 28px;
    height: 1px;
    background: var(--accent);
  }

  .scale-motion-note {
    margin: 70px clamp(24px, 7vw, 96px) 110px;
  }

  .scale-motion-note pre {
    overflow-x: auto;
    margin: 18px 0 0;
    color: rgba(244, 240, 232, 0.72);
    font-size: 12px;
    line-height: 1.65;
  }

  .scale-section {
    scroll-margin-top: 92px;
    padding: 112px clamp(24px, 7vw, 96px);
    color: var(--scale-ink);
    background: var(--scale-paper);
  }

  .scale-section h2 {
    max-width: 920px;
    margin: 16px 0 0;
    font-family: Georgia, serif;
    font-size: clamp(42px, 6vw, 88px);
    line-height: 0.95;
    font-weight: 500;
    letter-spacing: 0;
  }

  .scale-product-index {
    padding-top: 132px;
    background:
      linear-gradient(180deg, rgba(244, 240, 232, 1), rgba(233, 225, 209, 1));
  }

  .scale-index-rows {
    margin-top: 58px;
    border-top: 1px solid rgba(9, 10, 7, 0.22);
  }

  .scale-index-row {
    position: relative;
    min-height: 170px;
    display: grid;
    grid-template-columns: 72px minmax(0, 0.92fr) minmax(170px, 0.42fr) minmax(300px, 0.78fr);
    align-items: center;
    gap: 24px;
    padding: 24px 0;
    border-bottom: 1px solid rgba(9, 10, 7, 0.22);
    overflow: clip;
  }

  .scale-index-row::before {
    content: "";
    position: absolute;
    left: 19%;
    top: 50%;
    width: 160px;
    height: 160px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(93, 245, 220, 0.26), transparent 68%);
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.72);
    transition: opacity 520ms var(--scale-ease), transform 520ms var(--scale-ease);
    pointer-events: none;
  }

  .scale-index-row:hover::before {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.24);
  }

  .scale-index-number {
    color: rgba(9, 10, 7, 0.42);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 850;
  }

  .scale-index-row h3 {
    position: relative;
    z-index: 1;
    margin: 0;
    max-width: 100%;
    color: #151611;
    font-size: clamp(46px, 7vw, 112px);
    line-height: 0.82;
    font-weight: 950;
    letter-spacing: 0;
    text-transform: uppercase;
    overflow-wrap: normal;
    word-break: normal;
  }

  .scale-index-meta {
    position: relative;
    z-index: 2;
    display: grid;
    gap: 6px;
    color: #151611;
  }

  .scale-index-meta b,
  .scale-index-chips span {
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .scale-index-meta span {
    color: rgba(9, 10, 7, 0.58);
    font-size: 13px;
  }

  .scale-index-row p {
    position: relative;
    z-index: 2;
    margin: 0;
    color: rgba(9, 10, 7, 0.68);
    line-height: 1.55;
  }

  .scale-index-chips {
    grid-column: 2 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .scale-index-chips span {
    border: 1px solid rgba(9, 10, 7, 0.18);
    border-radius: 999px;
    padding: 8px 10px;
    color: rgba(9, 10, 7, 0.66);
  }

  .scale-handoffs {
    background:
      radial-gradient(circle at 16% 12%, rgba(93, 245, 220, 0.12), transparent 28vw),
      #090a07;
    color: var(--scale-paper);
    display: grid;
    grid-template-columns: minmax(260px, 0.72fr) minmax(0, 1fr);
    gap: clamp(32px, 7vw, 96px);
    align-items: start;
  }

  .scale-handoff-sticky {
    position: sticky;
    top: 112px;
  }

  .scale-handoff-sticky p {
    max-width: 460px;
    margin: 28px 0 0;
    color: rgba(244, 240, 232, 0.66);
    font-size: 17px;
    line-height: 1.65;
  }

  .scale-handoff-rail {
    position: relative;
    display: grid;
    gap: 0;
    border-top: 1px solid rgba(244, 240, 232, 0.16);
  }

  .scale-handoff-rail::before {
    content: "";
    position: absolute;
    left: 26px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(180deg, #5df5dc, rgba(244, 240, 232, 0.16), #d49a66);
  }

  .scale-handoff-step {
    position: relative;
    display: grid;
    grid-template-columns: 64px minmax(170px, 0.42fr) minmax(0, 1fr);
    gap: 22px;
    padding: 28px 0 28px;
    border-bottom: 1px solid rgba(244, 240, 232, 0.16);
  }

  .scale-handoff-step > span {
    position: relative;
    z-index: 1;
    width: 54px;
    height: 54px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 1px solid rgba(244, 240, 232, 0.18);
    background: #090a07;
    color: #5df5dc;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    font-weight: 850;
  }

  .scale-handoff-step b {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: rgba(244, 240, 232, 0.92);
  }

  .scale-handoff-step em {
    display: block;
    margin-top: 8px;
    color: rgba(244, 240, 232, 0.5);
    font-style: normal;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .scale-handoff-step p {
    margin: 0;
    color: rgba(244, 240, 232, 0.66);
    line-height: 1.58;
  }

  .scale-signals {
    background: #10110e;
    color: var(--scale-paper);
  }

  .scale-signal-grid {
    margin-top: 52px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid rgba(244, 240, 232, 0.14);
    border-left: 1px solid rgba(244, 240, 232, 0.14);
  }

  .scale-signal-grid article {
    min-height: 210px;
    padding: 24px;
    border-right: 1px solid rgba(244, 240, 232, 0.14);
    border-bottom: 1px solid rgba(244, 240, 232, 0.14);
  }

  .scale-signal-grid b {
    display: block;
    color: #5df5dc;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .scale-signal-grid p {
    margin: 28px 0 0;
    color: rgba(244, 240, 232, 0.68);
    line-height: 1.6;
  }

  .scale-components {
    background: #f4f0e8;
  }

  .scale-module-list {
    margin-top: 46px;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border-top: 1px solid rgba(9, 10, 7, 0.16);
  }

  .scale-module-list article {
    min-height: 180px;
    padding: 22px 20px;
    border-right: 1px solid rgba(9, 10, 7, 0.16);
    border-bottom: 1px solid rgba(9, 10, 7, 0.16);
  }

  .scale-module-list b {
    display: block;
    font-size: 13px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .scale-module-list p {
    margin: 18px 0 0;
    color: rgba(9, 10, 7, 0.62);
    line-height: 1.55;
  }

  .scale-architecture {
    min-height: 62vh;
    background: #e9e1d1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 440px);
    gap: 54px;
    align-items: start;
  }

  .scale-architecture p {
    max-width: 780px;
    margin-top: 28px;
    color: rgba(9, 10, 7, 0.68);
  }

  .scale-architecture code {
    color: #12351f;
    font-size: 0.82em;
  }

  .scale-architecture-list {
    border-top: 1px solid rgba(9, 10, 7, 0.16);
  }

  .scale-architecture-list article {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: 20px;
    padding: 20px 0;
    border-bottom: 1px solid rgba(9, 10, 7, 0.16);
  }

  .scale-architecture-list b {
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .scale-architecture-list p {
    margin: 0;
    color: rgba(9, 10, 7, 0.66);
    line-height: 1.55;
  }

  .scale-auth-overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: 22px;
    background: rgba(9, 10, 7, 0.72);
    backdrop-filter: blur(20px);
  }

  .scale-auth-card {
    position: relative;
    width: min(460px, 100%);
    padding: 28px;
    border-radius: 28px;
    border: 1px solid rgba(244, 240, 232, 0.16);
    background: #10110e;
    box-shadow: 0 30px 110px rgba(0, 0, 0, 0.42);
    display: grid;
    gap: 16px;
  }

  .scale-auth-close {
    position: absolute;
    right: 18px;
    top: 18px;
  }

  .scale-auth-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    padding: 6px;
    margin: 34px 0 8px;
    border: 1px solid rgba(244, 240, 232, 0.14);
    border-radius: 999px;
  }

  .scale-auth-tabs button {
    height: 42px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: rgba(244, 240, 232, 0.62);
    font-weight: 850;
    cursor: pointer;
  }

  .scale-auth-tabs button[data-active="true"] {
    background: var(--scale-paper);
    color: var(--scale-ink);
  }

  .scale-auth-card h2 {
    margin: 0;
    font-family: Georgia, serif;
    font-size: 34px;
    line-height: 1;
    font-weight: 500;
  }

  .scale-auth-card p {
    margin: -8px 0 0;
    color: rgba(244, 240, 232, 0.66);
    line-height: 1.46;
  }

  .scale-auth-join-mode {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .scale-auth-join-mode button {
    min-height: 40px;
    border-radius: 999px;
    border: 1px solid rgba(244, 240, 232, 0.14);
    background: rgba(244, 240, 232, 0.045);
    color: rgba(244, 240, 232, 0.66);
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
  }

  .scale-auth-join-mode button[data-active="true"] {
    border-color: rgba(93, 245, 220, 0.5);
    background: rgba(93, 245, 220, 0.14);
    color: var(--scale-paper);
  }

  .scale-auth-card label {
    display: grid;
    gap: 8px;
    color: rgba(244, 240, 232, 0.72);
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .scale-auth-card input {
    height: 48px;
    border-radius: 16px;
    border: 1px solid rgba(244, 240, 232, 0.16);
    background: rgba(244, 240, 232, 0.06);
    color: var(--scale-paper);
    padding: 0 14px;
    font-size: 15px;
    outline: none;
  }

  .scale-auth-card select {
    height: 48px;
    border-radius: 16px;
    border: 1px solid rgba(244, 240, 232, 0.16);
    background: rgba(244, 240, 232, 0.06);
    color: var(--scale-paper);
    padding: 0 14px;
    font-size: 15px;
    outline: none;
  }

  .scale-auth-card input[name="workspace_code"],
  .scale-auth-card input[name="code"] {
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .scale-auth-card .scale-primary-btn:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  .scale-auth-note {
    border: 1px solid rgba(93, 245, 220, 0.22);
    border-radius: 18px;
    background: rgba(93, 245, 220, 0.08);
    color: rgba(244, 240, 232, 0.66);
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.38;
  }

  .scale-auth-status {
    min-height: 48px;
    display: flex;
    align-items: center;
    border-radius: 18px;
    border: 1px solid rgba(70, 234, 209, 0.32);
    background: rgba(70, 234, 209, 0.12);
    color: rgba(249, 241, 223, 0.86);
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.35;
  }

  .scale-auth-status.is-error {
    border-color: rgba(222, 117, 111, 0.5);
    background: rgba(222, 117, 111, 0.12);
    color: #fcd5d2;
  }

  @keyframes scale-orange-intro {
    0% {
      transform: scaleY(1);
      opacity: 1;
    }
    28% {
      transform: scaleY(1);
      opacity: 1;
    }
    58% {
      transform: scaleY(0.08);
      opacity: 0.98;
    }
    74%, 100% {
      transform: scaleY(0);
      opacity: 0;
    }
  }

  @keyframes scale-cinema-ambient {
    0%, 18% { opacity: 0; }
    34%, 100% { opacity: 1; }
  }

  @keyframes scale-cinema-glow {
    0%, 18% {
      opacity: 0;
      transform: translate3d(-50%, -8%, 0) scale(0.72);
    }
    38%, 100% {
      opacity: 1;
      transform: translate3d(-50%, -8%, 0) scale(1);
    }
  }

  @keyframes scale-webgl-canvas-enter {
    0% {
      opacity: 0.62;
      transform: scale(0.92);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes scale-webgl-fallback-enter {
    0% {
      opacity: 0.62;
      transform: translate3d(-50%, -50%, 0) scale(0.92);
    }
    100% {
      opacity: 1;
      transform: translate3d(-50%, -50%, 0) scale(1);
    }
  }

  @keyframes scale-cinema-word {
    0% {
      opacity: 0;
      transform: translate3d(-14vw, 34px, 0);
    }
    25%, 58% {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    100% {
      opacity: 0.34;
      transform: translate3d(-5vw, -8vh, 0);
    }
  }

  @keyframes scale-cinema-orb-enter {
    0%, 24% {
      opacity: 0;
      transform: translate3d(-50%, -50%, 0) scale(0.28) rotate(-18deg);
    }
    44% {
      opacity: 1;
      transform: translate3d(-50%, -50%, 0) scale(1.05) rotate(8deg);
    }
    74%, 100% {
      opacity: 1;
      transform: translate3d(-50%, -50%, 0) scale(1.12) rotate(22deg);
    }
  }

  @keyframes scale-cinema-orb-morph {
    0%, 100% {
      border-radius: 48% 52% 45% 55% / 44% 43% 57% 56%;
      filter: saturate(1);
    }
    50% {
      border-radius: 56% 44% 54% 46% / 52% 38% 62% 48%;
      filter: saturate(1.16);
    }
  }

  @keyframes scale-cinema-rail-intro {
    0%, 32% {
      transform: translate3d(0, 34vh, 0) rotateX(0deg) rotateY(58deg);
    }
    58% {
      transform: translate3d(0, 1vh, 0) rotateX(0deg) rotateY(8deg);
    }
    100% {
      transform: translate3d(0, 0, 0) rotateX(0deg) rotateY(-72deg);
    }
  }

  @keyframes scale-cinema-mobile-rail-intro {
    0%, 32% {
      transform: translate3d(0, 28vh, 0) rotateX(0deg) rotateY(38deg);
    }
    58% {
      transform: translate3d(0, 1vh, 0) rotateX(0deg) rotateY(8deg);
    }
    100% {
      transform: translate3d(0, 0, 0) rotateX(0deg) rotateY(-18deg);
    }
  }

  @keyframes scale-cinema-rail-loop {
    from { transform: rotateY(0deg); }
    to { transform: rotateY(-360deg); }
  }

  @keyframes scale-cinema-panel-enter {
    0%, 22% {
      opacity: 0;
      filter: blur(16px);
      transform:
        translate3d(-50%, -32%, 0)
        rotateY(var(--panel-angle))
        translateZ(var(--panel-z, clamp(310px, 43vw, 610px)))
        rotateY(var(--panel-angle-inverse))
        translateY(130px)
        scale(0.82);
    }
    52% {
      opacity: 1;
      filter: blur(0);
      transform:
        translate3d(-50%, -52%, 0)
        rotateY(var(--panel-angle))
        translateZ(var(--panel-z, clamp(310px, 43vw, 610px)))
        rotateY(var(--panel-angle-inverse))
        translateY(-8px)
        scale(1);
    }
    100% {
      opacity: 1;
      filter: blur(0);
      transform:
        translate3d(-50%, -50%, 0)
        rotateY(var(--panel-angle))
        translateZ(var(--panel-z, clamp(310px, 43vw, 610px)))
        rotateY(var(--panel-angle-inverse))
        translateY(0)
        scale(1);
    }
  }

  @keyframes scale-cinema-caption {
    0%, 68% {
      opacity: 0;
      transform: translate3d(0, 30px, 0);
    }
    88%, 100% {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes scale-masthead-lock {
    0%, 28% {
      min-height: calc(100svh - 76px);
      align-items: end;
      padding-bottom: clamp(36px, 8vh, 86px);
    }
    58%, 100% {
      min-height: 118px;
      align-items: center;
      padding-bottom: 20px;
    }
  }

  @keyframes scale-masthead-sweep {
    0%, 24% { transform: translateX(-48%); }
    58%, 100% { transform: translateX(44%); }
  }

  @keyframes scale-stage-intro {
    0%, 24% {
      opacity: 0;
      transform: translate3d(0, 70px, 0);
    }
    52%, 100% {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes scale-copy-cinematic {
    0%, 48% {
      opacity: 0;
      transform: translate3d(0, 38px, 0);
    }
    72%, 100% {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes scale-screen-intro {
    0%, 30% {
      opacity: 0;
      clip-path: inset(0 0 100% 0 round 34px);
      transform: rotate(-6deg) translate3d(0, 76px, 0) scale(1.08);
    }
    62% {
      opacity: 0.72;
      clip-path: inset(0 0 0 0 round 34px);
      transform: rotate(-4deg) translate3d(0, 8px, 0) scale(1.02);
    }
    100% {
      opacity: 0.64;
      clip-path: inset(0 0 0 0 round 34px);
      transform: rotate(-3.5deg) translate3d(0, 0, 0);
    }
  }

  @keyframes scale-mobile-screen-intro {
    0%, 30% {
      opacity: 0;
      clip-path: inset(0 0 100% 0 round 24px);
      transform: translate3d(0, 44px, 0) scale(1.04);
    }
    62% {
      opacity: 0.72;
      clip-path: inset(0 0 0 0 round 24px);
      transform: translate3d(0, 4px, 0) scale(1.01);
    }
    100% {
      opacity: 0.64;
      clip-path: inset(0 0 0 0 round 24px);
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes scale-screen-float {
    0%, 100% {
      transform: rotate(-3.5deg) translate3d(0, 0, 0);
    }
    50% {
      transform: rotate(-2.2deg) translate3d(6px, -14px, 0) scale(1.012);
    }
  }

  @keyframes scale-label-intro {
    0%, 58% {
      opacity: 0;
      translate: 0 18px;
    }
    80%, 100% {
      opacity: 1;
      translate: 0 0;
    }
  }

  @keyframes scale-card-intro {
    0%, 16% {
      opacity: 0;
      translate: 0 74px;
      filter: blur(18px);
    }
    42% {
      opacity: 1;
      translate: 0 -12px;
      filter: blur(0);
    }
    60%, 100% {
      opacity: 1;
      translate: 0 0;
      filter: blur(0);
    }
  }

  @keyframes scale-card-drift {
    0%, 100% {
      transform: translate3d(0, 0, 0) rotate(var(--card-tilt));
    }
    50% {
      transform: translate3d(10px, -16px, 36px) rotate(var(--card-tilt));
    }
  }

  @keyframes scale-orbit-path {
    from {
      transform:
        translate3d(-50%, -50%, 0)
        rotate(var(--orbit-angle))
        translateX(calc(var(--orbit-radius) * var(--orbit-scale, 1)))
        rotate(var(--orbit-angle-inverse));
    }
    to {
      transform:
        translate3d(-50%, -50%, 0)
        rotate(calc(var(--orbit-angle) + 360deg))
        translateX(calc(var(--orbit-radius) * var(--orbit-scale, 1)))
        rotate(calc(var(--orbit-angle-inverse) - 360deg));
    }
  }

  @media (max-width: 1180px) {
    .scale-header {
      grid-template-columns: minmax(170px, 1fr) auto auto;
    }
    .scale-nav {
      gap: 16px;
    }
    .scale-index-row {
      grid-template-columns: 58px minmax(160px, 0.78fr) minmax(132px, 0.38fr) minmax(220px, 1fr);
    }
    .scale-index-row h3 {
      font-size: clamp(48px, 7.2vw, 94px);
    }
    .scale-section h2 {
      font-size: clamp(40px, 5.4vw, 74px);
    }
    .scale-editorial-stage {
      grid-template-columns: 1fr;
      align-items: start;
      gap: 36px;
    }
    .scale-editorial-copy {
      max-width: 820px;
    }
    .scale-editorial-copy h1 {
      max-width: 780px;
    }
    .scale-hero-deck {
      min-height: 720px;
    }
    .scale-module-list,
    .scale-signal-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 1060px) {
    .scale-header {
      grid-template-columns: 1fr auto;
    }
    .scale-nav {
      display: none;
    }
    .scale-brand {
      min-width: 0;
      width: calc(100vw - 168px);
      overflow: hidden;
    }
    .scale-actions {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
    }
  }

  @media (max-width: 900px) {
    .scale-header {
      grid-template-columns: 1fr auto;
      height: 68px;
      padding: 0 12px;
    }
    .scale-nav { display: none; }
    .scale-brand {
      gap: 8px;
      min-width: 0;
      width: calc(100vw - 154px);
      overflow: hidden;
    }
    .scale-brand-mark {
      width: 34px;
      height: 34px;
      flex-basis: 34px;
    }
    .scale-brand strong {
      font-size: 20px;
    }
    .scale-brand em {
      font-size: 8px;
      letter-spacing: 0.12em;
    }
    .scale-actions {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      gap: 4px;
    }
    .scale-link-btn {
      padding: 0 3px;
      font-size: 12px;
    }
    .scale-actions .scale-primary-btn {
      min-height: 36px;
      padding: 0 14px;
      font-size: 12px;
    }
    .scale-hero {
      min-height: 178svh;
    }
    .scale-cinema-hero {
      min-height: 190svh;
      padding-top: 0;
      overflow: visible;
    }
    .scale-cinema-scene {
      padding-top: 68px;
    }
    .scale-cinema-scene::before {
      inset: 68px 0 0;
    }
    .scale-webgl-canvas {
      inset: 68px 0 0;
      height: calc(100% - 68px);
    }
    .scale-cinema-type {
      left: 18px;
      top: 132px;
      font-size: clamp(72px, 23vw, 128px);
    }
    .scale-cinema-orb {
      left: 50%;
      top: 50%;
      z-index: 3;
      width: clamp(260px, 72vw, 380px);
    }
    .scale-cinema-stage {
      top: 50%;
      bottom: auto;
      z-index: auto;
      height: 1px;
      transform: scale(0.9);
      transform-origin: center center;
    }
    .scale-cinema-rail-intro {
      animation: none;
    }
    .scale-cinema-rail-loop {
      animation: none;
    }
    .scale-cinema-panel {
      --panel-z: 238px;
      width: clamp(190px, 58vw, 280px);
      min-height: clamp(230px, 62vw, 330px);
      padding: 18px;
    }
    .scale-cinema-panel p {
      display: none;
    }
    .scale-cinema-caption {
      display: none;
    }
    .scale-editorial-hero {
      min-height: auto;
      padding-top: 68px;
      overflow: visible;
    }
    .scale-hero-masthead {
      min-height: auto;
      grid-template-columns: auto 1fr;
      padding: 18px;
    }
    .scale-hero-masthead p {
      max-width: none;
      grid-column: 1 / -1;
      justify-self: start;
    }
    .scale-hero-masthead strong {
      font-size: clamp(40px, 13vw, 58px);
    }
    .scale-editorial-stage {
      display: block;
      min-height: auto;
      padding: 34px 18px 54px;
      overflow: visible;
    }
    .scale-editorial-stage::before {
      background-size: 54px 54px;
    }
    .scale-editorial-copy h1 {
      max-width: 620px;
      font-size: clamp(40px, 12vw, 66px);
      line-height: 0.94;
    }
    .scale-editorial-copy p {
      font-size: 14px;
    }
    .scale-editorial-copy .scale-value-actions {
      justify-content: flex-start;
    }
    .scale-hero-deck {
      min-height: auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
      margin-top: 34px;
      perspective: none;
    }
    .scale-hero-deck::before {
      position: relative;
      inset: auto;
      display: block;
      min-height: 260px;
      margin-bottom: 2px;
      border-radius: 24px;
      transform: none;
      animation: scale-mobile-screen-intro 8s var(--scale-ease) both;
    }
    .scale-hero-deck::after {
      left: 14px;
      right: auto;
      top: 14px;
      z-index: 4;
      min-height: 34px;
    }
    .scale-hero-card {
      position: relative;
      left: auto !important;
      top: auto !important;
      width: 100%;
      min-height: 168px;
      animation-name: scale-card-intro;
      animation-duration: 6.4s;
      animation-timing-function: var(--scale-ease);
      animation-delay: var(--card-enter-delay);
      animation-iteration-count: 1;
      animation-fill-mode: both;
      transform: none;
      border-radius: 20px;
    }
    .scale-hero-card strong {
      font-size: 48px;
    }
    .scale-hero-sticky {
      min-height: 100svh;
      padding: 86px 18px 36px;
    }
    .scale-hero-sticky::before { display: none; }
    .scale-orbit-field {
      opacity: 0.56;
      transform:
        translate3d(0, -18px, 0)
        scale(var(--scale-hero-orbit-scale, 1));
    }
    .scale-orbit-card[data-module-id="licensing"] {
      display: none;
    }
    .scale-value-block h1 {
      font-size: clamp(40px, 12vw, 66px);
      line-height: 0.94;
    }
    .scale-value-block p {
      width: min(360px, 100%);
      font-size: 14px;
    }
    .scale-orbit-card {
      --orbit-scale: 0.74;
      width: 116px;
      height: 116px;
      opacity: 0.52;
    }
    .scale-hero-logo-mark {
      width: min(245px, 62vw);
    }
    .scale-logo-wordmark {
      margin-top: -14px;
    }
    .scale-scroll-cue {
      margin-top: 22px;
    }
    .scale-mini-preview {
      width: 86px;
      height: 86px;
    }
    .scale-mini-number { font-size: 25px; left: 14px; bottom: 27px; }
    .scale-mini-top { left: 14px; right: 14px; top: 14px; }
    .scale-mini-bars { left: 14px; right: 14px; bottom: 16px; }
    .scale-orbit-caption { display: none; }
    .scale-hero-ledger { display: none; }
    .scale-detail-hero,
    .scale-detail-grid,
    .scale-architecture,
    .scale-handoffs {
      grid-template-columns: 1fr;
    }
    .scale-detail-hero .scale-mini-preview { display: none; }
    .scale-index-row {
      min-height: auto;
      grid-template-columns: 1fr;
      gap: 14px;
      padding: 24px 0 30px;
    }
    .scale-index-row h3 {
      font-size: clamp(48px, 18vw, 84px);
    }
    .scale-index-chips { grid-column: auto; }
    .scale-handoff-sticky {
      position: relative;
      top: auto;
    }
    .scale-handoff-step {
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 18px;
    }
    .scale-handoff-step p {
      grid-column: 2;
    }
    .scale-signal-grid {
      grid-template-columns: 1fr;
    }
    .scale-module-list { grid-template-columns: 1fr; }
    .scale-module-list article { min-height: 120px; border-right: 0; }
    .scale-section { padding-top: 88px; padding-bottom: 88px; }
    .scale-architecture-list article { grid-template-columns: 1fr; gap: 8px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .scale-orbit-card,
    .scale-hero-card,
    .scale-cinema-hero::before,
    .scale-cinema-glow,
    .scale-webgl-canvas,
    .scale-webgl-fallback,
    .scale-cinema-type span,
    .scale-cinema-orb,
    .scale-cinema-rail-intro,
    .scale-cinema-rail-loop,
    .scale-cinema-panel,
    .scale-cinema-caption,
    .scale-hero-deck::before,
    .scale-hero-masthead::after,
    .scale-detail-shell,
    .scale-mini-preview {
      animation: none !important;
      transition: none !important;
    }
  }
`;

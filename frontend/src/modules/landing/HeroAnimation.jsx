import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

// Hero animation for the Z-Matrix landing surface.
// Two phases:
//   1. INTRO — the source mp4 plays once on mount (the original
//      `hero-intro-v3.mp4` the design was derived from).
//   2. LOOP  — when the video ends, a framer-motion SVG scene
//      cross-fades in and loops forever: orbital rings collapse onto
//      a rotating wireframe tesseract, the cube glows and the Z
//      strokes expand into the full Z-matrix logo, lightning arcs
//      shoot outward, then the cycle resets.
//
// Both phases occupy the same right-anchored, square `.zm-stage`
// container so the orbits are guaranteed to be centered on the cube.

const TEAL      = '#46EAD1';
const TEAL_SOFT = '#7CF6E5';

const VIDEO_SRC = '/landing/matrix_landing_assets/hero-intro-v3.mp4';

// Square scene — viewBox center is the cube center. The whole scene
// lives inside `.zm-stage` which itself is centered/anchored via CSS,
// guaranteeing the orbits, arcs, and logo all share the same anchor.
const VB        = 1200;
const CENTER    = VB / 2;

// ── Master cycle (seconds) ───────────────────────────────────────────
// t=0.00 → 0.30  IDLE       — small Z inside the tesseract, orbits wide
// t=0.30 → 0.50  CONVERGE   — orbital rings collapse onto the cube
// t=0.50 → 0.60  PEAK GLOW  — core flash; Z scales to full logo
// t=0.60 → 0.80  LIGHTNING  — arcs shoot outward from the cube
// t=0.80 → 1.00  RESET      — Z shrinks back; orbits restore
const CYCLE = 9;

const ORBITS = [
  { rx: 290, ry: 90,  stroke: 0.9, dash: '2 6',  opacity: 0.55 },
  { rx: 360, ry: 115, stroke: 0.8, dash: '3 8',  opacity: 0.48 },
  { rx: 440, ry: 142, stroke: 0.7, dash: '1 7',  opacity: 0.42 },
  { rx: 510, ry: 168, stroke: 0.6, dash: '4 10', opacity: 0.34 },
  { rx: 580, ry: 195, stroke: 0.5, dash: '2 14', opacity: 0.26 },
];

// Arcs originate at the cube (M = CENTER) and shoot outward to the
// square viewBox edges. pathLen seeds strokeDasharray for the draw.
const ARCS = [
  { d: `M ${CENTER},${CENTER} Q 420,540 250,500 T 40,560`,    pathLen: 620, idx: 0, width: 2.4 },
  { d: `M ${CENTER},${CENTER} Q 780,540 950,500 T 1160,560`,  pathLen: 620, idx: 1, width: 2.4 },
  { d: `M ${CENTER},${CENTER} Q 420,660 250,700 T 40,640`,    pathLen: 620, idx: 2, width: 2.0 },
  { d: `M ${CENTER},${CENTER} Q 780,660 950,700 T 1160,640`,  pathLen: 620, idx: 3, width: 2.0 },
  { d: `M ${CENTER},${CENTER} Q 480,420 360,310 T 220,150`,   pathLen: 580, idx: 4, width: 1.6 },
  { d: `M ${CENTER},${CENTER} Q 720,420 840,310 T 980,150`,   pathLen: 580, idx: 5, width: 1.6 },
  { d: `M ${CENTER},${CENTER} Q 540,780 460,920 T 380,1080`,  pathLen: 580, idx: 6, width: 1.4 },
  { d: `M ${CENTER},${CENTER} Q 660,780 740,920 T 820,1080`,  pathLen: 580, idx: 7, width: 1.4 },
];

const DRIFT_ZS = [
  { x: [-260, -240, -250, -260], y: [-160, -150, -170, -160], size: 22, dur: 11, delay: 0.2, op: 0.55 },
  { x: [ 240,  260,  250,  240], y: [-180, -160, -170, -180], size: 26, dur: 13, delay: 0.9, op: 0.65 },
  { x: [-220, -200, -210, -220], y: [ 180,  170,  190,  180], size: 18, dur: 12, delay: 1.6, op: 0.45 },
  { x: [ 260,  280,  270,  260], y: [ 170,  190,  180,  170], size: 20, dur: 10, delay: 2.0, op: 0.50 },
  { x: [   0,   20,  -20,    0], y: [-240, -230, -250, -240], size: 16, dur: 14, delay: 0.5, op: 0.40 },
];

// ── Logo geometry (matches z-matrix-design-system/.../zmatrix-mark.svg) ──
const WIREFRAME = [
  'M22 10 L58 10 L58 46 L22 46 Z',
  'M6 22 L22 10',
  'M42 22 L58 10',
  'M6 58 L22 46',
  'M42 58 L58 46',
  'M6 22 L42 22 L42 58 L6 58 Z',
];
// Inner tesseract cube + 8 hypercube edges connecting outer ↔ inner corners.
const TESSERACT = [
  'M31 19 L49 19 L49 37 L31 37 Z',
  'M23 27 L31 19',
  'M41 27 L49 19',
  'M23 45 L31 37',
  'M41 45 L49 37',
  'M23 27 L41 27 L41 45 L23 45 Z',
  'M22 10 L31 19',
  'M58 10 L49 19',
  'M58 46 L49 37',
  'M22 46 L31 37',
  'M6 22 L23 27',
  'M42 22 L41 27',
  'M42 58 L41 45',
  'M6 58 L23 45',
];
const Z_STROKES = [
  'M6 22 L58 10',
  'M58 10 L6 58',
  'M6 58 L58 46',
];

function LoopScene() {
  return (
    <>
      <svg className="zm-svg" viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="zm-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={TEAL_SOFT} stopOpacity="0.55" />
            <stop offset="35%"  stopColor={TEAL}      stopOpacity="0.22" />
            <stop offset="100%" stopColor={TEAL}      stopOpacity="0" />
          </radialGradient>
          <radialGradient id="zm-outer-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={TEAL} stopOpacity="0.16" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <filter id="zm-arc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="zm-core-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <ellipse cx={CENTER} cy={CENTER} rx={VB * 0.48} ry={VB * 0.38} fill="url(#zm-outer-glow)" />

        <motion.ellipse
          cx={CENTER} cy={CENTER} rx="220" ry="160"
          fill="url(#zm-core-glow)"
          filter="url(#zm-core-blur)"
          animate={{
            scale:   [1, 1.05, 1.45, 1.3, 1, 1],
            opacity: [0.9, 0.95, 1, 1, 0.9, 0.9],
          }}
          transition={{
            duration: CYCLE,
            times:    [0, 0.3, 0.55, 0.65, 0.85, 1],
            repeat:   Infinity,
            ease:     'easeInOut',
          }}
          style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
        />

        {/* Orbits: collapse inward during CONVERGE, snap onto the cube
            at PEAK GLOW, then expand back during RESET. */}
        {ORBITS.map((o, i) => (
          <motion.ellipse
            key={`orbit-${i}`}
            cx={CENTER} cy={CENTER} rx={o.rx} ry={o.ry}
            fill="none"
            stroke={TEAL}
            strokeWidth={o.stroke}
            strokeDasharray={o.dash}
            animate={{
              scale:   [1, 1.02, 0.12, 0.08, 0.85, 1],
              opacity: [o.opacity, o.opacity, o.opacity * 0.4, 0, o.opacity * 0.7, o.opacity],
            }}
            transition={{
              duration: CYCLE,
              times:    [0, 0.3, 0.48, 0.55, 0.85, 1],
              repeat:   Infinity,
              ease:     'easeInOut',
              delay:    i * 0.04,
            }}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          />
        ))}

        {/* Ring pulses traveling each orbit on their own slow rotation. */}
        {ORBITS.map((o, i) => (
          <motion.g
            key={`pulse-${i}`}
            animate={{ rotate: 360 }}
            transition={{ duration: 14 + i * 5, delay: i * 0.7, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          >
            <circle cx={CENTER + o.rx} cy={CENTER} r="3.5" fill={i % 2 ? TEAL_SOFT : TEAL}>
              <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
          </motion.g>
        ))}

        {/* Lightning arcs fire OUTWARD from the cube during the
            LIGHTNING phase. Cascaded by index for a chained crackle. */}
        <g filter="url(#zm-arc-glow)">
          {ARCS.map((a) => {
            const fireStart = 0.58 + a.idx * 0.018;
            const peakStart = fireStart + 0.06;
            const peakEnd   = peakStart + 0.06;
            const fireEnd   = peakEnd + 0.05;
            return (
              <motion.path
                key={`arc-${a.idx}`}
                d={a.d}
                fill="none"
                stroke={TEAL_SOFT}
                strokeWidth={a.width}
                strokeLinecap="round"
                strokeDasharray={a.pathLen}
                animate={{
                  strokeDashoffset: [a.pathLen, a.pathLen, 0, 0, -a.pathLen, -a.pathLen],
                  opacity:          [0,         0,         0.95, 0.95, 0,           0],
                }}
                transition={{
                  duration: CYCLE,
                  times:    [0, fireStart, peakStart, peakEnd, fireEnd, 1],
                  repeat:   Infinity,
                  ease:     'easeOut',
                }}
              />
            );
          })}
        </g>

        {/* Drifting Z glyphs */}
        {DRIFT_ZS.map((z, i) => (
          <motion.text
            key={`drift-${i}`}
            x={CENTER} y={CENTER}
            fill={TEAL_SOFT}
            fontFamily="Georgia, 'Times New Roman', serif"
            fontStyle="italic"
            fontSize={z.size}
            textAnchor="middle"
            dominantBaseline="middle"
            opacity={z.op}
            animate={{ x: z.x.map((v) => CENTER + v), y: z.y.map((v) => CENTER + v) }}
            transition={{ duration: z.dur, delay: z.delay, repeat: Infinity, ease: 'easeInOut' }}
          >
            Z
          </motion.text>
        ))}
      </svg>

      {/* The logo — centered in the same .zm-stage so it shares an
          anchor with the orbit/arc system. */}
      <div className="zm-logo-frame">
        <motion.div
          className="zm-frame-glow"
          animate={{ opacity: [0.45, 0.85, 0.45] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />

        <motion.div
          className="zm-core-burst"
          animate={{
            opacity: [0.35, 0.45, 1, 1, 0.55, 0.35],
            scale:   [0.85, 0.95, 1.45, 1.35, 0.95, 0.85],
          }}
          transition={{
            duration: CYCLE,
            times:    [0, 0.3, 0.55, 0.6, 0.85, 1],
            repeat:   Infinity,
            ease:     'easeInOut',
          }}
        />

        <div className="zm-cube-stage">
          <motion.div
            className="zm-cube-3d"
            animate={{ rotateY: 360, rotateX: [-12, 12, -12] }}
            transition={{
              rotateY: { duration: CYCLE,     repeat: Infinity, ease: 'linear' },
              rotateX: { duration: CYCLE / 2, repeat: Infinity, ease: 'easeInOut' },
            }}
          >
            <svg className="zm-logo-svg" viewBox="0 0 64 64">
              <g stroke={TEAL} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" fill="none">
                {WIREFRAME.map((d, i) => <path key={i} d={d} />)}
              </g>
              <motion.g
                stroke={TEAL_SOFT} strokeWidth="0.55"
                strokeLinecap="round" strokeLinejoin="round" fill="none"
                animate={{ opacity: [0.5, 0.55, 0.95, 0.55, 0.5] }}
                transition={{
                  duration: CYCLE,
                  times:    [0, 0.3, 0.55, 0.8, 1],
                  repeat:   Infinity,
                  ease:     'easeInOut',
                }}
              >
                {TESSERACT.map((d, i) => <path key={i} d={d} />)}
              </motion.g>

              {/* Z strokes: small inside the inner cube at IDLE,
                  expand to the full logo during PEAK GLOW, then
                  collapse back during RESET. */}
              <motion.g
                style={{ transformOrigin: '32px 32px' }}
                animate={{
                  scale:   [0.42, 0.42, 1, 1, 1, 0.42, 0.42],
                  opacity: [0.45, 0.5,  1, 1, 1, 0.5,  0.45],
                }}
                transition={{
                  duration: CYCLE,
                  times:    [0, 0.3, 0.5, 0.6, 0.8, 0.95, 1],
                  repeat:   Infinity,
                  ease:     'easeInOut',
                }}
              >
                <g stroke={TEAL_SOFT} strokeWidth="3.6"
                   strokeLinecap="round" strokeLinejoin="round" fill="none">
                  {Z_STROKES.map((d, i) => {
                    const drawStart  = 0.32 + i * 0.04;
                    const drawDone   = drawStart + 0.10;
                    const eraseStart = 0.82 + i * 0.03;
                    const eraseDone  = eraseStart + 0.08;
                    return (
                      <motion.path
                        key={i}
                        d={d}
                        strokeDasharray="120"
                        animate={{ strokeDashoffset: [120, 120, 0, 0, 0, 120, 120] }}
                        transition={{
                          duration: CYCLE,
                          times:    [0, drawStart, drawDone, 0.6, eraseStart, eraseDone, 1],
                          repeat:   Infinity,
                          ease:     'easeInOut',
                        }}
                        style={{ filter: 'drop-shadow(0 0 8px rgba(124, 246, 229, 0.95))' }}
                      />
                    );
                  })}
                </g>
              </motion.g>
            </svg>
          </motion.div>
        </div>

        <span className="zm-wordmark">Z-matrix</span>
      </div>
    </>
  );
}

export default function HeroAnimation() {
  const [introDone, setIntroDone] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Hard safety net: if `ended` never fires (e.g. headless / blocked
    // autoplay), reveal the loop scene anyway after 14s.
    const safety = window.setTimeout(() => setIntroDone(true), 14_000);
    const play = v.play && v.play();
    if (play && typeof play.catch === 'function') {
      play.catch(() => setIntroDone(true));
    }
    return () => window.clearTimeout(safety);
  }, []);

  return (
    <div className="zm-hero-anim" aria-hidden="true">
      <style>{ZM_CSS}</style>

      {/* INTRO video — plays once, then fades out so the loop scene
          beneath it takes over. */}
      <video
        ref={videoRef}
        className={`zm-intro-video ${introDone ? 'zm-intro-done' : ''}`}
        src={VIDEO_SRC}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onEnded={() => setIntroDone(true)}
        onError={() => setIntroDone(true)}
      />

      {/* LOOP scene — orbits + arcs + cube, all centered in the same
          square stage so the cube is always at the center of its orbit. */}
      <div className={`zm-stage ${introDone ? 'zm-stage-visible' : ''}`}>
        <LoopScene />
      </div>
    </div>
  );
}

const ZM_CSS = `
.zm-hero-anim {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/* INTRO video — full-bleed background, fades out when introDone flips. */
.zm-intro-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 70% 50%;
  opacity: 0.95;
  transition: opacity 900ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 1;
}
.zm-intro-video.zm-intro-done {
  opacity: 0;
  pointer-events: none;
}

/* LOOP stage — square container anchored to the right of the hero.
   Both the orbit SVG and the logo frame are centered inside it,
   guaranteeing the cube sits at the visual center of every orbit. */
.zm-stage {
  position: absolute;
  top: 50%;
  right: clamp(48px, 8vw, 140px);
  transform: translateY(-50%);
  width: min(820px, 70vw);
  height: min(820px, 70vw);
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 900ms cubic-bezier(0.22, 1, 0.36, 1) 200ms;
  z-index: 0;
}
.zm-stage.zm-stage-visible { opacity: 1; }
@media (max-width: 980px) {
  .zm-stage {
    top: 50%;
    right: 50%;
    transform: translate(50%, -50%);
    width: min(620px, 90vw);
    height: min(620px, 90vw);
  }
}

.zm-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.zm-logo-frame {
  position: relative;
  width: 260px;
  height: 260px;
  border: 2.6px solid #46EAD1;
  border-radius: 42px;
  background:
    radial-gradient(60% 60% at 50% 50%, rgba(70, 234, 209, 0.12), rgba(70, 234, 209, 0.02) 70%, transparent 100%),
    rgba(5, 10, 12, 0.45);
  box-shadow:
    0 0 0 5px rgba(70, 234, 209, 0.07) inset,
    0 0 30px rgba(70, 234, 209, 0.55),
    0 0 80px rgba(70, 234, 209, 0.28);
  display: grid;
  place-items: center;
  overflow: hidden;
  z-index: 2;
}
.zm-frame-glow {
  position: absolute;
  inset: 6px;
  border-radius: 36px;
  background: radial-gradient(60% 60% at 50% 50%, rgba(124, 246, 229, 0.22), transparent 70%);
  pointer-events: none;
}
.zm-core-burst {
  position: absolute;
  top: 50%; left: 50%;
  width: 140px;
  height: 140px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(124, 246, 229, 0.55) 25%, rgba(70, 234, 209, 0.18) 55%, transparent 75%);
  filter: blur(3px);
  mix-blend-mode: screen;
  pointer-events: none;
  z-index: 1;
}
.zm-cube-stage {
  position: relative;
  z-index: 2;
  width: 190px;
  height: 190px;
  perspective: 900px;
  display: grid;
  place-items: center;
}
.zm-cube-3d {
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  filter: drop-shadow(0 0 14px rgba(70, 234, 209, 0.7));
  will-change: transform;
}
.zm-logo-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.zm-wordmark {
  position: absolute;
  left: 0; right: 0;
  bottom: 18px;
  text-align: center;
  font: 600 14px/1 Georgia, 'Times New Roman', serif;
  letter-spacing: 0.04em;
  color: rgba(124, 246, 229, 0.85);
  text-shadow: 0 0 10px rgba(70, 234, 209, 0.55);
  pointer-events: none;
  z-index: 3;
}

@media (prefers-reduced-motion: reduce) {
  .zm-hero-anim * { animation: none !important; transition: none !important; }
  .zm-intro-video { opacity: 0; }
  .zm-stage { opacity: 1; }
}
`;

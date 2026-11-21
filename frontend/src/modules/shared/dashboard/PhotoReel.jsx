// skipcq: JS-0833
import React from 'react';
import { Ico } from './kit.jsx';

export const REEL_MS = 7000;
const LOOPS = 2;
const PAUSE_KEY = 'zm:photo-reel-paused';

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function readPaused() {
  try { return window.localStorage.getItem(PAUSE_KEY) === '1'; } catch { return false; }
}

// A slow photo slideshow for a card background (crossfade + gentle Ken Burns
// pan that alternates direction, so the photos drift side to side).
// - One photo every REEL_MS; it plays LOOPS times, then rests on the first photo.
// - Holds while hovered or focused, while the tab is hidden, and while the card
//   is off screen; a Pause/Play button stops it for good (WCAG 2.2.2), and the
//   choice is remembered.
// - Reduced motion: the first photo, still. The photos are decorative (alt="").
// - Only the current and next photos are in the DOM, so nothing else downloads.
export default function PhotoReel({ photos, label = 'Photos' }) {
  const list = React.useMemo(() => (photos?.length ? photos : []), [photos]);
  const [idx, setIdx] = React.useState(0);
  const [steps, setSteps] = React.useState(0);
  const [paused, setPaused] = React.useState(readPaused);
  const [hold, setHold] = React.useState(false);
  const [visible, setVisible] = React.useState(true);
  const still = React.useMemo(prefersReducedMotion, []);
  const ref = React.useRef(null);
  const key = list.map((p) => p.src).join('|');

  React.useEffect(() => { setIdx(0); setSteps(0); }, [key]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const on = () => setHold(true);
    const off = () => setHold(false);
    el.addEventListener('mouseenter', on);
    el.addEventListener('mouseleave', off);
    el.addEventListener('focusin', on);
    el.addEventListener('focusout', off);
    let io;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
      io.observe(el);
    }
    return () => {
      el.removeEventListener('mouseenter', on);
      el.removeEventListener('mouseleave', off);
      el.removeEventListener('focusin', on);
      el.removeEventListener('focusout', off);
      io?.disconnect();
    };
  }, [list.length]);

  const finished = steps >= list.length * LOOPS;
  const running = !still && !paused && !hold && visible && !finished && list.length > 1;

  React.useEffect(() => {
    if (!running) return undefined;
    const id = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') { setSteps((n) => n); return; }
      setIdx((n) => (n + 1) % list.length);
      setSteps((n) => n + 1);
    }, REEL_MS);
    return () => window.clearTimeout(id);
  }, [running, idx, steps, list.length]);

  // Preload the next photo so the crossfade never shows a half-loaded image.
  React.useEffect(() => {
    if (list.length < 2 || still) return;
    const img = new Image();
    img.src = list[(idx + 1) % list.length].src;
  }, [idx, key, still, list]);

  const toggle = () => {
    setPaused((p) => {
      const nextPaused = !p;
      try { window.localStorage.setItem(PAUSE_KEY, nextPaused ? '1' : '0'); } catch { /* per-viewer only */ }
      if (!nextPaused && finished) setSteps(0);
      return nextPaused;
    });
  };

  if (!list.length) return null;
  const next = (idx + 1) % list.length;
  const animate = running || (!still && !paused && !finished);
  return (
    <div ref={ref} className="dash-reel" role="group" aria-roledescription="slideshow" aria-label={label}>
      {list.map((p, k) => (k === idx || k === next) && (
        <img key={p.src} src={p.src} alt="" aria-hidden="true" decoding="async"
          fetchPriority={k === idx ? 'high' : 'low'}
          className={`dash-reel-img${k === idx ? ' is-on' : ''}${k % 2 ? ' is-rtl' : ''}${animate ? '' : ' is-still'}`} />
      ))}
      {list.length > 1 && !still && (
        <div className="dash-reel-ctl">
          <span className="dash-reel-dots" aria-hidden="true">
            {list.map((p, k) => <span key={p.src} className={k === idx ? 'is-on' : ''} />)}
          </span>
          <button type="button" className="dash-reel-btn" onClick={toggle}
            aria-label={paused ? 'Play photos' : 'Pause photos'} aria-pressed={paused}>
            <Ico name={paused ? 'play' : 'pause'} size={14} />
          </button>
        </div>
      )}
      {list[idx].credit && <span className="dash-reel-credit">Photo: {list[idx].credit} / Unsplash</span>}
    </div>
  );
}

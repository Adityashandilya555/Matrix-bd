export const GRID_LAYERS = [
  'repeating-linear-gradient(0deg, var(--zm-grid-strong) 0, var(--zm-grid-strong) 1px, transparent 1px, transparent 160px)',
  'repeating-linear-gradient(90deg, var(--zm-grid-strong) 0, var(--zm-grid-strong) 1px, transparent 1px, transparent 160px)',
  'repeating-linear-gradient(0deg, var(--zm-grid) 0, var(--zm-grid) 1px, transparent 1px, transparent 40px)',
  'repeating-linear-gradient(90deg, var(--zm-grid) 0, var(--zm-grid) 1px, transparent 1px, transparent 40px)',
].join(', ');

export const GRID_ATTACH = 'local, local, local, local';

export function stageVignette(dark) {
  return dark
    ? 'radial-gradient(125% 90% at 50% -12%, rgba(226,176,122,0.07), transparent 46%), radial-gradient(150% 135% at 50% 120%, rgba(0,0,0,0.55), transparent 60%)'
    : 'radial-gradient(120% 80% at 50% -14%, rgba(255,253,250,0.72), transparent 52%), radial-gradient(150% 135% at 50% 120%, rgba(58,36,22,0.06), transparent 60%)';
}

// The canvas is split across two elements on purpose. The vignette is painted
// on a NON-scrolling container; the scroller only carries the grid, attached
// 'local' so it scrolls with the content. A background-attachment: fixed layer
// on the scroller itself makes Chrome repaint the whole viewport on every
// scroll frame (no composited scrolling), which made long, effect-heavy pages
// like the dashboards scroll at well under 60 fps.
export function canvasBackdrop(dark) {
  return { backgroundColor: canvasBase(dark), backgroundImage: stageVignette(dark) };
}

export const CANVAS_GRID = { backgroundImage: GRID_LAYERS, backgroundAttachment: GRID_ATTACH };

export function canvasBase(dark) {
  return dark ? '#120C08' : '#F1E9DE';
}

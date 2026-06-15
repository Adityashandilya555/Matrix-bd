// Shared "premium grid" surface recipe.
//
// The plane is built from two grid rhythms — a fine 40px lattice under a
// stronger 160px coarse grid — so it reads with real depth instead of a flat
// hatch. Both layers are pure CSS `repeating-linear-gradient`s keyed off the
// theme-reactive `--zm-grid` / `--zm-grid-strong` tokens, so the same string
// works in light and dark with no JS branching.
//
// Pair GRID_LAYERS with stageVignette() on the scrolling canvas: the vignette
// is painted on top (fixed to the viewport like a stage light) so the grid
// recedes toward the edges and every card/panel above it reads as raised.
export const GRID_LAYERS = [
  'repeating-linear-gradient(0deg, var(--zm-grid-strong) 0, var(--zm-grid-strong) 1px, transparent 1px, transparent 160px)',
  'repeating-linear-gradient(90deg, var(--zm-grid-strong) 0, var(--zm-grid-strong) 1px, transparent 1px, transparent 160px)',
  'repeating-linear-gradient(0deg, var(--zm-grid) 0, var(--zm-grid) 1px, transparent 1px, transparent 40px)',
  'repeating-linear-gradient(90deg, var(--zm-grid) 0, var(--zm-grid) 1px, transparent 1px, transparent 40px)',
].join(', ');

// background-attachment values matching the 4 GRID_LAYERS — `local` so the grid
// scrolls with the canvas content (it feels like a real surface, not a decal).
export const GRID_ATTACH = 'local, local, local, local';

// Stage-light vignette: a soft top glow + a deeper edge falloff so the canvas
// looks lit from above and the corners sink away. `fixed` (set by the caller)
// keeps it steady while content scrolls underneath.
export function stageVignette(dark) {
  return dark
    ? 'radial-gradient(125% 90% at 50% -12%, rgba(143,182,222,0.07), transparent 46%), radial-gradient(150% 135% at 50% 120%, rgba(0,0,0,0.55), transparent 60%)'
    : 'radial-gradient(120% 80% at 50% -14%, rgba(255,255,255,0.72), transparent 52%), radial-gradient(150% 135% at 50% 120%, rgba(30,41,59,0.06), transparent 60%)';
}

// Slightly-deepened base color for the canvas so white cards lift off it.
export function canvasBase(dark) {
  return dark ? '#09090F' : '#EEF2F8';
}

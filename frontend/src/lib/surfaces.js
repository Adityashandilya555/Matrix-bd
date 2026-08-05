export const GRID_LAYERS = [
  'repeating-linear-gradient(0deg, var(--zm-grid-strong) 0, var(--zm-grid-strong) 1px, transparent 1px, transparent 160px)',
  'repeating-linear-gradient(90deg, var(--zm-grid-strong) 0, var(--zm-grid-strong) 1px, transparent 1px, transparent 160px)',
  'repeating-linear-gradient(0deg, var(--zm-grid) 0, var(--zm-grid) 1px, transparent 1px, transparent 40px)',
  'repeating-linear-gradient(90deg, var(--zm-grid) 0, var(--zm-grid) 1px, transparent 1px, transparent 40px)',
].join(', ');

export const GRID_ATTACH = 'local, local, local, local';

export function stageVignette(dark) {
  return dark
    ? 'radial-gradient(125% 90% at 50% -12%, rgba(143,182,222,0.07), transparent 46%), radial-gradient(150% 135% at 50% 120%, rgba(0,0,0,0.55), transparent 60%)'
    : 'radial-gradient(120% 80% at 50% -14%, rgba(255,255,255,0.72), transparent 52%), radial-gradient(150% 135% at 50% 120%, rgba(30,41,59,0.06), transparent 60%)';
}

export function canvasBase(dark) {
  return dark ? '#09090F' : '#EEF2F8';
}

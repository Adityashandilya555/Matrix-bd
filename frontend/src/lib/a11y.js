// Keyboard parity for clickable non-button elements.
// Wrap the same handler you pass to onClick; this fires it on Enter/Space so
// keyboard users get identical behaviour (satisfies jsx-a11y key-event rules).
export function keyActivate(fn) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn(e);
    }
  };
}

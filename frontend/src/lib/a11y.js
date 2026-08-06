export function keyActivate(fn) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn(e);
    }
  };
}

import React from 'react';

/**
 * Isolates the decorative Rive animation. If Rive (the library, the WASM, or
 * the .riv asset) ever fails to load or render, this catches it and shows a
 * static fallback panel instead of taking the surrounding form down with it.
 * The login form lives outside this boundary, so it is never affected.
 */
export default class RiveErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.warn('[rive] decorative animation failed — falling back to static panel.', error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

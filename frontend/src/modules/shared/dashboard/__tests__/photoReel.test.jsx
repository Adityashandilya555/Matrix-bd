// skipcq: JS-0833
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import PhotoReel, { REEL_MS } from '../PhotoReel.jsx';
import { cityPhotos } from '../cityPhotos.js';

afterEach(() => { cleanup(); vi.useRealTimers(); try { window.localStorage?.clear(); } catch { /* no storage in this env */ } });

const PHOTOS = [
  { src: '/a.jpg', alt: 'First' }, { src: '/b.jpg', alt: 'Second' }, { src: '/c.jpg', alt: 'Third' },
];
const shown = () => screen.getByRole('group').querySelector('.dash-reel-img.is-on').getAttribute('src');

describe('PhotoReel', () => {
  it('moves to the next photo every few seconds', () => {
    vi.useFakeTimers();
    render(<PhotoReel photos={PHOTOS} />);
    expect(shown()).toBe('/a.jpg');
    act(() => { vi.advanceTimersByTime(REEL_MS); });
    expect(shown()).toBe('/b.jpg');
  });

  it('stops when paused with its button', () => {
    vi.useFakeTimers();
    render(<PhotoReel photos={PHOTOS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause photos' }));
    act(() => { vi.advanceTimersByTime(REEL_MS * 3); });
    expect(shown()).toBe('/a.jpg');
    expect(screen.getByRole('button', { name: 'Play photos' })).toBeTruthy();
  });

  it('stops after two loops and rests on the first photo', () => {
    vi.useFakeTimers();
    render(<PhotoReel photos={PHOTOS} />);
    for (let n = 0; n < PHOTOS.length * 2 + 3; n += 1) act(() => { vi.advanceTimersByTime(REEL_MS); });
    expect(shown()).toBe('/a.jpg');
  });

  it('mounts only the current and next photos', () => {
    render(<PhotoReel photos={[...PHOTOS, { src: '/d.jpg', alt: 'Fourth' }]} />);
    expect(screen.getByRole('group').querySelectorAll('img')).toHaveLength(2);
  });

  it('falls back to the café photos for a city without its own', () => {
    expect(cityPhotos('Atlantis').length).toBeGreaterThan(1);
  });
});

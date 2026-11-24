// skipcq: JS-0833
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import PhotoReel, { REEL_MS } from '../PhotoReel.jsx';
import { cityPhotos } from '../cityPhotos.js';
import { packRows } from '../RoleDashboard.jsx';

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

  it('stays still on narrow screens, where its pause control is hidden', () => {
    vi.useFakeTimers();
    const orig = window.matchMedia;
    window.matchMedia = (q) => ({ matches: q === '(max-width: 720px)', media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<PhotoReel photos={PHOTOS} />);
      act(() => { vi.advanceTimersByTime(REEL_MS * 3); });
      expect(shown()).toBe('/a.jpg');
      expect(screen.queryByRole('button', { name: 'Pause photos' })).toBeNull();
    } finally { window.matchMedia = orig; }
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

  it('has three photos for each of the seven cities, matched case-insensitively', () => {
    for (const city of ['Bengaluru', 'Mumbai', 'Pune', 'Hyderabad', 'Gurugram', 'Chennai', 'Kolkata']) {
      expect(cityPhotos(city)).toHaveLength(3);
    }
    expect(cityPhotos(' MUMBAI ')[0].src).toContain('/dashboard/cities/mumbai-');
  });
});

describe('cityPhotos across the city list', () => {
  it('uses a major city\'s landmark, then its state, then café photos', () => {
    const jaipur = cityPhotos('Jaipur').map((p) => p.src);
    expect(jaipur[0]).toContain('city-jaipur');
    expect(jaipur[1]).toContain('state-rajasthan');
    expect(jaipur).toHaveLength(3);
  });

  it('falls back to the state photo for a smaller city', () => {
    expect(cityPhotos('Achalpur')[0].src).toContain('state-maharashtra');
    expect(cityPhotos('Ludhiana')[0].src).toContain('state-punjab');
  });

  it('understands common alternative names', () => {
    expect(cityPhotos('Bangalore')[0].src).toContain('/dashboard/cities/bengaluru-');
    expect(cityPhotos('Vizag')[0].src).toContain('city-visakhapatnam');
  });

  it('gives every photo a credit except the bundled café shots', () => {
    const withCredit = cityPhotos('Udaipur').filter((p) => p.src.includes('/places/'));
    expect(withCredit.every((p) => p.credit)).toBe(true);
  });
});

describe('packRows', () => {
  it('stretches the last block of each row so every row ends flush at 12 columns', () => {
    const rows = packRows([{ key: 'a', span: 5 }, { key: 'b', span: 12 }, { key: 'c', span: 4 }, { key: 'd', span: 4 }]);
    expect(rows.map((r) => r.span)).toEqual([12, 12, 4, 8]);
  });
});

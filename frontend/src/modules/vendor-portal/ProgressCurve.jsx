// skipcq: JS-0833
// Planned vs actual cumulative progress, drawn from the server's curve points
// ({ planned: [[day, pct]], actual: [[day, pct]] }). Shared by the vendor
// portal and the Project team's Vendor fit-out page.
import React from 'react';

export default function ProgressCurve({ curve, duration, today }) {
  const W = 1000, H = 260, L = 40, R = 14, T = 14, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const D = Math.max(1, Number(duration) || 1);
  const x = (d) => L + (Math.min(Math.max(d, 0), D) / D) * iw;
  const y = (v) => T + ih - (Math.min(Math.max(v, 0), 100) / 100) * ih;
  const path = (pts) => (pts || []).map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const planned = curve?.planned || [];
  const actual = curve?.actual || [];
  const last = actual[actual.length - 1];
  const ticks = [];
  for (let d = 0; d <= D; d += 5) ticks.push(d);

  return (
    <div>
      <svg className="vp-curve" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Planned versus actual progress">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--zm-line)" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}%</text>
          </g>
        ))}
        {ticks.map((d) => <text key={d} x={x(d)} y={H - 8} textAnchor="middle">D{d}</text>)}
        {today >= 1 && today <= D && (
          <g><line x1={x(today)} x2={x(today)} y1={T} y2={T + ih} stroke="var(--vp-bad)" strokeWidth="1.5" />
            <text x={x(today) + 4} y={T + 10}>Today</text></g>
        )}
        {planned.length > 1 && <path d={path(planned)} fill="none" stroke="var(--zm-fg-3)" strokeWidth="1.5" strokeDasharray="5 4" />}
        {actual.length > 1 && <path d={path(actual)} fill="none" stroke="var(--vp-accent)" strokeWidth="2.5" strokeLinejoin="round" />}
        {last && <circle cx={x(last[0])} cy={y(last[1])} r="4" fill="var(--vp-accent)" />}
      </svg>
      <div className="vp-row vp-small vp-muted" style={{ gap: 16 }}>
        <span>— — Planned</span><span style={{ color: 'var(--vp-accent)' }}>━ Actual, from daily updates</span>
      </div>
    </div>
  );
}

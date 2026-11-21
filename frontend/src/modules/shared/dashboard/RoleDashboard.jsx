// skipcq: JS-0833
import React from 'react';
import PhotoReel from './PhotoReel.jsx';
import { cityPhotos } from './cityPhotos.js';
import {
  AreaTrend, Card, CardHead, ChipTabs, CountUp, Donut, FreshnessBadge, Funnel, Heatmap, Ico, Legend, Lollipops, Source, Sparkline, SplitTrack, StackedBar, TONE, Track,
} from './kit.jsx';

// One dashboard for every role. It draws only the sections present in `data`,
// which is the /dashboard/summary payload: the server decides what each role
// may see, so this component never filters by role itself.

const PHOTO = {
  hero: '/dashboard/latte-art.jpg',
  cafe: '/dashboard/cafe-plants.jpg',
  beans: '/dashboard/beans.jpg',
  cup: '/dashboard/beans-cup.jpg',
};

// Preferred width of each section on a 12-column bento grid.
const SPAN = {
  readiness: 7, inbox: 5, launches: 7, openings: 4, modules: 4, cycle: 4, funnel: 12, cities: 12,
  compliance: 4, licences: 4, timeline: 4, money: 8, budget: 4, people: 4, workload: 4, activity: 4,
};

// A soft tint per card, matching its header icon, so cards don't read flat.
const TINT = {
  readiness: 'green', inbox: 'orange', launches: 'blue', openings: 'orange', modules: 'blue', cycle: 'orange',
  funnel: 'purple', compliance: 'red', licences: 'green', timeline: 'purple', budget: 'blue', people: 'green',
  workload: 'orange', activity: 'blue',
};

// Pack blocks into rows of 12 so every row ends flush: when the next block
// does not fit, the last block of the row stretches to fill it.
export function packRows(blocks) {
  const out = blocks.map((b) => ({ ...b }));
  let used = 0;
  let rowEnd = -1;
  out.forEach((b, i) => {
    if (used + b.span > 12) {
      if (rowEnd >= 0) out[rowEnd].span += 12 - used;
      used = 0;
    }
    used += b.span;
    rowEnd = i;
  });
  if (rowEnd >= 0 && used < 12) out[rowEnd].span += 12 - used;
  return out;
}

export default function RoleDashboard({ data, updatedAt, scope, onScope, viewer }) {
  const d = data;
  const all = [
    ['readiness', d.readiness && <Readiness r={d.readiness} />],
    ['inbox', d.inbox && <Inbox inbox={d.inbox} />],
    ['launches', d.launches && <Launches l={d.launches} />],
    ['openings', d.openings && <Openings items={d.openings} />],
    ['modules', d.modules && <Modules mods={d.modules} />],
    ['cycle', d.cycle && <Cycle c={d.cycle} />],
    ['funnel', d.funnel && (
      <Card>
        <CardHead icon="funnel" tone="purple" title={d.funnel.title} sub="Pick a step to see how sites move through it" />
        <Funnel steps={d.funnel.steps} />
        <Source>{d.funnel.source}</Source>
      </Card>
    )],
    ['cities', d.cities && <Cities cities={d.cities} />],
    ['compliance', d.compliance && <Compliance c={d.compliance} />],
    ['licences', d.licences && <Licences l={d.licences} />],
    ['timeline', d.timeline && <Timeline t={d.timeline} />],
    ['money', d.money && <Money m={d.money} />],
    ['budget', d.budget && <Budget b={d.budget} />],
    ['people', d.people && <People p={d.people} />],
    ['workload', d.workload && <Workload w={d.workload} />],
    ['activity', d.activity && <Activity a={d.activity} />],
  ].filter(([, el]) => el).map(([key, el]) => ({ key, el, span: SPAN[key] }));
  const blocks = packRows(all);
  // Medium screens: halves and fulls, packed the same way so rows stay flush.
  const md = packRows(all.map((b) => ({ ...b, span: b.span <= 6 ? 6 : 12 })));
  return (
    <div className="dash dash-bento">
      <div className="b-item" style={{ '--span': 12, '--span-md': 12 }}>
        <Hero d={d} updatedAt={updatedAt} scope={scope} onScope={onScope} viewer={viewer} />
      </div>
      {d.empty && <div className="b-item" style={{ '--span': 12, '--span-md': 12 }}><Empty e={d.empty} /></div>}
      {blocks.map((b, i) => (
        <div key={b.key} className="b-item" data-tone={TINT[b.key]} style={{ '--span': b.span, '--span-md': md[i].span }}>{b.el}</div>
      ))}
    </div>
  );
}

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = String(name || '').trim().split(/[\s(]+/)[0];
  return first ? `${part}, ${first}` : part;
}

// Greeting and a café photo on top, a solid KPI strip below: each tile is a
// number with its 12-week sparkline and 4-week change when history exists.
function Hero({ d, updatedAt, scope, onScope, viewer }) {
  const h = d.hero;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section className="dash-card dash-hero2">
      <div className="dash-hero2-photo" aria-hidden="true">
        <img src={PHOTO.hero} alt="" />
      </div>
      <div className="dash-hero2-top">
        <div className="dash-hero2-text">
          <span className="dash-eyebrow" style={{ color: '#E9C9A6' }}>{h.eyebrow}</span>
          <h1>{greeting(viewer)}</h1>
          <p style={{ margin: 0, fontSize: 14.5, color: '#E9DCCB' }}>{today} · {h.lede}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            {d.simulated && <span className="dash-pill" style={{ background: 'var(--zm-copper-soft)', color: 'var(--zm-copper)' }}>Simulated view</span>}
            {d.scopes && (
              <div className="dash-seg" role="group" aria-label="Scope">
                {d.scopes.map((sc) => (
                  <button key={sc.key} type="button" aria-pressed={scope === sc.key} onClick={() => onScope?.(sc.key)}>{sc.label}</button>
                ))}
              </div>
            )}
            <FreshnessBadge updatedAt={updatedAt} onDark />
          </div>
        </div>
      </div>
      {d.kpis.length > 0 && (
        <div className="dash-kpis">
          {d.kpis.map((k) => (
            <div key={k.key} className="dash-kpi">
              <span className="dash-kpi-label">{k.label}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="dash-num dash-kpi-value"><CountUp value={k.value} /></span>
                {typeof k.delta === 'number' && k.delta !== 0 && (
                  <span className={`dash-delta${k.delta > 0 ? ' is-up' : ' is-down'}`}>{k.delta > 0 ? '▲' : '▼'} {Math.abs(k.delta)} in 4 wk</span>
                )}
              </div>
              {k.series ? <Sparkline points={k.series} /> : <span className="dash-sub" style={{ fontSize: 12 }}>{k.caption}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Empty({ e }) {
  return (
    <Card>
      <div className="dash-empty">
        <span className="dash-ico" style={{ width: 56, height: 56, borderRadius: 18, background: TONE.orange.bg, color: TONE.orange.fg }}><Ico name="store" size={26} /></span>
        <h2 className="dash-title">{e.title}</h2>
        <p className="dash-sub" style={{ maxWidth: 460, fontSize: 14 }}>{e.body}</p>
        {e.cta && e.href && (
          <a href={e.href} className="dash-chip" style={{ marginTop: 4, textDecoration: 'none', background: 'var(--zm-cta-bg)', color: 'var(--zm-cta-fg)', borderColor: 'var(--zm-cta-bg)' }}>
            <Ico name="plus" size={16} />{e.cta}
          </a>
        )}
      </div>
    </Card>
  );
}

const KIND_TONE = { design: 'blue', payment: 'orange', quality: 'purple', loi: 'red', change: 'neutral', budget: 'green' };

// "Waiting on you" as a focused card stack: one item at a time with the next
// two peeking behind; Next and Snooze (moves it to the back for now) step through.
function Inbox({ inbox }) {
  const [order, setOrder] = React.useState(() => inbox.items.map((_, i) => i));
  React.useEffect(() => { setOrder(inbox.items.map((_, i) => i)); }, [inbox.items]);
  const n = order.length;
  const top = n ? inbox.items[order[0]] : null;
  const next = () => setOrder((o) => (o.length > 1 ? [...o.slice(1), o[0]] : o));
  const prev = () => setOrder((o) => (o.length > 1 ? [o[o.length - 1], ...o.slice(0, -1)] : o));
  const t = top ? TONE[KIND_TONE[top.key] || 'neutral'] : TONE.neutral;
  return (
    <Card id="inbox">
      <CardHead icon="inbox" tone="orange" title={inbox.title} sub={n ? `${n} waiting · ${inbox.sub}` : inbox.sub} />
      {!top && (
        <div className="dash-stack-empty">
          <span className="dash-ico" style={{ background: 'var(--zm-success-soft)', color: 'var(--zm-success)' }}><Ico name="check" /></span>
          <div className="dash-col"><span style={{ fontWeight: 600 }}>You're all caught up</span><span className="dash-sub">New items show up here as soon as they need you.</span></div>
        </div>
      )}
      {top && (
        <div className="dash-stack" aria-live="polite">
          {n > 2 && <span className="dash-stack-ghost g2" aria-hidden="true" />}
          {n > 1 && <span className="dash-stack-ghost g1" aria-hidden="true" />}
          <article key={order[0]} className="dash-stack-card dv-anim dv-fade">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <span className="dash-pill" style={{ background: t.bg, color: t.fg }}>{top.kind}</span>
              {top.age && <span className="dash-sub">{top.age}</span>}
            </div>
            <span style={{ fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 22, lineHeight: 1.2 }}>{top.name}</span>
            <span className="dash-sub"><span style={{ fontFamily: 'var(--zm-font-mono)' }}>{top.code}</span>{top.city ? ` · ${top.city}` : ''}</span>
          </article>
        </div>
      )}
      {n > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="dash-sub">1 of {n}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dash-chip" onClick={prev} aria-label="Previous item">‹ Back</button>
            <button type="button" className="dash-chip" onClick={next}>Snooze</button>
            <button type="button" className="dash-chip" aria-pressed="true" onClick={next}>Next ›</button>
          </div>
        </div>
      )}
      <Source>{inbox.source}</Source>
    </Card>
  );
}

function Readiness({ r }) {
  return (
    <Card variant="green">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div className="dash-col">
          <span className="dash-eyebrow" style={{ color: '#9FE0C4' }}>Launch readiness</span>
          <h2 className="dash-title" style={{ fontSize: 25 }}>{r.ready} of {r.total} cafés are ready to open</h2>
        </div>
        <Donut size={84} stroke={16} track="rgba(255,255,255,.18)" label={`${r.ready} of ${r.total} ready`}
          parts={[{ label: 'Ready', value: r.ready, color: '#9FE0C4' }, { label: 'Not yet', value: r.total - r.ready, color: 'transparent' }]}
          center={`${Math.round((r.ready / r.total) * 100)}%`} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {r.checks.map(([label, n]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 80px 30px', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(159,224,196,.18)', color: '#9FE0C4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico name="check" size={13} stroke={3} /></span>
            <span style={{ fontSize: 13.5 }}>{label}</span>
            <Track pct={(n / r.total) * 100} height={7} color="#9FE0C4" style={{ background: 'rgba(255,255,255,.14)' }} />
            <span style={{ fontSize: 12.5, textAlign: 'right', fontWeight: 700 }}>{n}/{r.total}</span>
          </div>
        ))}
      </div>
      <Source>nso_reviews stage 2–3 checks · launch_date · final sign-offs</Source>
    </Card>
  );
}

function Launches({ l }) {
  const [range, setRange] = React.useState(12);
  const past = l.past.slice(12 - range);
  const points = past.map(([m, v, title]) => ({ key: `p${title || m}`, label: m, value: v, title }))
    .concat(l.ahead.map(([m, v, title]) => ({ key: `a${title || m}`, label: m, value: v, title, ahead: true })));
  const opened = past.reduce((s, [, v]) => s + v, 0);
  const planned = l.ahead.reduce((s, [, v]) => s + v, 0);
  return (
    <Card>
      <CardHead icon="rocket" tone="blue" title="Cafés opened & opening"
        sub={`${opened} opened in the last ${range} months · ${planned} planned ahead`}
        right={<ChipTabs label="Period" value={range} onChange={setRange}
          items={[3, 6, 12].map((r) => ({ key: r, label: `${r}M` }))} />} />
      <AreaTrend points={points} label="Cafés opened per month and planned openings" />
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--zm-fg-2)', flexWrap: 'wrap' }}>
        <Key color="var(--zm-accent)">Opened</Key><Key color="var(--zm-copper)">Planned (NSO launch date)</Key>
      </div>
      <Source>sites.launched_at · nso_reviews.launch_date</Source>
    </Card>
  );
}

function Key({ color, children }) {
  return <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{children}</span>;
}

function Openings({ items }) {
  return (
    <Card>
      <CardHead icon="calendar" tone="orange" title="Next openings" sub="From NSO launch dates" />
      <div className="dv-openings">
        {items.map((o, k) => (
          <div key={o.site} className="dv-anim dv-fade dv-opening" style={{ animationDelay: `${k * 60}ms` }}>
            <div className="dv-cal" aria-hidden="true">
              <span className="dv-cal-m">{o.m}</span>
              <span className="dv-cal-d">{o.d}</span>
            </div>
            <div className="dash-col" style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{o.site}</span>
              <span className="dash-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ico name="pin" size={13} />{o.state}</span>
            </div>
            {o.inDays !== undefined && (
              <span className="dash-pill" style={o.inDays <= 14
                ? { background: 'var(--zm-copper-soft)', color: 'var(--zm-copper)' }
                : { background: 'var(--zm-surface-sunken)', color: 'var(--zm-fg-2)' }}>
                {o.inDays <= 0 ? 'today' : `in ${o.inDays} d`}
              </span>
            )}
          </div>
        ))}
      </div>
      <Source>nso_reviews.launch_date · launch_approvals.status</Source>
    </Card>
  );
}

function Modules({ mods }) {
  const [i, setI] = React.useState(0);
  const [active, setActive] = React.useState(null);
  const m = mods[i];
  const total = m.parts.reduce((s, p) => s + p.value, 0);
  return (
    <Card>
      <CardHead icon="layers" tone="blue" title="Where sites stand" sub={`${total} sites in ${m.name}`}
        right={mods.length > 1 ? <ChipTabs label="Module" value={i} onChange={(k) => { setI(k); setActive(null); }} items={mods.map((x, k) => ({ key: k, label: x.name }))} /> : null} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="dash-num" style={{ fontSize: 34 }}><CountUp value={active === null ? total : m.parts[active].value} /></span>
        <span className="dash-sub">{active === null ? 'sites' : `${m.parts[active].label} · ${Math.round((m.parts[active].value / (total || 1)) * 100)}%`}</span>
      </div>
      <StackedBar key={m.name} parts={m.parts} active={active} label={`Sites by status in ${m.name}`} />
      <Legend parts={m.parts} showPct active={active} onActive={setActive} />
      <Source>{m.source}</Source>
    </Card>
  );
}

function Cycle({ c }) {
  return (
    <Card>
      <CardHead icon="clock" tone="orange" title="Time per step" sub={c.sub} />
      <Lollipops rows={c.steps} />
      <Source>step timestamps on sites · stage_events</Source>
    </Card>
  );
}

function Cities({ cities }) {
  const [i, setI] = React.useState(0);
  const c = cities[i];
  const total = c.launched + c.pipeline;
  const all = cities.reduce((s, x) => s + x.launched + x.pipeline, 0);
  return (
    <Card flush>
      <div style={{ position: 'relative', minHeight: 290, display: 'flex', flexWrap: 'wrap' }}>
        <PhotoReel photos={cityPhotos(c.name)} label={`Photos of ${c.name}`} />
        <div className="dash-reel-text" style={{ position: 'relative', flex: '0 1 620px', padding: 26, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <CardHead icon="pin" tone="blue" title="City spotlight" sub={`${cities.length} cities · pick one`} />
          <div style={{ maxWidth: 560 }}>
            <ChipTabs label="City" value={i} onChange={setI} items={cities.map((x, k) => ({ key: k, label: x.name, count: x.launched + x.pipeline }))} />
          </div>
          <span style={{ fontFamily: 'var(--zm-font-display)', fontWeight: 800, fontSize: 32 }}>{c.name}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14, maxWidth: 520 }}>
            <CityStat label="Sites" value={total} /><CityStat label="Opened" value={c.launched} />
            <CityStat label="In pipeline" value={c.pipeline} /><CityStat label="Rent / sq ft" value={c.rent} />
          </div>
          <div style={{ maxWidth: 460 }}>
            <SplitTrack height={12} parts={[{ label: 'Opened', value: c.launched, color: 'var(--zm-info)' }, { label: 'Pipeline', value: c.pipeline, color: 'var(--zm-info-soft)' }]} />
          </div>
          <span className="dash-sub">Share of the portfolio: {Math.round((total / all) * 100)}%</span>
        </div>
      </div>
    </Card>
  );
}

function CityStat({ label, value }) {
  return <div className="dash-col"><span className="dash-sub">{label}</span><span className="dash-num" style={{ fontSize: 24 }}>{value}</span></div>;
}

function Compliance({ c }) {
  return (
    <Card>
      <CardHead icon="shield" tone="red" title={c.title || 'Needs attention'} sub={c.sub} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
        {c.alerts.map((a) => (
          <div key={a.label} style={{ borderRadius: 16, padding: 14, background: TONE[a.tone].bg, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="dash-num" style={{ fontSize: 30, color: TONE[a.tone].fg }}>{a.n}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--zm-fg-2)' }}>{a.label}</span>
          </div>
        ))}
      </div>
      <Source>{c.source}</Source>
    </Card>
  );
}

function Licences({ l }) {
  return (
    <Card>
      <CardHead icon="licence" tone="green" title="Licences" sub={`On the ${l.of} opened and opening cafés`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {l.rows.map(([name, y, p, n]) => (
          <div key={name} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0,1fr) 40px', gap: 10, alignItems: 'center' }}>
            <span className="dash-lbl" style={{ fontSize: 13 }}>{name}</span>
            <SplitTrack height={9} parts={[{ label: 'Have it', value: y, color: 'var(--zm-success)' }, { label: 'Pending', value: p, color: 'var(--zm-warning)' }, { label: 'Refused', value: n, color: 'var(--zm-danger)' }]} />
            <span style={{ fontSize: 12, textAlign: 'right', fontWeight: 700 }}>{y}/{l.of}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--zm-fg-2)', flexWrap: 'wrap' }}>
        <Key color="var(--zm-success)">Have it</Key><Key color="var(--zm-warning)">Pending</Key><Key color="var(--zm-danger)">Refused</Key>
      </div>
      <Source>site_licensing: fssai, health_trade, shops_estab_reg, fire_noc, storage_license</Source>
    </Card>
  );
}

const DOT = { orange: TONE.orange.fg, blue: TONE.blue.fg, purple: TONE.purple.fg, green: TONE.green.fg, red: TONE.red.fg };

function Timeline({ t }) {
  return (
    <Card>
      <CardHead icon="doc" tone="purple" title={t.title} sub={t.sub} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', paddingLeft: 18 }}>
        <div style={{ position: 'absolute', left: 5, top: 8, bottom: 8, width: 2, background: 'var(--zm-line)' }} />
        {t.items.map((e) => (
          <div key={e.date + e.what} style={{ position: 'relative', padding: '8px 0' }}>
            <span style={{ position: 'absolute', left: -18, top: 13, width: 12, height: 12, borderRadius: '50%', background: DOT[e.tone], border: '2px solid var(--zm-surface)' }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: DOT[e.tone] }}>{e.date}</span>
            <p style={{ margin: '2px 0 0', fontSize: 13.5, fontWeight: 600 }}>{e.what}</p>
            <p className="dash-sub" style={{ fontSize: 12 }}>{e.site}</p>
          </div>
        ))}
      </div>
      <Source>{t.source}</Source>
    </Card>
  );
}

function Money({ m }) {
  return (
    <Card variant="dark" flush>
      <div style={{ position: 'relative', display: 'flex', minHeight: '100%' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(36,23,15,.97) 0%, rgba(36,23,15,.86) 55%, rgba(36,23,15,.45) 100%)' }} />
        <div style={{ position: 'relative', padding: 26, display: 'flex', flexDirection: 'column', gap: 18, width: '100%', boxSizing: 'border-box' }}>
          <div className="dash-head">
            <span className="dash-ico" style={{ background: 'rgba(255,211,168,.16)', color: '#FFD3A8' }}><Ico name="rupee" /></span>
            <div className="dash-col"><h2 className="dash-title">Commercials</h2><p className="dash-sub">Committed terms across opened cafés</p></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20 }}>
            {m.map((x) => (
              <div key={x.label} className="dash-col" style={{ gap: 4 }}>
                <span style={{ fontSize: 12, color: '#C9B49F' }}>{x.label}</span>
                <span className="dash-num" style={{ fontSize: 28, color: '#FFF6EC' }}>{x.value}</span>
                <span style={{ fontSize: 11.5, color: '#A8927C' }}>{x.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Budget({ b }) {
  const max = Math.max(...b.flatMap(([, g, c]) => [g, c]));
  return (
    <Card>
      <CardHead icon="chart" tone="blue" title="Budget vs closure" sub="Approved budget against final spend (₹ lakh)" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {b.map(([head, g, c]) => {
          const pct = Math.round(((c - g) / g) * 100);
          return (
            <div key={head} style={{ display: 'grid', gridTemplateColumns: '84px minmax(0,1fr) 48px', gap: 10, alignItems: 'center' }}>
              <span className="dash-lbl" style={{ fontSize: 13 }}>{head}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Track pct={(g / max) * 100} height={7} color="var(--zm-info-soft)" />
                <Track pct={(c / max) * 100} height={7} color="#E07A2F" />
              </div>
              <span style={{ fontSize: 12, textAlign: 'right', fontWeight: 700, color: pct > 0 ? 'var(--zm-danger)' : 'var(--zm-success)' }}>{pct > 0 ? '+' : ''}{pct}%</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--zm-fg-2)' }}><Key color="var(--zm-info-soft)">Budget</Key><Key color="#E07A2F">Closure</Key></div>
      <Source>site_budgets gfc vs closure · site_budget_items by head</Source>
    </Card>
  );
}

function People({ p }) {
  return (
    <Card>
      <CardHead icon="users" tone="green" title="Seats & teams" sub={`${p.seats[0]} of ${p.seats[1]} seats used`} />
      <Track pct={(p.seats[0] / p.seats[1]) * 100} height={12} color="var(--zm-success)" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {p.teams.map(([name, n]) => (
          <span key={name} className="dash-pill" style={{ background: 'var(--zm-surface-sunken)', color: 'var(--zm-fg)', padding: '7px 12px' }}>{name}<strong>{n}</strong></span>
        ))}
      </div>
      <Source>tenants.seat_limit · users.is_active · user_module_memberships</Source>
    </Card>
  );
}

function Workload({ w }) {
  const max = Math.max(...w.rows.map((r) => r.n));
  return (
    <Card>
      <CardHead icon="briefcase" tone="orange" title={w.title || 'Executive workload'} sub="Active site assignments" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {w.rows.map((r) => (
          <div key={r.ini + r.role} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) 26px', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--zm-copper-soft)', color: 'var(--zm-fg)', font: '700 12px var(--zm-font-body)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.ini}</span>
            <div className="dash-col" style={{ gap: 4 }}>
              <span style={{ fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{r.role}</span>
              <Track pct={(r.n / max) * 100} height={7} color={r.n >= 8 ? 'var(--zm-copper)' : 'color-mix(in srgb, var(--zm-accent) 55%, var(--zm-surface-sunken))'} />
            </div>
            <span className="dash-num" style={{ fontSize: 15, textAlign: 'right' }}>{r.n}</span>
          </div>
        ))}
      </div>
      <Source>site_delegations (active) · allocated_to on budgets and projects</Source>
    </Card>
  );
}

function Activity({ a }) {
  return (
    <Card>
      <CardHead icon="pulse" tone="blue" title="Activity" sub={a.sub} />
      <Heatmap cells={a.cells} today={a.today} />
      {a.pills && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {a.pills.map(([text, tone]) => <span key={text} className="dash-pill" style={{ background: TONE[tone].bg, color: TONE[tone].fg }}>{text}</span>)}
        </div>
      )}
      <Source>audit_logs{a.pills ? ' · notification_outbox.status' : ''}</Source>
    </Card>
  );
}

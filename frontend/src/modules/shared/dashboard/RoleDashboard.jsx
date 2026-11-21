// skipcq: JS-0833
import React from 'react';
import {
  Bars, Card, CardHead, ChipTabs, Donut, FreshnessBadge, Funnel, Heatmap, Ico, Legend, Source, SplitTrack, TONE, Track,
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

export default function RoleDashboard({ data, updatedAt, scope, onScope }) {
  const d = data;
  return (
    <div className="dash">
      <Hero d={d} updatedAt={updatedAt} scope={scope} onScope={onScope} />
      {d.empty && <Empty e={d.empty} />}

      {(d.inbox || d.readiness) && (
        <div className="dash-grid2">
          {d.inbox && <Inbox inbox={d.inbox} />}
          {d.readiness && <Readiness r={d.readiness} />}
        </div>
      )}

      {d.launches && (
        <>
          <p className="dash-sec">Openings</p>
          <div className="dash-grid3">
            <Launches l={d.launches} />
            {d.openings && <Openings items={d.openings} />}
          </div>
        </>
      )}

      {d.funnel && (
        <>
          <p className="dash-sec">{d.funnel.section || 'Pipeline'}</p>
          <Card>
            <CardHead icon="funnel" tone="purple" title={d.funnel.title} sub="Pick a step to see how sites move through it" />
            <Funnel steps={d.funnel.steps} photo={PHOTO.cup} />
            <Source>{d.funnel.source}</Source>
          </Card>
        </>
      )}

      {(d.modules || d.cycle) && (
        <div className="dash-grid2">
          {d.modules && <Modules mods={d.modules} />}
          {d.cycle && <Cycle c={d.cycle} />}
        </div>
      )}

      {d.cities && (
        <>
          <p className="dash-sec">Cities</p>
          <Cities cities={d.cities} />
        </>
      )}

      {(d.compliance || d.licences || d.timeline) && (
        <>
          <p className="dash-sec">{d.timeline?.section || 'Compliance & leases'}</p>
          <div className="dash-grid3">
            {d.compliance && <Compliance c={d.compliance} />}
            {d.licences && <Licences l={d.licences} />}
            {d.timeline && <Timeline t={d.timeline} />}
          </div>
        </>
      )}

      {d.money && (
        <>
          <p className="dash-sec">Money</p>
          <div className="dash-grid2">
            <Money m={d.money} />
            {d.budget && <Budget b={d.budget} />}
          </div>
        </>
      )}

      {(d.people || d.workload || d.activity) && (
        <>
          <p className="dash-sec">{d.people ? 'People & activity' : 'Team & activity'}</p>
          <div className="dash-grid3">
            {d.people && <People p={d.people} />}
            {d.workload && <Workload w={d.workload} />}
            {d.activity && <Activity a={d.activity} />}
          </div>
        </>
      )}
    </div>
  );
}

function Hero({ d, updatedAt, scope, onScope }) {
  const h = d.hero;
  return (
    <section className="dash-hero">
      <img src={PHOTO.hero} alt="A barista pouring latte art into a white cup" />
      <div className="dash-hero-shade" />
      <div className="dash-hero-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="dash-eyebrow" style={{ color: '#E9C9A6' }}>{h.eyebrow}</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {d.simulated && <span className="dash-pill" style={{ background: 'rgba(224,122,47,.32)', color: '#FFF6EC' }}>Simulated view</span>}
            {d.scopes && (
              <div style={{ display: 'flex', background: 'rgba(255,246,236,.14)', borderRadius: 999, padding: 3 }} role="group" aria-label="Scope">
                {d.scopes.map((s) => (
                  <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => onScope?.(s.key)}
                    style={{ border: 0, borderRadius: 999, padding: '8px 14px', minHeight: 36, cursor: 'pointer', font: '600 12.5px var(--zm-font-body)', background: scope === s.key ? '#FFF6EC' : 'transparent', color: scope === s.key ? '#24170F' : '#FFF6EC' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <FreshnessBadge updatedAt={updatedAt} onDark />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1>{h.title}</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: '#E9DCCB', maxWidth: 560 }}>{h.lede}</p>
        </div>
        <div className="dash-grid4">
          {d.kpis.map((k) => (
            <button key={k.key} type="button" className={`dash-glass${k.hot ? ' dash-glass--hot' : ''}`}>
              <span className="dash-eyebrow" style={{ color: k.hot ? '#FFD3A8' : '#E9C9A6', fontSize: 10.5 }}>{k.label}</span>
              <span className="dash-num" style={{ fontSize: 38 }}>{k.value}</span>
              <span style={{ fontSize: 12.5, color: '#E9DCCB' }}>{k.caption}</span>
            </button>
          ))}
        </div>
      </div>
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
        {e.cta && (
          <button type="button" className="dash-chip" aria-pressed="true" style={{ marginTop: 4 }}>
            <Ico name="plus" size={16} />{e.cta}
          </button>
        )}
      </div>
    </Card>
  );
}

const KIND_TONE = { design: 'blue', payment: 'orange', quality: 'purple', loi: 'red', change: 'neutral', budget: 'green' };

function Inbox({ inbox }) {
  const [tab, setTab] = React.useState('all');
  const kinds = [...new Set(inbox.items.map((i) => i.key))];
  const tabs = [{ key: 'all', label: 'All', count: inbox.items.length }].concat(
    kinds.map((k) => ({ key: k, label: inbox.items.find((i) => i.key === k).kind, count: inbox.items.filter((i) => i.key === k).length })),
  );
  const rows = inbox.items.filter((i) => tab === 'all' || i.key === tab);
  return (
    <Card id="inbox">
      <CardHead icon="inbox" tone="orange" title={inbox.title} sub={inbox.sub}
        right={inbox.items.length > 0 ? <ChipTabs label="Filter" items={tabs} value={tab} onChange={setTab} /> : null} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.length === 0 && <p className="dash-sub">Nothing waiting on you. Nice.</p>}
        {rows.map((a) => {
          const t = TONE[KIND_TONE[a.key] || 'neutral'];
          return (
            <a key={a.code + a.kind} href="#inbox" className="dash-row-link">
              <span className="dash-ico" style={{ background: t.bg, color: t.fg }}><Ico name="store" /></span>
              <div className="dash-col" style={{ flex: '1 1 200px' }}>
                <span style={{ fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 16.5 }}>{a.name}</span>
                <span className="dash-sub"><span style={{ fontFamily: 'var(--zm-font-mono)' }}>{a.code}</span> · {a.city}</span>
              </div>
              <span className="dash-pill" style={{ background: t.bg, color: t.fg }}>{a.kind}</span>
              <span className="dash-sub" style={{ width: 70, textAlign: 'right' }}>{a.age}</span>
              <span style={{ color: 'var(--zm-fg-3)' }}><Ico name="chevron" size={18} /></span>
            </a>
          );
        })}
      </div>
      <Source>{inbox.source}</Source>
    </Card>
  );
}

function Readiness({ r }) {
  return (
    <Card variant="green" photo={PHOTO.cafe} photoOpacity={0.3}>
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
  const bars = past.map(([m, v]) => ({ key: `p${m}`, label: m, value: v }))
    .concat(l.ahead.map(([m, v]) => ({ key: `a${m}`, label: `${m} ›`, value: v, ahead: true })));
  const opened = past.reduce((s, [, v]) => s + v, 0);
  const planned = l.ahead.reduce((s, [, v]) => s + v, 0);
  return (
    <Card className="dash-span2" photo={PHOTO.beans} photoOpacity={0.22}>
      <CardHead icon="rocket" tone="blue" title="Cafés opened & opening"
        sub={`${opened} opened in the last ${range} months · ${planned} planned ahead`}
        right={<ChipTabs label="Period" value={range} onChange={setRange}
          items={[3, 6, 12].map((r) => ({ key: r, label: `${r}M` }))} />} />
      <Bars bars={bars} color="var(--zm-info)" label="Cafés opened per month and planned openings" />
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--zm-fg-2)', flexWrap: 'wrap' }}>
        <Key color="var(--zm-info)">Opened</Key><Key color="#F2B27A">Planned (NSO launch date)</Key>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((o) => (
          <div key={o.site} style={{ display: 'grid', gridTemplateColumns: '54px minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
            <div style={{ borderRadius: 14, background: TONE[o.tone || 'neutral'].bg, padding: '7px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="dash-num" style={{ fontSize: 19 }}>{o.d}</span>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--zm-fg-2)' }}>{o.m}</span>
            </div>
            <div className="dash-col"><span className="dash-lbl" style={{ fontWeight: 600 }}>{o.site}</span><span className="dash-sub">{o.state}</span></div>
          </div>
        ))}
      </div>
      <Source>nso_reviews.launch_date · launch_approvals.status</Source>
    </Card>
  );
}

function Modules({ mods }) {
  const [i, setI] = React.useState(0);
  const m = mods[i];
  const total = m.parts.reduce((s, p) => s + p.value, 0);
  return (
    <Card>
      <CardHead icon="layers" tone="blue" title="Where sites stand" sub={`${total} sites in ${m.name}`}
        right={mods.length > 1 ? <ChipTabs label="Module" value={i} onChange={setI} items={mods.map((x, k) => ({ key: k, label: x.name }))} /> : null} />
      <div style={{ display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap' }}>
        <Donut parts={m.parts} size={170} center={total} sub="sites" label={`Sites by status in ${m.name}`} />
        <Legend parts={m.parts} showPct />
      </div>
      <Source>{m.source}</Source>
    </Card>
  );
}

function Cycle({ c }) {
  const max = Math.max(...c.steps.map((s) => s.days));
  return (
    <Card>
      <CardHead icon="clock" tone="orange" title="Time per step" sub={c.sub} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {c.steps.map((s) => (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px', gap: 10, alignItems: 'center' }}>
            <div className="dash-col" style={{ gap: 5 }}>
              <span className="dash-lbl">{s.label}</span>
              <Track pct={(s.days / max) * 100} height={8} color={s.days === max ? '#E07A2F' : '#A08AE7'} />
            </div>
            <span className="dash-num" style={{ fontSize: 15, textAlign: 'right' }}>{s.days}d</span>
          </div>
        ))}
      </div>
      {c.callout && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--zm-copper)', background: 'var(--zm-copper-soft)', borderRadius: 12, padding: '10px 12px' }}>{c.callout}</p>}
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
        <img className="dash-fade-right" src={PHOTO.cafe} alt="A bright café interior with plants and tables" />
        <div style={{ position: 'relative', flex: '1 1 460px', padding: 26, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
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
          <p className="dash-src" style={{ maxWidth: 520 }}>sites.city · is_launched · site_details rent / carpet area</p>
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
            <SplitTrack height={9} parts={[{ label: 'Have it', value: y, color: 'var(--zm-success)' }, { label: 'Pending', value: p, color: '#E8B23A' }, { label: 'Refused', value: n, color: 'var(--zm-danger)' }]} />
            <span style={{ fontSize: 12, textAlign: 'right', fontWeight: 700 }}>{y}/{l.of}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--zm-fg-2)', flexWrap: 'wrap' }}>
        <Key color="var(--zm-success)">Have it</Key><Key color="#E8B23A">Pending</Key><Key color="var(--zm-danger)">Refused</Key>
      </div>
      <Source>site_licensing: fssai, health_trade, shops_estab_reg, fire_noc, storage_license</Source>
    </Card>
  );
}

const DOT = { orange: '#E07A2F', blue: '#2F5FD0', purple: '#5A3FC0', green: '#1C7A52', red: '#C4413A' };

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
        <img src={PHOTO.cup} alt="Roasted coffee beans in a white cup" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.38 }} />
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
          <p className="dash-src">site_details: fixed_rent_amt, cam_charges, capex, security_deposit · sites.finance_amount</p>
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
              <Track pct={(r.n / max) * 100} height={7} color={r.n >= 8 ? '#E07A2F' : '#A08AE7'} />
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
      <Heatmap cells={a.cells} />
      {a.pills && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {a.pills.map(([text, tone]) => <span key={text} className="dash-pill" style={{ background: TONE[tone].bg, color: TONE[tone].fg }}>{text}</span>)}
        </div>
      )}
      <Source>audit_logs{a.pills ? ' · notification_outbox.status' : ''}</Source>
    </Card>
  );
}

// skipcq: JS-0833
// Turns a /dashboard/summary (or /nso/summary) payload into what RoleDashboard
// draws. The server decides which sections a role may see; this only reshapes
// the sections that are present and never adds one that is missing.

export const MODULE_LABEL = {
  bd: 'BD', legal: 'Legal', design: 'Design', project: 'Project', nso: 'NSO',
  project_excellence: 'Project Excellence',
};

// Okabe-Ito re-tuned to the café palette: colour-blind safe, >= 3:1 on cards.
const PART_COLORS = ['#2F5FD0', '#C2551B', '#12866C', '#B37A0A', '#A3548A', '#4F97CF', '#8A7462'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LABEL = {
  draft_submitted: 'Draft', shortlisted: 'Shortlisted', details_submitted: 'Details in', approved: 'Approved',
  loi_uploaded: 'LOI uploaded', legal_review: 'Legal review', legal_approved: 'Legal cleared',
  legal_rejected: 'Legal rejected', pushed_to_payments: 'Payments', awaiting_admin: 'Awaiting admin',
  awaiting_supervisor: 'Awaiting supervisor', in_review: 'In review', in_progress: 'In progress',
};

const STEP_NOTE = {
  drafted: 'Every site a BD executive puts forward.',
  shortlisted: 'A supervisor kept it for a closer look.',
  details: 'Full details submitted for approval.',
  approved: 'Deal approved; the LOI clock starts.',
  loi: 'Letter of intent signed and uploaded.',
  legal_review: 'Due diligence and agreements under review.',
  legal_approved: 'Legal cleared the site.',
  payments: 'Handed to payments.',
  launched: 'The café is open.',
};

const KPI_CAPTION = {
  total: 'in the workspace', awaiting: 'waiting for a decision', launched: 'opened', open: 'still moving',
  in_module: 'in this module', team: 'executives', mine: 'submitted, assigned or delegated', moved: 'changed in the last 7 days',
  done: 'opened',
};

export const pretty = (s) => STATUS_LABEL[s] || String(s || 'pending').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const initials = (name) => String(name || '?').split(/[\s(]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const inr = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

const age = (days) => {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
};

function parseDay(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function hero(p, mod) {
  const pending = p.inbox?.total ?? p.inbox?.items?.length ?? 0;
  if (p.role === 'admin') {
    return {
      eyebrow: 'Business admin · whole workspace',
      title: 'Your café portfolio, from first look to opening day.',
      lede: pending ? `${pending} item${pending === 1 ? '' : 's'} waiting for your sign-off.` : 'Nothing is waiting for your sign-off.',
    };
  }
  if (p.role === 'supervisor') {
    return {
      eyebrow: `${mod} · supervisor${p.scope === 'team' ? ' · my team' : ''}`,
      title: `${mod} at a glance.`,
      lede: pending ? `${pending} site${pending === 1 ? ' is' : 's are'} waiting on you.` : 'Nothing is waiting on you right now.',
    };
  }
  return {
    eyebrow: `${mod} · executive · your work`,
    title: 'Here’s your week.',
    lede: pending
      ? `${pending} site${pending === 1 ? ' needs' : 's need'} your next step.`
      : 'Only your own sites and the ones delegated to you.',
  };
}

// Every hero tile is styled the same: a single orange "hot" tile read as a
// mistake rather than an alert, and the inbox right below already says what
// is waiting.
function kpis(p) {
  return (p.kpis?.tiles || []).map((t) => ({
    key: t.key, label: t.label, value: t.value, caption: t.caption || KPI_CAPTION[t.key] || '',
  }));
}

function inbox(p) {
  const i = p.inbox;
  if (!i) return undefined;
  if (i.queues) {
    return {
      title: 'Waiting on you', sub: `${i.total} across ${i.queues.filter((q) => q.count).length} queues`, source: 'admin approval queues',
      items: i.queues.filter((q) => q.count > 0).map((q) => ({
        id: q.key, code: `${q.count} waiting`, name: q.label, city: q.oldest_days === null ? '' : `oldest ${age(q.oldest_days)}`,
        kind: q.label, key: q.key, age: age(q.oldest_days),
      })),
    };
  }
  if (i.items) {
    return {
      title: p.role === 'executive' ? 'Your next steps' : 'Waiting on you',
      sub: `${i.total} in total · oldest first`, source: (i.source || []).join(' · '),
      items: i.items.map((s) => {
        const kind = s.reason || pretty(s.status);
        return { id: s.site_id, code: s.code || kind, name: s.name, city: s.city, kind, key: kind, age: age(s.waiting_days) };
      }),
    };
  }
  // Executive: their own pending items.
  const items = (p.compliance?.loi_items || []).map((s) => ({
    id: `loi-${s.site_id}`, code: s.code ? `${s.code} · LOI by ${s.deadline}` : `LOI by ${s.deadline}`, name: s.name, city: s.city, kind: 'LOI due', key: 'loi', age: '',
  }));
  if (i.change_requests_pending) {
    items.push({ id: 'change-requests', code: `${i.change_requests_pending} open`, name: 'Change requests you raised', city: 'Legal', kind: 'Change request', key: 'change', age: '' });
  }
  return { title: 'Your next steps', sub: 'Sorted by deadline', source: 'your sites · approvals.loi_deadline · legal_change_requests', items };
}

function launches(p) {
  const l = p.launches;
  if (!l) return {};
  const now = new Date();
  const opened = new Map((l.by_month || []).map((r) => [String(r.month).slice(0, 7), r.opened]));
  const past = [];
  for (let k = 11; k >= 0; k -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    past.push([MONTHS[d.getUTCMonth()], opened.get(d.toISOString().slice(0, 7)) || 0, `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`]);
  }
  const ahead = [];
  for (let k = 1; k <= 3; k += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const key = d.toISOString().slice(0, 7);
    ahead.push([MONTHS[d.getUTCMonth()], (l.upcoming || []).filter((u) => String(u.launch_date).slice(0, 7) === key).length, `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`]);
  }
  const openings = (l.upcoming || []).map((u) => {
    const d = parseDay(u.launch_date);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const inDays = Math.round((d.getTime() - today) / 86400000);
    return { site: u.name, d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()], state: u.city, tone: 'orange', inDays };
  });
  return { launches: { past, ahead }, openings: openings.length ? openings : undefined };
}

function funnel(p, mod) {
  const f = p.funnel;
  if (!f) return undefined;
  const cyc = new Map((p.cycle_times?.steps || []).map((s) => [s.from, s.median_days]));
  return {
    section: f.module ? `${mod} stages` : 'Pipeline',
    title: f.module ? `${mod} sites by stage` : 'From first look to opening day',
    source: (f.source || []).join(' · '),
    steps: f.steps.map((s) => ({
      label: s.label, value: s.count, days: cyc.get(s.key) ?? 0, note: STEP_NOTE[s.key] || `${s.count} site${s.count === 1 ? '' : 's'} at this stage.`,
    })),
  };
}

function modules(p) {
  const items = p.modules?.items;
  if (!items?.length) return undefined;
  return items.map((m) => ({
    name: m.label,
    source: (p.modules.source || []).join(' · '),
    parts: m.statuses.length
      ? m.statuses.map((s, k) => ({ label: pretty(s.status), value: s.count, color: PART_COLORS[k % PART_COLORS.length] }))
      : [{ label: 'No sites yet', value: 0, color: '#C9BBAA' }],
  }));
}

function cycle(p) {
  const steps = (p.cycle_times?.steps || []).filter((s) => s.median_days !== null).map((s) => ({ label: s.label, days: s.median_days }));
  if (!steps.length) return undefined;
  const slow = steps.reduce((a, b) => (b.days > a.days ? b : a));
  return { sub: 'Median days between steps', steps, callout: `Slowest step: ${slow.label} (${slow.days} days).` };
}

function cities(p) {
  const items = p.cities?.items;
  if (!items?.length) return undefined;
  return items.map((c) => ({ name: c.city, launched: c.launched, pipeline: c.pipeline, rent: c.rent_psf === null ? '—' : `₹${Math.round(c.rent_psf)}` }));
}

function compliance(p) {
  const c = p.compliance;
  if (!c) return undefined;
  return {
    title: 'Needs attention', sub: p.role === 'executive' ? 'On your sites' : 'Across the sites you can see',
    source: (c.source || []).join(' · '),
    alerts: [
      { n: c.loi_overdue, label: 'LOIs overdue', tone: 'red' },
      { n: c.loi_due_7d, label: 'LOIs due in 7 days', tone: 'orange' },
      { n: c.dd_negative, label: 'DD negative', tone: 'red' },
      { n: c.legal_rejected, label: 'Legal rejected', tone: 'red' },
    ],
  };
}

function money(p) {
  const m = p.money;
  if (!m) return {};
  const out = {
    money: [
      { label: 'Rent, opened cafés', value: inr(m.rent_live), note: 'expected monthly rent' },
      { label: 'Rent, pipeline', value: inr(m.rent_pipeline), note: 'sites not yet open' },
      { label: 'Finance approved', value: inr(m.finance_approved), note: 'approved by finance' },
      { label: 'Finance pending', value: inr(m.finance_pending), note: 'awaiting a decision' },
    ],
  };
  const phase = Object.fromEntries((m.budgets || []).map((b) => [b.phase, b.total]));
  if (phase.gfc > 0 && phase.closure > 0) out.budget = [['All sites', phase.gfc / 1e5, phase.closure / 1e5]];
  return out;
}

function people(p) {
  const r = p.people?.roles;
  if (!r) return undefined;
  const active = r.reduce((s, x) => s + x.active, 0);
  const limit = Math.max(p.people.seat_limit || 0, active, 1);
  return { seats: [active, limit], teams: r.filter((x) => x.active).map((x) => [pretty(x.role), x.active]) };
}

function workload(p) {
  const items = p.workload?.items;
  if (!items?.length) return undefined;
  return { title: p.role === 'admin' ? 'Executive workload' : 'Team workload', rows: items.map((w) => ({ ini: initials(w.name), role: w.name, n: w.open_sites })) };
}

// 7 rows (Mon..Sun) × 12 weeks, row-major, levels 0-3, the shape Heatmap draws.
export function activityCells(days, today = new Date()) {
  const counts = new Map((days || []).map((d) => [String(d.date).slice(0, 10), d.count]));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) - 7 * 11);
  const cells = new Array(84).fill(0);
  for (let i = 0; i < 84; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const n = counts.get(d.toISOString().slice(0, 10)) || 0;
    const wk = Math.floor(i / 7);
    const day = i % 7;
    cells[day * 12 + wk] = n === 0 ? 0 : n <= 2 ? 1 : n <= 6 ? 2 : 3;
  }
  return cells;
}

function activity(p) {
  const a = p.activity;
  if (!a) return undefined;
  const total = (a.days || []).reduce((s, d) => s + d.count, 0);
  const who = p.role === 'executive' ? 'Your actions' : p.role === 'admin' ? 'Actions' : 'Module actions';
  const now = new Date();
  const todayRow = (now.getUTCDay() + 6) % 7; // Monday = 0, matching activityCells
  return { sub: `${who} per day · last 12 weeks · ${total} in total`, cells: activityCells(a.days), today: todayRow * 12 + 11 };
}

function empty(p, mod) {
  if (p.notice) return { title: p.notice.title, body: p.notice.body };
  if (p.role !== 'executive') return undefined;
  const sites = (p.funnel?.steps || []).reduce((n, st) => n + st.count, 0);
  if (sites > 0 || (p.inbox?.total || 0) > 0) return undefined;
  return p.module === 'bd'
    ? { title: 'No sites yet', body: 'Sites you submit or are assigned will show up here with their next steps.', cta: 'Create a pipeline' }
    : { title: `No ${mod} sites delegated to you yet`, body: 'When your supervisor delegates a site to you, it appears here.' };
}

export function toViewModel(p) {
  if (!p) return null;
  const mod = MODULE_LABEL[p.module] || 'Workspace';
  const vm = {
    hero: hero(p, mod),
    kpis: kpis(p),
    simulated: p.simulated,
    scopes: p.role === 'supervisor' && !p.simulated && p.module !== 'nso'
      ? [{ key: 'module', label: 'Whole module' }, { key: 'team', label: 'My team' }] : undefined,
    empty: empty(p, mod),
    inbox: inbox(p),
    ...launches(p),
    funnel: funnel(p, mod),
    modules: modules(p),
    cycle: cycle(p),
    cities: cities(p),
    compliance: compliance(p),
    ...money(p),
    people: people(p),
    workload: workload(p),
    activity: activity(p),
  };
  if (vm.empty) {
    delete vm.funnel;
    delete vm.cities;
  }
  return vm;
}

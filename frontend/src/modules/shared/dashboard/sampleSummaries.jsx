// Sample /dashboard/summary payloads for the dev-only preview page. Shaped
// exactly like the planned endpoint, so the same RoleDashboard renders real
// data once the backend lands. The four admin tiles and the four approval rows
// match what the live Business Admin page shows today; everything else is made up.

function heat(seed) {
  const cells = [];
  for (let day = 0; day < 7; day += 1) {
    for (let wk = 0; wk < 12; wk += 1) {
      const v = (day * 7 + wk * 13 + ((wk * day + seed) % 5)) % 9;
      cells.push(day >= 5 ? (v > 6 ? 1 : 0) : (v < 2 ? 1 : (v < 6 ? 2 : 3)));
    }
  }
  return cells;
}

const PAST = [['Nov', 0], ['Dec', 1], ['Jan', 0], ['Feb', 1], ['Mar', 0], ['Apr', 1], ['May', 0], ['Jun', 1], ['Jul', 0], ['Aug', 1], ['Sep', 1], ['Oct', 0]];

const BD_FUNNEL = [
  { label: 'Draft submitted', value: 280, days: 6, note: 'Every site a BD executive puts forward.' },
  { label: 'Shortlisted', value: 214, days: 11, note: 'A supervisor kept it for a closer look.' },
  { label: 'Approved', value: 152, days: 15, note: 'Details in and the deal approved; the LOI clock starts.' },
  { label: 'LOI uploaded', value: 118, days: 22, note: 'Letter of intent signed and uploaded.' },
  { label: 'Legal approved', value: 86, days: 9, note: 'Due diligence positive and licensing complete.' },
  { label: 'Finance approved', value: 71, days: 34, note: 'Payment approved by the business admin.' },
  { label: 'Design GFC', value: 42, days: 46, note: 'Drawings good for construction.' },
  { label: 'Project done', value: 9, days: 18, note: 'Build complete and quality audit cleared.' },
  { label: 'Opened', value: 6, days: 0, note: 'The café is open.' },
];

const MODULES = [
  { name: 'Legal', source: 'sites.legal_dd_status', parts: [{ label: 'Pending', value: 14, color: '#C9BBAA' }, { label: 'In review', value: 18, color: '#E8B23A' }, { label: 'Positive', value: 86, color: '#1C7A52' }, { label: 'Negative', value: 7, color: '#C4413A' }] },
  { name: 'Design', source: 'sites.design_status', parts: [{ label: 'Allocated', value: 9, color: '#C9BBAA' }, { label: 'In progress', value: 18, color: '#8FB0F0' }, { label: 'GFC pending', value: 2, color: '#E07A2F' }, { label: 'Approved', value: 42, color: '#2F5FD0' }] },
  { name: 'Project', source: 'sites.project_status', parts: [{ label: 'Allocated', value: 8, color: '#C9BBAA' }, { label: 'In progress', value: 25, color: '#8FB0F0' }, { label: 'Done', value: 9, color: '#2F5FD0' }] },
  { name: 'NSO', source: 'nso_reviews.current_stage', parts: [{ label: 'Stage 1', value: 2, color: '#C9BBAA' }, { label: 'Stage 2', value: 3, color: '#8FB0F0' }, { label: 'Stage 3', value: 6, color: '#E07A2F' }, { label: 'Complete', value: 6, color: '#2F5FD0' }] },
  { name: 'Launch', source: 'launch_approvals.status', parts: [{ label: 'Admin review', value: 1, color: '#C9BBAA' }, { label: 'Exec / supervisor', value: 2, color: '#8FB0F0' }, { label: 'Final review', value: 1, color: '#E07A2F' }, { label: 'Ready', value: 2, color: '#1C7A52' }] },
];

const CYCLE = [
  { label: 'Draft → shortlist', days: 6 }, { label: 'Shortlist → approved', days: 11 }, { label: 'Approved → LOI', days: 15 },
  { label: 'LOI → legal approved', days: 22 }, { label: 'Legal → design GFC', days: 34 }, { label: 'GFC → project done', days: 46 },
  { label: 'Project → opening', days: 18 },
];

const CITIES = [
  { name: 'Bengaluru', launched: 2, pipeline: 94, rent: '₹232' }, { name: 'Delhi', launched: 1, pipeline: 40, rent: '₹198' },
  { name: 'Mumbai', launched: 1, pipeline: 43, rent: '₹276' }, { name: 'Hyderabad', launched: 1, pipeline: 31, rent: '₹171' },
  { name: 'Gurugram', launched: 1, pipeline: 20, rent: '₹214' }, { name: 'Pune', launched: 0, pipeline: 21, rent: '₹164' },
  { name: 'Chennai', launched: 0, pipeline: 15, rent: '₹158' }, { name: 'Kolkata', launched: 0, pipeline: 7, rent: '₹149' },
  { name: 'Ahmedabad', launched: 0, pipeline: 4, rent: '₹137' },
];

export const ADMIN = {
  role: 'business_admin',
  hero: {
    eyebrow: 'retailexpansion.in · business admin',
    title: 'Your café portfolio, from first look to opening day.',
    lede: '4 sites are waiting for your approval. 8 cafés have opening dates, and 6 have already opened.',
  },
  kpis: [
    { key: 'total', label: 'Total sites', value: 280, caption: 'in the system' },
    { key: 'awaiting', label: 'Awaiting approval', value: 4, caption: '2 design · 1 payment · 1 quality', hot: true },
    { key: 'completed', label: 'Completed sites', value: 9, caption: 'project done' },
    { key: 'requests', label: 'Pending requests', value: 0, caption: 'workspace access' },
  ],
  inbox: {
    title: 'Waiting on you', sub: 'Approval Center · oldest first',
    source: 'design_deliverables.admin_status · finance_status · site_budgets.status · quality_audit_status',
    items: [
      { code: 'CA-359', name: 'Apollo Hospital - GCR', city: 'Gurugram', kind: 'Design', key: 'design', age: '3 days' },
      { code: 'CA-271', name: 'Indiranagar', city: 'Bengaluru', kind: 'Design', key: 'design', age: '2 days' },
      { code: 'CA-363', name: 'Silver County Road - Kudlu', city: 'Bengaluru', kind: 'Payment', key: 'payment', age: '1 day' },
      { code: 'CAGT-290', name: 'Dwarka - Maxwell - GT', city: 'Delhi', kind: 'Quality', key: 'quality', age: 'today' },
    ],
  },
  readiness: { ready: 2, total: 6, checks: [['Licences in place', 5], ['Launch date set', 5], ['Dry stock received', 4], ['Online delivery live', 3], ['Handover signed', 3], ['Both sign-offs', 2]] },
  launches: { past: PAST, ahead: [['Nov', 2], ['Dec', 3], ['Jan', 2]] },
  openings: [
    { d: '04', m: 'NOV', site: '[Site name] · Bengaluru', state: 'Ready to launch', tone: 'green' },
    { d: '19', m: 'NOV', site: '[Site name] · Mumbai', state: 'Final admin review', tone: 'orange' },
    { d: '06', m: 'DEC', site: '[Site name] · Hyderabad', state: 'With supervisor', tone: 'blue' },
    { d: '15', m: 'DEC', site: '[Site name] · Delhi', state: 'NSO stage 3', tone: 'purple' },
    { d: '—', m: 'TBC', site: '[Site name] · Pune', state: 'Launch date not set', tone: 'neutral' },
  ],
  funnel: { title: 'From first look to opening day', steps: BD_FUNNEL, source: 'sites: draft_submitted_at … shortlisted_at … loi_uploaded_at … launched_at' },
  modules: MODULES,
  cycle: { sub: 'Median days · draft to opening 152 days', steps: CYCLE, callout: 'The longest wait is between design sign-off and project done.' },
  cities: CITIES,
  compliance: {
    sub: 'LOIs, due diligence, agreements', source: 'approved_at + expected_loi_days · legal_dd_status · site_agreement',
    alerts: [{ n: 3, label: 'LOIs overdue', tone: 'red' }, { n: 5, label: 'LOIs due this week', tone: 'orange' }, { n: 7, label: 'Due diligence negative', tone: 'red' }, { n: 4, label: 'Agreements not registered', tone: 'orange' }],
  },
  licences: { of: 15, rows: [['FSSAI', 13, 2, 0], ['Health / trade', 12, 3, 0], ['Shops & estab.', 14, 1, 0], ['Fire NOC', 10, 4, 1], ['Storage', 11, 3, 1]] },
  timeline: {
    title: 'Lease calendar', sub: 'Next 60 days', source: 'site_details.escalation_date · rent_start_date + lock_in / tenure',
    items: [
      { date: '2 Nov', what: 'Rent escalation, 5% (year 3)', site: 'Indiranagar · Bengaluru', tone: 'orange' },
      { date: '9 Nov', what: 'Rent-free period ends', site: 'Silver County Road · Bengaluru', tone: 'blue' },
      { date: '18 Nov', what: 'Lock-in period ends', site: 'Apollo Hospital - GCR · Gurugram', tone: 'purple' },
      { date: '1 Dec', what: 'Rent starts', site: 'Dwarka - Maxwell · Delhi', tone: 'green' },
      { date: '27 Dec', what: 'Lease term ends: renew or exit', site: '[Site name] · Mumbai', tone: 'red' },
    ],
  },
  money: [
    { label: 'Monthly rent committed', value: '₹38.4L', note: 'rent + CAM' }, { label: 'Rent per sq ft', value: '₹208', note: 'average per month' },
    { label: 'Capex approved', value: '₹6.9Cr', note: 'project budgets' }, { label: 'Security deposits', value: '₹1.4Cr', note: 'with landlords' },
    { label: 'Finance approved', value: '₹9.8Cr', note: '71 sites' }, { label: 'Finance pending', value: '₹42L', note: '1 waiting on you' },
  ],
  budget: [['Civil', 96, 104], ['MEP', 78, 81], ['Furniture', 54, 51], ['Equipment', 62, 66], ['Signage', 18, 17], ['Contingency', 12, 9]],
  people: { seats: [41, 50], teams: [['BD', 14], ['Legal', 5], ['Design', 6], ['Project Excellence', 3], ['Project', 7], ['NSO', 4], ['Observers', 2]] },
  workload: { rows: [{ ini: 'RK', role: 'BD executive', n: 9 }, { ini: 'AS', role: 'Legal executive', n: 7 }, { ini: 'MP', role: 'Design executive', n: 6 }, { ini: 'TN', role: 'Project executive', n: 6 }, { ini: 'SD', role: 'NSO supervisor access', n: 2 }] },
  activity: { sub: 'Actions per day · last 12 weeks', cells: heat(0), pills: [['1,204 emails delivered', 'green'], ['7 failed', 'red']] },
};

// A BD supervisor: the BD pipeline only, plus their team. No money or people.
export function bdSupervisor(scope) {
  const team = scope === 'team';
  const k = team ? 0.42 : 1;
  const n = (v) => Math.max(0, Math.round(v * k));
  return {
    role: 'supervisor',
    scopes: [{ key: 'module', label: 'Whole module' }, { key: 'team', label: 'My team' }],
    hero: {
      eyebrow: 'BD · supervisor',
      title: team ? 'Your team’s sites this week.' : 'Every BD site, from draft to payment.',
      lede: team ? '4 executives report to you. 3 shortlisted sites are waiting on your approval.' : '117 sites are in motion across 12 cities. 3 are waiting on your approval.',
    },
    kpis: [
      { key: 'motion', label: 'In motion', value: n(117), caption: team ? 'my team' : 'across 12 cities' },
      { key: 'awaiting', label: 'Awaiting me', value: 3, caption: 'shortlist approvals', hot: true },
      { key: 'payments', label: 'In payments', value: n(47), caption: 'legal · finance' },
      { key: 'team', label: 'My team', value: 4, caption: '1 pending to approve' },
    ],
    inbox: {
      title: 'Waiting on you', sub: 'Shortlisted sites to approve, oldest first', source: 'sites.status = details_submitted · supervisor_id',
      items: [
        { code: 'BT-MUM-SJ2T', name: 'Vikhroli', city: 'Mumbai', kind: 'Approve', key: 'design', age: '3 days' },
        { code: 'BT-PUN-N10T', name: 'Embassy, Phase 1 Hinjewadi', city: 'Pune', kind: 'Approve', key: 'design', age: '3 days' },
        { code: 'BT-AHM-GX40', name: 'Campus corner', city: 'Ahmedabad', kind: 'LOI due', key: 'loi', age: 'in 2 days' },
      ],
    },
    funnel: { title: 'Your BD pipeline', steps: BD_FUNNEL.slice(0, 6).map((s) => ({ ...s, value: n(s.value) })), source: 'sites.*_at · scope: ' + (team ? 'my team' : 'whole module') },
    cycle: { sub: 'Median days in BD', steps: CYCLE.slice(0, 4), callout: 'LOIs take longest: 22 days from upload to legal approval.' },
    cities: CITIES.slice(0, 6).map((c) => ({ ...c, pipeline: n(c.pipeline) })),
    compliance: {
      title: 'LOI deadlines', sub: 'Sites approved but no LOI yet', source: 'sites.approved_at + approvals.expected_loi_days',
      alerts: [{ n: 2, label: 'LOIs overdue', tone: 'red' }, { n: 4, label: 'Due this week', tone: 'orange' }, { n: 83, label: 'Archived / rejected', tone: 'neutral' }, { n: 5, label: 'DDR negative', tone: 'red' }],
    },
    workload: { title: 'Team workload', rows: [{ ini: 'ST', role: 'santoshtiwari', n: 9 }, { ini: 'MO', role: 'monika', n: 6 }, { ini: 'RK', role: 'rahul.k', n: 4 }, { ini: 'AP', role: 'anita.p', n: 3 }] },
    activity: { sub: 'BD actions per day · last 12 weeks', cells: heat(2) },
  };
}

// A Legal supervisor: legal only. No BD numbers, per the scoping rule.
export function legalSupervisor(scope) {
  const team = scope === 'team';
  return {
    role: 'supervisor',
    scopes: [{ key: 'module', label: 'Whole module' }, { key: 'team', label: 'My team' }],
    hero: { eyebrow: 'Legal · supervisor', title: 'Due diligence and licensing, at a glance.', lede: '18 sites are in review. 2 change requests need your decision.' },
    kpis: [
      { key: 'legal', label: 'Sites in legal', value: team ? 51 : 125, caption: team ? 'my team' : 'whole module' },
      { key: 'awaiting', label: 'Awaiting me', value: 4, caption: '2 DD · 2 change requests', hot: true },
      { key: 'positive', label: 'DD positive', value: team ? 34 : 86, caption: 'cleared' },
      { key: 'team', label: 'My team', value: 3, caption: 'executives' },
    ],
    inbox: {
      title: 'Waiting on you', sub: 'Reviews and change requests', source: 'legal_dd_checklist.stage · legal_change_requests.status',
      items: [
        { code: 'BT-NOI-H5J4', name: 'Amity University', city: 'Noida', kind: 'DD review', key: 'quality', age: '2 days' },
        { code: 'BT-MUM-UXYU', name: 'Forum Mulund', city: 'Mumbai', kind: 'DD review', key: 'quality', age: '1 day' },
        { code: 'BT-MUM-WYT0', name: 'Gokuldhham', city: 'Mumbai', kind: 'Change request', key: 'change', age: '4 days' },
        { code: 'BT-PUN-4FMG', name: 'Hinjewadi Phase 1', city: 'Pune', kind: 'Change request', key: 'change', age: 'today' },
      ],
    },
    // My team narrows the Legal breakdown too, so it agrees with the tiles above
    // (51 in legal, 34 positive for the team; 125 and 86 for the module).
    modules: [team
      ? { ...MODULES[0], parts: [{ label: 'Pending', value: 6, color: '#C9BBAA' }, { label: 'In review', value: 7, color: '#E8B23A' }, { label: 'Positive', value: 34, color: '#1C7A52' }, { label: 'Negative', value: 4, color: '#C4413A' }] }
      : MODULES[0]],
    cycle: { sub: 'Median days in Legal', steps: [{ label: 'Review started → DD verdict', days: 12 }, { label: 'DD positive → agreement signed', days: 9 }, { label: 'Signed → registered', days: 14 }, { label: 'Licensing complete', days: 21 }], callout: 'Licensing takes longest: 21 days on average.' },
    compliance: {
      title: 'Legal health', sub: 'Across the module', source: 'legal_dd_status · site_agreement',
      alerts: [{ n: 7, label: 'DD negative', tone: 'red' }, { n: 4, label: 'Signed, not registered', tone: 'orange' }, { n: 2, label: 'Change requests open', tone: 'orange' }, { n: 18, label: 'In review', tone: 'neutral' }],
    },
    licences: { of: 15, rows: [['FSSAI', 13, 2, 0], ['Health / trade', 12, 3, 0], ['Shops & estab.', 14, 1, 0], ['Fire NOC', 10, 4, 1], ['Storage', 11, 3, 1]] },
    workload: { title: 'Team workload', rows: [{ ini: 'AS', role: 'Legal executive', n: 7 }, { ini: 'NK', role: 'Legal executive', n: 5 }, { ini: 'PJ', role: 'Legal executive', n: 3 }] },
    activity: { sub: 'Legal actions per day · last 12 weeks', cells: heat(3) },
  };
}

// A BD executive with work: only their own sites. No money, people or tenant totals.
export const BD_EXECUTIVE = {
  role: 'executive',
  hero: { eyebrow: 'BD · executive · your work', title: 'Good morning — here’s your week.', lede: '2 LOIs are due this week and 1 site visit is booked for Thursday.' },
  kpis: [
    { key: 'mine', label: 'My sites', value: 12, caption: 'submitted or assigned to me' },
    { key: 'due', label: 'Due this week', value: 2, caption: 'LOI deadlines', hot: true },
    { key: 'process', label: 'In process', value: 7, caption: 'approved → payments' },
    { key: 'done', label: 'Handed on', value: 3, caption: 'past payments' },
  ],
  inbox: {
    title: 'Your next steps', sub: 'Sorted by deadline', source: 'sites.submitted_by / assigned_to = me · approvals.expected_loi_days',
    items: [
      { code: 'BT-MUM-SJ2T', name: 'Vikhroli', city: 'Mumbai', kind: 'LOI due', key: 'loi', age: 'in 2 days' },
      { code: 'BT-PUN-N10T', name: 'Embassy, Phase 1 Hinjewadi', city: 'Pune', kind: 'LOI due', key: 'loi', age: 'in 4 days' },
      { code: 'BT-AHM-GX40', name: 'Campus corner', city: 'Ahmedabad', kind: 'Add details', key: 'design', age: 'visit 29 Oct' },
      { code: 'BT-MUM-UXYU', name: 'Forum Mulund', city: 'Mumbai', kind: 'Change request', key: 'change', age: 'sent 1 day ago' },
    ],
  },
  funnel: {
    section: 'My pipeline', title: 'Where my sites are',
    steps: [
      { label: 'Draft submitted', value: 12, days: 4, note: 'Sites you put forward.' },
      { label: 'Shortlisted', value: 10, days: 6, note: 'Kept by your supervisor.' },
      { label: 'Approved', value: 7, days: 9, note: 'Deal approved; LOI clock running.' },
      { label: 'LOI uploaded', value: 5, days: 14, note: 'Letter of intent in.' },
      { label: 'In payments', value: 3, days: 20, note: 'Handed to legal and finance.' },
    ],
    source: 'sites where submitted_by or assigned_to = me',
  },
  cities: [{ name: 'Mumbai', launched: 0, pipeline: 6, rent: '₹276' }, { name: 'Pune', launched: 0, pipeline: 4, rent: '₹164' }, { name: 'Ahmedabad', launched: 0, pipeline: 2, rent: '₹137' }],
  timeline: {
    section: 'Coming up', title: 'Upcoming on my sites', sub: 'Next 14 days', source: 'sites.approved_at + expected_loi_days · visit dates',
    items: [
      { date: 'Thu 5 Nov', what: 'LOI deadline', site: 'Vikhroli · Mumbai', tone: 'red' },
      { date: 'Fri 6 Nov', what: 'Site visit booked', site: 'Campus corner · Ahmedabad', tone: 'blue' },
      { date: 'Mon 9 Nov', what: 'LOI deadline', site: 'Embassy, Phase 1 Hinjewadi · Pune', tone: 'orange' },
      { date: 'Thu 12 Nov', what: 'Supervisor review', site: 'Gokuldhham · Mumbai', tone: 'purple' },
    ],
  },
  activity: { sub: 'Your actions per day · last 12 weeks', cells: heat(5) },
};

// A new executive with nothing yet: an empty state instead of rows of zeros.
export const EMPTY_EXECUTIVE = {
  role: 'executive',
  hero: { eyebrow: 'BD · executive · your work', title: 'Welcome aboard, ritwick.', lede: 'Your sites, deadlines and next steps will appear here as soon as you add your first pipeline.' },
  kpis: [
    { key: 'mine', label: 'My sites', value: 0, caption: 'none yet' },
    { key: 'due', label: 'Due this week', value: 0, caption: 'no deadlines' },
    { key: 'process', label: 'In process', value: 0, caption: '—' },
    { key: 'done', label: 'Handed on', value: 0, caption: '—' },
  ],
  empty: {
    title: 'No sites yet',
    body: 'Start by adding a site you’ve found. Sites your supervisor delegates to you will show up here too.',
    cta: 'New pipeline',
  },
};

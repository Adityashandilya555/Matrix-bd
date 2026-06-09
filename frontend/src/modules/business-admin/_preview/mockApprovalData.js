// Dev-only mock data + injectable fetchers for the Approval Center preview.
// Mirrors the shapes returned by designApi.js / businessAdminApi.js / httpAdapter.
// Mutations update an in-memory store so approve / send-back / rotate visibly
// change the queues. Imported only by ApprovalCenterPreview.jsx (a DEV route).

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (n = 4) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

// ── Sites in the system (Sites tab + identity for the queues) ────────────────
const SITES = [
  { siteId: 's-del-014', siteCode: 'BT-DEL-014', siteName: 'Khan Market', city: 'New Delhi',
    status: 'legal_approved', legalDdStatus: 'positive', agreementStatus: 'signed', licensingStatus: 'partial',
    designStatus: 'in_progress', projectStatus: 'pending', financeStatus: 'pending' },
  { siteId: 's-blr-007', siteCode: 'BT-BLR-007', siteName: 'Indiranagar 100ft Road', city: 'Bengaluru',
    status: 'pushed_to_payments', legalDdStatus: 'positive', agreementStatus: 'signed', licensingStatus: 'complete',
    designStatus: 'in_progress', projectStatus: 'pending', financeStatus: 'awaiting_admin' },
  { siteId: 's-mum-021', siteCode: 'BT-MUM-021', siteName: 'Bandra Linking Road', city: 'Mumbai',
    status: 'legal_approved', legalDdStatus: 'positive', agreementStatus: 'signed', licensingStatus: 'complete',
    designStatus: 'gfc_pending', projectStatus: 'pending', financeStatus: 'pending' },
  { siteId: 's-ggn-003', siteCode: 'BT-GGN-003', siteName: 'Cyber Hub', city: 'Gurugram',
    status: 'pushed_to_payments', legalDdStatus: 'positive', agreementStatus: 'registered', licensingStatus: 'complete',
    designStatus: 'approved', projectStatus: 'budgeting', financeStatus: 'approved' },
  { siteId: 's-hyd-009', siteCode: 'BT-HYD-009', siteName: 'Jubilee Hills', city: 'Hyderabad',
    status: 'pushed_to_payments', legalDdStatus: 'positive', agreementStatus: 'signed', licensingStatus: 'complete',
    designStatus: 'approved', projectStatus: 'pending', financeStatus: 'awaiting_admin' },
  { siteId: 's-pun-002', siteCode: 'BT-PUN-002', siteName: 'Koregaon Park', city: 'Pune',
    status: 'pushed_to_payments', legalDdStatus: 'positive', agreementStatus: 'registered', licensingStatus: 'complete',
    designStatus: 'approved', projectStatus: 'done', financeStatus: 'approved' },
  { siteId: 's-chn-011', siteCode: 'BT-CHN-011', siteName: 'Nungambakkam', city: 'Chennai',
    status: 'legal_review', legalDdStatus: 'in_review', agreementStatus: 'pending', licensingStatus: 'pending',
    designStatus: 'pending', projectStatus: 'pending', financeStatus: 'pending' },
];
const siteMeta = (id) => { const s = SITES.find((x) => x.siteId === id); return { siteId: s.siteId, siteCode: s.siteCode, siteName: s.siteName, city: s.city }; };

const store = {
  deliverables: [
    { ...siteMeta('s-del-014'), deliverables: [
      { kind: '2d', status: 'approved', fileName: 'khan-market-2d-layout-v3.pdf', downloadUrl: '#' },
      { kind: '3d', status: 'approved', fileName: 'khan-market-3d-render-final.pdf', downloadUrl: '#' },
    ] },
    { ...siteMeta('s-blr-007'), deliverables: [
      { kind: '3d', status: 'approved', fileName: 'indiranagar-3d-walkthrough.pdf', downloadUrl: '#' },
    ] },
  ],
  gfc: [
    { ...siteMeta('s-mum-021'), boqEstimatedAmount: 4250000, submittedByName: 'Priya Nair' },
  ],
  gfcReview: {
    's-mum-021': { ...siteMeta('s-mum-021'), deliverables: [
      { kind: 'recce', status: 'approved', fileName: 'bandra-recce.pdf', downloadUrl: '#' },
      { kind: '2d', status: 'approved', fileName: 'bandra-2d-layout.pdf', downloadUrl: '#' },
      { kind: '3d', status: 'approved', fileName: 'bandra-3d-render.pdf', downloadUrl: '#' },
      { kind: 'boq', status: 'approved', fileName: 'bandra-boq.xlsx', downloadUrl: '#', estimatedAmount: 4250000 },
    ] },
  },
  finance: [
    { ...siteMeta('s-blr-007'), caCode: 'CA-BLR-2231', financeAmount: 1875000, submittedByName: 'Arjun Mehta' },
    { ...siteMeta('s-hyd-009'), caCode: 'CA-HYD-9087', financeAmount: 2410000, submittedByName: 'Sana Khan' },
  ],
  budget: [
    { ...siteMeta('s-ggn-003'), budgetTotal: 3180000, submittedByName: 'Arjun Mehta' },
  ],
  supervisors: [
    { id: 'u-p1', email: 'anil.mehta@bluetokai.com', module: 'bd', createdAt: '2026-06-04T08:20:00Z' },
    { id: 'u-p2', email: 'divya.s@bluetokai.com', module: 'design', createdAt: '2026-06-05T07:45:00Z' },
    { id: 'u-p3', email: 'farhan.ali@bluetokai.com', module: 'project', createdAt: '2026-06-05T09:50:00Z' },
  ],
  org: [
    { module: 'bd', code: 'BD-7K2P', supervisors: [
      { id: 's-bd-1', email: 'rohan.kapoor@bluetokai.com', name: 'Rohan Kapoor', joinedAt: '2026-05-02T00:00:00Z', executives: [
        { id: 'e-bd-1', email: 'aman.verma@bluetokai.com', name: 'Aman Verma', joinedAt: '2026-05-08T00:00:00Z' },
        { id: 'e-bd-2', email: 'pooja.rao@bluetokai.com', name: 'Pooja Rao', joinedAt: '2026-05-11T00:00:00Z' },
      ] },
    ], unassignedExecutives: [] },
    { module: 'legal', code: 'LG-4Q9M', supervisors: [
      { id: 's-lg-1', email: 'sara.thomas@bluetokai.com', name: 'Sara Thomas', joinedAt: '2026-05-04T00:00:00Z', executives: [] },
    ], unassignedExecutives: [
      { id: 'e-lg-9', email: 'meera.iyer@bluetokai.com', name: 'Meera Iyer', joinedAt: '2026-05-19T00:00:00Z' },
    ] },
    { module: 'design', code: 'DS-2X8N', supervisors: [
      { id: 's-ds-1', email: 'vikram.rao@bluetokai.com', name: 'Vikram Rao', joinedAt: '2026-05-06T00:00:00Z', executives: [
        { id: 'e-ds-1', email: 'neha.gupta@bluetokai.com', name: 'Neha Gupta', joinedAt: '2026-05-12T00:00:00Z' },
        { id: 'e-ds-2', email: 'imran.shaikh@bluetokai.com', name: 'Imran Shaikh', joinedAt: '2026-05-14T00:00:00Z' },
      ] },
    ], unassignedExecutives: [] },
    { module: 'project', code: null, supervisors: [], unassignedExecutives: [] },
  ],
};

// ── cross-module history generator (newest-first, like the audit feed) ────────
function historyFor(site) {
  const ev = [];
  let t = Date.parse('2026-05-18T09:00:00Z');
  const push = (actor, action, detail) => {
    ev.push({ id: `${site.siteId}-${ev.length}`, siteId: site.siteId, actor, action, detail: detail || null,
      fromStatus: null, toStatus: null, fieldName: null, fromValue: null, toValue: null, createdAt: new Date(t).toISOString() });
    t += (5 + ev.length * 3) * 3600 * 1000;
  };
  push('Aman Verma', 'create_draft');
  push('Aman Verma', 'shortlist');
  push('Rohan Kapoor', 'approve_details');
  push('Aman Verma', 'upload_loi');
  push('Rohan Kapoor', 'send_to_legal');
  if (site.legalDdStatus && site.legalDdStatus !== 'pending') push('Meera Iyer', 'legal_dd_submitted_for_review');
  if (['positive'].includes(site.legalDdStatus) || ['legal_approved', 'pushed_to_payments'].includes(site.status)) {
    push('Sara Thomas', 'legal_dd_positive');
    push('Sara Thomas', 'legal_approved');
  }
  if (site.designStatus && site.designStatus !== 'pending') {
    push('Vikram Rao', 'design_allocated');
    push('Neha Gupta', 'design_deliverable_submitted', 'kind=2d');
    if (['gfc_pending', 'approved'].includes(site.designStatus)) {
      push('Vikram Rao', 'design_deliverable_approved');
      push('Business Admin', 'design_admin_approved');
    }
    if (site.designStatus === 'approved') push('Business Admin', 'design_gfc_approved');
  }
  if (site.financeStatus && site.financeStatus !== 'pending') {
    push('Sana Khan', 'finance_submitted');
    if (['awaiting_admin', 'approved'].includes(site.financeStatus)) push('Sara Thomas', 'finance_supervisor_approved');
    if (site.financeStatus === 'approved') push('Business Admin', 'finance_admin_approved');
  }
  if (site.projectStatus && site.projectStatus !== 'pending') {
    push('Farhan Ali', 'project_allocated');
    push('Imran Shaikh', 'project_budget_submitted');
    if (['done'].includes(site.projectStatus)) {
      push('Business Admin', 'project_budget_approved');
      push('Business Admin', 'project_completed');
    }
  }
  return ev.reverse(); // newest first
}

export const mockFetchers = {
  listDeliverables: async () => { await wait(540); return { items: structuredClone(store.deliverables), total: store.deliverables.length }; },
  reviewDeliverable: async (siteId, kind) => {
    await wait(480);
    const site = store.deliverables.find((s) => s.siteId === siteId);
    if (site) site.deliverables = site.deliverables.filter((d) => d.kind !== kind);
    store.deliverables = store.deliverables.filter((s) => s.deliverables.length > 0);
    return { ok: true };
  },

  listGfc: async () => { await wait(600); return { items: structuredClone(store.gfc), total: store.gfc.length }; },
  reviewGfcPackage: async (siteId) => { await wait(450); return structuredClone(store.gfcReview[siteId]); },
  decideGfc: async (siteId) => { await wait(520); store.gfc = store.gfc.filter((s) => s.siteId !== siteId); return { ok: true }; },

  listFinance: async () => { await wait(560); return { items: structuredClone(store.finance), total: store.finance.length }; },
  approveFinance: async (siteId) => { await wait(480); store.finance = store.finance.filter((s) => s.siteId !== siteId); return { ok: true }; },

  listBudget: async () => { await wait(520); return { items: structuredClone(store.budget), total: store.budget.length }; },
  reviewBudget: async (siteId) => { await wait(500); store.budget = store.budget.filter((s) => s.siteId !== siteId); return { ok: true }; },
  fetchBudgetDetail: async (siteId) => {
    await wait(420);
    const row = store.budget.find((s) => s.siteId === siteId) || {};
    const total = row.budgetTotal || 0;
    const per = Math.round(total / 11);
    const items = [
      'Professional Fees', 'HVAC', 'Furniture, Light & Planters', 'Civil & Interiors',
      'Kitchen Equipment', 'Branding', 'Crockery & Small Equipments', 'Utilities',
      'Licencing', 'BD Cost', 'Misc',
    ].map((label, i) => ({ idx: i + 1, label, amount: per }));
    return { items, budgetTotal: per * 11, totalIndoorAreaSqft: 316, totalAreaSqft: 804, covers: 30 };
  },

  listSupervisors: async () => { await wait(500); return structuredClone(store.supervisors); },
  approveSupervisor: async (id) => { await wait(450); store.supervisors = store.supervisors.filter((u) => u.id !== id); return { ok: true }; },
  rejectSupervisor: async (id) => { await wait(450); store.supervisors = store.supervisors.filter((u) => u.id !== id); return { ok: true }; },

  rotateDeptCode: async (moduleKey) => {
    await wait(480);
    const prefix = { bd: 'BD', legal: 'LG', design: 'DS', project: 'PRJ' }[moduleKey] || moduleKey.toUpperCase();
    const m = store.org.find((x) => x.module === moduleKey);
    if (m) m.code = `${prefix}-${rid(4)}`;
    return { ok: true };
  },
  listOrg: async () => { await wait(540); return structuredClone(store.org); },

  listSites: async () => { await wait(620); return { items: structuredClone(SITES), total: SITES.length }; },
  fetchSiteHistory: async (siteId) => {
    await wait(450);
    const site = SITES.find((s) => s.siteId === siteId);
    return { items: site ? historyFor(site) : [], total: 0 };
  },
};

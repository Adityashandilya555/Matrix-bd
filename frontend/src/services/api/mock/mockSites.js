// Unified canonical site list.
// Replaces the four separate seed arrays (drafts, shortlist, staging, archive).
// Status values use UPPER_SNAKE_CASE matching SiteStatus enum in lib/stateMachine.js.
// Legacy fields (stage, inReview, loiUploaded, pushed, days, daysSinceApproval, etc.)
// are NOT stored here — they are derived by SitesContext selectors at read time.

import { SiteStatus } from '../../../lib/stateMachine.js';

const now = new Date();
const iso = () => now.toISOString();

// Helper: build auditTrail entry
function auditEntry(by, fromStatus, toStatus, note = '') {
  return { id: Math.random().toString(36).slice(2, 10), at: iso(), by, fromStatus, toStatus, action: `${fromStatus} -> ${toStatus}`, note };
}

const MOCK_SITES = [
  // ---- DRAFT_SUBMITTED sites (9) ----
  {
    id: 'site_h9d31a40', code: 'BT-MUM-0144', name: 'BKC One · East Wing',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: null,
    visitDate: '2026-05-18', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-17T10:00:00Z', updatedAt: '2026-05-17T10:00:00Z',
    auditTrail: [],
    // shortlist UI continuity fields
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 200,
  },
  {
    id: 'site_i1e42a51', code: 'BT-CHE-0011', name: 'Anna Nagar 2nd Ave',
    city: 'Chennai', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: null,
    visitDate: '2026-05-16', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-14T09:00:00Z', updatedAt: '2026-05-14T09:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 30,
  },
  {
    id: 'site_j2f53b62', code: 'BT-AHM-0008', name: 'CG Road · Navrangpura',
    city: 'Ahmedabad', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    assignedTo: null,
    visitDate: '2026-05-14', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-12T08:00:00Z', updatedAt: '2026-05-12T08:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 60,
  },
  {
    id: 'site_k3g64c73', code: 'BT-BLR-0210', name: 'HSR Layout 27th Main',
    city: 'Bengaluru', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_aisha', name: 'Aisha Sengupta' },
    assignedTo: null,
    visitDate: '2026-05-13', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-11T11:00:00Z', updatedAt: '2026-05-11T11:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 120,
  },
  {
    id: 'site_l4h75d84', code: 'BT-PUN-0024', name: 'Baner High Street',
    city: 'Pune', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: null,
    visitDate: '2026-05-11', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-09T10:00:00Z', updatedAt: '2026-05-09T10:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 160,
  },
  {
    id: 'site_m5i86e95', code: 'BT-MUM-0145', name: 'Lokhandwala Back Rd',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: null,
    visitDate: '2026-05-08', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-06T09:00:00Z', updatedAt: '2026-05-06T09:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 240,
  },
  {
    id: 'site_n6j97f06', code: 'BT-HYD-0036', name: 'Jubilee Hills Rd 36',
    city: 'Hyderabad', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    assignedTo: null,
    visitDate: '2026-04-29', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-04-27T08:00:00Z', updatedAt: '2026-04-27T08:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 280,
  },
  {
    id: 'site_o7k08g17', code: 'BT-DEL-0091', name: 'Saket M-Block · L13',
    city: 'New Delhi', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_aisha', name: 'Aisha Sengupta' },
    assignedTo: null,
    visitDate: '2026-04-26', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-04-24T07:00:00Z', updatedAt: '2026-04-24T07:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 320,
  },
  {
    id: 'site_p8l19h28', code: 'BT-BLR-0211', name: 'Whitefield · Hope Farm',
    city: 'Bengaluru', tenantId: 'bt-tenant-001', status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: null,
    visitDate: '2026-04-22', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-04-20T08:00:00Z', updatedAt: '2026-04-20T08:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 10,
  },

  // ---- SHORTLISTED sites (2) and DETAILS_SUBMITTED sites (2) ----
  // DETAILS_SUBMITTED = inReview: true in legacy
  {
    id: 'site_sl_mum143', code: 'BT-MUM-0143', name: 'Bandra Linking Rd',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.DETAILS_SUBMITTED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: null,
    visitDate: '2026-05-17', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-15T10:00:00Z', updatedAt: '2026-05-16T12:00:00Z',
    auditTrail: [],
    score: 78, estSales: 19.8, carpet: 1120, rent: 112, rentType: 'fixed', totalOpCost: 165000, hue: 140,
  },
  {
    id: 'site_sl_mum146', code: 'BT-MUM-0146', name: 'Borivali West · Carter',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.SHORTLISTED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: null,
    visitDate: '2026-05-15', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-13T10:00:00Z', updatedAt: '2026-05-14T11:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 220,
  },
  {
    id: 'site_sl_blr209', code: 'BT-BLR-0209', name: 'Koramangala 6th Block',
    city: 'Bengaluru', tenantId: 'bt-tenant-001', status: SiteStatus.SHORTLISTED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: null,
    visitDate: '2026-05-15', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-13T09:00:00Z', updatedAt: '2026-05-14T10:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 30,
  },
  {
    id: 'site_sl_del090', code: 'BT-DEL-0090', name: 'Connaught Place · F-21',
    city: 'New Delhi', tenantId: 'bt-tenant-001', status: SiteStatus.DETAILS_SUBMITTED,
    createdBy: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    assignedTo: null,
    visitDate: '2026-05-12', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-10T08:00:00Z', updatedAt: '2026-05-12T14:00:00Z',
    auditTrail: [],
    score: 82, estSales: 22.0, carpet: 1320, rent: 142, rentType: 'fixed', totalOpCost: 198000, hue: 200,
  },

  // ---- APPROVED sites (5) and LOI_UPLOADED sites (2) — the staging view ----
  {
    id: 'site_a8f3c129', code: 'BT-MUM-0142', name: 'Powai · Lake Homes',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.APPROVED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: { id: 'user_riya', name: 'Riya Sharma' },
    visitDate: '2026-05-01', expectedLoiDays: 14, loiUrl: null,
    details: { spocName: 'Rohan Khanna' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-03T10:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 140,
    // staging display fields (non-persisted in real DB, computed from dates)
    _draftDate: '2026-05-01', _approvedDate: '2026-05-03', _approvedBy: 'N. Iyer',
    _daysSinceApproval: 16, _daysToLOI: null, _spocName: 'Rohan Khanna',
  },
  {
    id: 'site_e2c1f8a3', code: 'BT-HYD-0034', name: 'Banjara Hills Rd 12',
    city: 'Hyderabad', tenantId: 'bt-tenant-001', status: SiteStatus.APPROVED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: { id: 'user_riya', name: 'Riya Sharma' },
    visitDate: '2026-05-08', expectedLoiDays: 14, loiUrl: null,
    details: { spocName: 'Pranav Reddy' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-08T09:00:00Z', updatedAt: '2026-05-10T09:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 50,
    _draftDate: '2026-05-08', _approvedDate: '2026-05-10', _approvedBy: 'R. Sharma',
    _daysSinceApproval: 9, _daysToLOI: null, _spocName: 'Pranav Reddy',
  },
  {
    id: 'site_c4d09f02', code: 'BT-DEL-0089', name: 'Khan Market · Shop 27',
    city: 'New Delhi', tenantId: 'bt-tenant-001', status: SiteStatus.APPROVED,
    createdBy: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    assignedTo: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    visitDate: '2026-04-20', expectedLoiDays: 21, loiUrl: null,
    details: { spocName: 'Devansh Roy' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-04-20T08:00:00Z', updatedAt: '2026-04-22T08:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 200,
    _draftDate: '2026-04-20', _approvedDate: '2026-04-22', _approvedBy: 'N. Iyer',
    _daysSinceApproval: 27, _daysToLOI: null, _spocName: 'Devansh Roy',
  },
  {
    id: 'site_g8c20d12', code: 'BT-PUN-0021', name: 'Koregaon Park Lane 5',
    city: 'Pune', tenantId: 'bt-tenant-001', status: SiteStatus.APPROVED,
    createdBy: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    assignedTo: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    visitDate: '2026-04-13', expectedLoiDays: 21, loiUrl: null,
    details: { spocName: 'Yash Bhide' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-04-13T08:00:00Z', updatedAt: '2026-04-15T08:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 260,
    _draftDate: '2026-04-13', _approvedDate: '2026-04-15', _approvedBy: 'N. Iyer',
    _daysSinceApproval: 34, _daysToLOI: null, _spocName: 'Yash Bhide',
  },
  {
    id: 'site_b7e2118a', code: 'BT-BLR-0207', name: 'Indiranagar 12th Main',
    city: 'Bengaluru', tenantId: 'bt-tenant-001', status: SiteStatus.APPROVED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: { id: 'user_aman', name: 'Aman Verma' },
    visitDate: '2026-05-10', expectedLoiDays: 14, loiUrl: null,
    details: { spocName: 'Aisha Mehta' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-05-10T09:00:00Z', updatedAt: '2026-05-12T09:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 90,
    _draftDate: '2026-05-10', _approvedDate: '2026-05-12', _approvedBy: 'R. Sharma',
    _daysSinceApproval: 6, _daysToLOI: null, _spocName: 'Aisha Mehta',
  },
  // LOI_UPLOADED
  {
    id: 'site_q9m20i39', code: 'BT-MUM-0140', name: 'Andheri · Lokhandwala',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.LOI_UPLOADED,
    createdBy: { id: 'user_riya', name: 'Riya Sharma' },
    assignedTo: { id: 'user_riya', name: 'Riya Sharma' },
    visitDate: '2026-04-06', expectedLoiDays: 14, loiUrl: 'mock-storage/loi-site_q9m20i39.pdf',
    details: { spocName: 'Tanvi Joshi' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-04-06T08:00:00Z', updatedAt: '2026-04-21T14:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 170,
    _draftDate: '2026-04-06', _approvedDate: '2026-04-08', _approvedBy: 'N. Iyer',
    _daysSinceApproval: 14, _daysToLOI: 13, _spocName: 'Tanvi Joshi',
    _loiUploadedAt: '2026-04-21',
  },
  {
    id: 'site_r0n31j40', code: 'BT-DEL-0086', name: 'GK-1 N-Block · 142',
    city: 'New Delhi', tenantId: 'bt-tenant-001', status: SiteStatus.LOI_UPLOADED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: { id: 'user_aman', name: 'Aman Verma' },
    visitDate: '2026-03-30', expectedLoiDays: 21, loiUrl: 'mock-storage/loi-site_r0n31j40.pdf',
    details: { spocName: 'Vikram Anand' }, rejectionReasons: null, archiveNote: null,
    createdAt: '2026-03-30T08:00:00Z', updatedAt: '2026-04-22T14:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 300,
    _draftDate: '2026-03-30', _approvedDate: '2026-04-02', _approvedBy: 'R. Sharma',
    _daysSinceApproval: 20, _daysToLOI: 20, _spocName: 'Vikram Anand',
    _loiUploadedAt: '2026-04-22',
    _pushed: false,
  },

  // ---- ARCHIVED sites (2) ----
  {
    id: 'site_arch_001', code: 'BT-MUM-0091', name: 'Khar · Linking Rd 33',
    city: 'Mumbai', tenantId: 'bt-tenant-001', status: SiteStatus.ARCHIVED,
    createdBy: { id: 'user_aman', name: 'Aman Verma' },
    assignedTo: null,
    visitDate: '2026-04-10', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: ['High rent', 'High cannibalisation'], archiveNote: '',
    createdAt: '2026-04-01T08:00:00Z', updatedAt: '2026-04-12T10:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 10,
    _archivedAt: '2026-04-12',
  },
  {
    id: 'site_arch_002', code: 'BT-DEL-0072', name: 'Defence Colony · 12B',
    city: 'New Delhi', tenantId: 'bt-tenant-001', status: SiteStatus.ARCHIVED,
    createdBy: { id: 'user_nikhil', name: 'Nikhil Iyer' },
    assignedTo: null,
    visitDate: '2026-03-25', expectedLoiDays: null, loiUrl: null,
    details: null, rejectionReasons: ['Affluence problem'], archiveNote: '',
    createdAt: '2026-03-20T08:00:00Z', updatedAt: '2026-03-30T10:00:00Z',
    auditTrail: [],
    score: '', estSales: '', carpet: '', rent: '', rentType: '', totalOpCost: 0, hue: 330,
    _archivedAt: '2026-03-30',
  },
];

const STORAGE_KEY = 'matrix_bd_mock_sites_v1';

function cloneSite(site) {
  return JSON.parse(JSON.stringify(site));
}

function readStoredSites() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistSites() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_sites));
  } catch {
    // Mock persistence is best-effort only; writes should keep working in memory.
  }
}

// Mutable mock store. Browser mock mode persists to localStorage so draft saves
// survive refreshes like the HTTP/database-backed app does.
let _sites = readStoredSites() || MOCK_SITES.map(cloneSite);

export function getAllSites() {
  return [..._sites];
}

export function getSiteById(id) {
  return _sites.find(s => s.id === id) || null;
}

export function getSiteByCode(code) {
  return _sites.find(s => s.code === code) || null;
}

export function upsertSite(site) {
  const idx = _sites.findIndex(s => s.id === site.id);
  let saved;
  if (idx >= 0) {
    _sites[idx] = { ..._sites[idx], ...site, updatedAt: new Date().toISOString() };
    saved = _sites[idx];
  } else {
    const newSite = { ...site, updatedAt: new Date().toISOString() };
    _sites.unshift(newSite);
    saved = newSite;
  }
  persistSites();
  return saved;
}

export function resetSites() {
  _sites = MOCK_SITES.map(cloneSite);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

// Design-system tone and stage constants.
// Extracted from Primitives.jsx — values preserved exactly.

export const TONES = {
  neutral: { fg: 'var(--zm-fg-2)',    bg: 'var(--zm-surface-2)',    edge: 'var(--zm-line-strong)',  mark: 'var(--zm-fg-3)' },
  accent:  { fg: 'var(--zm-accent)',  bg: 'var(--zm-accent-soft)',  edge: 'var(--zm-accent-line)',  mark: 'var(--zm-accent)' },
  copper:  { fg: 'var(--zm-copper)',  bg: 'var(--zm-copper-soft)',  edge: 'var(--zm-copper-line)',  mark: 'var(--zm-copper)' },
  plum:    { fg: 'var(--zm-plum)',    bg: 'var(--zm-plum-soft)',    edge: 'color-mix(in srgb, var(--zm-plum) 38%, transparent)',    mark: 'var(--zm-plum)' },
  info:    { fg: 'var(--zm-info)',    bg: 'var(--zm-info-soft)',    edge: 'color-mix(in srgb, var(--zm-info) 38%, transparent)',    mark: 'var(--zm-info)' },
  success: { fg: 'var(--zm-success)', bg: 'var(--zm-success-soft)', edge: 'color-mix(in srgb, var(--zm-success) 38%, transparent)', mark: 'var(--zm-success)' },
  danger:  { fg: 'var(--zm-danger)',  bg: 'var(--zm-danger-soft)',  edge: 'color-mix(in srgb, var(--zm-danger) 38%, transparent)',  mark: 'var(--zm-danger)' },
};

export const STAGES = {
  draft:        { name: 'Draft',           tone: 'neutral', color: '#6E6E78' },
  overdueDraft: { name: 'Draft · overdue', tone: 'danger',  color: '#9B2A2A' },
  shortlist:    { name: 'Shortlist',       tone: 'info',    color: '#2A4FA0' },
  inReview:     { name: 'In review',       tone: 'plum',    color: '#6B4789' },
  staging:      { name: 'Sites in process · LOI', tone: 'copper', color: '#B0712E' },
  overdue:      { name: 'LOI overdue',     tone: 'danger',  color: '#9B2A2A' },
  uploaded:     { name: 'LOI uploaded',    tone: 'accent',  color: '#0F5D5C' },
  legal_review: { name: 'Legal review',    tone: 'plum',    color: '#6B4789' },
  legal_approved: { name: 'Legal approved', tone: 'success', color: '#2F7A4A' },
  legal_rejected: { name: 'Legal rejected', tone: 'danger',  color: '#9B2A2A' },
  completed:    { name: 'Pushed',          tone: 'success', color: '#2F7A4A' },
  rejected:     { name: 'Rejected',        tone: 'danger',  color: '#9B2A2A' },
  archived:     { name: 'Archived',        tone: 'neutral', color: '#6E6E78' },
};

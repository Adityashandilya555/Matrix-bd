// Route path constants. Always import from here — never hardcode paths in components.
export const ROUTES = {
  OVERVIEW:               '/',
  PIPELINE:               '/pipeline',
  SHORTLIST:              '/shortlist',
  STAGING_EXEC:           '/staging/exec',
  STAGING_SUPERVISOR:     '/staging/supervisor',
  STAGING:                '/staging',
  ARCHIVE:                '/archive',
  TEAM:                   '/team',
  DD_FAILED:              '/dd-failed',
  BD_SITE_STATUS:         '/sites/:siteId/status',
  LEGAL:                  '/legal',
  LEGAL_CHANGE_REQUESTS:  '/legal/change-requests',
  LEGAL_REJECTED:         '/legal/rejected',
  LEGAL_HISTORY:          '/legal/history',
  LEGAL_HISTORY_SITE:     '/legal/history/:siteId',
  LEGAL_SITE_DDR:         '/legal/sites/:siteId/ddr',
  LEGAL_SITE_AGREEMENT:   '/legal/sites/:siteId/agreement',
  LEGAL_SITE_LICENSING:   '/legal/sites/:siteId/licensing',
  PAYMENT:                '/payment',
  LAUNCH:                 '/launch',
  DESIGN:                 '/design',
  DESIGN_SITE:            '/design/sites/:siteId',
  DESIGN_HISTORY:         '/design/history',
  DESIGN_HISTORY_SITE:    '/design/history/:siteId',
  PROJECT:                '/project',
  PROJECT_SITES:          '/project/sites',
  PROJECT_SITE:           '/project/:siteId',
  PROJECT_HISTORY:        '/project/history',
  PROJECT_HISTORY_SITE:   '/project/history/:siteId',
  NSO:                    '/nso',
  NSO_SITE:               '/nso/:siteId',
  NSO_HISTORY:            '/nso/history',
  NSO_HISTORY_SITE:       '/nso/history/:siteId',
  SITE:                   '/sites/:id',
  ADD_DETAILS:            '/shortlist/:code/details',
  LOI_TIMELINE:           '/shortlist/:code/timeline',
  SITE_TRACKER:           '/staging-flow',
  SITE_TRACKER_DETAIL:    '/staging-flow/:siteId',
  DASHBOARD_MINIMAL_PREVIEW: '/dashboard-minimal-preview',
};

export function siteRoute(id) {
  return ROUTES.SITE.replace(':id', id);
}

export function addDetailsRoute(code) {
  return ROUTES.ADD_DETAILS.replace(':code', code);
}

export function loiTimelineRoute(code) {
  return ROUTES.LOI_TIMELINE.replace(':code', code);
}

export function legalSiteDdrRoute(siteId) {
  return ROUTES.LEGAL_SITE_DDR.replace(':siteId', siteId);
}

export function legalSiteAgreementRoute(siteId) {
  return ROUTES.LEGAL_SITE_AGREEMENT.replace(':siteId', siteId);
}

export function legalSiteLicensingRoute(siteId) {
  return ROUTES.LEGAL_SITE_LICENSING.replace(':siteId', siteId);
}

export function legalHistorySiteRoute(siteId) {
  return ROUTES.LEGAL_HISTORY_SITE.replace(':siteId', siteId);
}

export function designSiteRoute(siteId) {
  return ROUTES.DESIGN_SITE.replace(':siteId', siteId);
}

export function designHistorySiteRoute(siteId) {
  return ROUTES.DESIGN_HISTORY_SITE.replace(':siteId', siteId);
}

export function projectSiteRoute(siteId) {
  return ROUTES.PROJECT_SITE.replace(':siteId', siteId);
}

export function projectHistorySiteRoute(siteId) {
  return ROUTES.PROJECT_HISTORY_SITE.replace(':siteId', siteId);
}

export function nsoSiteRoute(siteId) {
  return ROUTES.NSO_SITE.replace(':siteId', siteId);
}

export function nsoHistorySiteRoute(siteId) {
  return ROUTES.NSO_HISTORY_SITE.replace(':siteId', siteId);
}

export function bdSiteStatusRoute(siteId) {
  return ROUTES.BD_SITE_STATUS.replace(':siteId', siteId);
}

export function siteTrackerDetailRoute(siteId) {
  return ROUTES.SITE_TRACKER_DETAIL.replace(':siteId', siteId);
}

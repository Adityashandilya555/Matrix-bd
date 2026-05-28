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
  LEGAL_SITE_DDR:         '/legal/sites/:siteId/ddr',
  LEGAL_SITE_AGREEMENT:   '/legal/sites/:siteId/agreement',
  LEGAL_SITE_LICENSING:   '/legal/sites/:siteId/licensing',
  PAYMENT:                '/payment',
  PAYMENT_SITE_LICENSING: '/payment/sites/:siteId/licensing',
  SITE:                   '/sites/:id',
  ADD_DETAILS:            '/shortlist/:code/details',
  LOI_TIMELINE:           '/shortlist/:code/timeline',
  SITE_TRACKER:           '/staging-flow',
  SITE_TRACKER_DETAIL:    '/staging-flow/:siteId',
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

export function paymentSiteLicensingRoute(siteId) {
  return ROUTES.PAYMENT_SITE_LICENSING.replace(':siteId', siteId);
}

export function bdSiteStatusRoute(siteId) {
  return ROUTES.BD_SITE_STATUS.replace(':siteId', siteId);
}

export function siteTrackerDetailRoute(siteId) {
  return ROUTES.SITE_TRACKER_DETAIL.replace(':siteId', siteId);
}

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
  LEGAL:                  '/legal',
  LEGAL_SITE_DDR:         '/legal/sites/:siteId/ddr',
  PAYMENT:                '/payment',
  PAYMENT_SITE_LICENSING: '/payment/sites/:siteId/licensing',
  SITE:                   '/sites/:id',
  ADD_DETAILS:            '/shortlist/:code/details',
  LOI_TIMELINE:           '/shortlist/:code/timeline',
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

export function paymentSiteLicensingRoute(siteId) {
  return ROUTES.PAYMENT_SITE_LICENSING.replace(':siteId', siteId);
}

// skipcq: JS-0833
// displayCode — the one code a user should ever see for a site.
//
// A site carries two identifiers: `code`, minted once at draft creation as
// BT-{CITY3}-{RAND4}, and `ca_code`, the commercial code Finance types in later
// and which supersedes it everywhere once present. The backend now resolves this
// in _common.display_code(), so most responses arrive already-resolved; this is
// for the surfaces that receive both fields and have to choose.
//
// Five spellings because the call sites genuinely use all of them — the wire is
// snake_case, most adapters camelCase it, and the launch payloads name the field
// site_code rather than code.
//
// NOTE: deliberately does NOT fall back to site.id. Three surfaces
// (SiteFinancePage, SiteTrackerDetailPage, SiteTrackerListPage) do append
// `|| site.id` themselves so a codeless row still gets a handle — that renders a
// raw UUID, which is right there and wrong everywhere else. Keep it opt-in.
export function displayCode(site, fallback = '—') {
  if (!site) return fallback;
  return site.ca_code || site.caCode
      || site.site_code || site.siteCode
      || site.code
      || fallback;
}

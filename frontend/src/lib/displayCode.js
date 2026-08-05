export function displayCode(site, fallback = '—') {
  if (!site) return fallback;
  return site.ca_code || site.caCode
      || site.site_code || site.siteCode
      || site.code
      || fallback;
}

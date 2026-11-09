// Request-security rules that must hold both locally and behind the hosting proxy.

type Headers = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || undefined;

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Owner-cookie attributes. Plain-HTTP localhost gets SameSite=Lax (Secure cookies need HTTPS on
 * some browsers). Everything else is served over public HTTPS, possibly inside a cross-site
 * preview iframe, so it needs SameSite=None; Secure. CSRF protection comes from isCrossSiteWrite.
 */
export function ownerCookie(name: string, value: string, headers: Headers, maxAgeSeconds = 86400): string {
  const host = first(headers['x-forwarded-host']) ?? first(headers.host) ?? '';
  const plainLocal = LOCAL_HOSTS.test(host) && first(headers['x-forwarded-proto']) !== 'https';
  const site = plainLocal ? 'SameSite=Lax' : 'SameSite=None; Secure';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${site}; Max-Age=${maxAgeSeconds}`;
}

/**
 * True when a state-changing request comes from another site. Browsers send Sec-Fetch-Site, which
 * proxies do not rewrite; otherwise fall back to comparing Origin with the (forwarded) host.
 */
export function isCrossSiteWrite(headers: Headers): boolean {
  const fetchSite = first(headers['sec-fetch-site']);
  if (fetchSite) return !(fetchSite === 'same-origin' || fetchSite === 'none');
  const origin = first(headers.origin);
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const hosts = [first(headers.host), first(headers['x-forwarded-host'])].filter(Boolean);
  return hosts.length > 0 && !hosts.includes(originHost);
}

const urlHelper = (value: string): URL => {
  const parsed = new URL(value, "https://placeholder.invalid");
  return parsed;
};

/**
 * Normalize a URL so equivalent variations collapse to a single canonical key.
 * Strips the fragment, trailing slash (for paths other than "/"), and the
 * default port. Protocol is left untouched (https vs http are treated as
 * different origins, matching browser behavior). Query strings are preserved.
 */
export function normalizeUrl(raw: string, baseUrl: string): string {
  const parsed = new URL(raw, baseUrl);
  parsed.hash = "";
  if (parsed.protocol === "https:" && parsed.port === "443") parsed.port = "";
  if (parsed.protocol === "http:" && parsed.port === "80") parsed.port = "";
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

/** Resolve a raw href found on a page into an absolute target URL. */
export function resolveHref(raw: string, baseUrl: string): string {
  return urlHelper(raw).href ? new URL(raw, baseUrl).href : raw;
}

/** True when the link points at the same host as the site being crawled. */
export function isInternalLink(raw: string, host: string): boolean {
  try {
    const parsed = new URL(raw, `https://${host}`);
    return parsed.host === host;
  } catch {
    return false;
  }
}
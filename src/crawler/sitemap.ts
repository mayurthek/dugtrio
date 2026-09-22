import { normalizeUrl } from "./link-normalizer.js";

/**
 * Fetch sitemap.xml (and sitemap-index files one level deep) and return the
 * list of page URLs found. Returns [] when no sitemap exists.
 */
export async function fetchSitemap(baseUrl: string): Promise<string[]> {
  const urls: string[] = [];

  const fetchUrl = async (href: string, nested = false): Promise<string[]> => {
    const found: string[] = [];
    let res: Response;
    try {
      res = await fetch(new URL(href, baseUrl));
    } catch {
      return found;
    }
    if (!res.ok) return found;

    const text = await res.text();
    const isIndex = text.includes("<sitemapindex") || (nested && text.includes("<sitemap>"));

    const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const loc of locs) {
      if (isIndex) {
        const nestedUrls = await fetchUrl(loc, true);
        found.push(...nestedUrls);
      } else {
        const parsed = new URL(loc.trim(), baseUrl);
        if (parsed.pathname.endsWith(".xml")) continue; // nested index we already got
        found.push(normalizeUrl(loc.trim(), baseUrl));
      }
    }
    return found;
  };

  const rootUrls = await fetchUrl("/sitemap.xml");
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  for (const url of [...rootUrls, ...urls]) {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
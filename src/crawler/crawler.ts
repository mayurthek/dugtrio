import { chromium, type Page, type APIRequestContext } from "playwright";
import { join } from "node:path";
import { normalizeUrl, isInternalLink } from "./link-normalizer.js";
import { CRAWLER_USER_AGENT, fetchRobots, isPathAllowed } from "./robots.js";
import { fetchSitemap } from "./sitemap.js";
import type { CrawlOptions, CrawlPage, CrawlReport, BrokenLink, FindingCounts, CrawlEvent } from "./types.js";
import { runPageAgents, trackPage } from "../agents/index.js";
import type { Finding } from "../agents/types.js";

interface QueueItem {
  url: string;
  canonical: string;
  depth: number;
  discoveredFrom?: string;
}

interface DeferredCheck {
  from: string;
  href: string;
  target: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ensureAbsolute(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return trimmed;
  return `https://${trimmed}`;
}

async function extractLinks(page: Page, base: string): Promise<{ raw: string; absolute: string; target: string }[]> {
  const raws = await page.$$eval("a[href]", (els) =>
    els.map((e) => e.getAttribute("href")).filter(Boolean) as string[]
  );
  const host = new URL(base).host;
  const found: { raw: string; absolute: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const absolute = new URL(raw, base).href;
    if (!isInternalLink(absolute, host)) continue;
    const target = normalizeUrl(absolute, base);
    if (seen.has(target)) continue;
    seen.add(target);
    found.push({ raw, absolute, target });
  }
  return found;
}

export async function crawl(options: CrawlOptions): Promise<CrawlReport> {
  const baseUrl = ensureAbsolute(options.baseUrl);
  const maxPages = options.maxPages ?? 50;
  const pageTimeout = options.pageTimeout ?? 15_000;
  const totalTimeout = options.totalTimeout ?? 5 * 60_000;
  const maxDepth = options.maxDepth ?? 3;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const screenshotsDir = options.screenshotsDir ?? join(process.cwd(), "artifacts", "screenshots");

  const startedAt = new Date();
  const deadline = Date.now() + totalTimeout;

  const stats = {
    discovered: 0,
    crawled: 0,
    skippedRobots: 0,
    skippedDepth: 0,
    skippedLimit: 0,
    failed: 0,
    brokenLinks: 0,
  };

  const pages: CrawlPage[] = [];
  const brokenLinks: BrokenLink[] = [];
  const allFindings: Finding[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = [];
  const deferredChecks: DeferredCheck[] = [];

  let plannedVisits = 0;
  let attempted = 0;
  const emit = (evt: CrawlEvent) => options.onEvent?.(evt);
  const log = (level: "info" | "ok" | "warn", message: string) => {
    emit({ type: "log", level, message });
  };

  const browser = await chromium.launch({ headless: true });

  const enqueue = (item: QueueItem) => {
    plannedVisits++;
    queue.push(item);
  };

  try {
    const robots = await fetchRobots(baseUrl);
    emit({ type: "started", baseUrl });
    log("info", `Crawling ${baseUrl} (max ${maxPages} pages, depth ${maxDepth})`);

    const seed = normalizeUrl(baseUrl, baseUrl);
    const seedPath = new URL(seed).pathname;
    if (!isPathAllowed(robots, seedPath)) {
      throw new Error(`The site's robots.txt disallows crawling "${seedPath}".`);
    }
    visited.add(seed);
    stats.discovered++;
    enqueue({ url: baseUrl, canonical: seed, depth: 0, discoveredFrom: undefined });

    const sitemapUrls = await fetchSitemap(baseUrl);
    if (sitemapUrls.length > 0) log("info", `Found ${sitemapUrls.length} URLs in sitemap.xml`);
    for (const sitemapUrl of sitemapUrls) {
      if (visited.has(sitemapUrl)) continue;
      visited.add(sitemapUrl);
      stats.discovered++;
      if (!isPathAllowed(robots, new URL(sitemapUrl).pathname)) {
        stats.skippedRobots++;
        continue;
      }
      if (plannedVisits >= maxPages) {
        stats.skippedLimit++;
        deferredChecks.push({ from: "sitemap.xml", href: sitemapUrl, target: sitemapUrl });
        continue;
      }
      if (1 > maxDepth) {
        stats.skippedDepth++;
        deferredChecks.push({ from: "sitemap.xml", href: sitemapUrl, target: sitemapUrl });
        continue;
      }
      enqueue({ url: sitemapUrl, canonical: sitemapUrl, depth: 1, discoveredFrom: "sitemap.xml" });
    }

    const visit = async (item: QueueItem) => {
      attempted++;
      log("info", `Testing ${item.canonical} (depth ${item.depth})`);
      const page = await browser.newPage({ userAgent: CRAWLER_USER_AGENT });
      page.setDefaultTimeout(pageTimeout);
      const telemetry = trackPage(page);

      const record: CrawlPage = {
        url: item.url,
        canonical: item.canonical,
        status: 0,
        depth: item.depth,
        discoveredFrom: item.discoveredFrom,
        links: [],
        findings: [],
      };
      let duplicate = false;

      try {
        const resp = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: pageTimeout });
        const finalUrl = page.url();
        const canonical = normalizeUrl(finalUrl, baseUrl);

        // Redirect landed on an already-crawled page -> nothing new to record.
        if (visited.has(canonical) && canonical !== item.canonical) {
          duplicate = true;
          return;
        }

        if (!visited.has(canonical)) visited.add(canonical);

        record.url = finalUrl;
        record.canonical = canonical;
        record.status = resp?.status() ?? 0;
        record.title = (await page.title()).trim();
        record.contentType = resp?.headers()["content-type"];

        const nextDepth = item.depth + 1;
        for (const link of await extractLinks(page, finalUrl)) {
          record.links.push(link.target);
          if (visited.has(link.target)) continue;

          visited.add(link.target);
          stats.discovered++;

          if (!isPathAllowed(robots, new URL(link.target).pathname)) {
            stats.skippedRobots++;
            continue;
          }
          if (nextDepth > maxDepth) {
            stats.skippedDepth++;
            deferredChecks.push({ from: finalUrl, href: link.raw, target: link.target });
            continue;
          }
          if (plannedVisits >= maxPages) {
            stats.skippedLimit++;
            deferredChecks.push({ from: finalUrl, href: link.raw, target: link.target });
            continue;
          }
          enqueue({ url: link.absolute, canonical: link.target, depth: nextDepth, discoveredFrom: finalUrl });
        }

        // Run the worker agents against this page.
        const pageFindings = await runPageAgents({
          page,
          pageRecord: record,
          response: resp,
          finalUrl,
          baseUrl,
          telemetry,
          screenshotsDir,
        });
        record.findings = pageFindings;
        allFindings.push(...pageFindings);
        emit({ type: "page", page: record });
        emit({
          type: "stats",
          stats: { crawled: pages.length + 1, discovered: stats.discovered, planned: plannedVisits, failed: stats.failed },
        });
        if (pageFindings.length > 0) {
          log("ok", `${pageFindings.length} flaw(s) found on ${canonical}`);
        } else {
          log("info", `${canonical} looks clean`);
        }
      } catch (err) {
        stats.failed++;
        record.error = err instanceof Error ? err.message : String(err);
      } finally {
        await page.close().catch(() => {});
      }

      if (duplicate) return;
      pages.push(record);

      // A real page we visited and got an error status is a broken link too.
      if (record.status >= 400 && record.discoveredFrom) {
        const link: BrokenLink = {
          from: record.discoveredFrom,
          href: record.url,
          target: record.canonical,
          status: record.status,
        };
        brokenLinks.push(link);
        emit({ type: "brokenLink", link });
        log("warn", `Broken link: ${record.canonical} (HTTP ${record.status})`);
      }
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        if (Date.now() >= deadline) break;
        const item = queue.shift();
        if (!item) {
          if (queue.length === 0 && attempted >= plannedVisits) break;
          await sleep(30);
          continue;
        }
        await visit(item);
      }
    });
    await Promise.all(workers);

    const apiContext = await browser.newContext({ userAgent: CRAWLER_USER_AGENT });
    try {
      for (const check of deferredChecks) {
        if (Date.now() >= deadline) break;
        const status = await checkTarget(apiContext.request, check.target, pageTimeout);
        if (status >= 400 || status === 0) {
          const link: BrokenLink = { from: check.from, href: check.href, target: check.target, status };
          brokenLinks.push(link);
          emit({ type: "brokenLink", link });
          log("warn", `Broken link: ${check.target} (HTTP ${status})`);
        }
      }
    } finally {
      await apiContext.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const endedAt = new Date();
  const report: CrawlReport = {
    baseUrl: ensureAbsolute(baseUrl),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    stats: {
      ...stats,
      crawled: pages.length,
      brokenLinks: brokenLinks.length,
      findings: summarizeFindings(allFindings),
    },
    pages,
    brokenLinks,
    findings: allFindings,
  };
  emit({ type: "done", report });
  return report;
}

function summarizeFindings(findings: Finding[]): FindingCounts {
  const counts: FindingCounts = { high: 0, medium: 0, low: 0, byCategory: {} };
  for (const f of findings) {
    counts[f.severity]++;
    counts.byCategory[f.category] = (counts.byCategory[f.category] ?? 0) + 1;
  }
  return counts;
}

async function checkTarget(request: APIRequestContext, target: string, timeout: number): Promise<number> {
  try {
    const res = await request.get(target, { timeout, failOnStatusCode: false });
    return res.status();
  } catch {
    return 0;
  }
}
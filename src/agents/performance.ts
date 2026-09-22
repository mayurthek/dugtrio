import type { AgentContext, Finding, PageAgent } from "./types.js";

interface NavTimings {
  ttfb: number;
  dcl: number;
  load: number;
  requestCount: number;
  largest: { url: string; size: number } | null;
}

const formatBytes = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

async function readTimings(ctx: AgentContext): Promise<NavTimings | null> {
  try {
    const t = await ctx.page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return null;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      let largest = null;
      let largestSize = 0;
      for (const r of resources) {
        const size = r.transferSize || r.decodedBodySize || 0;
        if (size > largestSize) {
          largestSize = size;
          largest = { url: r.name, size };
        }
      }
      return {
        ttfb: Math.max(0, nav.responseStart - nav.startTime),
        dcl: Math.max(0, nav.domContentLoadedEventEnd - nav.startTime),
        load: Math.max(0, nav.loadEventEnd - nav.startTime),
        requestCount: resources.length,
        largest,
      };
    });
    return t;
  } catch {
    return null;
  }
}

export const performanceAgent: PageAgent = {
  id: "performance",
  name: "Performance checker",
  category: "performance",
  run: async (ctx) => {
    const findings: Finding[] = [];
    const location = { url: ctx.pageRecord.canonical };

    const t = await readTimings(ctx);
    if (!t) return findings;

    if (t.ttfb > 600) {
      findings.push({
        id: "",
        agent: "performance",
        category: "performance",
        severity: "medium",
        title: `Slow first byte (TTFB ${formatMs(t.ttfb)})`,
        message: `The server took ${formatMs(t.ttfb)} before sending the first byte (recommended: under 600 ms).`,
        location,
        evidence: `ttfb=${t.ttfb}ms`,
        fix: "Speed up the backend response: add caching/CDN, optimize slow database queries, or precompute/stream the HTML.",
      });
    }

    if (t.dcl > 2500) {
      findings.push({
        id: "",
        agent: "performance",
        category: "performance",
        severity: "medium",
        title: `Slow to become interactive (DOM ready ${formatMs(t.dcl)})`,
        message: `The DOM finished loading after ${formatMs(t.dcl)} (recommended: under 2.5 s).`,
        location,
        evidence: `dcl=${t.dcl}ms`,
        fix: "Reduce render-blocking CSS/JS, defer non-critical scripts, and lazy-load below-the-fold content.",
      });
    }

    if (t.load > 4000) {
      findings.push({
        id: "",
        agent: "performance",
        category: "performance",
        severity: "high",
        title: `Slow full page load (${formatMs(t.load)})`,
        message: `The page took ${formatMs(t.load)} to fully load (recommended: under 4 s).`,
        location,
        evidence: `load=${t.load}ms`,
        fix: "Compress images, minify CSS/JS, enable HTTP compression, and consider a CDN for static assets.",
      });
    }

    if (t.requestCount > 80) {
      findings.push({
        id: "",
        agent: "performance",
        category: "performance",
        severity: "low",
        title: `${t.requestCount} network requests`,
        message: `The page makes ${t.requestCount} network requests, which slows rendering on weak connections.`,
        location,
        evidence: `requests=${t.requestCount}`,
        fix: "Bundle CSS/JS files, use CSS sprites or inlined SVGs, and remove unused plugins/widgets.",
      });
    }

    if (t.largest && t.largest.size > 1024 * 1024) {
      const isImage = /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(t.largest.url);
      findings.push({
        id: "",
        agent: "performance",
        category: "performance",
        severity: isImage ? "medium" : "low",
        title: `Very large resource: ${formatBytes(t.largest.size)}`,
        message: `${t.largest.url} is ${formatBytes(t.largest.size)} (the largest resource on the page).`,
        location: { ...location, resource: t.largest.url },
        evidence: t.largest.url,
        fix: isImage
          ? "Resize the image to its display dimensions and serve it as WebP/AVIF or a compressed JPEG/PNG."
          : "Split this into smaller chunks, remove unused code, or enable compression for it.",
      });
    }

    return findings;
  },
};

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}
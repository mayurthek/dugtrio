import type { AgentContext, Finding, PageAgent } from "./types.js";

const HIGH_TYPES = new Set(["script", "stylesheet"]);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export const functionalAgent: PageAgent = {
  id: "functional",
  name: "Functional tester",
  category: "functional",
  run: async ({ page, finalUrl, telemetry, pageRecord }) => {
    const findings: Finding[] = [];
    const location = { url: pageRecord.canonical };

    // --- Uncaught JavaScript exceptions -----------------------------------
    for (const err of unique(telemetry.pageErrors).slice(0, 5)) {
      findings.push({
        id: "",
        agent: "functional",
        category: "functional",
        severity: "high",
        title: "Uncaught JavaScript exception",
        message: err,
        location,
        evidence: err,
        fix: "Fix the code that throws this exception (see evidence for the stack trace). A try/catch or a null check on the failing value usually resolves it.",
      });
    }

    // --- console.error messages -------------------------------------------
    if (telemetry.consoleErrors.length > 0) {
      const texts = unique(telemetry.consoleErrors).slice(0, 3).join(" | ");
      findings.push({
        id: "",
        agent: "functional",
        category: "functional",
        severity: "medium",
        title: `${telemetry.consoleErrors.length} console error(s) logged`,
        message: `The page logged ${telemetry.consoleErrors.length} error(s) to the console while loading:\n${texts}`,
        location,
        evidence: texts,
        fix: "Investigate the logged error: from console.error() calls, missing data, or failed operations. Remove or handle the failing call path.",
      });
    }

    // --- HTTP errors for sub-resources ------------------------------------
    const seenFailed = new Set<string>();
    for (const fail of telemetry.failedResponses) {
      if (fail.url === finalUrl) continue; // the document itself is reported elsewhere
      const key = `${fail.url}:${fail.status}`;
      if (seenFailed.has(key)) continue;
      seenFailed.add(key);
      const severity = HIGH_TYPES.has(fail.resourceType) ? "high" : "medium";
      findings.push({
        id: "",
        agent: "functional",
        category: "functional",
        severity,
        title: `Resource failed to load (${fail.resourceType}, HTTP ${fail.status})`,
        message: `${fail.url} returned HTTP ${fail.status}.`,
        location: { ...location, resource: fail.url },
        evidence: fail.url,
        fix: `Serve this ${fail.resourceType} from a valid URL and make it return a 2xx status, or remove/repair the reference to it.`,
      });
    }

    // --- Network-level failures (DNS, refused, cert, aborted) --------------
    for (const fail of unique(telemetry.failedRequests).slice(0, 5)) {
      if (fail.url === finalUrl) continue;
      findings.push({
        id: "",
        agent: "functional",
        category: "functional",
        severity: HIGH_TYPES.has(fail.resourceType) ? "high" : "medium",
        title: `Network error loading ${fail.resourceType}`,
        message: `${fail.url} failed: ${fail.error ?? "unknown network error"}`,
        location: { ...location, resource: fail.url },
        evidence: fail.url,
        fix: `Check the URL and the server: the resource could not be fetched (${fail.error ?? "network error"}).`,
      });
    }

    // --- Broken images -----------------------------------------------------
    const brokenImages = await page.evaluate(() => {
      const broken: { src: string; count: number }[] = [];
      const counts = new Map<string, number>();
      for (const img of document.querySelectorAll<HTMLImageElement>("img[src]")) {
        if (img.complete && img.naturalWidth === 0) {
          counts.set(img.src, (counts.get(img.src) ?? 0) + 1);
        }
      }
      for (const [src, count] of counts) broken.push({ src, count });
      return broken.slice(0, 5);
    });
    if (brokenImages.length > 0) {
      findings.push({
        id: "",
        agent: "functional",
        category: "functional",
        severity: "medium",
        title: `${brokenImages.length} broken image(s) on the page`,
        message: brokenImages
          .map((b) => `${b.src} (${b.count}x)`)
          .join("\n"),
        location,
        evidence: brokenImages.map((b) => b.src).join("\n"),
        fix: "Fix the image src to point at an existing file, or upload/replace the missing asset so browsers can decode it.",
      });
    }

    return findings;
  },
};
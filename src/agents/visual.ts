import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentContext, Finding, PageAgent } from "./types.js";

export const visualAgent: PageAgent = {
  id: "visual",
  name: "Visual / UI checker",
  category: "visual",
  run: async ({ page, pageRecord, baseUrl, screenshotsDir }: AgentContext) => {
    const findings: Finding[] = [];
    const location = { url: pageRecord.canonical };

    // --- Horizontal overflow / elements wider than the viewport ------------
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const hasScroll = doc.scrollWidth > vw + 1;
      const wide: Element[] = [];
      if (hasScroll) {
        for (const el of document.querySelectorAll("body *")) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.right > vw + 2 || r.width > vw + 2) wide.push(el);
          if (wide.length >= 6) break;
        }
      }
      const offenders = wide.map((el) => {
        const id = el.id;
        const cls = Array.from(el.classList).slice(0, 2).join(".");
        const tag = el.tagName.toLowerCase();
        const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : tag;
        const r = el.getBoundingClientRect();
        return { selector, right: Math.round(r.right), width: Math.round(r.width) };
      });
      return { hasScroll, offenders };
    });

    if (overflow.hasScroll) {
      const offendersText = overflow.offenders
        .map((o) => `${o.selector} (spans to ${o.right}px, width ${o.width}px)`)
        .join("\n");
      findings.push({
        id: "",
        agent: "visual",
        category: "visual",
        severity: "medium",
        title: "Page scrolls horizontally (content wider than the viewport)",
        message:
          overflow.offenders.length > 0
            ? `Elements wider than the viewport:\n${offendersText}`
            : "The document is wider than the viewport; no obvious single element was found.",
        location,
        evidence: offendersText,
        fix: "Remove fixed widths / min-widths and left/right margins that push elements past the viewport, or make them responsive (width: 100% / max-width: 100%).",
      });
    }

    // --- Element pushed far below the visible viewport --------------------
    const traps = await page.evaluate(() => {
      const vh = document.documentElement.clientHeight;
      const far: Element[] = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.top > vh + 400 && r.height > 0) far.push(el);
        if (far.length >= 3) break;
      }
      return far.map((el) => {
        const id = el.id;
        const cls = Array.from(el.classList).slice(0, 2).join(".");
        const tag = el.tagName.toLowerCase();
        const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : tag;
        return { selector, top: Math.round(el.getBoundingClientRect().top) };
      });
    });
    if (traps.length > 0) {
      findings.push({
        id: "",
        agent: "visual",
        category: "visual",
        severity: "low",
        title: "Content pushed more than one viewport below the fold",
        message: traps.map((t) => `${t.selector} starts ${t.top}px down the page`).join("\n"),
        location,
        evidence: traps.map((t) => t.selector).join(", "),
        fix: "Check for large margins or spacers pushing content down (e.g. empty containers with min-heights, or a broken flex/grid layout).",
      });
    }

    // --- Full-page screenshot as evidence ----------------------------------
    try {
      await mkdir(screenshotsDir, { recursive: true });
      const host = new URL(baseUrl).host;
      const filename = `${host}%${pageRecord.depth}%${String(pageRecord.canonical).replace(/[^a-z0-9]+/gi, "_").slice(-60)}.png`;
      const path = join(screenshotsDir, filename);
      await page.screenshot({ path, fullPage: true }).catch(() => {
        return page.screenshot({ path });
      });
      pageRecord.screenshot = path;
    } catch {
      // Screenshot is best-effort evidence; never fails the run.
    }

    return findings;
  },
};
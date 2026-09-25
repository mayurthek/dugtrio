import type { Category, Finding, Severity } from "../agents/types.js";
import type { BrokenLink, CrawlReport } from "../crawler/types.js";

export interface FindingOccurrence {
  url: string;
  selector?: string;
  resource?: string;
  evidence?: string;
}

/** A flaw is a de-duplicated finding: one problem, many occurrences. */
export interface Flaw {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  message: string;
  fix: string;
  /** Every page where this flaw was seen. */
  occurrences: FindingOccurrence[];
  /** Number of distinct pages affected. */
  affectedPages: number;
}

export interface PageSummary {
  url: string;
  title?: string;
  status: number;
  depth: number;
  findings: number;
  bySeverity: { high: number; medium: number; low: number };
  worst: Severity | "clean";
  screenshot?: string;
}

export interface TestReport {
  baseUrl: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** 0-100 health score; higher is better. */
  score: number;
  summary: {
    pagesTested: number;
    brokenLinks: number;
    totalFindings: number;
    uniqueFlaws: number;
    bySeverity: { high: number; medium: number; low: number };
    byCategory: Record<string, number>;
  };
  /** Deduped flaws, ranked: severity first, then number of pages affected. */
  flaws: Flaw[];
  /** Per-page summary of the run. */
  pages: PageSummary[];
  brokenLinks: BrokenLink[];
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const SCORE_WEIGHT: Record<Severity, number> = { high: 8, medium: 4, low: 1 };
/** A flaw that hits 5 pages or 500 pages costs the same as 5 pages. */
const SCORE_PAGES_CAP = 5;
const BROKEN_LINK_PENALTY = 4;

/**
 * Normalized identity of a flaw so identical problems across pages (or with
 * different counts/measurements) collapse into one. Numbers become "n".
 */
export function flawKey(f: Finding): string {
  const title = f.title
    .toLowerCase()
    .replace(/\d+/g, "n")
    .replace(/\s+/g, " ")
    .trim();
  return `${f.category}|${title}`;
}

function summarize(crawl: CrawlReport): TestReport["summary"] {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byCategory: Record<string, number> = {};
  for (const f of crawl.findings) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }
  return {
    pagesTested: crawl.pages.length,
    brokenLinks: crawl.brokenLinks.length,
    totalFindings: crawl.findings.length,
    uniqueFlaws: 0, // filled by buildTestReport
    bySeverity,
    byCategory,
  };
}

function scoreOf(flaws: Flaw[], brokenLinks: BrokenLink[]): number {
  let score = 100;
  for (const flaw of flaws) {
    score -= SCORE_WEIGHT[flaw.severity] * Math.min(flaw.affectedPages, SCORE_PAGES_CAP);
  }
  score -= BROKEN_LINK_PENALTY * brokenLinks.length;
  return Math.max(0, Math.min(100, score));
}

/** Turn a raw crawl report into the ranked, de-duplicated TestReport. */
export function buildTestReport(crawl: CrawlReport): TestReport {
  const groups = new Map<string, Flaw>();

  for (const finding of crawl.findings) {
    const key = flawKey(finding);
    let flaw = groups.get(key);
    if (!flaw) {
      flaw = {
        id: key,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        message: finding.message,
        fix: finding.fix,
        occurrences: [],
        affectedPages: 0,
      };
      groups.set(key, flaw);
    }
    // Keep the highest severity seen for this flaw.
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[flaw.severity]) {
      flaw.severity = finding.severity;
    }
    flaw.occurrences.push({
      url: finding.location.url,
      selector: finding.location.selector,
      resource: finding.location.resource,
      evidence: finding.evidence,
    });
  }

  const flaws = [...groups.values()].map((flaw) => ({
    ...flaw,
    affectedPages: new Set(flaw.occurrences.map((o) => o.url)).size,
  }));

  // Rank: severity first, then most pages affected, then alphabetically.
  flaws.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.affectedPages - a.affectedPages ||
      a.title.localeCompare(b.title)
  );

  const pages: PageSummary[] = crawl.pages.map((page) => {
    const bySeverity = { high: 0, medium: 0, low: 0 };
    for (const f of page.findings) bySeverity[f.severity]++;
    const worst: PageSummary["worst"] = bySeverity.high
      ? "high"
      : bySeverity.medium
        ? "medium"
        : bySeverity.low
          ? "low"
          : "clean";
    return {
      url: page.canonical,
      title: page.title,
      status: page.status,
      depth: page.depth,
      findings: page.findings.length,
      bySeverity,
      worst,
      screenshot: page.screenshot,
    };
  });

  const summary = summarize(crawl);
  summary.uniqueFlaws = flaws.length;

  return {
    baseUrl: crawl.baseUrl,
    startedAt: crawl.startedAt,
    endedAt: crawl.endedAt,
    durationMs: crawl.durationMs,
    score: scoreOf(flaws, crawl.brokenLinks),
    summary,
    flaws,
    pages,
    brokenLinks: crawl.brokenLinks,
  };
}
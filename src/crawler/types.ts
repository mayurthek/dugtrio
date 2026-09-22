export interface CrawlOptions {
  baseUrl: string;
  /** Maximum number of pages to crawl. */
  maxPages?: number;
  /** Per-page navigation timeout in ms. */
  pageTimeout?: number;
  /** Overall crawl timeout in ms. */
  totalTimeout?: number;
  /** Max link depth from the seed page (root = 0). */
  maxDepth?: number;
  /** Limiter for concurrent page visits. */
  concurrency?: number;
  /** Where to write screenshot artifacts. */
  screenshotsDir?: string;
  /** Receive real-time crawl events (used for live UI). */
  onEvent?: (evt: CrawlEvent) => void;
}

export interface LiveStats {
  crawled: number;
  discovered: number;
  planned: number;
  failed: number;
}

export type CrawlEvent =
  | { type: "started"; baseUrl: string }
  | { type: "log"; level: "info" | "ok" | "warn"; message: string }
  | { type: "page"; page: CrawlPage }
  | { type: "stats"; stats: LiveStats }
  | { type: "brokenLink"; link: BrokenLink }
  | { type: "done"; report: CrawlReport }
  | { type: "error"; message: string };

import type { Finding } from "../agents/types.js";

export interface FindingCounts {
  high: number;
  medium: number;
  low: number;
  byCategory: Record<string, number>;
}

export interface CrawlPage {
  /** Final URL after redirects. */
  url: string;
  /** Normalized URL used as the stable key. */
  canonical: string;
  /** HTTP status of the final response. */
  status: number;
  /** Document title, if any. */
  title?: string;
  /** Content type of the response. */
  contentType?: string;
  /** Crawl depth (root page = 0). */
  depth: number;
  /** URL of the page that linked to this one. */
  discoveredFrom?: string;
  /** Internal links found on the page (normalized). */
  links: string[];
  /** Distinct internal links on the page that we discovered but could not crawl. */
  brokenLinks?: BrokenLink[];
  /** Set when the page could not be loaded (timeout, connection error, ...). */
  error?: string;
  /** Full-page screenshot captured as evidence (path on disk). */
  screenshot?: string;
  /** Flaws the worker agents found on this page. */
  findings: Finding[];
}

export interface BrokenLink {
  /** The page the broken link lives on. */
  from: string;
  /** The target href as written in the source. */
  href: string;
  /** The normalized target we tried to resolve. */
  target: string;
  /** HTTP status observed (404, 500, ...). */
  status: number;
}

export interface CrawlReport {
  baseUrl: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stats: {
    discovered: number;
    crawled: number;
    skippedRobots: number;
    skippedDepth: number;
    skippedLimit: number;
    failed: number;
    brokenLinks: number;
    findings: FindingCounts;
  };
  pages: CrawlPage[];
  brokenLinks: BrokenLink[];
  /** Every finding from every page, as a flat list. */
  findings: Finding[];
}

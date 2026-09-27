import type { Page, Response } from "playwright";
import type { CrawlPage } from "../crawler/types.js";

export type Severity = "high" | "medium" | "low";
export type Category = "functional" | "visual" | "accessibility" | "performance" | "security";

export interface FailedResource {
  /** Request URL that failed. */
  url: string;
  /** HTTP status when the server answered; 0 for network-level failures. */
  status: number;
  /** Resource type as reported by Playwright (script, stylesheet, image, fetch, ...). */
  resourceType: string;
  /** Error text for network failures. */
  error?: string;
}

/** Everything the page emitted while it was loading. Collected by the crawler. */
export interface Telemetry {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: FailedResource[];
  failedRequests: FailedResource[];
  requests: { url: string; navigation: boolean }[];
}

export interface FindingLocation {
  /** The page (canonical URL) where the problem lives. */
  url: string;
  /** CSS selector of the offending element, when applicable. */
  selector?: string;
  /** URL of a failing component (broken resource, bad form action, ...). */
  resource?: string;
}

export interface Finding {
  id: string;
  /** Agent id that produced it, e.g. "functional". */
  agent: string;
  category: Category;
  severity: Severity;
  title: string;
  message: string;
  location: FindingLocation;
  /** Supporting detail: screenshot path, failing request, stack snippet, ... */
  evidence?: string;
  /** Concrete suggestion for fixing the flaw. */
  fix: string;
}

export interface AgentContext {
  page: Page;
  /** The page record being inspected. */
  pageRecord: CrawlPage;
  /** Final navigation response of the page load. */
  response: Response | null;
  /** Final URL (after redirects). */
  finalUrl: string;
  baseUrl: string;
  telemetry: Telemetry;
  /** Where to persist screenshot evidence. */
  screenshotsDir: string;
}

export interface PageAgent {
  id: string;
  name: string;
  category: Category;
  run(ctx: AgentContext): Promise<Finding[]>;
}

/**
 * Emitted the moment a single agent finishes with a page, so the UI can show
 * flaws as they are picked up instead of waiting for the slowest agent.
 */
export interface AgentRunEvent {
  /** Agent id, e.g. "accessibility". */
  agent: string;
  name: string;
  category: Category;
  /** Canonical URL of the page that was inspected. */
  url: string;
  /** Findings this agent produced (already id-assigned). */
  findings: Finding[];
  /** How long the agent took on this page. */
  durationMs: number;
  /** Set when the agent threw; the run continues without its findings. */
  error?: string;
}

/** Attach page listeners that record what happened during load into a telemetry bag. */
export function trackPage(page: Page): Telemetry {
  const telemetry: Telemetry = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
    failedRequests: [],
    requests: [],
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") telemetry.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => telemetry.pageErrors.push(err.message));
  page.on("request", (req) => {
    telemetry.requests.push({ url: req.url(), navigation: req.isNavigationRequest() });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      telemetry.failedResponses.push({
        url: res.url(),
        status: res.status(),
        resourceType: res.request().resourceType(),
      });
    }
  });
  page.on("requestfailed", (req) => {
    telemetry.failedRequests.push({
      url: req.url(),
      status: 0,
      resourceType: req.resourceType(),
      error: req.failure()?.errorText,
    });
  });

  return telemetry;
}

/**
 * Clear a telemetry bag in place. Needed when one page is reused across
 * visits (visible-browser mode), so listeners are attached once but each
 * visit only reports its own load.
 */
export function resetTelemetry(telemetry: Telemetry): void {
  telemetry.consoleErrors.length = 0;
  telemetry.pageErrors.length = 0;
  telemetry.failedResponses.length = 0;
  telemetry.failedRequests.length = 0;
  telemetry.requests.length = 0;
}
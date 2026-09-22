import { createRequire } from "node:module";
import type { Page } from "playwright";
import type { AgentContext, Finding, PageAgent, Severity } from "./types.js";

const require = createRequire(import.meta.url);
const AXE_SOURCE = require.resolve("axe-core/axe.min.js");

interface AxeViolationNode {
  target: string;
  html: string;
  summary: string;
}

interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: AxeViolationNode[];
}

function impactToSeverity(impact: string): Severity {
  switch (impact) {
    case "critical":
    case "serious":
      return "high";
    case "moderate":
      return "medium";
    default:
      return "low";
  }
}

async function runAxe(page: Page): Promise<AxeViolation[]> {
  try {
    await page.addScriptTag({ path: AXE_SOURCE });
    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
      const r = await axe.run({
        resultTypes: ["violations"],
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
        },
      });
      return r.violations;
    });
    return result;
  } catch {
    return [];
  }
}

export const accessibilityAgent: PageAgent = {
  id: "accessibility",
  name: "Accessibility checker",
  category: "accessibility",
  run: async ({ page, pageRecord }: AgentContext) => {
    const findings: Finding[] = [];
    const location = { url: pageRecord.canonical };

    const violations = await runAxe(page);
    for (const violation of violations) {
      const node = violation.nodes[0];
      const fixHint = violation.help
        .split("\n")[0]
        .replace(/\s+$/, "");

      findings.push({
        id: "",
        agent: "accessibility",
        category: "accessibility",
        severity: impactToSeverity(violation.impact),
        title: `${violation.id} (${violation.nodes.length} element(s))`,
        message: `${fixHint}\nFirst affected element: ${node?.html ?? "(unknown)"}`,
        location: {
          ...location,
          selector: node?.target,
        },
        evidence: violation.helpUrl,
        fix: `${fixHint}. Reference: ${violation.helpUrl}`,
      });
    }

    return findings;
  },
};
import { randomUUID } from "node:crypto";
import type { AgentContext, Finding, PageAgent } from "./types.js";
import { functionalAgent } from "./functional.js";
import { visualAgent } from "./visual.js";
import { accessibilityAgent } from "./accessibility.js";
import { performanceAgent } from "./performance.js";
import { securityAgent } from "./security.js";

export const agents: PageAgent[] = [
  functionalAgent,
  visualAgent,
  accessibilityAgent,
  performanceAgent,
  securityAgent,
];

/** Run every agent against a page and return their findings with ids assigned. */
export async function runPageAgents(ctx: AgentContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const agent of agents) {
    try {
      const result = await agent.run(ctx);
      for (const finding of result) {
        findings.push({ ...finding, id: randomUUID() });
      }
    } catch (err) {
      if (process.env.DEBUG_AGENTS) {
        console.error(`[agent:${agent.id}] ${err instanceof Error ? err.stack : String(err)}`);
      }
    }
  }
  return findings;
}

export { trackPage } from "./types.js";
export type { Finding, AgentContext, PageAgent, Severity, Category, Telemetry, FindingLocation } from "./types.js";
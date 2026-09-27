import { randomUUID } from "node:crypto";
import type { AgentContext, AgentRunEvent, Finding, PageAgent } from "./types.js";
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

/**
 * Run every agent against a page and return their findings with ids assigned.
 * `onAgent` fires as each agent finishes, so the UI can render flaws live
 * rather than in one batch after the slowest agent completes.
 */
export async function runPageAgents(
  ctx: AgentContext,
  onAgent?: (evt: AgentRunEvent) => void
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const agent of agents) {
    const startedAt = Date.now();
    const base = {
      agent: agent.id,
      name: agent.name,
      category: agent.category,
      url: ctx.pageRecord.canonical,
    };
    try {
      const result = await agent.run(ctx);
      const withIds = result.map((f) => ({ ...f, id: randomUUID() }));
      findings.push(...withIds);
      onAgent?.({ ...base, findings: withIds, durationMs: Date.now() - startedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Report the failure too, so a stalled agent shows up as such instead of silence.
      onAgent?.({ ...base, findings: [], durationMs: Date.now() - startedAt, error: message });
      if (process.env.DEBUG_AGENTS) {
        console.error(`[agent:${agent.id}] ${err instanceof Error ? err.stack : String(err)}`);
      }
    }
  }
  return findings;
}

export { trackPage, resetTelemetry } from "./types.js";
export type { Finding, AgentContext, AgentRunEvent, PageAgent, Severity, Category, Telemetry, FindingLocation } from "./types.js";
export const CRAWLER_USER_AGENT = "DugtrioBot/0.1 (+https://dugtrio.test)";

interface RobotsRule {
  agent: string;
  path: string;
  allow: boolean;
}

interface RuleSet {
  rules: RobotsRule[];
}

const stripComment = (line: string): string => {
  const idx = line.indexOf("#");
  return (idx === -1 ? line : line.slice(0, idx)).trim();
};

/**
 * Minimal robots.txt parser. Groups rules by user-agent, supports Allow +
 * Disallow with longest-prefix-match semantics. Wildcards (`$`, `*`) are not
 * supported; paths are matched as plain prefixes, which is adequate for the
 * safety-rail purpose of this module.
 */
export function parseRobotsTxt(raw: string): RuleSet {
  const rules: RobotsRule[] = [];
  let currentAgent: string | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line) continue;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === "user-agent") {
      currentAgent = value;
    } else if ((key === "allow" || key === "disallow") && currentAgent) {
      if (value === "") {
        if (key === "disallow") continue; // empty Disallow = allow everything
        rules.push({ agent: currentAgent, path: "/", allow: true });
      } else {
        rules.push({ agent: currentAgent, path: value, allow: key === "allow" });
      }
    }
  }

  return { rules };
}

/**
 * True when the given path may be crawled. Uses longest-prefix matching with
 * the group matching our crawler user agent (specific UA wins over "*").
 */
export function isPathAllowed(rules: RuleSet, path: string): boolean {
  const applicable = rules.rules.filter(
    (r) => r.agent === CRAWLER_USER_AGENT || r.agent === "*"
  );
  if (applicable.length === 0) return true;

  const sorted = [...applicable].sort(
    (a, b) => b.path.length - a.path.length
  );
  for (const rule of sorted) {
    if (path.startsWith(rule.path)) return rule.allow;
  }
  return true;
}

/** Fetch and parse a site's robots.txt. Returns an empty set if unavailable. */
export async function fetchRobots(baseUrl: string): Promise<RuleSet> {
  const url = new URL("/robots.txt", baseUrl);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": CRAWLER_USER_AGENT },
    });
    if (!res.ok) return { rules: [] };
    return parseRobotsTxt(await res.text());
  } catch {
    return { rules: [] };
  }
}
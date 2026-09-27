export const CRAWLER_USER_AGENT = "DugtrioBot/0.1 (+https://dugtrio.test)";

/**
 * robots.txt `User-agent:` lines carry a product token ("DugtrioBot"), never a
 * full User-Agent header with version and comment URL. Comparing against
 * CRAWLER_USER_AGENT directly never matches, so the token is what we key on.
 */
export const CRAWLER_TOKEN = CRAWLER_USER_AGENT.split(/[\s/]/)[0] as string;

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
 * True when the given path may be crawled. Uses longest-prefix matching. A
 * group that names us directly wins outright over the `*` group, which is what
 * robots.txt expects when a site opts a specific bot in or out.
 */
export function isPathAllowed(rules: RuleSet, path: string): boolean {
  const groupFor = (agent: string) => rules.rules.filter((r) => r.agent.toLowerCase() === agent);
  const specific = groupFor(CRAWLER_TOKEN.toLowerCase());
  const applicable = specific.length > 0 ? specific : groupFor("*");
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
import type { AgentContext, Finding, PageAgent } from "./types.js";

export const securityAgent: PageAgent = {
  id: "security",
  name: "Security checker (basics)",
  category: "security",
  run: async ({ page, finalUrl, telemetry, pageRecord, response }: AgentContext) => {
    const findings: Finding[] = [];
    const location = { url: pageRecord.canonical };
    const final = new URL(finalUrl);
    const headers = (response?.headers?.() ?? {});

    // --- Mixed content: HTTP resources on an HTTPS page --------------------
    if (final.protocol === "https:") {
      const mixed = new Set<string>();
      for (const req of telemetry.requests) {
        if (req.navigation) continue;
        let u: URL;
        try {
          u = new URL(req.url);
        } catch {
          continue;
        }
        if (u.protocol === "http:") mixed.add(req.url);
      }
      const list = [...mixed].slice(0, 5);
      if (list.length > 0) {
        findings.push({
          id: "",
          agent: "security",
          category: "security",
          severity: "high",
          title: `Mixed content: ${mixed.size} HTTP resource(s) on a secure page`,
          message: list.join("\n"),
          location: { ...location, resource: list[0] },
          evidence: list.join("\n"),
          fix: "Load these resources over https:// (or use protocol-relative /<path> URLs) so the browser doesn't block them and no content can be tampered with in transit.",
        });
      }
    }

    // --- Browser security headers -----------------------------------------
    if (final.protocol === "https:") {
      const csp = headers["content-security-policy"];
      const frame = headers["x-frame-options"];
      if (!csp && !frame) {
        findings.push({
          id: "",
          agent: "security",
          category: "security",
          severity: "low",
          title: "Page can be embedded (no framing protection)",
          message: "No Content-Security-Policy frame-ancestors directive and no X-Frame-Options header were sent.",
          location,
          evidence: "missing: content-security-policy, x-frame-options",
          fix: "Add `X-Frame-Options: DENY` (or `Content-Security-Policy: frame-ancestors 'none'`) unless you intentionally allow embedding.",
        });
      }
    }
    if (!headers["content-security-policy"]) {
      findings.push({
        id: "",
        agent: "security",
        category: "security",
        severity: "medium",
        title: "No Content-Security-Policy header",
        message: "The site does not restrict what scripts/styles can run, which increases XSS risk.",
        location,
        evidence: "missing: content-security-policy",
        fix: "Send a Content-Security-Policy header allowing only trusted sources, e.g. `default-src 'self'; script-src 'self'`.",
      });
    }
    if (!headers["x-content-type-options"]) {
      findings.push({
        id: "",
        agent: "security",
        category: "security",
        severity: "low",
        title: "Missing X-Content-Type-Options header",
        message: "The browser could sniff a resource's MIME type instead of trusting the declared one.",
        location,
        evidence: "missing: x-content-type-options",
        fix: "Send `X-Content-Type-Options: nosniff` on responses.",
      });
    }
    if (final.protocol === "https:" && !headers["strict-transport-security"]) {
      findings.push({
        id: "",
        agent: "security",
        category: "security",
        severity: "low",
        title: "Missing Strict-Transport-Security header",
        message: "Browsers are not told to force HTTPS for this host.",
        location,
        evidence: "missing: strict-transport-security",
        fix: "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` once HTTPS is fully working.",
      });
    }

    // --- Index pages shouldn't leak / expose headers ----------------------
    const server = headers["server"];
    if (server && /(apache|nginx|iis)\/\d/.test(server)) {
      findings.push({
        id: "",
        agent: "security",
        category: "security",
        severity: "low",
        title: "Server software version exposed",
        message: `The Server header advertises "${server}", helping attackers pick exploits.`,
        location,
        evidence: `server: ${server}`,
        fix: "Disable or obfuscate the Server header in your web server configuration.",
      });
    }

    // --- Forms must not submit over plain HTTP ----------------------------
    const forms = await page.evaluate(() => {
      const bad = [...document.querySelectorAll<HTMLFormElement>("form[action]")]
        .map((f) => f.action)
        .filter((u) => u.startsWith("http:"));
      const insecure = [...bad] as string[];
      return { count: insecure.length, actions: insecure.slice(0, 3) };
    });
    if (forms.count > 0) {
      findings.push({
        id: "",
        agent: "security",
        category: "security",
        severity: "high",
        title: `${forms.count} form(s) submit over plain HTTP`,
        message: forms.actions.join("\n"),
        location: { ...location, resource: forms.actions[0] },
        evidence: forms.actions.join("\n"),
        fix: "Point every form action to an https:// URL so credentials and user data aren't sent in clear text.",
      });
    }

    // --- target=_blank without rel=noopener --------------------------------
    const blankLinks = await page.evaluate(() => {
      let count = 0;
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[target='_blank']")) {
        const rel = (a.getAttribute("rel") ?? "").split(/\s+/);
        if (!rel.includes("noopener") && !rel.includes("noreferrer")) count++;
      }
      return count;
    });
    if (blankLinks > 0) {
      findings.push({
        id: "",
        agent: "security",
        category: "security",
        severity: "low",
        title: `${blankLinks} new-tab link(s) without rel=\"noopener\"`,
        message: "Opened tabs can access window.opener and tamper with this page (reverse tabnabbing).",
        location,
        evidence: `${blankLinks} <a target=\"_blank\"> without noopener`,
        fix: 'Add `rel="noopener"` (or `rel="noreferrer"`) to every `target="_blank"` link.',
      });
    }

    return findings;
  },
};
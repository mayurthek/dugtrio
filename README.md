<h1 align="center">
  <img src="public/dugtrio.svg" width="276" alt="Dugtrio">
</h1>

<p align="center">Multi-agent website testing. Point it at a URL and it crawls the site, runs five independent agents over every page, and streams each flaw to a live dashboard as it is found.</p>

---

## Quick start

```bash
npm install
npx playwright install chromium   # downloads the browser Playwright drives
npm run server                    # http://localhost:3000
```

The dashboard opens headed by default, so you watch the crawl happen in a real browser window. Set `HEADLESS=1` to run without one.

Prefer the terminal?

```bash
npm run crawl -- https://example.com 25 2
#                                  url    maxPages  maxDepth
```

## How it works

```
crawl (Playwright)
   └─ per page, in order:  functional → visual → accessibility → performance → security
        └─ each agent reports the moment it finishes, not when the slowest one does
             └─ reporter: dedupe → rank → score  →  SSE  →  dashboard
```

A **flaw** is one problem seen many times. The reporter collapses duplicates by normalising the title (digits become `n`, so "3 console errors" and "7 console errors" are the same flaw), counts how many pages each one affects, and ranks by severity then blast radius. That is why the final list is short and the raw finding count is not.

## The agents

| Agent | Looks for |
|---|---|
| **functional** | Uncaught JS exceptions, `console.error` output, failed sub-resources, network-level failures, broken images |
| **visual** | Horizontal overflow, content stranded below the fold; captures a full-page screenshot as evidence |
| **accessibility** | axe-core over `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `best-practice` |
| **performance** | TTFB > 600 ms, DOM ready > 2.5 s, full load > 4 s, > 80 requests, any resource > 1 MB |
| **security** | Mixed content, forms posting over HTTP, missing CSP / HSTS / `X-Content-Type-Options`, no framing protection, exposed server version, `target="_blank"` without `noopener` |

Every finding carries a severity, the page and selector it lives on, and a concrete fix — not just a rule name.

## Scoring

Start at 100 and subtract:

| Event | Cost |
|---|---|
| High-severity flaw | 8 × pages affected (capped at 5) |
| Medium-severity flaw | 4 × pages affected (capped at 5) |
| Low-severity flaw | 1 × pages affected (capped at 5) |
| Broken link | 4 |

The cap matters: a flaw on 5 pages costs the same as the same flaw on 500, so one systemic bug cannot masquerade as hundreds of problems.

## HTTP API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/test` | Start a run. Body: `{ url, maxPages?, maxDepth?, maxLinkChecks? }` → `202 { id }` |
| `GET` | `/events/:id` | SSE stream: `started`, `log`, `agent`, `page`, `stats`, `brokenLink`, `report`, `done`, `error` |
| `GET` | `/report/:id` | Final ranked report, or `{ status }` while still running |
| `GET` | `/jobs` | Every run this process has seen |
| `GET` | `/health` | Liveness |

```bash
curl -X POST localhost:3000/test -H 'content-type: application/json' \
     -d '{"url":"https://example.com","maxPages":10,"maxDepth":1}'
```

Events are buffered per job, so connecting to `/events/:id` late replays what you missed before going live.

## Configuration

| Env | Default | Effect |
|---|---|---|
| `HEADLESS` | unset (headed) | `HEADLESS=1` runs without a visible window |
| `PORT` | `3000` | Server port |
| `DEBUG_AGENTS` | unset | Logs agent stack traces to stderr |

Crawl options: `maxPages` (25 via API, 50 via CLI), `maxDepth` (2 / 3), `pageTimeout` (15 s), `totalTimeout` (5 min), `concurrency` (2, forced to 1 when headed so one window steps through the site), `maxLinkChecks` (50).

`maxLinkChecks` exists because a site with a large sitemap queues every discovered-but-uncrawled URL for an individual HTTP check. Uncapped, a 30,000-URL site ran until the crawl deadline; capped and batched, the same site finishes in seconds. The dashboard logs when it truncates.

## Known limitations

- **Client-rendered sites are under-tested.** Pages load on `domcontentloaded`, so a heavy SPA can hand the agents an empty body. A single-page app with no server-rendered links will report one page and nothing else, which is correct rather than broken — there is genuinely nothing to crawl.
- **`page.evaluate` can lose a race.** If a site navigates via JS after `domcontentloaded`, the execution context is destroyed mid-agent and that agent's findings for the page are lost. The error is reported rather than swallowed, but the page is under-reported.
- **Broken-link checks are capped** at 50 by default, so a large site is sampled, not fully verified.
- **robots.txt is parsed minimally** — prefix matching only. `*` and `$` wildcards inside paths are not honoured, and a site that disallows `/` for `*` will refuse the crawl outright.
- **The functional agent does not click.** It inspects what the page load produced. Buttons, menus and multi-step flows are out of scope.

## Layout

```
src/
  server.ts          Express + SSE, job registry
  crawler/           Playwright crawl, robots.txt, sitemap, URL normalisation
  agents/            the five agents + telemetry collection
  reporter/          dedupe, rank, score
public/              dashboard (vanilla JS, no build step)
```

Screenshots land in `artifacts/screenshots/` and are served at `/screenshots`. That directory is gitignored.

import express, { type Response } from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { crawl } from "./crawler/crawler.js";
import type { CrawlEvent, CrawlReport } from "./crawler/types.js";

interface Job {
  id: string;
  baseUrl: string;
  status: "running" | "done" | "error";
  createdAt: string;
  events: CrawlEvent[];
  clients: Set<Response>;
  report?: CrawlReport;
  error?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotsDir = join(process.cwd(), "artifacts", "screenshots");

const jobs = new Map<string, Job>();
const app = express();
app.use(express.json());

app.use(express.static(join(__dirname, "..", "public")));
app.use("/screenshots", express.static(screenshotsDir));

function broadcast(job: Job, event: CrawlEvent) {
  job.events.push(event);
  const payload = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of job.clients) {
    client.write(payload);
  }
}

function finishEventStream(job: Job) {
  for (const client of job.clients) {
    client.write("event: done\ndata: {}\n\n");
    client.end();
  }
  job.clients.clear();
}

app.post("/test", (req, res) => {
  const baseUrl = (req.body?.url ?? "").toString().trim();
  if (!baseUrl) {
    res.status(400).json({ error: "Provide a 'url' in the request body." });
    return;
  }
  const maxPages = Number(req.body?.maxPages ?? 25);
  const maxDepth = Number(req.body?.maxDepth ?? 2);

  const id = randomUUID();
  const job: Job = {
    id,
    baseUrl,
    status: "running",
    createdAt: new Date().toISOString(),
    events: [],
    clients: new Set(),
  };
  jobs.set(id, job);

  crawl({
    baseUrl,
    maxPages,
    maxDepth,
    onEvent: (event) => {
      broadcast(job, event);
      if (event.type === "done") {
        job.status = "done";
        job.report = event.report;
        finishEventStream(job);
      }
      if (event.type === "error") {
        job.status = "error";
        job.error = event.message;
        finishEventStream(job);
      }
    },
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    job.status = "error";
    job.error = message;
    broadcast(job, { type: "error", message });
    finishEventStream(job);
  });

  res.status(202).json({ id, status: job.status, maxPages, maxDepth });
});

app.get("/events/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "No test with that id." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");

  for (const event of job.events) {
    res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
  }
  if (job.status === "done" || job.status === "error") {
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  job.clients.add(res);
  req.on("close", () => {
    job.clients.delete(res);
  });
});

app.get("/jobs", (_req, res) => {
  res.json(
    [...jobs.values()].map((j) => ({
      id: j.id,
      baseUrl: j.baseUrl,
      status: j.status,
      createdAt: j.createdAt,
      pages: j.report?.stats.crawled ?? j.events.filter((e) => e.type === "page").length,
      findings: j.report?.stats.findings ?? null,
    }))
  );
});

app.get("/report/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "No test with that id." });
    return;
  }
  if (job.status === "running") {
    res.json({ id: job.id, status: job.status });
    return;
  }
  if (job.status === "error") {
    res.status(500).json({ id: job.id, status: job.status, error: job.error });
    return;
  }
  res.json({ id: job.id, status: job.status, report: job.report });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, activeJobs: jobs.size });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Dugtrio running at http://localhost:${port}`);
  console.log("POST /test {url}       -> start a crawl (SSE events at /events/:id)");
  console.log("GET  /events/:id       -> live Server-Sent Events stream");
  console.log("GET  /report/:id       -> fetch final report");
});
import express from "express";
import { randomUUID } from "node:crypto";
import { crawl } from "./crawler/crawler.js";
import type { CrawlReport } from "./crawler/types.js";

interface Job {
  id: string;
  baseUrl: string;
  status: "running" | "done" | "error";
  createdAt: string;
  report?: CrawlReport;
  error?: string;
}

const jobs = new Map<string, Job>();
const app = express();
app.use(express.json());

app.post("/test", (req, res) => {
  const baseUrl = (req.body?.url ?? "").toString().trim();
  if (!baseUrl) {
    res.status(400).json({ error: "Provide a 'url' in the request body." });
    return;
  }

  const id = randomUUID();
  const job: Job = {
    id,
    baseUrl,
    status: "running",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);

  crawl({ baseUrl })
    .then((report) => {
      job.status = "done";
      job.report = report;
    })
    .catch((err) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    });

  res.status(202).json({ id, status: job.status });
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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Dugtrio server listening on http://localhost:${port}`);
  console.log("POST /test {url}       -> start a crawl");
  console.log("GET  /report/:id       -> fetch status / report");
});
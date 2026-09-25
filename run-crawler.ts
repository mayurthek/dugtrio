import { crawl } from "./src/crawler/crawler.js";
import { buildTestReport } from "./src/reporter/reporter.js";

const url = process.argv[2];

if (!url) {
  console.error("Usage: npm run crawl -- https://example.com [maxPages] [maxDepth]");
  process.exit(1);
}

const maxPages = Number(process.argv[3] ?? 50);
const maxDepth = Number(process.argv[4] ?? 3);
if (!Number.isFinite(maxPages) || !Number.isFinite(maxDepth)) {
  console.error("maxPages and maxDepth must be numbers.");
  process.exit(1);
}

const started = Date.now();
console.error(`Crawling ${url} (max ${maxPages} pages, depth ${maxDepth}) ...`);

try {
  const crawlReport = await crawl({ baseUrl: url, maxPages, maxDepth });
  const report = buildTestReport(crawlReport);
  const s = report.summary;
  console.error(
    `Done in ${(Date.now() - started) / 1000}s | score: ${report.score}/100 | ` +
      `pages: ${s.pagesTested}, broken links: ${s.brokenLinks}, ` +
      `findings: ${s.totalFindings} total (${s.uniqueFlaws} unique) | ` +
      `${s.bySeverity.high} high / ${s.bySeverity.medium} med / ${s.bySeverity.low} low`
  );
  process.stdout.write(JSON.stringify(report, null, 2));
} catch (err) {
  console.error(`Crawl failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
import { crawl } from "./src/crawler/crawler.js";

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
  const report = await crawl({ baseUrl: url, maxPages, maxDepth });
  console.error(
    `Done in ${(Date.now() - started) / 1000}s | ` +
      `pages crawled: ${report.stats.crawled}, discovered: ${report.stats.discovered}, ` +
      `broken links: ${report.stats.brokenLinks}, failed: ${report.stats.failed}, ` +
      `findings: ${report.stats.findings.high} high / ${report.stats.findings.medium} med / ${report.stats.findings.low} low`
  );
  process.stdout.write(JSON.stringify(report, null, 2));
} catch (err) {
  console.error(`Crawl failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
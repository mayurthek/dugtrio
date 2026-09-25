const $ = (id) => document.getElementById(id);

const state = {
  jobId: null,
  findings: new Map(),
  screenshots: new Map(),
  pageChips: new Map(),
  startedAt: null,
  severityFilter: "all",
  brokenCount: 0,
  report: null,
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function screenshotUrl(path) {
  if (!path) return null;
  const file = String(path).split(/[\\/]/).pop();
  return `/screenshots/${encodeURIComponent(file)}`;
}

function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function setJet(status, label) {
  const el = $("jet-status");
  el.innerHTML = `<span class="dot ${status}"></span>${esc(label)}`;
}

function log(level, message) {
  const box = $("log");
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const line = document.createElement("div");
  line.className = level;
  line.innerHTML = `<span class="time">${time}</span>  ${esc(message)}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function addChip(page) {
  const box = $("page-chips");
  const chip = document.createElement("span");
  chip.className = "chip";
  const worst = page.findings && page.findings.length ? worstSeverity(page.findings) : null;
  if (worst) chip.classList.add(`sev-${worst}`);
  else chip.classList.add("ok");
  const label = new URL(page.canonical).pathname + (new URL(page.canonical).search || "");
  chip.textContent = label === "/" ? "/" : label.slice(0, 60);
  chip.title = page.canonical;
  box.appendChild(chip);
}

function worstSeverity(findings) {
  const sevs = findings.map((f) => f.severity);
  if (sevs.includes("high")) return "high";
  if (sevs.includes("medium")) return "medium";
  return "low";
}

function findingCard(f) {
  const card = document.createElement("article");
  card.className = `finding sev-${f.severity}`;
  const shotId = state.screenshots.get(f.location.url);
  const shotUrl = shotId ? screenshotUrl(shotId) : null;
  const loc = [
    f.location.url ? `<span class="f-loc">${esc(f.location.url)}</span>` : "",
    f.location.selector ? `<span class="f-loc">Selector: <code>${esc(f.location.selector)}</code></span>` : "",
    f.location.resource ? `<span class="f-loc">↳ ${esc(f.location.resource)}</span>` : "",
  ].join("");

  card.innerHTML = `
    <div class="f-head">
      <span class="badge ${f.severity}">${f.severity}</span>
      <span class="badge cat">${f.category}</span>
      <span class="f-title">${esc(f.title)}</span>
    </div>
    <p class="f-msg">${esc(f.message)}</p>
    ${loc}
    ${shotUrl ? `<div class="f-shot"><a href="${shotUrl}" target="_blank"><img src="${shotUrl}" alt="page screenshot" loading="lazy" /></a></div>` : ""}
    <div class="f-fix"><strong>How to fix</strong>${esc(f.fix)}</div>
  `;
  return card;
}

function appendFinding(f) {
  if (state.findings.has(f.id)) return;
  state.findings.set(f.id, f);
  $("findings-count").textContent = state.findings.size;
  updateCounts();
  renderFindings();
}

function renderFindings() {
  const box = $("findings");
  box.innerHTML = "";
  const byId = (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];

  let items;
  if (state.report) {
    // Final view: deduped, ranked flaws.
    $("findings-count").textContent = state.report.summary.uniqueFlaws;
    items = state.report.flaws.filter(
      (f) => state.severityFilter === "all" || f.severity === state.severityFilter
    );
    if (!items.length) box.innerHTML = '<p class="empty">No findings yet.</p>';
    for (const f of items) box.appendChild(flawCard(f));
    return;
  }

  const list = [...state.findings.values()].sort(byId);
  items = state.severityFilter === "all"
    ? list
    : list.filter((f) => f.severity === state.severityFilter);
  if (!items.length) {
    box.innerHTML = '<p class="empty">No findings yet.</p>';
    return;
  }
  for (const f of items) box.appendChild(findingCard(f));
}

function updateCounts() {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of state.findings.values()) counts[f.severity]++;
  $("stat-high").textContent = counts.high;
  $("stat-med").textContent = counts.medium;
  $("stat-low").textContent = counts.low;
}

function flawCard(flaw) {
  const card = document.createElement("article");
  card.className = `finding sev-${flaw.severity}`;
  const pages = [...new Set(flaw.occurrences.map((o) => o.url))];
  const first = flaw.occurrences[0] ?? {};
  const shotPath = state.screenshots.get(first.url);
  const shotUrl = shotPath ? screenshotUrl(shotPath) : null;
  const shot = shotUrl ? `<div class="f-shot"><a href="${shotUrl}" target="_blank"><img src="${shotUrl}" alt="page screenshot" loading="lazy" /></a></div>` : "";
  const others = pages.length > 1
    ? `<p class="f-more">Also affects ${pages.length - 1} other page(s):<br /><code>${esc(pages.slice(1, 6).join("\n"))}</code>${pages.length > 6 ? `<br />…and ${pages.length - 6} more` : ""}</p>`
    : "";

  card.innerHTML = `
    <div class="f-head">
      <span class="badge ${flaw.severity}">${flaw.severity}</span>
      <span class="badge cat">${flaw.category}</span>
      <span class="f-title">${esc(flaw.title)}</span>
      ${pages.length > 1 ? `<span class="badge pages">${pages.length} pages</span>` : ""}
    </div>
    <p class="f-msg">${esc(flaw.message)}</p>
    ${first.selector || first.resource ? `<span class="f-loc">${first.selector ? `Selector: <code>${esc(first.selector)}</code>` : ""} ${first.resource ? `↳ ${esc(first.resource)}` : ""}</span>` : ""}
    <span class="f-loc">${esc(first.url ?? "")}</span>
    ${others}
    ${shot}
    <div class="f-fix"><strong>How to fix</strong>${esc(flaw.fix)}</div>
  `;
  return card;
}

function addBrokenLink(link) {
  state.brokenCount++;
  $("broken-count").textContent = state.brokenCount;
  const ul = $("broken-list");
  const li = document.createElement("li");
  li.textContent = `${link.target} (HTTP ${link.status}) ← from ${link.from}`;
  li.title = link.href;
  ul.appendChild(li);
  log("warn", `Broken link: ${link.target} returned HTTP ${link.status}`);
}

function updateStats(stats) {
  $("stat-discovered").textContent = stats.discovered;
  $("stat-crawled").textContent = stats.crawled;
}

function elapsedTimer() {
  const tick = () => {
    if (!state.startedAt || !state.jobId) return;
    const s = Math.floor((Date.now() - state.startedAt) / 1000);
    const m = Math.floor(s / 60);
    $("stat-time").textContent = `${m}:${String(s % 60).padStart(2, "0")}`;
  };
  setInterval(tick, 1000);
}

function handleEvent(evt) {
  switch (evt.type) {
    case "log":
      log(evt.level === "ok" ? "ok" : evt.level, evt.message);
      break;
    case "stats":
      updateStats(evt.stats);
      break;
    case "page": {
      if (!state.screenshots.has(evt.page.canonical) && evt.page.screenshot) {
        state.screenshots.set(evt.page.canonical, evt.page.screenshot);
      }
      addChip(evt.page);
      for (const f of evt.page.findings || []) appendFinding(f);
      log("info", `Tested ${evt.page.canonical}${evt.page.findings?.length ? ` — ${evt.page.findings.length} flaw(s)` : " — clean"}`);
      break;
    }
    case "brokenLink":
      addBrokenLink(evt.link);
      break;
    case "report": {
      // Reporter's final ranked output: switch the list to grouped flaws.
      state.report = evt.report;
      $("stat-score").textContent = evt.report.score;
      const scoreEl = $("stat-score");
      scoreEl.className = `stat-num score ${evt.report.score >= 80 ? "good" : evt.report.score >= 50 ? "mid" : "bad"}`;
      $("stat-high").textContent = evt.report.summary.bySeverity.high;
      $("stat-med").textContent = evt.report.summary.bySeverity.medium;
      $("stat-low").textContent = evt.report.summary.bySeverity.low;
      renderFindings();
      log("ok", `Report ready — score ${evt.report.score}/100, ${evt.report.summary.uniqueFlaws} unique flaw(s) across ${evt.report.summary.pagesTested} page(s)`);
      break;
    }
    case "error":
      log("warn", `Error: ${evt.message}`);
      setJet("error", "failed");
      $("error-banner").textContent = evt.message;
      $("error-banner").classList.remove("hidden");
      $("run-btn").disabled = false;
      break;
    case "done":
      setJet("done", "complete");
      log("ok", `Finished in ${Math.round(evt.report.durationMs / 1000)}s — ${evt.report.stats.crawled} pages tested, ${evt.report.stats.findings.high} high / ${evt.report.stats.findings.medium} medium / ${evt.report.stats.findings.low} low`);
      $("run-btn").disabled = false;
      break;
  }
}

function startTest(url, maxPages, maxDepth) {
  state.findings.clear();
  state.screenshots.clear();
  state.pageChips.clear();
  state.brokenCount = 0;
  state.report = null;
  $("stat-score").textContent = "—";
  $("stat-score").className = "stat-num";
  $("findings-count").textContent = "0";
  $("broken-count").textContent = "0";
  $("findings").innerHTML = '<p class="empty">Findings will stream in here live…</p>';
  $("page-chips").innerHTML = "";
  $("broken-list").innerHTML = "";
  $("log").innerHTML = "";
  $("stat-high").textContent = $("stat-med").textContent = $("stat-low").textContent = "0";
  $("stat-discovered").textContent = $("stat-crawled").textContent = "0";
  $("run-panel").classList.remove("hidden");
  $("error-banner").classList.add("hidden");
  $("stat-url").textContent = url;
  state.startedAt = Date.now();
  setJet("running", "testing…");
  $("run-btn").disabled = true;

  fetch("/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, maxPages, maxDepth }),
  })
    .then((r) => r.json())
    .then(({ id }) => {
      state.jobId = id;
      const es = new EventSource(`/events/${id}`);
      es.addEventListener("message", (e) => handleEvent(JSON.parse(e.data)));
      es.addEventListener("done", () => es.close());
      es.onerror = () => es.close();
    })
    .catch((err) => {
      log("warn", `Could not start test: ${err.message}`);
      setJet("error", "failed");
      $("run-btn").disabled = false;
    });
}

$("test-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  if (!url) return;
  const maxPages = Number($("maxPages").value) || 25;
  const maxDepth = Number($("maxDepth").value) || 2;
  startTest(url, maxPages, maxDepth);
});

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.severityFilter = btn.dataset.filter;
    renderFindings();
  });
});

elapsedTimer();
setJet("idle", "idle");
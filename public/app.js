const $ = (id) => document.getElementById(id);

const state = {
  jobId: null,
  findings: new Map(),
  screenshots: new Map(),
  pageChips: new Map(),
  startedAt: null,
  severityFilter: "all",
  brokenCount: 0,
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
  const list = [...state.findings.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const filtered = state.severityFilter === "all"
    ? list
    : list.filter((f) => f.severity === state.severityFilter);
  if (!filtered.length) {
    box.innerHTML = '<p class="empty">No findings yet.</p>';
    return;
  }
  for (const f of filtered) box.appendChild(findingCard(f));
}

function updateCounts() {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of state.findings.values()) counts[f.severity]++;
  $("stat-high").textContent = counts.high;
  $("stat-med").textContent = counts.medium;
  $("stat-low").textContent = counts.low;
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
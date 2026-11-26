const ENDPOINTS = [
  {
    id: "backend-health",
    name: "Backend API Gateway (Health)",
    platform: "Render (Spring Boot)",
    url: "https://backend-pi68.onrender.com/api/health",
    mode: "cors-json",
  },
  {
    id: "backend-oidc",
    name: "Backend OIDC Discovery",
    platform: "Render (OIDC Metadata)",
    url: "https://backend-pi68.onrender.com/.well-known/openid-configuration",
    mode: "cors-json",
  },
  {
    id: "web-portal",
    name: "Sentinel Web IAM Portal",
    platform: "Vercel (Next.js)",
    url: "https://web-beta-orcin-33.vercel.app/",
    mode: "no-cors",
  },
  {
    id: "web-login",
    name: "Web Login Gate",
    platform: "Vercel (Next.js)",
    url: "https://web-beta-orcin-33.vercel.app/login",
    mode: "no-cors",
  },
  {
    id: "web-register",
    name: "Web Registration Portal",
    platform: "Vercel (Next.js)",
    url: "https://web-beta-orcin-33.vercel.app/register",
    mode: "no-cors",
  },
  {
    id: "sentinel-control",
    name: "Sentinel Control Plane (Super Admin)",
    platform: "Vercel (Next.js)",
    url: "https://sentinel-control-green.vercel.app/",
    mode: "no-cors",
  },
  {
    id: "demo-acme",
    name: "Acme HR Portal (SSO Client)",
    platform: "Vercel (Next.js)",
    url: "https://demo-apps-blue.vercel.app/",
    mode: "no-cors",
  },
  {
    id: "demo-fintech",
    name: "FinTech Payroll Portal (SSO Client)",
    platform: "Vercel (Next.js)",
    url: "https://demo-apps-sfjl.vercel.app/",
    mode: "no-cors",
  },
  {
    id: "demo-nexus",
    name: "Nexus Ops Portal (SSO Client)",
    platform: "Vercel (Next.js)",
    url: "https://demo-apps-fjk5.vercel.app/",
    mode: "no-cors",
  },
];

const PIPELINE_REPOS = [
  {
    id: "backend",
    label: "Backend API (Render Auto-Deploy)",
    repo: "Sentinal-Security/backend",
    branch: "development",
    platform: "Render",
  },
  {
    id: "web",
    label: "Web IAM Portal (Vercel Auto-Deploy)",
    repo: "Sentinal-Security/web",
    branch: "development",
    platform: "Vercel",
  },
  {
    id: "mobile",
    label: "Mobile APK Builder (GitHub Actions)",
    repo: "Sentinal-Security/mobile",
    branch: "development",
    platform: "GitHub Actions",
  },
  {
    id: "checker",
    label: "Status Checker (GitHub Pages)",
    repo: "ractopen/sentinel-status-checker",
    branch: "main",
    platform: "GitHub Pages",
  },
];

let autoRefreshEnabled = true;
let serverSnapshot = null;

function initTheme() {
  const saved = localStorage.getItem("sentinel_checker_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("theme-toggle");
  btn.textContent = saved === "dark" ? "Light Mode" : "Dark Mode";
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sentinel_checker_theme", next);
    btn.textContent = next === "dark" ? "Light Mode" : "Dark Mode";
  });
}

function formatAgo(iso) {
  if (!iso) return "N/A";
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

async function fetchJsonSafe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function probePipeline(item) {
  const [runsData, commitsData, deploymentsData] = await Promise.all([
    fetchJsonSafe(`https://api.github.com/repos/${item.repo}/actions/runs?per_page=2`),
    fetchJsonSafe(`https://api.github.com/repos/${item.repo}/commits/${item.branch}`),
    fetchJsonSafe(`https://api.github.com/repos/${item.repo}/deployments?per_page=1`),
  ]);

  const latestRun = runsData?.workflow_runs?.[0];
  const latestCommitMsg = commitsData?.commit?.message?.split("\n")[0] || "No commit message";
  const latestCommitSha = commitsData?.sha ? commitsData.sha.slice(0, 7) : "--";
  const latestCommitDate = commitsData?.commit?.author?.date;

  let deployState = null;
  let deployEnv = item.platform;
  if (Array.isArray(deploymentsData) && deploymentsData.length > 0) {
    const dep = deploymentsData[0];
    deployEnv = dep.environment || item.platform;
    const statuses = await fetchJsonSafe(dep.statuses_url);
    if (Array.isArray(statuses) && statuses.length > 0) {
      deployState = statuses[0].state;
    }
  }

  let state = "IDLE / LIVE";
  let pillClass = "pill-ok";
  let summary = `Latest code (${latestCommitSha}) is deployed and idle.`;

  if (latestRun && (latestRun.status === "in_progress" || latestRun.status === "queued")) {
    state = "COMPILING (GITHUB ACTION)";
    pillClass = "pill-warn";
    summary = `GitHub Action "${latestRun.name}" is currently ${latestRun.status.replace("_", " ")} (${formatAgo(latestRun.created_at)}).`;
  } else if (deployState === "pending" || deployState === "in_progress" || deployState === "queued") {
    state = `COMPILING (${item.platform.toUpperCase()})`;
    pillClass = "pill-warn";
    summary = `${deployEnv} is currently building/deploying commit ${latestCommitSha}.`;
  } else if (deployState === "failure" || deployState === "error" || (latestRun && latestRun.conclusion === "failure")) {
    state = "BUILD FAILED";
    pillClass = "pill-err";
    summary = `Latest ${item.platform} build/deploy reported a failure. Check workflow logs.`;
  } else if (latestRun) {
    summary = `Last workflow "${latestRun.name}" finished (${latestRun.conclusion || latestRun.status}) ${formatAgo(latestRun.updated_at)}.`;
  }

  return {
    ...item,
    state,
    pillClass,
    summary,
    latestCommitSha,
    latestCommitMsg,
    latestCommitDate,
    runUrl: latestRun?.html_url || `https://github.com/${item.repo}/actions`,
  };
}

function renderPipelines(pipelineResults) {
  const grid = document.getElementById("pipeline-grid");
  grid.innerHTML = "";

  pipelineResults.forEach((p) => {
    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <div class="service-top">
        <div>
          <div class="service-name">${p.label}</div>
          <div class="service-platform">${p.repo} (${p.branch})</div>
        </div>
        <span class="status-pill ${p.pillClass}">${p.state}</span>
      </div>
      <div class="service-summary">${p.summary}</div>
      <div class="service-meta">
        <span>Commit ${p.latestCommitSha}: ${p.latestCommitMsg.slice(0, 48)}</span>
        <span>${formatAgo(p.latestCommitDate)}</span>
      </div>
      <a class="service-url" href="${p.runUrl}" target="_blank" rel="noopener noreferrer">View Pipeline / Actions Logs</a>
    `;
    grid.appendChild(card);
  });
}

async function loadServerSnapshot() {
  try {
    const res = await fetch(`./status.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    serverSnapshot = await res.json();
    const ageEl = document.getElementById("snapshot-age");
    if (serverSnapshot?.checkedAt) {
      ageEl.textContent = `Server snapshot: ${serverSnapshot.checkedAt}`;
    }
    return serverSnapshot;
  } catch {
    return null;
  }
}

async function probeEndpoint(ep) {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(ep.url, {
      method: "GET",
      mode: ep.mode === "no-cors" ? "no-cors" : "cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);

    if (ep.mode === "no-cors") {
      return {
        ...ep,
        state: "RUNNING",
        detail: "Website is reachable and responding normally",
        latency,
        httpCode: "OPAQUE",
      };
    }

    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        ...ep,
        state: "COMPILING / WAKING",
        detail: `HTTP ${res.status} — Render is waking up or compiling new code`,
        latency,
        httpCode: res.status,
      };
    }

    if (!res.ok) {
      return {
        ...ep,
        state: "OFFLINE",
        detail: `Returned HTTP ${res.status} ${res.statusText}`,
        latency,
        httpCode: res.status,
      };
    }

    return {
      ...ep,
      state: "RUNNING",
      detail: `Healthy (${res.status} OK)`,
      latency,
      httpCode: res.status,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    const isTimeout = err && err.name === "AbortError";
    return {
      ...ep,
      state: isTimeout ? "COMPILING / WAKING" : "OFFLINE",
      detail: isTimeout ? "Timed out (8s) — server is cold-starting or compiling" : "Unreachable / Network error",
      latency,
      httpCode: "ERR",
    };
  }
}

async function probeBackendTelemetry() {
  const gwEl = document.getElementById("tel-gateway");
  const dbEl = document.getElementById("tel-db");
  const pingEl = document.getElementById("tel-db-ping");
  const mailEl = document.getElementById("tel-mail");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://backend-pi68.onrender.com/api/status/system", {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      gwEl.textContent = `HTTP ${res.status}`;
      return;
    }

    const json = await res.json();
    const data = json?.data || json;
    gwEl.textContent = data?.status || "OPERATIONAL";
    dbEl.textContent = data?.database?.status || "CONNECTED";
    pingEl.textContent = data?.database?.pingMs !== undefined ? `${data.database.pingMs} ms` : "N/A";
    mailEl.textContent = data?.email?.status || data?.emailSubsystem?.status || "OPERATIONAL";
  } catch {
    gwEl.textContent = "COMPILING / WAKING";
    dbEl.textContent = "--";
    pingEl.textContent = "-- ms";
    mailEl.textContent = "--";
  }
}

function renderResults(results, pipelineResults) {
  const grid = document.getElementById("services-grid");
  grid.innerHTML = "";

  let onlineCount = 0;
  let compilingCount = 0;
  let offlineCount = 0;

  results.forEach((r) => {
    if (r.state === "RUNNING") onlineCount++;
    else if (r.state === "COMPILING / WAKING") compilingCount++;
    else offlineCount++;

    const snapshotEntry = serverSnapshot?.results?.find((s) => s.id === r.id);
    const serverBadge = snapshotEntry
      ? `Server HTTP Check: ${snapshotEntry.httpCode} (${snapshotEntry.latencyMs}ms)`
      : "Server HTTP Check: pending";

    const pillClass =
      r.state === "RUNNING" ? "pill-ok" : r.state === "COMPILING / WAKING" ? "pill-warn" : "pill-err";

    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <div class="service-top">
        <div>
          <div class="service-name">${r.name}</div>
          <div class="service-platform">${r.platform}</div>
        </div>
        <span class="status-pill ${pillClass}">${r.state}</span>
      </div>
      <a class="service-url" href="${r.url}" target="_blank" rel="noopener noreferrer">${r.url}</a>
      <div class="service-summary">${r.detail}</div>
      <div class="service-meta">
        <span>${serverBadge}</span>
        <span>${r.latency} ms</span>
      </div>
    `;
    grid.appendChild(card);
  });

  const activeBuilds = pipelineResults.filter((p) => p.state.startsWith("COMPILING"));
  const failedBuilds = pipelineResults.filter((p) => p.state === "BUILD FAILED");

  const banner = document.getElementById("overall-banner");
  const title = document.getElementById("overall-title");
  const subtitle = document.getElementById("overall-subtitle");
  banner.className = "banner";

  if (activeBuilds.length > 0 || compilingCount > 0) {
    banner.classList.add("banner-warn");
    const names = activeBuilds.map((b) => b.platform).join(", ");
    title.textContent = "Builds or Services Are Currently Compiling / Waking Up";
    subtitle.textContent = `${activeBuilds.length} active pipeline(s) (${names || "Render/Vercel"}) and ${compilingCount} endpoint(s) waking up. ${onlineCount} services running.`;
  } else if (offlineCount > 0 || failedBuilds.length > 0) {
    banner.classList.add("banner-err");
    title.textContent = `${offlineCount} Service(s) Offline / ${failedBuilds.length} Build Issue(s)`;
    subtitle.textContent = `${onlineCount} running normally. Check the cards below for details.`;
  } else {
    banner.classList.add("banner-ok");
    title.textContent = `Everything Is Live & Healthy (${onlineCount}/${results.length} Running)`;
    subtitle.textContent = "No builds currently compiling. Render API Gateway and all Vercel sites are responding normally.";
  }

  document.getElementById("last-checked").textContent =
    `Last check: ${new Date().toLocaleTimeString()}`;
}

async function runFullCheck() {
  const btn = document.getElementById("run-check-btn");
  btn.disabled = true;
  btn.textContent = "Checking...";

  await loadServerSnapshot();
  const [results, pipelineResults] = await Promise.all([
    Promise.all(ENDPOINTS.map(probeEndpoint)),
    Promise.all(PIPELINE_REPOS.map(probePipeline)),
    probeBackendTelemetry(),
  ]);
  renderPipelines(pipelineResults);
  renderResults(results, pipelineResults);

  btn.disabled = false;
  btn.textContent = "Refresh Now";
}

function setupControls() {
  document.getElementById("run-check-btn").addEventListener("click", runFullCheck);
  document.getElementById("wake-backend-btn").addEventListener("click", async () => {
    const btn = document.getElementById("wake-backend-btn");
    btn.disabled = true;
    btn.textContent = "Waking...";
    await Promise.all([probeEndpoint(ENDPOINTS[0]), probeBackendTelemetry()]);
    await runFullCheck();
    btn.disabled = false;
    btn.textContent = "Wake Up Backend";
  });

  const autoBtn = document.getElementById("auto-refresh-toggle");
  autoBtn.addEventListener("click", () => {
    autoRefreshEnabled = !autoRefreshEnabled;
    autoBtn.textContent = autoRefreshEnabled ? "Live Polling: ON (10s)" : "Live Polling: OFF";
  });

  document.getElementById("custom-probe-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("custom-url-input");
    const box = document.getElementById("custom-probe-result");
    const url = input.value.trim();
    if (!url) return;

    box.classList.remove("hidden");
    box.textContent = `Probing ${url}...`;
    const result = await probeEndpoint({
      id: "custom",
      name: "Custom URL",
      platform: "Custom",
      url,
      mode: "no-cors",
    });
    box.textContent = `${result.state} | ${result.detail} | Latency: ${result.latency} ms | URL: ${url}`;
  });

  setInterval(() => {
    if (autoRefreshEnabled && document.visibilityState === "visible") {
      runFullCheck();
    }
  }, 10000);
}

initTheme();
setupControls();
runFullCheck();

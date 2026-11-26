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

let autoRefreshEnabled = true;
let autoRefreshTimer = null;
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
        state: "ONLINE",
        detail: "Reachable from browser",
        latency,
        httpCode: "OPAQUE",
      };
    }

    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        ...ep,
        state: "COMPILING",
        detail: `HTTP ${res.status} (Waking up / Compiling)`,
        latency,
        httpCode: res.status,
      };
    }

    if (!res.ok) {
      return {
        ...ep,
        state: "OFFLINE",
        detail: `HTTP ${res.status} ${res.statusText}`,
        latency,
        httpCode: res.status,
      };
    }

    return {
      ...ep,
      state: "ONLINE",
      detail: `HTTP ${res.status} OK`,
      latency,
      httpCode: res.status,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - start);
    const isTimeout = err && err.name === "AbortError";
    return {
      ...ep,
      state: isTimeout ? "COMPILING" : "OFFLINE",
      detail: isTimeout ? "Timed out (8s) — cold starting / weak network" : "Unreachable / Network error",
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
    gwEl.textContent = "WAKING / OFFLINE";
    dbEl.textContent = "--";
    pingEl.textContent = "-- ms";
    mailEl.textContent = "--";
  }
}

function renderResults(results) {
  const grid = document.getElementById("services-grid");
  grid.innerHTML = "";

  let onlineCount = 0;
  let compilingCount = 0;
  let offlineCount = 0;

  results.forEach((r) => {
    if (r.state === "ONLINE") onlineCount++;
    else if (r.state === "COMPILING") compilingCount++;
    else offlineCount++;

    const snapshotEntry = serverSnapshot?.results?.find((s) => s.id === r.id);
    const serverBadge = snapshotEntry
      ? `Server Check: HTTP ${snapshotEntry.httpCode} (${snapshotEntry.latencyMs}ms)`
      : "Server Check: pending";

    const pillClass =
      r.state === "ONLINE" ? "pill-ok" : r.state === "COMPILING" ? "pill-warn" : "pill-err";

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
      <div class="service-meta">
        <span>${r.detail}</span>
        <span>${r.latency} ms</span>
      </div>
      <div class="service-meta">
        <span>${serverBadge}</span>
      </div>
    `;
    grid.appendChild(card);
  });

  const banner = document.getElementById("overall-banner");
  const title = document.getElementById("overall-title");
  const subtitle = document.getElementById("overall-subtitle");
  banner.className = "banner";

  if (offlineCount === 0 && compilingCount === 0) {
    banner.classList.add("banner-ok");
    title.textContent = `All ${onlineCount} Services Operational`;
    subtitle.textContent = "Backend API gateway and all Vercel deployments responded cleanly.";
  } else if (offlineCount === 0) {
    banner.classList.add("banner-warn");
    title.textContent = `${compilingCount} Service(s) Cold-Starting or Compiling`;
    subtitle.textContent = `${onlineCount} online, ${compilingCount} waking up. Retry in a few seconds.`;
  } else {
    banner.classList.add("banner-err");
    title.textContent = `${offlineCount} Service(s) Unreachable`;
    subtitle.textContent = `${onlineCount} online, ${compilingCount} compiling, ${offlineCount} offline.`;
  }

  document.getElementById("last-checked").textContent =
    `Last check: ${new Date().toLocaleTimeString()}`;
}

async function runFullCheck() {
  const btn = document.getElementById("run-check-btn");
  btn.disabled = true;
  btn.textContent = "Checking...";

  await loadServerSnapshot();
  const [results] = await Promise.all([
    Promise.all(ENDPOINTS.map(probeEndpoint)),
    probeBackendTelemetry(),
  ]);
  renderResults(results);

  btn.disabled = false;
  btn.textContent = "Run Full Check";
}

function setupControls() {
  document.getElementById("run-check-btn").addEventListener("click", runFullCheck);
  document.getElementById("wake-backend-btn").addEventListener("click", async () => {
    const btn = document.getElementById("wake-backend-btn");
    btn.disabled = true;
    btn.textContent = "Waking...";
    await Promise.all([
      probeEndpoint(ENDPOINTS[0]),
      probeBackendTelemetry(),
    ]);
    await runFullCheck();
    btn.disabled = false;
    btn.textContent = "Wake Up Backend";
  });

  const autoBtn = document.getElementById("auto-refresh-toggle");
  autoBtn.addEventListener("click", () => {
    autoRefreshEnabled = !autoRefreshEnabled;
    autoBtn.textContent = autoRefreshEnabled ? "Auto-Refresh: ON (30s)" : "Auto-Refresh: OFF";
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

  autoRefreshTimer = setInterval(() => {
    if (autoRefreshEnabled && document.visibilityState === "visible") {
      runFullCheck();
    }
  }, 30000);
}

initTheme();
setupControls();
runFullCheck();

const centerGrid = document.getElementById("adminCenterGrid");
const adminMessageFeed = document.getElementById("adminMessageFeed");
const adminSyncState = document.getElementById("adminSyncState");
const adminCenterCount = document.getElementById("adminCenterCount");
const adminLoadCount = document.getElementById("adminLoadCount");
const adminFailureCount = document.getElementById("adminFailureCount");
const networkCongestionToggle = document.getElementById("networkCongestionToggle");
const autoReroutingToggle = document.getElementById("autoReroutingToggle");
const resetSimulationsBtn = document.getElementById("resetSimulationsBtn");
const networkStateBadge = document.getElementById("networkStateBadge");
const rerouteStateBadge = document.getElementById("rerouteStateBadge");
const loadGraph = document.getElementById("loadGraph");

const state = {
  centers: [],
  simulationState: {
    network_congestion: false,
    auto_rerouting: true,
  },
  recentEvents: [],
};

function setSyncState(text, tone = "neutral") {
  if (!adminSyncState) {
    return;
  }
  adminSyncState.className = `status-pill ${tone}`;
  adminSyncState.textContent = text;
}

function pushMessage(text, tone = "neutral") {
  if (!adminMessageFeed) {
    return;
  }

  const item = document.createElement("li");
  item.className = `feed-item ${tone}`;
  item.textContent = text;
  adminMessageFeed.prepend(item);

  while (adminMessageFeed.children.length > 8) {
    adminMessageFeed.removeChild(adminMessageFeed.lastElementChild);
  }
}

function statusTone(status) {
  if (status === "available") return "good";
  if (status === "busy") return "warn";
  return "bad";
}

function statusLabel(center) {
  if (center.force_failure) return "Offline";
  if (center.runtime_status === "busy" || center.overload) return "Busy";
  return "Available";
}

function typeEmoji(type) {
  if (type === "police") return "🚓";
  if (type === "fire") return "🔥";
  return "🚑";
}

function loadLevelTone(level) {
  if (level === "high") return "bad";
  if (level === "medium") return "warn";
  return "good";
}

function loadLevelWidth(level) {
  if (level === "high") return 92;
  if (level === "medium") return 62;
  return 28;
}

function renderGlobalState() {
  if (networkCongestionToggle) {
    networkCongestionToggle.checked = Boolean(state.simulationState.network_congestion);
  }
  if (autoReroutingToggle) {
    autoReroutingToggle.checked = Boolean(state.simulationState.auto_rerouting);
  }

  if (networkStateBadge) {
    const active = Boolean(state.simulationState.network_congestion);
    networkStateBadge.className = `status-pill ${active ? "warn" : "neutral"}`;
    networkStateBadge.textContent = active ? "Network Congestion On" : "Network Normal";
  }

  if (rerouteStateBadge) {
    const active = Boolean(state.simulationState.auto_rerouting);
    rerouteStateBadge.className = `status-pill ${active ? "active" : "neutral"}`;
    rerouteStateBadge.textContent = active ? "Auto Rerouting On" : "Auto Rerouting Off";
  }
}

function renderGraph() {
  if (!loadGraph) {
    return;
  }

  loadGraph.innerHTML = "";
  state.centers.forEach((center) => {
    const bar = document.createElement("div");
    bar.className = `load-bar ${loadLevelTone(center.load_level)}`;
    bar.title = `${center.name} - ${center.load_level} load`;
    bar.innerHTML = `
      <span class="load-bar-label">${center.id}</span>
      <span class="load-bar-track"><i style="width:${loadLevelWidth(center.load_level)}%"></i></span>
      <small>${center.load_level}</small>
    `;
    loadGraph.appendChild(bar);
  });
}

function renderSummaryPills() {
  if (adminCenterCount) {
    adminCenterCount.textContent = `${state.centers.length} centers`;
  }
  if (adminLoadCount) {
    const overloaded = state.centers.filter((center) => center.overload).length;
    adminLoadCount.textContent = `${overloaded} overloaded`;
  }
  if (adminFailureCount) {
    const failed = state.centers.filter((center) => center.force_failure).length;
    adminFailureCount.textContent = `${failed} failed`;
  }
}

function publishAdminContext() {
  if (!window.ResQContextPanel?.set) {
    return;
  }

  const availableCount = state.centers.filter((center) => statusLabel(center) === "Available").length;
  const busyCount = state.centers.filter((center) => statusLabel(center) === "Busy").length;
  const offlineCount = state.centers.filter((center) => statusLabel(center) === "Offline").length;
  const forcedFailures = state.centers.filter((center) => center.force_failure).length;

  window.ResQContextPanel.set("admin", {
    totalCenters: state.centers.length,
    availableCount,
    busyCount,
    offlineCount,
    forcedFailures,
    networkCongestion: Boolean(state.simulationState.network_congestion),
    autoRerouting: Boolean(state.simulationState.auto_rerouting),
  });
}

function renderCenterCard(center) {
  const card = document.createElement("article");
  const isFailed = Boolean(center.force_failure);
  const isOverloaded = Boolean(center.overload);
  const tone = isFailed ? "bad" : statusTone(center.runtime_status);
  card.className = `admin-center-card ${tone} ${isOverloaded ? "is-overloaded" : ""} ${isFailed ? "is-failed" : ""}`;
  card.dataset.centerId = center.id;

  card.innerHTML = `
    <div class="admin-center-card-head">
      <div>
        <p class="mini-label">${center.id}</p>
        <h3>${typeEmoji(center.type)} ${center.name}</h3>
      </div>
      <span class="status-pill ${tone}">${statusLabel(center)}</span>
    </div>

    <div class="admin-center-meta">
      <span>${center.type?.toUpperCase() || "CENTER"}</span>
      <span>${center.lat.toFixed(3)}, ${center.lng.toFixed(3)}</span>
      <span>${Number(center.distance_km || 0).toFixed(1)} km</span>
    </div>

    <div class="admin-badges-row">
      <span class="chip ${tone}">${center.runtime_status || "available"}</span>
      <span class="chip ${center.overload ? "warn" : "good"}">${center.overload ? "overloaded" : "stable"}</span>
      <span class="chip ${center.force_failure ? "bad" : "good"}">${center.force_failure ? "failure" : "healthy"}</span>
    </div>

    <div class="load-widget">
      <div class="load-widget-head">
        <span>Load Level</span>
        <strong>${center.load_level}</strong>
      </div>
      <div class="load-widget-track">
        <span style="width:${loadLevelWidth(center.load_level)}%"></span>
      </div>
      <div class="load-widget-foot">
        <small>Priority ${Number(center.priority_score || 0).toFixed(1)}</small>
        <small>${center.effective_load}/${center.capacity}</small>
      </div>
    </div>

    <div class="admin-card-controls">
      <label>
        Availability
        <select data-center-field="status" title="Change the operational status for this center.">
          <option value="available">Available</option>
          <option value="busy">Busy</option>
          <option value="offline">Offline</option>
        </select>
      </label>

      <label class="control-toggle compact" title="Pushes this center into a busy state and lowers routing priority.">
        <input type="checkbox" data-center-field="overload" />
        <span class="control-toggle-ui"></span>
        <span>
          <strong>Overload Center</strong>
          <small>Mark busy and lower priority.</small>
        </span>
      </label>

      <button type="button" class="btn btn-secondary control-action" data-center-action="failure" title="Toggle a simulated call failure for this center.">
        Force Failure
      </button>
    </div>

    <div class="admin-card-footer">
      <small>${isFailed ? "Warning: routing will avoid this center." : isOverloaded ? "Routing will prefer healthier centers first." : "Routing is normal."}</small>
    </div>
  `;

  const statusSelect = card.querySelector('[data-center-field="status"]');
  const overloadToggle = card.querySelector('[data-center-field="overload"]');
  const failureButton = card.querySelector('[data-center-action="failure"]');

  statusSelect.value = center.runtime_status || "available";
  overloadToggle.checked = Boolean(center.overload);
  failureButton.textContent = center.force_failure ? "Clear Failure" : "Force Failure";

  statusSelect.addEventListener("change", () => {
    updateCenter(center.id, {
      status: statusSelect.value,
      overload: overloadToggle.checked,
      force_failure: Boolean(center.force_failure),
    });
  });

  overloadToggle.addEventListener("change", () => {
    if (overloadToggle.checked && statusSelect.value !== "offline") {
      statusSelect.value = "busy";
    }
    if (!overloadToggle.checked && statusSelect.value === "busy" && !center.force_failure) {
      statusSelect.value = "available";
    }
    updateCenter(center.id, {
      status: statusSelect.value,
      overload: overloadToggle.checked,
      force_failure: Boolean(center.force_failure),
    });
  });

  failureButton.addEventListener("click", () => {
    updateCenter(center.id, {
      status: failureButton.textContent === "Clear Failure" ? statusSelect.value : "offline",
      overload: overloadToggle.checked,
      force_failure: !center.force_failure,
    });
  });

  return card;
}

function renderCenters() {
  if (!centerGrid) {
    return;
  }

  centerGrid.innerHTML = "";
  state.centers.forEach((center) => {
    centerGrid.appendChild(renderCenterCard(center));
  });
  renderSummaryPills();
  renderGraph();
  publishAdminContext();
}

function renderRecentEvents(rows) {
  const entries = rows.filter((row) => row.kind === "simulation").slice(0, 8);
  state.recentEvents = entries;

  if (!adminMessageFeed) {
    return;
  }

  adminMessageFeed.innerHTML = "";
  if (!entries.length) {
    const item = document.createElement("li");
    item.className = "feed-item neutral";
    item.textContent = "No simulation events recorded yet.";
    adminMessageFeed.appendChild(item);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = `feed-item ${entry.target === "global" ? "warn" : "bad"}`;
    item.textContent = `${new Date(entry.timestamp).toLocaleTimeString()} • ${entry.summary}`;
    adminMessageFeed.appendChild(item);
  });

  publishAdminContext();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

async function loadState() {
  setSyncState("Syncing...", "neutral");

  const [centerData, simulationData, logData] = await Promise.all([
    requestJson("/api/admin/centers"),
    requestJson("/api/admin/simulation"),
    requestJson("/api/logs?status=all"),
  ]);

  state.centers = Array.isArray(centerData.centers) ? centerData.centers : [];
  state.simulationState = simulationData.simulation_state || state.simulationState;

  renderGlobalState();
  renderCenters();
  renderRecentEvents(Array.isArray(logData) ? logData : []);
  setSyncState("Live", "good");
  publishAdminContext();
}

async function updateCenter(centerId, payload) {
  setSyncState("Saving center...", "warn");
  await requestJson("/api/admin/center-control", {
    method: "POST",
    body: JSON.stringify({
      center_id: centerId,
      ...payload,
    }),
  });
  await loadState();
  pushMessage(`Updated ${centerId}`, "good");
}

async function updateSimulationState() {
  setSyncState("Saving simulation...", "warn");
  await requestJson("/api/admin/simulation", {
    method: "POST",
    body: JSON.stringify({
      network_congestion: networkCongestionToggle?.checked || false,
      auto_rerouting: autoReroutingToggle?.checked || false,
    }),
  });
  await loadState();
  pushMessage("Global simulation updated", "good");
}

async function resetSimulationState() {
  setSyncState("Resetting...", "warn");
  await requestJson("/api/admin/simulation/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  await loadState();
  pushMessage("All simulations reset", "warn");
}

if (networkCongestionToggle) {
  networkCongestionToggle.addEventListener("change", () => {
    updateSimulationState().catch((error) => {
      pushMessage(error.message, "bad");
      setSyncState("Sync failed", "bad");
    });
  });
}

if (autoReroutingToggle) {
  autoReroutingToggle.addEventListener("change", () => {
    updateSimulationState().catch((error) => {
      pushMessage(error.message, "bad");
      setSyncState("Sync failed", "bad");
    });
  });
}

if (resetSimulationsBtn) {
  resetSimulationsBtn.addEventListener("click", () => {
    resetSimulationState().catch((error) => {
      pushMessage(error.message, "bad");
      setSyncState("Sync failed", "bad");
    });
  });
}

loadState().catch((error) => {
  setSyncState("Offline", "bad");
  pushMessage(error.message || "Unable to load admin control state.", "bad");
});

setInterval(() => {
  loadState().catch(() => {
    setSyncState("Offline", "bad");
  });
}, 5000);

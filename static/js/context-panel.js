(function () {
  const panel = document.getElementById("contextPanel");
  if (!panel) {
    return;
  }

  const body = document.body;
  const pageKey = (body?.dataset.page || window.location.pathname.replace(/^\//, "") || "home").toLowerCase();
  const pageLabel = {
    home: "Overview",
    dashboard: "Dashboard",
    emergency: "Emergency",
    ai_decision_engine_page: "AI Decision Engine",
    admin: "Admin Control",
    nearby_helpers: "Nearby Helpers",
    logs: "Logs",
    about: "About",
  }[pageKey] || "Context Panel";

  const state = {
    page: pageKey,
    payload: {},
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function statCard(icon, label, value, note = "", tone = "neutral") {
    return `
      <article class="context-stat ${tone}">
        <div class="context-stat-head">
          <span class="context-stat-label"><span>${icon}</span><span>${escapeHtml(label)}</span></span>
          <span class="context-chip ${tone}">${escapeHtml(tone)}</span>
        </div>
        <strong class="context-stat-value">${escapeHtml(value)}</strong>
        ${note ? `<small class="context-stat-note">${escapeHtml(note)}</small>` : ""}
      </article>
    `;
  }

  function listItem(title, detail) {
    return `<li><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></li>`;
  }

  function timelineItem(title, detail, tone = "neutral") {
    return `
      <div class="context-timeline-step ${tone}">
        <span class="context-timeline-dot"></span>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(detail)}</small>
        </div>
      </div>
    `;
  }

  function renderHeader(title, subtitle) {
    return `
      <div class="context-panel-title">
        <p class="eyebrow">${escapeHtml(pageLabel)}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    `;
  }

  function renderDashboard(payload) {
    const summary = payload.summary || {};
    const requests = Array.isArray(payload.requests) ? payload.requests : [];
    const activeCalls = payload.activeCalls ?? Math.max(0, Number(summary.total || 0) - Number(summary.connected || 0) - Number(summary.unresolved || 0));
    const reroutedCalls = payload.reroutedCalls ?? Number(summary.rerouted || 0);
    const congestion = Boolean(payload.simulationState?.network_congestion);
    const latestStrength = Number(requests[0]?.network?.strength ?? 0);
    const networkStatus = payload.networkStatus || (congestion ? "Congested" : latestStrength > 65 ? "Strong" : latestStrength > 35 ? "Weak" : "Weak");
    const alerts = requests.slice(0, 3);

    return `
      ${renderHeader("Real-time command snapshot", "Live metrics pulled from the active dashboard session.")}
      <div class="context-stat-grid">
        ${statCard("📊", "Active Calls", activeCalls, `${summary.total || 0} total requests`, activeCalls > 0 ? "warn" : "good")}
        ${statCard("🔁", "Rerouted Calls", reroutedCalls, `${summary.connected || 0} connected`, reroutedCalls > 0 ? "warn" : "good")}
        ${statCard("📡", "Network Status", networkStatus, congestion ? "Simulation congestion active" : `Signal ${latestStrength || "--"}%`, congestion ? "bad" : latestStrength > 65 ? "good" : "warn")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">⚠️ Recent Alerts</span>
          <span class="context-chip ${alerts.length ? "warn" : "good"}">${alerts.length ? `${alerts.length} live` : "clear"}</span>
        </div>
        <ul class="context-list">
          ${alerts.length ? alerts.map((request) => listItem(`${request.request_id} • ${String(request.final_status || "pending")}`, `${new Date(request.created_at).toLocaleTimeString()} • ${String(request.source || "mobile").toUpperCase()}`)).join("") : listItem("No active alerts", "The latest requests will appear here automatically.")}
        </ul>
      </div>
      <div class="context-panel-footer">
        <span class="context-chip ${congestion ? "bad" : "good"}">${congestion ? "Congested" : "Operational"}</span>
        <span class="context-chip neutral">Live sync</span>
      </div>
    `;
  }

  function renderEmergency(payload) {
    const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    const location = payload.currentLocation;
    const locationText = location
      ? `${Number(location.lat).toFixed(5)}, ${Number(location.lng).toFixed(5)}${location.source ? ` (${location.source})` : ""}`
      : payload.locationText || "Awaiting browser position";

    return `
      ${renderHeader("Emergency dispatch context", "Track the call state as the simulation moves through each stage.")}
      <div class="context-stat-grid">
        ${statCard("📞", "Call Status", payload.callStatus || "Idle", payload.finalStatus || "Waiting for trigger", payload.callTone || "neutral")}
        ${statCard("🔁", "Rerouting Status", payload.reroutingStatus || "Standby", payload.reroutingNote || "Routing decisions update live", payload.reroutingTone || "neutral")}
        ${statCard("📍", "Current Location", locationText, "Last known caller position", location ? "good" : "warn")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">⏱ Timeline</span>
          <span class="context-chip ${payload.timelineTone || "warn"}">${timeline.length || 0} steps</span>
        </div>
        <div class="context-timeline">
          ${timeline.length ? timeline.map((step) => timelineItem(step.label, step.detail || step.label, step.tone || "neutral")).join("") : timelineItem("Call initiated", "Waiting for SOS trigger", "neutral")}
        </div>
      </div>
      <div class="context-panel-footer">
        <span class="context-chip ${payload.finalTone || "neutral"}">${payload.finalStatus || "Connecting"}</span>
        <span class="context-chip neutral">Live updates</span>
      </div>
    `;
  }

  function renderAdmin(payload) {
    const totalCenters = Number(payload.totalCenters || 0);
    return `
      ${renderHeader("Control plane overview", "Monitor center health and simulation switches from one glance.")}
      <div class="context-stat-grid">
        ${statCard("🏥", "Total Centers", totalCenters, `${Number(payload.availableCount || 0)} available in rotation`, totalCenters > 0 ? "good" : "warn")}
        ${statCard("🟢", "Available / Busy / Offline", `${Number(payload.availableCount || 0)} / ${Number(payload.busyCount || 0)} / ${Number(payload.offlineCount || 0)}`, "Current center state mix", "neutral")}
        ${statCard("⚙️", "Active Simulations", `${payload.networkCongestion ? "Congestion ON" : "Congestion OFF"}`, `${Number(payload.forcedFailures || 0)} forced failures`, payload.networkCongestion ? "warn" : "good")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">Quick toggles</span>
          <span class="context-chip ${payload.autoRerouting ? "good" : "warn"}">${payload.autoRerouting ? "Auto rerouting ON" : "Auto rerouting OFF"}</span>
        </div>
        <div class="context-chip-row">
          <span class="context-chip ${payload.networkCongestion ? "warn" : "good"}">Network congestion ${payload.networkCongestion ? "enabled" : "clear"}</span>
          <span class="context-chip ${payload.autoRerouting ? "good" : "warn"}">Auto rerouting ${payload.autoRerouting ? "enabled" : "paused"}</span>
        </div>
      </div>
      <div class="context-panel-footer">
        <span class="context-chip neutral">Realtime admin sync</span>
      </div>
    `;
  }

  function renderAi(payload) {
    const ranked = Array.isArray(payload.ranked_centers)
      ? payload.ranked_centers
      : Array.isArray(payload.rankedCenters)
        ? payload.rankedCenters
        : Array.isArray(payload.centers)
          ? payload.centers
          : [];
    const selected = payload.selected_center || payload.selectedCenter || ranked[0] || null;
    const confidence = Number(payload.confidence_score ?? payload.confidenceScore ?? selected?.ai_confidence ?? selected?.confidence_score ?? 0);
    return `
      ${renderHeader("AI routing snapshot", "Scoring centers by traffic, availability, and network reliability.")}
      <div class="context-stat-grid">
        ${statCard("🧠", "Selected Center", selected?.name || "Waiting", payload.explanation || "AI evaluates all available centers.", selected ? "good" : "warn")}
        ${statCard("⭐", "Confidence", `${confidence.toFixed(1)}%`, selected ? "Confidence based on score spread" : "Run AI analysis to score centers.", selected ? "good" : "neutral")}
        ${statCard("📍", "Evaluation Type", String(payload.emergencyType || "medical").toUpperCase(), payload.recalculatingMessage || "AI is recalculating...", "neutral")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">Why this center</span>
        </div>
        <ul class="context-list">
          ${selected?.ai_reasons ? selected.ai_reasons.map((reason) => listItem(reason, "Included in final score")).join("") : listItem("AI is recalculating...", "No ranked centers yet.")}
        </ul>
      </div>
      <div class="context-panel-footer">
        <span class="context-chip ${selected ? "good" : "warn"}">${selected ? "AI selected" : "Recalculating"}</span>
        <span class="context-chip neutral">Dynamic routing</span>
      </div>
    `;
  }

  function renderNearby(payload) {
    const responding = Number(payload.respondingCount || 0);
    const pending = Number(payload.pendingCount || 0);
    return `
      ${renderHeader("Nearby helper pulse", "Track nearby users and the current alert radius in real time.")}
      <div class="context-stat-grid">
        ${statCard("👥", "Nearby Users Count", Number(payload.totalHelpers || 0), `${responding} responding now`, responding > 0 ? "good" : "warn")}
        ${statCard("🟢", "Responding / Pending", `${responding} / ${pending}`, "Helper status split", responding > 0 ? "good" : pending > 0 ? "warn" : "neutral")}
        ${statCard("📍", "Selected Radius", payload.radiusLabel || "--", payload.autoAlert ? "Auto-alert enabled" : "Manual alert mode", "neutral")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">🚨 Alert Status</span>
          <span class="context-chip ${payload.alertStatus === "Sent" ? "good" : "warn"}">${escapeHtml(payload.alertStatus || "Not Sent")}</span>
        </div>
        <p class="context-panel-copy">${escapeHtml(payload.alertSummary || "No nearby alert has been sent yet.")}</p>
      </div>
      <div class="context-panel-footer">
        <span class="context-chip ${payload.autoAlert ? "good" : "warn"}">Auto alert ${payload.autoAlert ? "on" : "off"}</span>
        <span class="context-chip ${payload.soundAlert ? "good" : "neutral"}">Sound ${payload.soundAlert ? "enabled" : "silent"}</span>
      </div>
    `;
  }

  function renderLogs(payload) {
    return `
      ${renderHeader("Audit trail snapshot", "Review the latest operational log totals and signal health.")}
      <div class="context-stat-grid">
        ${statCard("📄", "Total Logs", Number(payload.totalLogs || 0), "All event rows currently visible", Number(payload.totalLogs || 0) > 0 ? "good" : "neutral")}
        ${statCard("❌", "Failures", Number(payload.failures || 0), "Unresolved or failed call events", Number(payload.failures || 0) > 0 ? "warn" : "good")}
        ${statCard("🔁", "Reroutes", Number(payload.reroutes || 0), "Fallback or rerouted sessions", Number(payload.reroutes || 0) > 0 ? "warn" : "good")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">⏱ Last Activity</span>
          <span class="context-chip ${payload.lastActivity ? "good" : "neutral"}">${escapeHtml(payload.lastActivity ? new Date(payload.lastActivity).toLocaleTimeString() : "No activity yet")}</span>
        </div>
        <p class="context-panel-copy">${escapeHtml(payload.lastSummary || "Recent system activity will appear here automatically.")}</p>
      </div>
    `;
  }

  function renderAbout() {
    return `
      ${renderHeader("Project summary", "A real-time emergency response prototype with adaptive routing and live state.")}
      <div class="context-stat-grid">
        ${statCard("🎯", "Objective", "Reduce call failure and misrouting", "Keep emergency requests moving until they reach help.", "good")}
        ${statCard("🧠", "Key Features", "Live routing + location + logs", "Browser geolocation, rerouting, and operational monitoring.", "neutral")}
      </div>
      <div>
        <div class="context-stat-head">
          <span class="context-stat-label">Feature summary</span>
        </div>
        <ul class="context-list">
          ${listItem("Failure detection", "Identifies drop, busy, timeout, and no-response conditions.")}
          ${listItem("Smart rerouting", "Directs calls to the next available center automatically.")}
          ${listItem("Context-rich monitoring", "Keeps the UI aligned to the active page and live data.")}
        </ul>
      </div>
    `;
  }

  function renderHome() {
    return `
      ${renderHeader("Command interface", "A live emergency operations workspace with a context-aware side panel.")}
      <div class="context-stat-grid">
        ${statCard("🚀", "Start Point", "Dashboard + Emergency", "Use the top navigation to jump into the live workflow.", "good")}
        ${statCard("🛰️", "Live Systems", "Maps, logs, and helper alerts", "Every page feeds the context panel in real time.", "neutral")}
      </div>
    `;
  }

  function render() {
    const payload = state.payload || {};
    panel.classList.remove("is-updated");

    const content = {
      dashboard: renderDashboard(payload),
      emergency: renderEmergency(payload),
      admin: renderAdmin(payload),
      nearby_helpers: renderNearby(payload),
      logs: renderLogs(payload),
      ai_decision_engine_page: renderAi(payload),
      about: renderAbout(),
      home: renderHome(),
    }[state.page] || renderHome();

    panel.dataset.page = state.page;
    panel.innerHTML = content;
    requestAnimationFrame(() => panel.classList.add("is-updated"));
  }

  window.ResQContextPanel = {
    set(page, payload = {}) {
      state.page = String(page || state.page || "home").toLowerCase();
      state.payload = payload || {};
      render();
    },
    refresh() {
      render();
    },
    getState() {
      return { ...state };
    },
  };

  render();
})();
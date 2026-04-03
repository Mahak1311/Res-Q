let map;
let centersLayer;
let requestsLayer;
let routeLayer;
let heatLayer;

const dashboardState = {
  latestRequest: null,
  totalRequests: 0,
};

const statusChip = (status) => {
  if (status === "connected") return '<span class="chip good">connected</span>';
  if (status === "fallback_sent") return '<span class="chip warn">fallback</span>';
  return '<span class="chip bad">unresolved</span>';
};

function initMap() {
  map = L.map("map").setView([12.9716, 77.5946], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  centersLayer = L.layerGroup().addTo(map);
  requestsLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

function pulseIcon(colorClass = "") {
  return L.divIcon({
    className: "",
    html: `<div class="pulse-marker ${colorClass}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function formatStatus(status) {
  if (status === "connected") return { label: "Connected", className: "good" };
  if (status === "fallback_sent") return { label: "Rerouted", className: "warn" };
  if (status === "unresolved") return { label: "Failed", className: "bad" };
  return { label: "Calling", className: "active" };
}

function estimateEta(distanceKm, status) {
  const base = status === "connected" ? 2 : status === "fallback_sent" ? 4 : 5;
  return `${Math.max(base, Math.round(distanceKm * 1.4))} min`;
}

function renderStats(summary) {
  dashboardState.totalRequests = summary.total;
  const active = Math.max(0, summary.total - summary.connected - summary.unresolved);
  document.getElementById("statActive").textContent = active;
  document.getElementById("statFailed").textContent = summary.unresolved;
  document.getElementById("statRerouted").textContent = summary.rerouted;
  document.getElementById("statResponse").textContent = `${Math.max(2, Math.round(12 - summary.connected * 0.4))}s`;
}

function renderFocusCard(request) {
  const focusUser = document.getElementById("focusUser");
  const focusStatus = document.getElementById("focusStatus");
  const focusDistance = document.getElementById("focusDistance");
  const focusEta = document.getElementById("focusEta");
  const focusMode = document.getElementById("focusMode");

  if (!request) {
    focusUser.textContent = "Awaiting request";
    focusStatus.textContent = "Idle";
    focusStatus.className = "status-pill neutral";
    focusDistance.textContent = "Distance: --";
    focusEta.textContent = "ETA: --";
    focusMode.textContent = "Mode: --";
    return;
  }

  const status = formatStatus(request.final_status);
  const target = request.final_center || request.attempts[request.attempts.length - 1];
  const userLabel = `${request.source || "mobile".toUpperCase()}-${request.request_id.slice(-4)}`;
  const distance = target?.distance_km ?? 0;

  focusUser.textContent = userLabel;
  focusStatus.textContent = status.label;
  focusStatus.className = `status-pill ${status.className}`;
  focusDistance.textContent = `Distance: ${distance.toFixed(1)} km`;
  focusEta.textContent = `ETA: ${estimateEta(distance, request.final_status)}`;
  focusMode.textContent = `Mode: ${request.source || "mobile"}`;
}

function renderActivity(requests) {
  const feed = document.getElementById("activityFeed");
  feed.innerHTML = "";

  requests.slice(0, 6).forEach((req) => {
    const item = document.createElement("article");
    item.className = "activity-item";

    const status = formatStatus(req.final_status);
    const location = `${req.user_lat?.toFixed(3) ?? "--"}, ${req.user_lng?.toFixed(3) ?? "--"}`;
    const progress = req.final_status === "connected" ? 100 : req.final_status === "fallback_sent" ? 72 : 40;

    item.innerHTML = `
      <div class="activity-item-head">
        <span class="status-pill ${status.className}">${status.label}</span>
        <small>${new Date(req.created_at).toLocaleTimeString()}</small>
      </div>
      <strong>Caller ${req.request_id.slice(-4)}</strong>
      <small>${location} • ${req.source || "mobile"}</small>
      <div class="progress-bar"><span style="width:${progress}%"></span></div>
    `;
    feed.appendChild(item);
  });
}

function renderTable(requests) {
  const tbody = document.querySelector("#requestTable tbody");
  tbody.innerHTML = "";

  requests.forEach((req) => {
    const row = document.createElement("tr");
    const centerName = req.final_center ? req.final_center.name : "fallback";
    row.innerHTML = `
      <td>${req.request_id}</td>
      <td>${req.source || "mobile"}</td>
      <td>${statusChip(req.final_status)}</td>
      <td>${centerName}</td>
      <td>${req.network.strength}%</td>
    `;
    tbody.appendChild(row);
  });
}

function renderMapData(data) {
  centersLayer.clearLayers();
  requestsLayer.clearLayers();
  routeLayer.clearLayers();

  const centersById = new Map(data.centers.map((c) => [c.id, c]));

  data.centers.forEach((center) => {
    const marker = L.circleMarker([center.lat, center.lng], {
      radius: 8,
      color: "#15a34a",
      fillOpacity: 0.75,
      weight: 2,
    }).bindPopup(`<strong>${center.name}</strong><br/>Capacity: ${center.capacity}<br/>Load: ${center.load}`);
    marker.addTo(centersLayer);
  });

  data.failure_zones.forEach((zone) => {
    L.circle([zone.lat, zone.lng], {
      radius: 800,
      color: "#f97316",
      fillColor: "#fb923c",
      fillOpacity: 0.12,
      weight: 1,
      dashArray: "4,5",
    })
      .bindPopup(`Failure-prone: ${zone.name}`)
      .addTo(routeLayer);
  });

  data.requests.forEach((req, index) => {
    const user = req.location.corrected;
    const color = req.final_status === "connected" ? "#22c55e" : req.final_status === "fallback_sent" ? "#facc15" : "#ef4444";
    const userIcon = pulseIcon(req.final_status === "connected" ? "" : "route");

    L.marker([user.lat, user.lng], { icon: userIcon })
      .bindPopup(`<strong>${req.request_id}</strong><br/>Status: ${req.final_status}`)
      .addTo(requestsLayer);

    req.attempts.forEach((attempt, attemptIndex) => {
      const center = centersById.get(attempt.center_id);
      const targetLat = attempt.lat || center?.lat;
      const targetLng = attempt.lng || center?.lng;
      if (targetLat === undefined || targetLng === undefined) {
        return;
      }

      L.polyline(
        [
          [user.lat, user.lng],
          [targetLat, targetLng],
        ],
        {
          color,
          weight: index === 0 ? 4 : 2,
          opacity: index === 0 ? 0.86 : 0.42,
          dashArray: attemptIndex > 0 ? "8,8" : undefined,
        }
      ).addTo(routeLayer);
    });
  });

  if (typeof L.heatLayer === "function") {
    if (heatLayer) {
      map.removeLayer(heatLayer);
    }
    heatLayer = L.heatLayer(data.failure_heatmap, {
      radius: 24,
      blur: 16,
      maxZoom: 15,
      gradient: { 0.3: "#38bdf8", 0.5: "#facc15", 0.8: "#ef4444" },
    }).addTo(map);
  }
}

async function refreshDashboard() {
  const response = await fetch("/api/dashboard");
  const data = await response.json();
  dashboardState.latestRequest = data.requests[0] || null;
  renderStats(data.summary);
  renderFocusCard(dashboardState.latestRequest);
  renderActivity(data.requests);
  renderTable(data.requests);
  renderMapData(data);
}

function wireSosButtons() {
  const buttons = [document.getElementById("sidebarSos"), document.getElementById("mapSos")].filter(Boolean);
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = "/emergency";
    });
  });
}

initMap();
wireSosButtons();
refreshDashboard();
setInterval(refreshDashboard, 4000);

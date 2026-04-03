const {
  createMap,
  userIcon,
  centerIcon,
  requestIcon,
  createRadiusCircle,
  createMarkerPopupContent,
  fetchRoute,
} = window.ResQMaps || {};

let map;
let centersLayer;
let requestsLayer;
let routeLayer;
let userLayer;
let zoneLayer;
let userCircle;
let latestRouteLine;
let stopWatchingLocation = () => {};

const dashboardState = {
  latestRequest: null,
  totalRequests: 0,
  summary: null,
  latestData: null,
  simulationState: {
    network_congestion: false,
    auto_rerouting: true,
  },
  currentLocation: { lat: 20.5937, lng: 78.9629 },
  followUser: true,
};

const NEUTRAL_LOCATION = { lat: 20.5937, lng: 78.9629 };

const statusChip = (status) => {
  if (status === "connected") return '<span class="chip good">connected</span>';
  if (status === "fallback_sent") return '<span class="chip warn">fallback</span>';
  return '<span class="chip bad">unresolved</span>';
};

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported by browser");
      resolve({ ...NEUTRAL_LOCATION, source: "default" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "geolocation",
        });
      },
      () => {
        resolve({ ...NEUTRAL_LOCATION, source: "default" });
      },
      {
        timeout: 15000,
        enableHighAccuracy: true,
        maximumAge: 60000,
      }
    );
  });
}

function formatStatus(status) {
  if (status === "connected") return { label: "Connected", className: "good" };
  if (status === "fallback_sent") return { label: "Rerouted", className: "warn" };
  if (status === "unresolved") return { label: "Failed", className: "bad" };
  return { label: "Calling", className: "active" };
}

function activityBadge(status) {
  if (status === "connected") return { label: "Resolved", className: "good" };
  if (status === "unresolved") return { label: "Failed", className: "bad" };
  return { label: "Active", className: "active" };
}

function estimateEta(distanceKm, status) {
  const base = status === "connected" ? 2 : status === "fallback_sent" ? 4 : 5;
  return `${Math.max(base, Math.round(distanceKm * 1.4))} min`;
}

function renderStats(summary) {
  dashboardState.summary = summary;
  dashboardState.totalRequests = summary.total;
  const active = Math.max(0, summary.total - summary.connected - summary.unresolved);
  document.getElementById("statActive").textContent = active;
  document.getElementById("statFailed").textContent = summary.unresolved;
  document.getElementById("statRerouted").textContent = summary.rerouted;
  document.getElementById("statResponse").textContent = `${Math.max(2, Math.round(12 - summary.connected * 0.4))}s`;
}

function publishDashboardContext(data = dashboardState.latestData || {}) {
  if (!window.ResQContextPanel?.set) {
    return;
  }

  const summary = dashboardState.summary || data.summary || {};
  const requests = Array.isArray(data.requests) ? data.requests : [];
  const latestStrength = Number(requests[0]?.network?.strength ?? 0);
  const congestion = Boolean(dashboardState.simulationState?.network_congestion);
  const networkStatus = congestion
    ? "Congested"
    : latestStrength > 65
      ? "Strong"
      : latestStrength > 35
        ? "Weak"
        : "Weak";

  window.ResQContextPanel.set("dashboard", {
    summary,
    requests,
    simulationState: dashboardState.simulationState,
    currentLocation: dashboardState.currentLocation,
    activeCalls: Math.max(0, Number(summary.total || 0) - Number(summary.connected || 0) - Number(summary.unresolved || 0)),
    reroutedCalls: Number(summary.rerouted || 0),
    networkStatus,
  });
}

function renderSimulationBadge() {
  const badge = document.getElementById("simulationBadge");
  if (!badge) {
    return;
  }

  const congestion = dashboardState.simulationState.network_congestion;
  const rerouting = dashboardState.simulationState.auto_rerouting;
  badge.textContent = congestion
    ? rerouting
      ? "Congestion On · Auto Rerouting"
      : "Congestion On · Manual Routing"
    : rerouting
      ? "Simulation Ready"
      : "Rerouting Paused";
  badge.className = `badge ${congestion ? "badge-yellow" : rerouting ? "badge-green" : "badge-teal"}`;
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
  const userLabel = `${String(request.source || "mobile").toUpperCase()}-${request.request_id.slice(-4)}`;
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

    const status = activityBadge(req.final_status);
    const location = `${req.user_lat?.toFixed(3) ?? "--"}, ${req.user_lng?.toFixed(3) ?? "--"}`;
    const progress = req.final_status === "connected" ? 100 : req.final_status === "fallback_sent" ? 72 : 40;

    item.innerHTML = `
      <div class="activity-item-head">
        <span class="status-pill ${status.className}">${status.label}</span>
        <small>${new Date(req.created_at).toLocaleTimeString()}</small>
      </div>
      <strong>${req.request_id.slice(-4)}</strong>
      <small>${location} • ${String(req.source || "mobile").toUpperCase()}</small>
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

function clearMapLayers() {
  centersLayer.clearLayers();
  requestsLayer.clearLayers();
  routeLayer.clearLayers();
  userLayer.clearLayers();
  zoneLayer.clearLayers();
}

function renderCurrentLocation(location) {
  dashboardState.currentLocation = location;

  if (!map || !userLayer) {
    return;
  }

  userLayer.clearLayers();
  L.marker([location.lat, location.lng], { icon: userIcon() })
    .bindPopup(createMarkerPopupContent({ name: "You are here 📍", type: "Current location", status: "Live" }))
    .addTo(userLayer);

  if (userCircle) {
    userCircle.remove();
  }
  userCircle = createRadiusCircle([location.lat, location.lng], Number(dashboardState.nearbyRadius || 1000), {
    color: "#2ed4ca",
    fillColor: "#2ed4ca",
    fillOpacity: 0.08,
    dashArray: "7,9",
  }).addTo(userLayer);

  // Always follow user location for now, regardless of followUser flag
  console.log("Dashboard: Setting view to user location:", [location.lat, location.lng]);
  map.setView([location.lat, location.lng], Math.max(map.getZoom(), 13), { animate: true });
  publishDashboardContext();
}

async function renderRouteForRequest(request) {
  if (!request || !request.final_center) {
    return;
  }

  const origin = request.location?.corrected || { lat: request.user_lat, lng: request.user_lng };
  const destination = {
    lat: request.final_center.lat,
    lng: request.final_center.lng,
  };

  const route = await fetchRoute(origin, destination);
  if (latestRouteLine) {
    latestRouteLine.remove();
    latestRouteLine = null;
  }

  if (route?.coordinates?.length) {
    latestRouteLine = L.polyline(route.coordinates, {
      color: request.final_status === "connected" ? "#22c55e" : "#facc15",
      weight: 4,
      opacity: 0.88,
      className: "route-line-anim",
    }).addTo(routeLayer);
    return;
  }

  latestRouteLine = L.polyline(
    [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ],
    {
      color: request.final_status === "connected" ? "#22c55e" : "#facc15",
      weight: 4,
      opacity: 0.7,
      dashArray: "8,10",
      className: "route-line-anim",
    }
  ).addTo(routeLayer);
}

async function renderMapData(data) {
  if (!map) {
    return;
  }

  clearMapLayers();
  dashboardState.latestData = data;
  const centersById = new Map((data.centers || []).map((center) => [center.id, center]));

  (data.centers || []).forEach((center) => {
    L.marker([center.lat, center.lng], {
      icon: centerIcon(center.type, center.runtime_status),
    })
      .bindPopup(
        createMarkerPopupContent({
          name: center.name,
          type: center.type,
          status: center.runtime_status || "available",
          extraLines: [
            `Load: ${center.effective_load}/${center.capacity}`,
            `Distance: ${Number(center.distance_km || 0).toFixed(1)} km`,
          ],
        })
      )
      .addTo(centersLayer);
  });

  (data.failure_zones || []).forEach((zone) => {
    L.circle([zone.lat, zone.lng], {
      radius: 800,
      color: "#f97316",
      fillColor: "#fb923c",
      fillOpacity: 0.12,
      weight: 1,
      dashArray: "4,5",
    })
      .bindPopup(`Failure-prone: ${zone.name}`)
      .addTo(zoneLayer);
  });

  (data.requests || []).forEach((req, index) => {
    const user = req.location.corrected;
    const color = req.final_status === "connected" ? "#22c55e" : req.final_status === "fallback_sent" ? "#facc15" : "#ef4444";
    L.marker([user.lat, user.lng], {
      icon: requestIcon(req.final_status, index === 0),
    })
      .bindPopup(
        createMarkerPopupContent({
          name: req.request_id,
          type: String(req.source || "mobile").toUpperCase(),
          status: req.final_status,
          extraLines: [
            `Signal: ${req.network.strength}%`,
            `Center: ${req.final_center?.name || "fallback"}`,
          ],
        })
      )
      .addTo(requestsLayer);

    if (index === 0) {
      dashboardState.latestRequest = req;
      // Don't override user location - comment out the setView call
      // if (dashboardState.followUser) {
      //   map.setView([user.lat, user.lng], 13, { animate: true });
      // }
      console.log("Dashboard: Latest request loaded but not overriding user location");
    }

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
          opacity: index === 0 ? 0.9 : 0.42,
          dashArray: attemptIndex > 0 ? "8,8" : undefined,
          className: index === 0 && attemptIndex === req.attempts.length - 1 ? "route-line-anim" : "",
        }
      ).addTo(routeLayer);
    });
  });

  renderFocusCard(dashboardState.latestRequest);
  if (dashboardState.latestRequest) {
    await renderRouteForRequest(dashboardState.latestRequest);
  }
  publishDashboardContext(data);
}

async function refreshDashboard() {
  const response = await fetch("/api/dashboard");
  const data = await response.json();
  dashboardState.latestData = data;
  dashboardState.simulationState = data.simulation_state || dashboardState.simulationState;
  dashboardState.nearbyRadius = data.nearby_helper_state?.radius_m || dashboardState.nearbyRadius || 1000;
  renderStats(data.summary);
  renderActivity(data.requests);
  renderTable(data.requests);
  await renderMapData(data);
  renderSimulationBadge();
  publishDashboardContext(data);
}

function wireSosButtons() {
  const buttons = [document.getElementById("mapSos")].filter(Boolean);
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = "/emergency";
    });
  });
}

function wireFeatureButtons() {
  const buttons = document.querySelectorAll(".feature-trigger");
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action || "unknown";
      const target = button.dataset.target || "/dashboard";

      document.querySelectorAll(".feature-trigger").forEach((item) => item.classList.remove("active-feature"));
      button.classList.add("active-feature");

      try {
        await fetch("/api/ui/feature-click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, target, source: "dashboard" }),
        });
      } catch (_) {
        // Navigation still continues even if logging is unavailable.
      }

      if (target && target !== window.location.pathname) {
        window.location.href = target;
      }
    });
  });
}

function startLocationTracking() {
  // Use our improved getLocation function instead of trackBrowserLocation
  console.log("Dashboard: Starting location tracking");
  getLocation().then(location => {
    console.log("Dashboard: Got location:", location);
    renderCurrentLocation(location);
  }).catch(error => {
    console.warn("Dashboard: Location tracking failed:", error);
  });
}

function initMapView() {
  if (!window.L || !createMap) {
    return;
  }

  map = createMap("map", { center: [20.5937, 78.9629], zoom: 5 });
  centersLayer = L.layerGroup().addTo(map);
  requestsLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  userLayer = L.layerGroup().addTo(map);
  zoneLayer = L.layerGroup().addTo(map);

  setTimeout(() => {
    map.invalidateSize();
  }, 0);
}

initMapView();
wireSosButtons();
wireFeatureButtons();
startLocationTracking();
refreshDashboard();
setInterval(refreshDashboard, 4000);

window.addEventListener("beforeunload", () => {
  stopWatchingLocation();
});

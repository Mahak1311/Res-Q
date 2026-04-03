const sosButton = document.getElementById("sosButton");
const statusText = document.getElementById("statusText");
const messageFeed = document.getElementById("messageFeed");
const strengthFill = document.getElementById("strengthFill");
const strengthValue = document.getElementById("strengthValue");
const locationText = document.getElementById("locationText");
const callModeText = document.getElementById("callModeText");
const finalBadge = document.getElementById("finalBadge");
const statusLoader = document.getElementById("statusLoader");
const runtimeHint = document.getElementById("runtimeHint");
const attemptTableBody = document.querySelector("#attemptTable tbody");
const modeButtons = document.querySelectorAll(".mode-btn");
const emergencyConsole = document.getElementById("emergencyConsole");
const metricOneValue = document.getElementById("metricOneValue");
const metricTwoValue = document.getElementById("metricTwoValue");

let activeMode = "mobile";
let map;
let userMarker;
let routeLine;
const centerMarkers = new Map();
let bootstrapCenters = [];
let bootstrapSimulationState = {
  network_congestion: false,
  auto_rerouting: true,
};

const STEP_DELAY_MS = {
  short: 900,
  normal: 1400,
  long: 1800,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emergencyType = emergencyConsole?.dataset.emergencyType || "medical";
const emergencyModeLabel = emergencyConsole?.dataset.modeLabel || "Emergency Mode Active";
const emergencyDescription = emergencyConsole?.dataset.modeDescription || "Emergency dispatch routing";

const SERVICE_LABELS = {
  medical: "ambulance response unit",
  police: "security dispatch unit",
  fire: "fire response unit",
};

const TYPE_THEME = {
  medical: {
    centerLabel: "hospital",
    centerPluralLabel: "hospitals",
    unitLabel: "ambulance",
    centerIcon: "+",
    markerIdle: "#22c55e",
    markerActive: "#2dd4bf",
    markerFailed: "#f59e0b",
    markerConnected: "#22c55e",
    routeFailed: "#14b8a6",
    routeConnected: "#22c55e",
    routeClass: "route-line-medical",
    startText: "Connecting to nearest hospital...",
    noResponseText: "No triage response detected",
    retryText: "Retrying medical channel...",
    rerouteText: "Escalating to backup hospital dispatch...",
    connectedText: "Medical dispatch connected",
    dispatchedText: "Ambulance dispatched",
    progressText: "Patient assistance in progress",
  },
  police: {
    centerLabel: "police station",
    centerPluralLabel: "police stations",
    unitLabel: "police unit",
    centerIcon: "🛡",
    markerIdle: "#60a5fa",
    markerActive: "#38bdf8",
    markerFailed: "#ef4444",
    markerConnected: "#3b82f6",
    routeFailed: "#2563eb",
    routeConnected: "#3b82f6",
    routeClass: "route-line-police",
    startText: "Alerting nearest police unit...",
    noResponseText: "Control room no response detected",
    retryText: "Retrying incident-control channel...",
    rerouteText: "Rerouting to next police command node...",
    connectedText: "Police dispatch connected",
    dispatchedText: "Officers dispatched",
    progressText: "Incident response active",
  },
  fire: {
    centerLabel: "fire station",
    centerPluralLabel: "fire stations",
    unitLabel: "fire unit",
    centerIcon: "🔥",
    markerIdle: "#f97316",
    markerActive: "#fb923c",
    markerFailed: "#ef4444",
    markerConnected: "#f97316",
    routeFailed: "#ea580c",
    routeConnected: "#fb923c",
    routeClass: "route-line-fire",
    startText: "Dispatching fire brigade...",
    noResponseText: "No station response detected",
    retryText: "Retrying fire command channel...",
    rerouteText: "Rerouting to secondary fire station...",
    connectedText: "Fire response dispatch connected",
    dispatchedText: "Fire response team en route",
    progressText: "Containment in progress",
  },
};

const activeTheme = TYPE_THEME[emergencyType] || TYPE_THEME.medical;

const randomBangalorePoint = () => ({
  lat: 12.90 + Math.random() * 0.13,
  lng: 77.53 + Math.random() * 0.19,
});

function speakMessage(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function setFinalBadge(status) {
  finalBadge.className = "status-badge";
  if (status === "connected" || status === "rerouted") {
    finalBadge.classList.add("good");
  } else if (status === "fallback_sent") {
    finalBadge.classList.add("warn");
  } else if (status === "unresolved" || status === "failed") {
    finalBadge.classList.add("bad");
  } else {
    finalBadge.classList.add("neutral");
  }
  finalBadge.textContent = status.replace("_", " ");
}

function setLoader(isActive, hintText = "") {
  if (!statusLoader) {
    return;
  }
  statusLoader.hidden = !isActive;
  if (runtimeHint && hintText) {
    runtimeHint.textContent = hintText;
  }
}

function addMessage(message, type = "neutral") {
  const item = document.createElement("li");
  item.className = `feed-item ${type}`;
  item.textContent = message;
  messageFeed.prepend(item);
}

function setStrength(strength) {
  strengthValue.textContent = `${strength}%`;
  strengthFill.style.width = `${strength}%`;
  strengthFill.className = "";
  if (strength > 65) {
    strengthFill.classList.add("signal-good");
  } else if (strength > 35) {
    strengthFill.classList.add("signal-medium");
  } else {
    strengthFill.classList.add("signal-low");
  }
}

function normalizeReason(reason) {
  if (!reason) {
    return "-";
  }
  if (reason === "center_unavailable") {
    return `${activeTheme.centerLabel} unavailable`;
  }
  if (reason === "no_response") {
    return "no response";
  }
  return reason.replace(/_/g, " ");
}

function createCenterIcon(state = "idle") {
  return L.divIcon({
    className: "",
    html: `<div class="center-marker ${emergencyType} ${state}">${activeTheme.centerIcon}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function updateModeMetrics({
  attemptNumber = 0,
  status = "pending",
  distanceKm = 0,
  strength = 55,
}) {
  if (!metricOneValue || !metricTwoValue) {
    return;
  }

  if (emergencyType === "medical") {
    const eta = Math.max(2, Math.round(distanceKm * 1.7 + 3));
    const patientStatus = status === "connected" ? (strength < 42 ? "Critical" : "Stable") : "Critical";
    metricOneValue.textContent = `${eta} min`;
    metricTwoValue.textContent = patientStatus;
    return;
  }

  if (emergencyType === "police") {
    const severity = status !== "connected" ? "High" : strength < 40 ? "High" : attemptNumber > 1 ? "Medium" : "Low";
    const units = Math.max(1, attemptNumber + (status === "connected" ? 1 : 0));
    metricOneValue.textContent = severity;
    metricTwoValue.textContent = `${units}`;
    return;
  }

  const intensity = status !== "connected" ? "High" : strength < 45 ? "Medium" : "Low";
  const waterUnits = Math.max(1, attemptNumber);
  const crew = Math.max(4, attemptNumber * 3);
  metricOneValue.textContent = intensity;
  metricTwoValue.textContent = `${waterUnits} units / ${crew} crew`;
}

function addAttemptRow(attempt) {
  const tr = document.createElement("tr");
  tr.className = "attempt-row-enter";
  tr.innerHTML = `
    <td>${attempt.attempt}</td>
    <td>${attempt.center_name}</td>
    <td>${Number(attempt.distance_km || 0).toFixed(2)} km</td>
    <td><span class="chip ${attempt.status === "connected" ? "good" : "bad"}">${attempt.status}</span></td>
    <td>${normalizeReason(attempt.reason)}</td>
  `;
  attemptTableBody.appendChild(tr);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return radius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normalizeCenterStatusId(centerId) {
  const raw = String(centerId || "");
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const match = raw.match(/(\d+)$/);
  if (!match) {
    return raw;
  }

  const numeric = Number(match[1]);
  return numeric >= 101 ? numeric - 100 : numeric;
}

async function fetchCenterAvailability(centerId) {
  try {
    const statusId = normalizeCenterStatusId(centerId);
    const response = await fetch(`/center-status/${encodeURIComponent(statusId)}`);
    if (!response.ok) {
      return true;
    }
    const data = await response.json();
    return Boolean(data.available);
  } catch (_) {
    return true;
  }
}

function initMap() {
  if (!window.L) {
    return;
  }

  map = L.map("emergencyMap", {
    zoomControl: true,
  }).setView([12.9716, 77.5946], 12);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }).addTo(map);
}

function styleCenterMarker(marker, mode) {
  marker.setIcon(createCenterIcon(mode));
}

function renderCentersOnMap(centers) {
  if (!map) {
    return;
  }

  centerMarkers.forEach((marker) => marker.remove());
  centerMarkers.clear();

  centers.forEach((center) => {
    const marker = L.marker([center.lat, center.lng], {
      icon: createCenterIcon("idle"),
    })
      .bindPopup(`<strong>${center.name}</strong><br/>Capacity: ${center.capacity}<br/>Load: ${center.load}`)
      .addTo(map);
    centerMarkers.set(center.id, marker);
  });
}

function upsertUserMarker(location) {
  if (!map) {
    return;
  }

  const icon = L.divIcon({
    className: "",
    html: '<div class="pulse-marker"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  if (!userMarker) {
    userMarker = L.marker([location.lat, location.lng], { icon }).addTo(map);
  } else {
    userMarker.setLatLng([location.lat, location.lng]);
  }
  userMarker.bindPopup("Caller location");
  map.panTo([location.lat, location.lng], { animate: true, duration: 0.8 });
}

function drawRoute(userLocation, center, status) {
  if (!map || !center) {
    return;
  }

  if (routeLine) {
    routeLine.remove();
  }

  const color = status === "connected" ? activeTheme.routeConnected : activeTheme.routeFailed;
  routeLine = L.polyline(
    [
      [userLocation.lat, userLocation.lng],
      [center.lat, center.lng],
    ],
    {
      color,
      weight: 4,
      opacity: 0.84,
      dashArray: status === "connected" ? "10,12" : "6,10",
      className: activeTheme.routeClass,
    }
  ).addTo(map);
}

async function loadBootstrapData() {
  try {
    const response = await fetch(`/api/bootstrap?emergency_type=${encodeURIComponent(emergencyType)}`);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    bootstrapCenters = Array.isArray(data.centers) ? data.centers : [];
    bootstrapSimulationState = data.simulation_state || bootstrapSimulationState;
    renderCentersOnMap(bootstrapCenters);
  } catch (_) {
    // Keep UI usable even if bootstrap fails.
  }
}

function buildVisualAttempts(data, location) {
  const attempts = Array.isArray(data.attempts) ? [...data.attempts] : [];
  if (data.simulation_state && data.simulation_state.auto_rerouting === false) {
    return attempts;
  }
  if (attempts.length >= 2) {
    return attempts;
  }

  if (!bootstrapCenters.length) {
    return attempts;
  }

  const ranked = [...bootstrapCenters]
    .map((center) => ({
      ...center,
      distance_km: Number(haversineKm(location.lat, location.lng, center.lat, center.lng).toFixed(2)),
    }))
    .sort((a, b) => a.distance_km - b.distance_km);

  if (ranked.length < 2) {
    return attempts;
  }

  const primaryFailure = {
    attempt: 1,
    center_id: ranked[0].id,
    center_name: ranked[0].name,
    lat: ranked[0].lat,
    lng: ranked[0].lng,
    distance_km: ranked[0].distance_km,
    status: "failed",
    reason: data.network?.strength <= 38 ? "no_response" : "busy",
    timestamp: new Date().toISOString(),
  };

  const secondaryConnect = {
    attempt: 2,
    center_id: ranked[1].id,
    center_name: ranked[1].name,
    lat: ranked[1].lat,
    lng: ranked[1].lng,
    distance_km: ranked[1].distance_km,
    status: "connected",
    reason: null,
    timestamp: new Date().toISOString(),
  };

  return [primaryFailure, secondaryConnect];
}

async function runFlow(data, location) {
  const visualAttempts = buildVisualAttempts(data, location);
  let strength = Number(data.network?.strength || 55);
  const serviceLabel = SERVICE_LABELS[emergencyType] || activeTheme.centerLabel;

  addMessage(activeTheme.startText, "neutral");
  statusText.textContent = activeTheme.startText;
  setLoader(true, "Initializing emergency route checks...");
  updateModeMetrics({
    attemptNumber: 0,
    status: "pending",
    distanceKm: 0,
    strength,
  });
  await sleep(STEP_DELAY_MS.normal);

  for (const attempt of visualAttempts) {
    const center = {
      id: attempt.center_id,
      name: attempt.center_name,
      lat: attempt.lat,
      lng: attempt.lng,
      distance_km: attempt.distance_km,
    };

    const marker = centerMarkers.get(center.id);
    if (marker) {
      styleCenterMarker(marker, "active");
      marker.openPopup();
    }
    drawRoute(location, center, attempt.status);

    addMessage(`Checking availability for ${center.name}...`, "neutral");
    statusText.textContent = `Checking availability for ${center.name}...`;
    setLoader(true, "Running availability and network diagnostics...");
    await sleep(STEP_DELAY_MS.short);

    const isAvailable = await fetchCenterAvailability(center.id);
    if (!isAvailable && attempt.status === "connected") {
      attempt.status = "failed";
      attempt.reason = "center_unavailable";
    }

    addAttemptRow(attempt);
    updateModeMetrics({
      attemptNumber: attempt.attempt,
      status: attempt.status,
      distanceKm: Number(attempt.distance_km || 0),
      strength,
    });

    if (attempt.status === "connected") {
      if (marker) {
        styleCenterMarker(marker, "connected");
      }
      strength = Math.min(99, strength + 4);
      setStrength(strength);
      addMessage(activeTheme.connectedText, "good");
      await sleep(STEP_DELAY_MS.short);
      addMessage(activeTheme.dispatchedText, "good");
      await sleep(STEP_DELAY_MS.short);
      addMessage(activeTheme.progressText, "good");
      statusText.textContent = activeTheme.connectedText;
      setLoader(false, "Connection established.");
      setFinalBadge("connected");
      speakMessage(activeTheme.connectedText);
      updateModeMetrics({
        attemptNumber: attempt.attempt,
        status: "connected",
        distanceKm: Number(attempt.distance_km || 0),
        strength,
      });
      return;
    }

    if (marker) {
      styleCenterMarker(marker, "failed");
    }
    strength = Math.max(8, strength - (attempt.reason === "no_response" ? 14 : 10));
    setStrength(strength);

    addMessage(activeTheme.noResponseText, "warn");
    statusText.textContent = activeTheme.noResponseText;
    await sleep(STEP_DELAY_MS.short);

    addMessage(activeTheme.retryText, "warn");
    statusText.textContent = activeTheme.retryText;
    await sleep(STEP_DELAY_MS.short);

    addMessage(activeTheme.rerouteText, "warn");
    statusText.textContent = activeTheme.rerouteText;
    setLoader(true, "Rerouting in progress...");
    speakMessage(activeTheme.rerouteText);
    await sleep(STEP_DELAY_MS.normal);
  }

  setFinalBadge("failed");
  setLoader(true, "No center accepted voice route. Sending fallback...");
  statusText.textContent = `No available ${activeTheme.centerPluralLabel}`;
  addMessage(`No available ${activeTheme.centerPluralLabel}`, "bad");

  if (data.fallback) {
    addMessage(`Sending fallback alert (${data.fallback.channel})`, "warn");
    addMessage(`Fallback status: ${data.fallback.status}`, "warn");
  } else {
    addMessage("Sending fallback alert (SMS / Internet)", "warn");
  }

  await sleep(STEP_DELAY_MS.long);
  setLoader(false, "Fallback workflow completed.");
  updateModeMetrics({
    attemptNumber: visualAttempts.length,
    status: "failed",
    distanceKm: 0,
    strength,
  });
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ...randomBangalorePoint(), source: "mock" });
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
      () => resolve({ ...randomBangalorePoint(), source: "mock" }),
      { timeout: 5000 }
    );
  });
}

function setActiveMode(mode) {
  activeMode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  if (callModeText) {
    const channelLabel = mode === "voip" ? "VoIP call selected" : "Mobile call selected";
    callModeText.textContent = `${channelLabel} • ${emergencyModeLabel}`;
  }
}

async function triggerEmergency() {
  sosButton.disabled = true;
  sosButton.classList.add("active");
  statusText.textContent = "Attempting to connect...";
  messageFeed.innerHTML = "";
  attemptTableBody.innerHTML = "";
  setFinalBadge("connecting");
  setLoader(true, "Collecting location and network data...");

  const location = await getLocation();
  locationText.textContent = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} (${location.source})`;
  if (runtimeHint) {
    runtimeHint.textContent = `${emergencyDescription} in progress...`;
  }
  upsertUserMarker(location);

  const response = await fetch("/api/emergency/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...location,
      source: activeMode,
      emergency_type: emergencyType,
      user_id: `ui-${Date.now()}`,
      timestamp: new Date().toISOString(),
      network: {
        mode: activeMode,
        channel: location.source,
      },
    }),
  });

  if (!response.ok) {
    statusText.textContent = "Unable to process emergency request.";
    addMessage("System error while simulating emergency call.", "bad");
    setFinalBadge("unresolved");
    setLoader(false, "Emergency request failed.");
    sosButton.disabled = false;
    sosButton.classList.remove("active");
    return;
  }

  const data = await response.json();
  setStrength(data.network.strength);

  if (data.nearby_alert) {
    addMessage(`Nearby helpers notified: ${data.nearby_alert.stats.notified}`, "warn");
  }
  if (data.simulation_state?.network_congestion) {
    addMessage("Network congestion simulation active", "warn");
  }
  if (!data.simulation_state?.auto_rerouting) {
    addMessage("Auto rerouting is disabled for this session", "warn");
  }

  await runFlow(data, location);

  if (data.final_center) {
    addMessage(`Connected center: ${data.final_center.name}`, "good");
  } else if (data.fallback) {
    addMessage(`Fallback ${data.fallback.channel} status: ${data.fallback.status}`, "warn");
  }

  centerMarkers.forEach((marker) => {
    styleCenterMarker(marker, "idle");
  });

  sosButton.disabled = false;
  sosButton.classList.remove("active");
}

if (sosButton) {
  sosButton.addEventListener("click", triggerEmergency);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveMode(button.dataset.mode));
});

initMap();
loadBootstrapData();
setActiveMode(activeMode);

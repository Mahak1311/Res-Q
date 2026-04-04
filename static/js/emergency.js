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

const MEDICAL_ELEMENTS = {
  beds: document.getElementById("medBedsValue"),
  icu: document.getElementById("medIcuValue"),
  staff: document.getElementById("medStaffValue"),
  response: document.getElementById("medResponseValue"),
  success: document.getElementById("medSuccessValue"),
  labelOne: document.getElementById("medLabelOne"),
  labelTwo: document.getElementById("medLabelTwo"),
};

const POLICE_ELEMENTS = {
  units: document.getElementById("polUnitsValue"),
  nearest: document.getElementById("polNearestValue"),
  risk: document.getElementById("polRiskValue"),
  speed: document.getElementById("polSpeedValue"),
  labelOne: document.getElementById("polLabelOne"),
  labelTwo: document.getElementById("polLabelTwo"),
};

const FIRE_ELEMENTS = {
  trucks: document.getElementById("fireTrucksValue"),
  water: document.getElementById("fireWaterValue"),
  equip: document.getElementById("fireEquipValue"),
  capability: document.getElementById("fireCapabilityValue"),
  labelOne: document.getElementById("fireLabelOne"),
  labelTwo: document.getElementById("fireLabelTwo"),
};

const {
  createMap,
  userIcon,
  emergencyIcon,
  createRadiusCircle,
  createMarkerPopupContent,
  trackBrowserLocation,
  fetchRoute,
} = window.ResQMaps || {};

let activeMode = "mobile";
let map;
let userMarker;
let emergencyMarker;
let routeLine;
let locationCircle;
let currentLocation = null;
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
const NEUTRAL_LOCATION = { lat: 20.5937, lng: 78.9629 };

const emergencyContext = {
  timeline: [],
  callStatus: "Idle",
  reroutingStatus: "Standby",
  reroutingNote: "Routing decisions update live",
  currentLocation: null,
  locationText: "Awaiting browser position",
  finalStatus: "connecting",
  finalTone: "neutral",
  callTone: "neutral",
  reroutingTone: "neutral",
};

function publishEmergencyContext(overrides = {}) {
  if (!window.ResQContextPanel?.set) {
    return;
  }

  window.ResQContextPanel.set("emergency", {
    ...emergencyContext,
    ...overrides,
  });
}

function pushEmergencyTimeline(label, detail, tone = "neutral") {
  emergencyContext.timeline = [...emergencyContext.timeline, { label, detail: detail || label, tone }].slice(-4);
  publishEmergencyContext();
}

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

  emergencyContext.finalStatus = status;
  emergencyContext.finalTone = finalBadge.classList.contains("good")
    ? "good"
    : finalBadge.classList.contains("warn")
      ? "warn"
      : finalBadge.classList.contains("bad")
        ? "bad"
        : "neutral";
  publishEmergencyContext();
}

function setLoader(isActive, hintText = "") {
  if (!statusLoader) {
    return;
  }
  statusLoader.hidden = !isActive;
  if (runtimeHint && hintText) {
    runtimeHint.textContent = hintText;
  }
  emergencyContext.reroutingStatus = isActive ? hintText || "Processing" : "Connected";
  emergencyContext.reroutingNote = hintText || emergencyContext.reroutingNote;
  publishEmergencyContext();
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

  publishEmergencyContext();
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

function updateDomainMetrics({
  attemptNumber = 0,
  status = "pending",
  distanceKm = 0,
  strength = 55,
  domainProfile = null,
}) {
  if (emergencyType === "medical") {
    if (!MEDICAL_ELEMENTS.beds) {
      return;
    }
    const beds = domainProfile?.hospital_bed_availability ?? Math.max(1, 16 - attemptNumber * 2);
    const icu = domainProfile?.icu_availability ?? Math.max(0, 7 - attemptNumber);
    const staff = domainProfile?.staff_availability ?? Math.max(2, 18 - attemptNumber * 2);
    const response = domainProfile?.average_response_time_min ?? Math.max(3, Math.round(distanceKm * 2.0 + 4));
    const success = domainProfile?.patient_success_rate ?? Math.max(58, Math.round(91 - attemptNumber * 4 - (100 - strength) * 0.16));
    MEDICAL_ELEMENTS.beds.textContent = `${beds}`;
    MEDICAL_ELEMENTS.icu.textContent = `${icu}`;
    MEDICAL_ELEMENTS.staff.textContent = `${staff}`;
    MEDICAL_ELEMENTS.response.textContent = `${Number(response).toFixed(1)} min`;
    MEDICAL_ELEMENTS.success.textContent = `${Number(success).toFixed(1)}%`;

    const labels = Array.isArray(domainProfile?.labels) ? domainProfile.labels : [];
    if (MEDICAL_ELEMENTS.labelOne) {
      MEDICAL_ELEMENTS.labelOne.textContent = labels[0] || (icu >= 2 ? "ICU Ready" : "ICU Limited");
    }
    if (MEDICAL_ELEMENTS.labelTwo) {
      MEDICAL_ELEMENTS.labelTwo.textContent = labels[1] || (status === "connected" ? "Critical Care Available" : "Critical Care Standby");
    }
    return;
  }

  if (emergencyType === "police") {
    if (!POLICE_ELEMENTS.units) {
      return;
    }

    const units = domainProfile?.patrol_units_nearby ?? Math.max(1, 4 - Math.floor(attemptNumber / 2));
    const nearestKm = domainProfile?.nearest_unit_distance_km ?? Math.max(0.2, Number((distanceKm * 0.9).toFixed(2)));
    const risk = (domainProfile?.zone_risk_level || (status !== "connected" ? "high" : strength < 45 ? "medium" : "low")).toUpperCase();
    const speed = domainProfile?.response_speed_min ?? Math.max(2, Number((distanceKm * 1.45 + 2.8).toFixed(1)));
    POLICE_ELEMENTS.units.textContent = `${units}`;
    POLICE_ELEMENTS.nearest.textContent = `${Number(nearestKm).toFixed(2)} km`;
    POLICE_ELEMENTS.risk.textContent = risk;
    POLICE_ELEMENTS.speed.textContent = `${Number(speed).toFixed(1)} min`;

    const labels = Array.isArray(domainProfile?.labels) ? domainProfile.labels : [];
    if (POLICE_ELEMENTS.labelOne) {
      POLICE_ELEMENTS.labelOne.textContent = labels[0] || (risk === "HIGH" ? "High Priority Zone" : "Zone Under Watch");
    }
    if (POLICE_ELEMENTS.labelTwo) {
      POLICE_ELEMENTS.labelTwo.textContent = labels[1] || (status === "connected" ? "Unit Dispatched" : "Dispatch Queue Active");
    }
    return;
  }

  if (!FIRE_ELEMENTS.trucks) {
    return;
  }

  const trucks = domainProfile?.fire_trucks_available ?? Math.max(1, 5 - Math.floor(attemptNumber / 2));
  const water = domainProfile?.water_capacity_liters ?? trucks * 3200;
  const equip = domainProfile?.equipment_readiness ?? Math.max(52, Math.round(89 - attemptNumber * 3 - (100 - strength) * 0.14));
  const capability = (domainProfile?.fire_handling_capability || (status !== "connected" ? "high" : equip >= 80 ? "high" : equip >= 64 ? "medium" : "limited")).toUpperCase();
  FIRE_ELEMENTS.trucks.textContent = `${trucks}`;
  FIRE_ELEMENTS.water.textContent = `${Math.round(water).toLocaleString()} L`;
  FIRE_ELEMENTS.equip.textContent = `${Number(equip).toFixed(1)}%`;
  FIRE_ELEMENTS.capability.textContent = capability;

  const labels = Array.isArray(domainProfile?.labels) ? domainProfile.labels : [];
  if (FIRE_ELEMENTS.labelOne) {
    FIRE_ELEMENTS.labelOne.textContent = labels[0] || (capability === "HIGH" ? "High Severity" : "Containment Ready");
  }
  if (FIRE_ELEMENTS.labelTwo) {
    FIRE_ELEMENTS.labelTwo.textContent = labels[1] || (status === "connected" ? "Rapid Response Online" : "Rapid Response Required");
  }
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

  map = createMap("emergencyMap", {
    center: [20.5937, 78.9629],
    zoom: 5,
  });

  map.on("click", (event) => {
    currentLocation = { lat: event.latlng.lat, lng: event.latlng.lng };
    upsertUserMarker(currentLocation);
  });
}

async function initializeLocation() {
  try {
    const location = await getLocation();
    currentLocation = location;
    upsertUserMarker(location);
    upsertEmergencyMarker(location);
    ensureLocationLayer();
    console.log("Location initialized:", location);
  } catch (error) {
    console.warn("Failed to initialize location:", error);
  }
}

function ensureLocationLayer() {
  if (!map) {
    return;
  }

  if (!locationCircle && currentLocation) {
    locationCircle = createRadiusCircle([currentLocation.lat, currentLocation.lng], 1000, {
      color: "#2ed4ca",
      fillColor: "#2ed4ca",
      fillOpacity: 0.08,
      dashArray: "7,10",
    }).addTo(map);
  }
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
      .bindPopup(
        createMarkerPopupContent({
          name: center.name,
          type: center.type || activeTheme.centerLabel,
          status: center.runtime_status || "available",
          extraLines: [`Capacity: ${center.capacity}`, `Load: ${center.load}`],
        })
      )
      .addTo(map);
    centerMarkers.set(center.id, marker);
  });
}

function upsertUserMarker(location) {
  if (!map) {
    return;
  }

  console.log("UPSERT USER MARKER - Location:", location);
  currentLocation = location;

  if (userMarker) {
    userMarker.setLatLng([location.lat, location.lng]);
  } else {
    userMarker = L.marker([location.lat, location.lng], { icon: userIcon() }).addTo(map);
  }

  userMarker.bindPopup(
    createMarkerPopupContent({
      name: "Your Location",
      type: "Current Position",
      status: location.source || "unknown",
      extraLines: [`Source: ${location.source}`],
    })
  );

  if (locationCircle) {
    locationCircle.setLatLng([location.lat, location.lng]);
  } else {
    locationCircle = createRadiusCircle([location.lat, location.lng], 1000, {
      color: "#2ed4ca",
      fillColor: "#2ed4ca",
      fillOpacity: 0.08,
    }).addTo(map);
  }

  console.log("SETTING MAP VIEW to:", [location.lat, location.lng]);
  map.setView([location.lat, location.lng], Math.max(map.getZoom(), 14), { animate: true });
}

function upsertEmergencyMarker(location) {
  if (!map) {
    return;
  }

  if (emergencyMarker) {
    emergencyMarker.setLatLng([location.lat, location.lng]);
  } else {
    emergencyMarker = L.marker([location.lat, location.lng], { icon: emergencyIcon() }).addTo(map);
  }

  emergencyMarker.bindPopup(
    createMarkerPopupContent({
      name: "Emergency location 🚨",
      type: "Incident",
      status: "Active",
    })
  );
}

async function drawRoute(userLocation, center, status) {
  if (!map || !center) {
    return;
  }

  if (routeLine) {
    routeLine.remove();
  }

  const route = await fetchRoute(userLocation, center);
  const color = status === "connected" ? activeTheme.routeConnected : activeTheme.routeFailed;

  if (route?.coordinates?.length) {
    routeLine = L.polyline(route.coordinates, {
      color,
      weight: 4,
      opacity: 0.9,
      className: activeTheme.routeClass,
    }).addTo(map);
    return;
  }

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

function startLocationTracking() {
  // Use our improved getLocation function instead of trackBrowserLocation
  // Only update if we don't already have a good location
  if (!currentLocation || currentLocation.source === "mock") {
    getLocation().then(location => {
      currentLocation = location;
      upsertUserMarker(location);
      console.log("Location tracking updated:", location);
    }).catch(error => {
      console.warn("Location tracking failed:", error);
    });
  } else {
    console.log("Using existing location:", currentLocation);
  }
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
  const scoredCenters = Array.isArray(data.ai_decision?.ranked_centers) ? data.ai_decision.ranked_centers : [];
  const centerProfileMap = new Map(scoredCenters.map((center) => [center.id, center]));

  addMessage(activeTheme.startText, "neutral");
  statusText.textContent = activeTheme.startText;
  setLoader(true, "Initializing emergency route checks...");
  updateDomainMetrics({
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

    if (attempt.attempt > 1) {
      emergencyContext.reroutingStatus = `Rerouting to ${center.name}`;
      emergencyContext.reroutingNote = `Attempt ${attempt.attempt} of ${visualAttempts.length}`;
      pushEmergencyTimeline("Rerouted", `Trying ${center.name}`, "warn");
    }

    const marker = centerMarkers.get(center.id);
    const scoredCenter = centerProfileMap.get(center.id);
    if (marker) {
      styleCenterMarker(marker, "active");
      marker.openPopup();
    }
    await drawRoute(location, center, attempt.status);

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
    updateDomainMetrics({
      attemptNumber: attempt.attempt,
      status: attempt.status,
      distanceKm: Number(attempt.distance_km || 0),
      strength,
      domainProfile: scoredCenter?.domain_profile,
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
      emergencyContext.callStatus = "Connected";
      emergencyContext.reroutingStatus = `Connected to ${center.name}`;
      emergencyContext.reroutingNote = `${center.name} accepted the call`;
      pushEmergencyTimeline("Connected", `${center.name} accepted the call`, "active");
      speakMessage(activeTheme.connectedText);
      updateDomainMetrics({
        attemptNumber: attempt.attempt,
        status: "connected",
        distanceKm: Number(attempt.distance_km || 0),
        strength,
        domainProfile: scoredCenter?.domain_profile,
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
  emergencyContext.callStatus = "Failed";
  pushEmergencyTimeline("Failed", `${center.name} did not respond`, "bad");
    await sleep(STEP_DELAY_MS.short);

    addMessage(activeTheme.retryText, "warn");
    statusText.textContent = activeTheme.retryText;
  emergencyContext.reroutingStatus = `Retrying after ${center.name}`;
  emergencyContext.reroutingNote = "Searching next center";
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
  emergencyContext.callStatus = "Failed";
  emergencyContext.reroutingStatus = "Fallback alert in progress";
  emergencyContext.reroutingNote = `No available ${activeTheme.centerPluralLabel}`;
  pushEmergencyTimeline("Fallback", "SMS / internet alert sent", "warn");

  if (data.fallback) {
    addMessage(`Sending fallback alert (${data.fallback.channel})`, "warn");
    addMessage(`Fallback status: ${data.fallback.status}`, "warn");
  } else {
    addMessage("Sending fallback alert (SMS / Internet)", "warn");
  }

  await sleep(STEP_DELAY_MS.long);
  setLoader(false, "Fallback workflow completed.");
  updateDomainMetrics({
    attemptNumber: visualAttempts.length,
    status: "failed",
    distanceKm: 0,
    strength,
  });
}

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
        console.warn("Geolocation failed: falling back to neutral center");
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

function setActiveMode(mode) {
  activeMode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  if (callModeText) {
    const channelLabel = mode === "voip" ? "VoIP call selected" : "Mobile call selected";
    callModeText.textContent = `${channelLabel} • ${emergencyModeLabel}`;
  }

  publishEmergencyContext({ callMode: activeMode });
}

async function triggerEmergency() {
  sosButton.disabled = true;
  sosButton.classList.add("active");
  statusText.textContent = "Attempting to connect...";
  messageFeed.innerHTML = "";
  attemptTableBody.innerHTML = "";
  setFinalBadge("connecting");
  setLoader(true, "Collecting location and network data...");
  emergencyContext.timeline = [{ label: "Call initiated", detail: "SOS request triggered", tone: "active" }];
  emergencyContext.callStatus = "Calling";
  emergencyContext.reroutingStatus = "Collecting location";
  emergencyContext.reroutingNote = "Waiting for browser position";
  publishEmergencyContext();

  const location = await getLocation();
  locationText.textContent = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} (${location.source})`;
  emergencyContext.currentLocation = location;
  emergencyContext.locationText = locationText.textContent;
  pushEmergencyTimeline("Location acquired", locationText.textContent, "neutral");
  if (runtimeHint) {
    runtimeHint.textContent = `${emergencyDescription} in progress...`;
  }
  upsertUserMarker(location);
  upsertEmergencyMarker(location);
  ensureLocationLayer();

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
    emergencyContext.callStatus = "Failed";
    pushEmergencyTimeline("Call failed", "Emergency request could not be processed", "bad");
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
console.log("Emergency.js loaded - about to initialize location");
initializeLocation();
startLocationTracking();
loadBootstrapData();
setActiveMode(activeMode);
updateDomainMetrics({
  attemptNumber: 0,
  status: "pending",
  distanceKm: 3.5,
  strength: 60,
});

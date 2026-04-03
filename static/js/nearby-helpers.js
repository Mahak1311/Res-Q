const {
  createMap,
  userIcon,
  emergencyIcon,
  helperIcon,
  createRadiusCircle,
  createMarkerPopupContent,
  trackBrowserLocation,
} = window.ResQMaps || {};

const nearbyMapElement = document.getElementById("nearbyMap");
const radiusRange = document.getElementById("radiusRange");
const radiusLabel = document.getElementById("radiusLabel");
const radiusPills = document.querySelectorAll(".radius-pill");
const autoAlertToggle = document.getElementById("autoAlertToggle");
const soundAlertToggle = document.getElementById("soundAlertToggle");
const sendNearbyAlertBtn = document.getElementById("sendNearbyAlertBtn");
const nearbyUsersList = document.getElementById("nearbyUsersList");
const nearbySyncBadge = document.getElementById("nearbySyncBadge");
const helpersNotifiedBadge = document.getElementById("helpersNotifiedBadge");
const helpersRespondingBadge = document.getElementById("helpersRespondingBadge");
const previewHeadline = document.getElementById("previewHeadline");
const previewBody = document.getElementById("previewBody");
const previewMeta = document.getElementById("previewMeta");

const nearbyState = {
  radius_m: 1000,
  auto_alert_on_sos: true,
  sound_alert: true,
  current_location: { lat: 20.5937, lng: 78.9629 },
  emergency_location: { lat: 20.5937, lng: 78.9629 },
  helpers: [],
  alert: null,
};

let nearbyMap;
let mapLayers = {};
let stopWatchingLocation = () => {};
let helperMotionTimer = null;
let locationSyncTimer = null;

function metersToLabel(radiusM) {
  return radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM}m`;
}

function statusChip(status) {
  if (status === "responding") return '<span class="chip warn">Responding</span>';
  if (status === "ignored") return '<span class="chip bad">Ignored</span>';
  return '<span class="chip good">Available</span>';
}

function helperPopup(helper) {
  return createMarkerPopupContent({
    name: helper.name,
    type: helper.label || "helper",
    status: helper.status,
    extraLines: [
      `${Number(helper.distance_m).toFixed(0)} m away`,
      helper.eta_min ? `ETA: ${helper.eta_min} min` : "ETA: --",
    ],
  });
}

function updatePreview(alertData) {
  if (!alertData) {
    previewHeadline.textContent = "🚨 Emergency nearby — help needed!";
    previewBody.textContent = "Medical emergency near your location. Please respond if you are able.";
    previewMeta.textContent = `${metersToLabel(nearbyState.radius_m)} radius`;
    return;
  }

  previewHeadline.textContent = alertData.preview.headline;
  previewBody.textContent = alertData.preview.details;
  previewMeta.textContent = `${alertData.preview.radius_label} • ${alertData.stats.notified} notified | ${alertData.stats.responding} responding`;
}

function renderStats(alertData) {
  if (!alertData) {
    if (helpersNotifiedBadge) helpersNotifiedBadge.textContent = "0 helpers notified";
    if (helpersRespondingBadge) helpersRespondingBadge.textContent = "0 responding";
    return;
  }

  if (helpersNotifiedBadge) {
    helpersNotifiedBadge.textContent = `${alertData.stats.notified} helpers notified`;
  }
  if (helpersRespondingBadge) {
    helpersRespondingBadge.textContent = `${alertData.stats.responding} responding`;
  }
}

function renderHelpersList(helpers) {
  if (!nearbyUsersList) {
    return;
  }

  nearbyUsersList.innerHTML = "";
  helpers.forEach((helper) => {
    const item = document.createElement("article");
    item.className = `nearby-user-card ${helper.status}`;
    item.innerHTML = `
      <div class="nearby-user-head">
        <strong>${helper.name}</strong>
        <span class="chip ${helper.status === "responding" ? "warn" : helper.status === "ignored" ? "bad" : "good"}">${helper.status}</span>
      </div>
      <p>${Number(helper.distance_m).toFixed(0)} m away</p>
      <div class="nearby-user-meta">
        <span>ETA: ${helper.eta_min ? `${helper.eta_min} min` : "--"}</span>
        <span>${helper.label || "helper"}</span>
      </div>
      <div class="nearby-user-track">
        <span style="width:${helper.status === "responding" ? 100 : helper.status === "available" ? 58 : 22}%"></span>
      </div>
    `;
    nearbyUsersList.appendChild(item);
  });
}

function ensureMap() {
  if (!nearbyMapElement || !window.L || nearbyMap) {
    return;
  }

  nearbyMap = createMap("nearbyMap", {
    center: [nearbyState.current_location.lat, nearbyState.current_location.lng],
    zoom: 14,
  });

  mapLayers = {
    base: L.layerGroup().addTo(nearbyMap),
    helpers: L.layerGroup().addTo(nearbyMap),
    overlays: L.layerGroup().addTo(nearbyMap),
  };

  setTimeout(() => nearbyMap.invalidateSize(), 0);
}

function renderMap() {
  ensureMap();
  if (!nearbyMap || !mapLayers.helpers) {
    return;
  }

  mapLayers.helpers.clearLayers();
  mapLayers.overlays.clearLayers();

  L.marker([nearbyState.current_location.lat, nearbyState.current_location.lng], { icon: userIcon() })
    .bindPopup(createMarkerPopupContent({ name: "You are here 📍", type: "Current location", status: "Live" }))
    .addTo(mapLayers.helpers);

  L.marker([nearbyState.emergency_location.lat, nearbyState.emergency_location.lng], { icon: emergencyIcon() })
    .bindPopup(createMarkerPopupContent({ name: "Emergency location 🚨", type: "Incident", status: "Active" }))
    .addTo(mapLayers.helpers);

  createRadiusCircle([nearbyState.current_location.lat, nearbyState.current_location.lng], nearbyState.radius_m, {
    color: "#2ed4ca",
    fillColor: "#2ed4ca",
    fillOpacity: 0.12,
  })
    .bindPopup(`Radius: ${metersToLabel(nearbyState.radius_m)}`)
    .addTo(mapLayers.overlays);

  nearbyState.helpers.forEach((helper) => {
    const marker = L.marker([helper.lat, helper.lng], { icon: helperIcon(helper.status) })
      .bindPopup(helperPopup(helper))
      .addTo(mapLayers.helpers);

    if (helper.status === "responding") {
      marker.bindTooltip(`ETA ${helper.eta_min} min`, { direction: "top", offset: [0, -10] });
      L.polyline(
        [
          [helper.lat, helper.lng],
          [nearbyState.emergency_location.lat, nearbyState.emergency_location.lng],
        ],
        {
          color: "#facc15",
          weight: 2,
          opacity: 0.75,
          dashArray: "8,8",
          className: "helper-route-anim",
        }
      ).addTo(mapLayers.overlays);
    }
  });

  nearbyMap.setView([nearbyState.current_location.lat, nearbyState.current_location.lng], 14, { animate: true });
}

function updateControlsFromState() {
  if (radiusRange) {
    radiusRange.value = String(nearbyState.radius_m);
  }
  if (autoAlertToggle) {
    autoAlertToggle.checked = nearbyState.auto_alert_on_sos;
  }
  if (soundAlertToggle) {
    soundAlertToggle.checked = nearbyState.sound_alert;
  }
  if (radiusLabel) {
    radiusLabel.textContent = metersToLabel(nearbyState.radius_m);
  }
  radiusPills.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.radius) === nearbyState.radius_m);
  });
}

function playSoundAlert() {
  if (!nearbyState.sound_alert) {
    return;
  }
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    const audioContext = new AudioContextCtor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.02;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audioContext.close().catch(() => {});
    }, 260);
  } catch (_) {
    // Silent fallback.
  }
}

function getDistanceMeters(a, b) {
  const radius = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const startLat = (a.lat * Math.PI) / 180;
  const endLat = (b.lat * Math.PI) / 180;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function moveRespondingHelpers() {
  nearbyState.helpers = nearbyState.helpers.map((helper) => {
    if (helper.status !== "responding") {
      return helper;
    }

    const step = 0.12;
    const nextLat = helper.lat + (nearbyState.emergency_location.lat - helper.lat) * step;
    const nextLng = helper.lng + (nearbyState.emergency_location.lng - helper.lng) * step;
    const nextDistance = getDistanceMeters({ lat: nextLat, lng: nextLng }, nearbyState.emergency_location);

    return {
      ...helper,
      lat: nextLat,
      lng: nextLng,
      distance_m: nextDistance,
    };
  });

  renderHelpersList(nearbyState.helpers);
  renderMap();
}

function syncLocationToBackend() {
  if (locationSyncTimer) {
    clearTimeout(locationSyncTimer);
  }

  locationSyncTimer = setTimeout(async () => {
    try {
      await fetch("/api/nearby-helpers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radius_m: nearbyState.radius_m,
          auto_alert_on_sos: nearbyState.auto_alert_on_sos,
          sound_alert: nearbyState.sound_alert,
          current_location: nearbyState.current_location,
          emergency_location: nearbyState.emergency_location,
        }),
      });
    } catch (_) {
      // Keep the local map responsive even if persistence fails.
    }
  }, 1200);
}

async function loadHelpers() {
  const response = await fetch("/api/nearby-helpers?emergency_type=medical");
  const data = await response.json();
  nearbyState.helpers = Array.isArray(data.helpers) ? data.helpers : [];
  nearbyState.radius_m = data.state?.radius_m || nearbyState.radius_m;
  nearbyState.auto_alert_on_sos = Boolean(data.state?.auto_alert_on_sos);
  nearbyState.sound_alert = Boolean(data.state?.sound_alert);
  nearbyState.current_location = data.state?.current_location || nearbyState.current_location;
  nearbyState.emergency_location = data.state?.emergency_location || nearbyState.emergency_location;

  updateControlsFromState();
  if (nearbySyncBadge) {
    nearbySyncBadge.textContent = "Live";
    nearbySyncBadge.className = "status-pill good";
  }

  updatePreview(data.state?.last_alert);
  renderStats(data.state?.last_alert);
  renderHelpersList(nearbyState.helpers);
  renderMap();
}

async function sendNearbyAlert() {
  if (!nearbyState.current_location) {
    return;
  }

  if (nearbySyncBadge) {
    nearbySyncBadge.textContent = "Sending...";
    nearbySyncBadge.className = "status-pill warn";
  }

  const response = await fetch("/api/nearby-helpers/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat: nearbyState.current_location.lat,
      lng: nearbyState.current_location.lng,
      emergency_type: "medical",
      radius_m: nearbyState.radius_m,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to send nearby alert");
  }

  const alertData = await response.json();
  nearbyState.alert = alertData;
  nearbyState.helpers = alertData.helpers || [];
  nearbyState.emergency_location = alertData.location || nearbyState.current_location;

  playSoundAlert();
  updatePreview(alertData);
  renderStats(alertData);
  renderHelpersList(nearbyState.helpers);
  renderMap();

  if (nearbySyncBadge) {
    nearbySyncBadge.textContent = "Alert sent";
    nearbySyncBadge.className = "status-pill good";
  }
}

function wireControls() {
  radiusRange?.addEventListener("input", () => {
    nearbyState.radius_m = Number(radiusRange.value);
    radiusLabel.textContent = metersToLabel(nearbyState.radius_m);
    radiusPills.forEach((button) => button.classList.toggle("active", Number(button.dataset.radius) === nearbyState.radius_m));
    renderMap();
    syncLocationToBackend();
  });

  radiusPills.forEach((button) => {
    button.addEventListener("click", () => {
      nearbyState.radius_m = Number(button.dataset.radius);
      radiusRange.value = String(nearbyState.radius_m);
      radiusLabel.textContent = metersToLabel(nearbyState.radius_m);
      radiusPills.forEach((item) => item.classList.toggle("active", item === button));
      renderMap();
      syncLocationToBackend();
    });
  });

  autoAlertToggle?.addEventListener("change", async () => {
    nearbyState.auto_alert_on_sos = autoAlertToggle.checked;
    syncLocationToBackend();
  });

  soundAlertToggle?.addEventListener("change", async () => {
    nearbyState.sound_alert = soundAlertToggle.checked;
    syncLocationToBackend();
  });

  sendNearbyAlertBtn?.addEventListener("click", () => {
    sendNearbyAlert().catch(() => {
      if (nearbySyncBadge) {
        nearbySyncBadge.textContent = "Failed";
        nearbySyncBadge.className = "status-pill bad";
      }
    });
  });
}

function startLocationTracking() {
  stopWatchingLocation = trackBrowserLocation({
    onUpdate: (location) => {
      nearbyState.current_location = location;
      renderMap();
      syncLocationToBackend();
    },
    onError: () => {
      // Keep the last known location if browser geolocation is denied.
    },
  });
}

function startHelperMotion() {
  if (helperMotionTimer) {
    clearInterval(helperMotionTimer);
  }

  helperMotionTimer = setInterval(() => {
    if (nearbyState.alert) {
      moveRespondingHelpers();
      return;
    }

    renderMap();
  }, 2500);
}

ensureMap();
wireControls();
startLocationTracking();
startHelperMotion();
loadHelpers().catch(() => {
  if (nearbySyncBadge) {
    nearbySyncBadge.textContent = "Offline";
    nearbySyncBadge.className = "status-pill bad";
  }
});
setInterval(() => {
  loadHelpers().catch(() => {
    if (nearbySyncBadge) {
      nearbySyncBadge.textContent = "Offline";
      nearbySyncBadge.className = "status-pill bad";
    }
  });
}, 5000);

window.addEventListener("beforeunload", () => {
  stopWatchingLocation();
  if (helperMotionTimer) {
    clearInterval(helperMotionTimer);
  }
  if (locationSyncTimer) {
    clearTimeout(locationSyncTimer);
  }
});
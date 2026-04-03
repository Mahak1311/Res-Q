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
  current_location: { lat: 12.9716, lng: 77.5946 },
  emergency_location: { lat: 12.9698, lng: 77.6061 },
  helpers: [],
  alert: null,
};

let nearbyMap;
let currentLocationMarker;
let emergencyMarker;
let radiusCircle;
let helperLayer;
let rippleLayer;

function metersToLabel(radiusM) {
  return radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM}m`;
}

function statusChip(status) {
  if (status === "responding") return '<span class="chip warn">Responding</span>';
  if (status === "ignored") return '<span class="chip bad">Ignored</span>';
  return '<span class="chip good">Available</span>';
}

function helperIcon(status = "available") {
  const tone = status === "responding" ? "responding" : status === "ignored" ? "ignored" : "available";
  return L.divIcon({
    className: "",
    html: `<div class="helper-marker ${tone}">👥</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function emergencyIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="helper-marker emergency">🚨</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function userIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="helper-marker user">📍</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function ensureMap() {
  if (!nearbyMapElement || !window.L || nearbyMap) {
    return;
  }

  nearbyMap = L.map("nearbyMap").setView([nearbyState.current_location.lat, nearbyState.current_location.lng], 14);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }).addTo(nearbyMap);

  helperLayer = L.layerGroup().addTo(nearbyMap);

  currentLocationMarker = L.marker([nearbyState.current_location.lat, nearbyState.current_location.lng], {
    icon: userIcon(),
  }).addTo(helperLayer);

  emergencyMarker = L.marker([nearbyState.emergency_location.lat, nearbyState.emergency_location.lng], {
    icon: emergencyIcon(),
  }).addTo(helperLayer);

  radiusCircle = L.circle([nearbyState.current_location.lat, nearbyState.current_location.lng], {
    radius: nearbyState.radius_m,
    color: "#2ed4ca",
    fillColor: "#2ed4ca",
    fillOpacity: 0.12,
    weight: 2,
    dashArray: "6,8",
  }).addTo(helperLayer);
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

function updateMap(alertData) {
  ensureMap();
  if (!nearbyMap || !helperLayer) {
    return;
  }

  helperLayer.clearLayers();
  currentLocationMarker = L.marker([nearbyState.current_location.lat, nearbyState.current_location.lng], {
    icon: userIcon(),
  }).addTo(helperLayer);

  emergencyMarker = L.marker([nearbyState.emergency_location.lat, nearbyState.emergency_location.lng], {
    icon: emergencyIcon(),
  }).addTo(helperLayer);

  radiusCircle = L.circle([nearbyState.current_location.lat, nearbyState.current_location.lng], {
    radius: nearbyState.radius_m,
    color: "#2ed4ca",
    fillColor: "#2ed4ca",
    fillOpacity: 0.12,
    weight: 2,
    dashArray: "6,8",
  }).addTo(helperLayer);

  nearbyState.helpers.forEach((helper) => {
    const marker = L.marker([helper.lat, helper.lng], { icon: helperIcon(helper.status) })
      .bindPopup(`<strong>${helper.name}</strong><br/>${Number(helper.distance_m).toFixed(0)} m away`)
      .addTo(helperLayer);

    if (helper.status === "responding") {
      const destination = [nearbyState.emergency_location.lat, nearbyState.emergency_location.lng];
      const path = L.polyline([[helper.lat, helper.lng], destination], {
        color: "#facc15",
        weight: 2,
        opacity: 0.75,
        dashArray: "8,8",
        className: "helper-route-anim",
      }).addTo(helperLayer);
      marker.bindTooltip(`ETA ${helper.eta_min} min`, { direction: "top", offset: [0, -10] });
    }
  });

  if (alertData) {
    const ripple = L.circle([nearbyState.emergency_location.lat, nearbyState.emergency_location.lng], {
      radius: nearbyState.radius_m * 0.8,
      color: "#ef4444",
      fillColor: "#ef4444",
      fillOpacity: 0.0,
      weight: 2,
      opacity: 0.55,
      className: "ripple-circle",
    }).addTo(helperLayer);
    rippleLayer = ripple;

    setTimeout(() => {
      if (ripple && nearbyMap.hasLayer(ripple)) {
        nearbyMap.removeLayer(ripple);
      }
    }, 1500);
  }

  nearbyMap.setView([nearbyState.current_location.lat, nearbyState.current_location.lng], 14, { animate: true });
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
  if (nearbySyncBadge) {
    nearbySyncBadge.textContent = "Live";
    nearbySyncBadge.className = "status-pill good";
  }

  updatePreview(data.state?.last_alert);
  renderStats(data.state?.last_alert);
  renderHelpersList(nearbyState.helpers);
  updateMap(data.state?.last_alert);
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

  playSoundAlert();
  updatePreview(alertData);
  renderStats(alertData);
  renderHelpersList(nearbyState.helpers);
  updateMap(alertData);

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
    if (radiusCircle) {
      radiusCircle.setRadius(nearbyState.radius_m);
    }
  });

  radiusPills.forEach((button) => {
    button.addEventListener("click", () => {
      nearbyState.radius_m = Number(button.dataset.radius);
      radiusRange.value = String(nearbyState.radius_m);
      radiusLabel.textContent = metersToLabel(nearbyState.radius_m);
      radiusPills.forEach((item) => item.classList.toggle("active", item === button));
      if (radiusCircle) {
        radiusCircle.setRadius(nearbyState.radius_m);
      }
    });
  });

  autoAlertToggle?.addEventListener("change", async () => {
    nearbyState.auto_alert_on_sos = autoAlertToggle.checked;
    await fetch("/api/nearby-helpers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radius_m: nearbyState.radius_m,
        auto_alert_on_sos: nearbyState.auto_alert_on_sos,
        sound_alert: nearbyState.sound_alert,
      }),
    });
  });

  soundAlertToggle?.addEventListener("change", async () => {
    nearbyState.sound_alert = soundAlertToggle.checked;
    await fetch("/api/nearby-helpers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        radius_m: nearbyState.radius_m,
        auto_alert_on_sos: nearbyState.auto_alert_on_sos,
        sound_alert: nearbyState.sound_alert,
      }),
    });
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

ensureMap();
wireControls();
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

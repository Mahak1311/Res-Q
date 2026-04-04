(function () {
  const state = {
    map: null,
    userMarker: null,
    centerMarkers: [],
    routeLayers: [],
    decisionToken: 0,
    lastPayload: null,
    currentOrigin: null,
    offlineMode: document.body?.dataset?.offlineMode === "true",
  };

  const shell = document.getElementById("aiShell");
  const emergencyTypeSelect = document.getElementById("aiEmergencyType");
  const recalculateBtn = document.getElementById("aiRecalculateBtn");
  const statusBadge = document.getElementById("aiStatusBadge");
  const selectedName = document.getElementById("aiSelectedName");
  const selectedScore = document.getElementById("aiSelectedScore");
  const selectedConfidence = document.getElementById("aiSelectedConfidence");
  const selectedTraffic = document.getElementById("aiSelectedTraffic");
  const selectedAvailability = document.getElementById("aiSelectedAvailability");
  const explanation = document.getElementById("aiExplanation");
  const reasonList = document.getElementById("aiReasonList");
  const confidenceChip = document.getElementById("aiConfidenceChip");
  const confidenceBar = document.getElementById("aiConfidenceBar");
  const decisionState = document.getElementById("aiDecisionState");
  const decisionCount = document.getElementById("aiDecisionCount");
  const tableBody = document.querySelector("#aiDecisionTable tbody");

  function getResQMaps() {
    return window.ResQMaps || {};
  }

  function setRefreshing(isRefreshing) {
    shell?.classList.toggle("is-refreshing", isRefreshing);
    recalculateBtn?.toggleAttribute("disabled", isRefreshing);
    if (statusBadge) {
      statusBadge.textContent = isRefreshing ? "AI is recalculating..." : "Decision ready";
      statusBadge.className = `status-pill ${isRefreshing ? "warn" : "active"}`;
    }
    if (decisionState) {
      decisionState.textContent = isRefreshing ? "AI is recalculating..." : "Ready";
      decisionState.className = `status-pill ${isRefreshing ? "warn" : "active"}`;
    }
  }

  function formatDistance(distance) {
    if (distance == null || Number.isNaN(Number(distance))) {
      return "--";
    }
    const value = Number(distance);
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)} km`;
    }
    return `${Math.round(value)} m`;
  }

  function formatScore(score) {
    if (score == null || Number.isNaN(Number(score))) {
      return "--";
    }
    return Number(score).toFixed(1);
  }

  function formatConfidence(confidence) {
    if (confidence == null || Number.isNaN(Number(confidence))) {
      return "--";
    }
    const value = Number(confidence);
    return `${Math.round(value <= 1 ? value * 100 : value)}%`;
  }

  function getConfidenceValue(center) {
    return Number(center?.ai_confidence ?? center?.confidence_score ?? 0);
  }

  function getCurrentOrigin() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ lat: 20.5937, lng: 78.9629 });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: Number(position.coords.latitude),
            lng: Number(position.coords.longitude),
          });
        },
        () => {
          resolve({ lat: 20.5937, lng: 78.9629 });
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  function confidenceClass(confidence) {
    if (confidence >= 80) {
      return "good";
    }
    if (confidence >= 60) {
      return "active";
    }
    return "warn";
  }

  function clearMapLayers() {
    for (const layer of state.routeLayers) {
      try {
        layer.remove();
      } catch (_) {
        // Ignore layer teardown issues during refresh.
      }
    }
    state.routeLayers = [];

    for (const marker of state.centerMarkers) {
      try {
        marker.remove();
      } catch (_) {
        // Ignore layer teardown issues during refresh.
      }
    }
    state.centerMarkers = [];

    if (state.userMarker) {
      try {
        state.userMarker.remove();
      } catch (_) {
        // Ignore layer teardown issues during refresh.
      }
      state.userMarker = null;
    }
  }

  function setSelectedSummary(selected) {
    if (!selected) {
      selectedName.textContent = "No center available";
      selectedScore.textContent = "Score: --";
      selectedConfidence.textContent = "Confidence: --";
      selectedTraffic.textContent = "Traffic: --";
      selectedAvailability.textContent = "Availability: --";
      explanation.textContent = "The engine could not identify an available center. Recalculate or adjust the admin simulation controls.";
      reasonList.innerHTML = "";
      confidenceChip.textContent = "Confidence --";
      confidenceChip.className = "status-pill neutral";
      confidenceBar.style.width = "0%";
      return;
    }

    selectedName.textContent = selected.name || "Selected center";
    selectedScore.textContent = `Score: ${formatScore(selected.ai_score ?? selected.score)}`;
    selectedConfidence.textContent = `Confidence: ${formatConfidence(getConfidenceValue(selected))}`;
    selectedTraffic.textContent = `Traffic: ${selected.traffic_label || selected.traffic_level || selected.traffic || "--"}`;
    selectedAvailability.textContent = `Availability: ${selected.availability || selected.availability_label || selected.status || "--"}`;
    explanation.textContent = selected.ai_explanation || selected.explanation || "This center scored highest after AI ranking.";
    confidenceChip.textContent = `Confidence ${formatConfidence(getConfidenceValue(selected))}`;
    confidenceChip.className = `status-pill ${confidenceClass(getConfidenceValue(selected))}`;
    confidenceBar.style.width = `${Math.max(0, Math.min(100, getConfidenceValue(selected)))}%`;

    const reasons = Array.isArray(selected.ai_reasons) ? selected.ai_reasons : [];
    reasonList.innerHTML = reasons
      .map((reason) => `<li>${reason}</li>`)
      .join("");
    if (!reasons.length) {
      reasonList.innerHTML = "<li>AI selected the strongest option based on the current live signals.</li>";
    }
  }

  function renderTable(rankedCenters, selectedId) {
    if (!tableBody) {
      return;
    }

    tableBody.innerHTML = rankedCenters
      .map((center, index) => {
        const isSelected = center.id === selectedId;
        return `
          <tr class="${isSelected ? "is-selected" : ""}">
            <td>
              <div class="ai-center-name">
                <strong>${center.name || `Center ${index + 1}`}</strong>
                ${isSelected ? '<span class="status-pill active">AI Selected</span>' : ""}
              </div>
            </td>
            <td>${formatDistance(center.distance_meters ?? center.distance)}</td>
            <td>${center.traffic_label || center.traffic_level || center.traffic || "--"}</td>
            <td>${center.availability || center.availability_label || center.status || "--"}</td>
            <td>${formatScore(center.ai_score ?? center.score)}</td>
            <td>${formatConfidence(getConfidenceValue(center))}</td>
          </tr>`;
      })
      .join("");
  }

  async function drawRoutes(payload) {
    const maps = getResQMaps();
    const center = payload.user_location || payload.origin || state.currentOrigin || { lat: 20.5937, lng: 78.9629 };
    const rankedCenters = Array.isArray(payload.ranked_centers) ? payload.ranked_centers : [];
    const selected = payload.selected_center || rankedCenters[0] || null;

    clearMapLayers();

    if (!state.map && typeof maps.createMap === "function") {
      state.map = maps.createMap("aiMap", {
        center: [center.lat || center.latitude || 20.5937, center.lng || center.longitude || 78.9629],
        zoom: 11,
      });
    }

    if (!state.map) {
      return;
    }

    const origin = {
      lat: Number(center.lat ?? center.latitude ?? 20.5937),
      lng: Number(center.lng ?? center.longitude ?? 78.9629),
    };

    if (typeof L !== "undefined" && typeof maps.userIcon === "function") {
      state.userMarker = L.marker([origin.lat, origin.lng], { icon: maps.userIcon() })
        .addTo(state.map)
        .bindPopup("Your current location");
    } else if (typeof L !== "undefined") {
      state.userMarker = L.marker([origin.lat, origin.lng]).addTo(state.map);
    }

    const bounds = [];
    bounds.push([origin.lat, origin.lng]);

    for (const centerItem of rankedCenters) {
      const lat = Number(centerItem.latitude ?? centerItem.lat);
      const lng = Number(centerItem.longitude ?? centerItem.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }

      bounds.push([lat, lng]);
      const markerOptions = centerItem.id === selected?.id && typeof maps.centerIcon === "function"
        ? { icon: maps.centerIcon(centerItem.type || centerItem.center_type || "hospital", centerItem.availability || centerItem.status || "available") }
        : undefined;

      const marker = markerOptions && typeof L !== "undefined"
        ? L.marker([lat, lng], markerOptions).addTo(state.map)
        : L.marker([lat, lng]).addTo(state.map);
      marker.bindPopup(`<strong>${centerItem.name || "Center"}</strong><br/>Score: ${formatScore(centerItem.ai_score ?? centerItem.score)}<br/>Confidence: ${formatConfidence(getConfidenceValue(centerItem))}`);
      state.centerMarkers.push(marker);
    }

    const routePromises = rankedCenters.map(async (centerItem, index) => {
      const lat = Number(centerItem.latitude ?? centerItem.lat);
      const lng = Number(centerItem.longitude ?? centerItem.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof maps.fetchRoute !== "function") {
        return null;
      }

      const route = await maps.fetchRoute(origin, { lat, lng });
      const coordinates = route?.coordinates || [[origin.lat, origin.lng], [lat, lng]];
      const selectedRoute = centerItem.id === selected?.id;
      const polyline = L.polyline(coordinates, {
        color: selectedRoute ? "#2ed4ca" : "#64748b",
        weight: selectedRoute ? 6 : 4,
        opacity: selectedRoute ? 0.98 : 0.42,
        dashArray: selectedRoute ? null : "8,10",
        className: selectedRoute ? "ai-selected-route" : "ai-candidate-route",
      }).addTo(state.map);
      state.routeLayers.push(polyline);

      if (index === 0 || selectedRoute) {
        polyline.bringToFront();
      }
      return polyline;
    });

    await Promise.all(routePromises);

    if (bounds.length > 1) {
      state.map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      state.map.setView([origin.lat, origin.lng], 11);
    }
  }

  function setMetaSummary(payload) {
    const rankedCenters = Array.isArray(payload.ranked_centers) ? payload.ranked_centers : [];
    const selected = payload.selected_center || rankedCenters[0] || null;
    decisionCount.textContent = `${rankedCenters.length} options`;
    if (!selected) {
      setSelectedSummary(null);
      renderTable(rankedCenters, null);
      return;
    }
    setSelectedSummary(selected);
    renderTable(rankedCenters, selected.id);
  }

  async function loadDecision() {
    const token = ++state.decisionToken;
    setRefreshing(true);
    try {
      const origin = await getCurrentOrigin();
      state.currentOrigin = origin;
      const params = new URLSearchParams({
        emergency_type: emergencyTypeSelect?.value || shell?.dataset.defaultEmergencyType || "medical",
        lat: String(origin.lat),
        lng: String(origin.lng),
      });
      const response = await fetch(`/api/ai-decision?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Decision request failed: ${response.status}`);
      }
      const payload = await response.json();
      if (token !== state.decisionToken) {
        return;
      }
      state.lastPayload = payload;
      setMetaSummary(payload);
      await drawRoutes(payload);
      setRefreshing(false);
    } catch (error) {
      if (token !== state.decisionToken) {
        return;
      }
      setRefreshing(false);
      const rankedCenters = state.lastPayload?.ranked_centers || [];
      decisionState.textContent = "Recalculation failed";
      decisionState.className = "status-pill bad";
      explanation.textContent = error?.message || "Unable to fetch AI decision data.";
      reasonList.innerHTML = "<li>Refresh the page or check the backend logs for the failure reason.</li>";
      renderTable(rankedCenters, state.lastPayload?.selected_center?.id || null);
    }
  }

  function bindEvents() {
    recalculateBtn?.addEventListener("click", () => {
      loadDecision();
    });
    emergencyTypeSelect?.addEventListener("change", () => {
      loadDecision();
    });
  }

  function init() {
    if (!shell || !tableBody) {
      return;
    }
    bindEvents();
    loadDecision();
  }

  window.addEventListener("resize", () => {
    if (state.map) {
      state.map.invalidateSize();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

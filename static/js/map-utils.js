(function () {
  const routeCache = new Map();

  const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const OSM_ATTRIBUTION = "&copy; OpenStreetMap contributors";

  function createMap(elementId, options = {}) {
    const defaultCenter = [20.5937, 78.9629];
    const defaultZoom = 5;
    const map = L.map(elementId, {
      zoomControl: true,
      preferCanvas: true,
      ...options.mapOptions,
    }).setView(options.center || defaultCenter, options.zoom || defaultZoom);

    L.tileLayer(OSM_TILE_URL, {
      maxZoom: 19,
      subdomains: "abc",
      attribution: OSM_ATTRIBUTION,
    }).addTo(map);

    return map;
  }

  function divIcon(html, className, size = [44, 44], anchor = [22, 22]) {
    return L.divIcon({
      className: "",
      html: `<div class="${className}">${html}</div>`,
      iconSize: size,
      iconAnchor: anchor,
    });
  }

  function userIcon() {
    return divIcon('<span class="map-marker-label">You are here 📍</span>', "map-marker map-marker-user", [150, 42], [75, 21]);
  }

  function emergencyIcon() {
    return divIcon('<span class="map-marker-emoji">🚨</span>', "map-marker map-marker-emergency", [48, 48], [24, 24]);
  }

  function requestIcon(status = "pending", isLatest = false) {
    const tone = status === "connected" ? "good" : status === "fallback_sent" ? "warn" : "bad";
    const emoji = isLatest ? "🚨" : "📍";
    return divIcon(`<span class="map-marker-emoji">${emoji}</span>`, `map-marker map-marker-request ${tone}`, [48, 48], [24, 24]);
  }

  function centerIcon(type = "hospital", status = "available") {
    const tone = status === "busy" ? "busy" : status === "offline" ? "offline" : "available";
    const emoji = type === "police" ? "🚓" : type === "fire" ? "🔥" : "🚑";
    return divIcon(`<span class="map-marker-emoji">${emoji}</span>`, `map-marker map-marker-center ${type} ${tone}`, [50, 50], [25, 25]);
  }

  function helperIcon(status = "available") {
    const tone = status === "responding" ? "responding" : status === "ignored" ? "ignored" : "available";
    return divIcon('<span class="map-marker-emoji">👥</span>', `map-marker map-marker-helper ${tone}`, [46, 46], [23, 23]);
  }

  function trackBrowserLocation({ onUpdate, onError, enableHighAccuracy = true, maximumAge = 4000 } = {}) {
    if (!navigator.geolocation) {
      if (typeof onError === "function") {
        onError(new Error("Geolocation unavailable"));
      }
      return () => {};
    }

    const emitPosition = (position) => {
      if (typeof onUpdate === "function") {
        onUpdate({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      }
    };

    navigator.geolocation.getCurrentPosition(
      emitPosition,
      (error) => {
        if (typeof onError === "function") {
          onError(error);
        }
      },
      {
        enableHighAccuracy,
        timeout: 8000,
        maximumAge,
      }
    );

    return () => {};
  }

  async function fetchRoute(origin, destination) {
    if (!origin || !destination) {
      return null;
    }

    const cacheKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}:${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
    if (routeCache.has(cacheKey)) {
      return routeCache.get(cacheKey);
    }

    try {
      const url = new URL(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`);
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("alternatives", "false");
      url.searchParams.set("steps", "false");

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`OSRM request failed: ${response.status}`);
      }

      const data = await response.json();
      const route = data?.routes?.[0];
      if (!route || !Array.isArray(route.geometry?.coordinates)) {
        throw new Error("No route geometry returned");
      }

      const resolved = {
        coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        distance: route.distance,
        duration: route.duration,
      };
      routeCache.set(cacheKey, resolved);
      return resolved;
    } catch (_) {
      routeCache.set(cacheKey, null);
      return null;
    }
  }

  function createRadiusCircle(latLng, radius, options = {}) {
    return L.circle(latLng, {
      radius,
      color: options.color || "#2ed4ca",
      fillColor: options.fillColor || options.color || "#2ed4ca",
      fillOpacity: options.fillOpacity ?? 0.12,
      weight: options.weight || 2,
      dashArray: options.dashArray || "6,8",
    });
  }

  function createMarkerPopupContent({ name, type, status, extraLines = [] }) {
    const rows = [
      `<strong>${name || "Location"}</strong>`,
      type ? `Type: ${type}` : null,
      status ? `Status: ${status}` : null,
      ...extraLines,
    ].filter(Boolean);
    return rows.join("<br/>");
  }

  window.ResQMaps = {
    createMap,
    emergencyIcon,
    requestIcon,
    centerIcon,
    helperIcon,
    userIcon,
    createRadiusCircle,
    createMarkerPopupContent,
    fetchRoute,
    trackBrowserLocation,
  };
})();
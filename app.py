from __future__ import annotations

import json
import math
import random
import threading
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, redirect, render_template, request, url_for

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "static" / "data"

app = Flask(__name__)

STORE_LOCK = threading.Lock()
CALL_LOGS: deque[dict[str, Any]] = deque(maxlen=2000)
LIVE_REQUESTS: deque[dict[str, Any]] = deque(maxlen=400)
UI_ACTIONS: deque[dict[str, Any]] = deque(maxlen=600)

FAILURE_ZONES = [
    {"name": "Tunnel Corridor", "lat": 12.9497, "lng": 77.6208, "weight": 0.42},
    {"name": "Industrial Pocket", "lat": 12.9369, "lng": 77.5607, "weight": 0.31},
    {"name": "Dense Urban Canyon", "lat": 12.9994, "lng": 77.6402, "weight": 0.35},
]

CELL_TOWERS = [
    {"id": "T-01", "lat": 12.9728, "lng": 77.5934, "provider": "Airtel", "base_strength": 84},
    {"id": "T-02", "lat": 12.9939, "lng": 77.5706, "provider": "Jio", "base_strength": 78},
    {"id": "T-03", "lat": 12.9375, "lng": 77.6268, "provider": "Vi", "base_strength": 72},
    {"id": "T-04", "lat": 12.9079, "lng": 77.5874, "provider": "BSNL", "base_strength": 64},
    {"id": "T-05", "lat": 12.9911, "lng": 77.6933, "provider": "Airtel", "base_strength": 69},
]


def load_json(file_name: str) -> Any:
    with open(DATA_DIR / file_name, "r", encoding="utf-8") as f:
        return json.load(f)


EMERGENCY_CENTERS = load_json("emergency_centers.json")
MOCK_CDR = load_json("mock_cdr.json")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


def nearest_cell_tower(lat: float, lng: float) -> dict[str, Any]:
    return min(CELL_TOWERS, key=lambda tower: haversine_km(lat, lng, tower["lat"], tower["lng"]))


def failure_zone_penalty(lat: float, lng: float) -> float:
    penalty = 0.0
    for zone in FAILURE_ZONES:
        distance = haversine_km(lat, lng, zone["lat"], zone["lng"])
        if distance < 1.5:
            penalty += zone["weight"] * (1.5 - distance)
    return min(1.2, penalty)


def correct_location(gps_lat: float, gps_lng: float) -> dict[str, Any]:
    tower = nearest_cell_tower(gps_lat, gps_lng)
    tower_bias_lat = random.uniform(-0.0015, 0.0015)
    tower_bias_lng = random.uniform(-0.0015, 0.0015)

    network_lat = tower["lat"] + tower_bias_lat
    network_lng = tower["lng"] + tower_bias_lng

    corrected_lat = (gps_lat * 0.68) + (network_lat * 0.32)
    corrected_lng = (gps_lng * 0.68) + (network_lng * 0.32)

    return {
        "gps": {"lat": gps_lat, "lng": gps_lng},
        "network": {"lat": network_lat, "lng": network_lng, "tower_id": tower["id"]},
        "corrected": {"lat": corrected_lat, "lng": corrected_lng},
    }


def compute_network_strength(lat: float, lng: float) -> dict[str, Any]:
    tower = nearest_cell_tower(lat, lng)
    distance = haversine_km(lat, lng, tower["lat"], tower["lng"])
    distance_penalty = min(32, distance * 9.5)
    zone_penalty = failure_zone_penalty(lat, lng) * 15
    random_jitter = random.uniform(-8, 8)

    strength = max(5, min(99, int(tower["base_strength"] - distance_penalty - zone_penalty + random_jitter)))

    probability = max(0.08, min(0.97, 0.16 + (strength / 100) * 0.78 - zone_penalty / 130))

    return {
        "tower_id": tower["id"],
        "provider": tower["provider"],
        "strength": strength,
        "call_success_probability": round(probability, 3),
    }


def sorted_centers(lat: float, lng: float) -> list[dict[str, Any]]:
    ranked = []
    for center in EMERGENCY_CENTERS:
        c = deepcopy(center)
        c["distance_km"] = round(haversine_km(lat, lng, c["lat"], c["lng"]), 2)
        ranked.append(c)
    ranked.sort(key=lambda x: x["distance_km"])
    return ranked


def pick_failure_reason(
    network_strength: int,
    center: dict[str, Any],
    attempt_index: int,
    corrected_lat: float,
    corrected_lng: float,
) -> str | None:
    zone_risk = failure_zone_penalty(corrected_lat, corrected_lng)
    load_ratio = center["load"] / max(1, center["capacity"])

    busy_threshold = min(0.8, 0.12 + load_ratio * 0.55 + attempt_index * 0.08)
    drop_threshold = min(0.65, 0.06 + max(0, (44 - network_strength) / 100) + zone_risk * 0.12)
    timeout_threshold = min(0.72, 0.12 + zone_risk * 0.25 + (0.2 if network_strength < 35 else 0))

    roll = random.random()
    if roll < busy_threshold:
        return "busy"
    if roll < busy_threshold + drop_threshold:
        return "dropped"
    if roll < busy_threshold + drop_threshold + timeout_threshold:
        return "no_response"
    return None


def simulate_routing(payload: dict[str, float]) -> dict[str, Any]:
    request_id = f"REQ-{int(datetime.now().timestamp() * 1000)}"
    call_source = (payload.get("source") or "browser").lower()

    location_data = correct_location(payload["lat"], payload["lng"])
    corrected_lat = location_data["corrected"]["lat"]
    corrected_lng = location_data["corrected"]["lng"]
    network_data = compute_network_strength(corrected_lat, corrected_lng)

    if call_source == "voip":
        network_data["call_success_probability"] = round(max(0.06, network_data["call_success_probability"] - 0.05), 3)
        decision_prefix = "VoIP channel validated."
    elif call_source == "mobile":
        network_data["call_success_probability"] = round(min(0.99, network_data["call_success_probability"] + 0.03), 3)
        decision_prefix = "Mobile network channel validated."
    else:
        decision_prefix = "Call channel validated."

    route_candidates = sorted_centers(corrected_lat, corrected_lng)
    attempts: list[dict[str, Any]] = []
    decision_messages: list[str] = [
        "Attempting to connect...",
        decision_prefix,
        "Optimizing route using corrected location...",
    ]

    final_status = "failed"
    final_center = None
    rerouted = False
    fallback = None

    for idx, center in enumerate(route_candidates[:4], start=1):
        if idx > 1:
            rerouted = True
            decision_messages.append("Selecting alternate center...")

        reason = pick_failure_reason(
            network_data["strength"], center, idx, corrected_lat, corrected_lng
        )

        attempt = {
            "attempt": idx,
            "center_id": center["id"],
            "center_name": center["name"],
            "lat": center["lat"],
            "lng": center["lng"],
            "distance_km": center["distance_km"],
            "status": "connected" if reason is None else "failed",
            "reason": reason,
            "timestamp": now_iso(),
        }

        attempts.append(attempt)

        if reason is None:
            final_status = "connected"
            final_center = center
            decision_messages.append("Connected to nearest emergency center")
            break

        if reason == "busy":
            decision_messages.append("Call failed. Rerouting...")
        elif reason == "dropped":
            decision_messages.append("Call dropped. Re-establishing channel...")
        else:
            decision_messages.append("No response timeout. Escalating route...")

    if final_status != "connected":
        fallback_channel = "sms" if random.random() > 0.5 else "internet_alert"
        fallback = {
            "channel": fallback_channel,
            "status": "sent" if random.random() < 0.94 else "failed",
            "timestamp": now_iso(),
        }
        final_status = "fallback_sent" if fallback["status"] == "sent" else "unresolved"
        decision_messages.append("Primary voice route unavailable. Triggering fallback alert...")

    event = {
        "request_id": request_id,
        "created_at": now_iso(),
        "source": call_source,
        "location": location_data,
        "network": network_data,
        "attempts": attempts,
        "rerouted": rerouted,
        "final_status": final_status,
        "final_center": final_center,
        "fallback": fallback,
        "messages": decision_messages,
    }

    return event


def log_event(entry: dict[str, Any]) -> None:
    with STORE_LOCK:
        base = {
            "timestamp": now_iso(),
            "request_id": entry["request_id"],
            "source": entry["source"],
            "final_status": entry["final_status"],
            "rerouted": entry["rerouted"],
            "network_strength": entry["network"]["strength"],
            "user_lat": round(entry["location"]["corrected"]["lat"], 6),
            "user_lng": round(entry["location"]["corrected"]["lng"], 6),
            "details": {
                "attempts": entry["attempts"],
                "fallback": entry["fallback"],
                "messages": entry["messages"],
            },
        }

        CALL_LOGS.appendleft(base)
        LIVE_REQUESTS.appendleft(entry)


def log_ui_action(action: dict[str, Any]) -> None:
    with STORE_LOCK:
        UI_ACTIONS.appendleft(
            {
                "timestamp": now_iso(),
                "action": action.get("action", "unknown"),
                "target": action.get("target", ""),
                "source": action.get("source", "dashboard"),
            }
        )


@app.route("/")
def home() -> str:
    return render_template("dashboard.html")


@app.route("/home")
def main_home() -> str:
    return redirect(url_for("dashboard"))


@app.route("/emergency")
def emergency() -> str:
    return render_template("emergency.html")


@app.route("/dashboard")
def dashboard() -> str:
    return render_template("dashboard.html")


@app.route("/logs")
def logs() -> str:
    return render_template("logs.html")


@app.route("/about")
def about() -> str:
    return render_template("about.html")


@app.route("/api/bootstrap")
def api_bootstrap():
    return jsonify(
        {
            "centers": EMERGENCY_CENTERS,
            "failure_zones": FAILURE_ZONES,
            "cdr_sample": MOCK_CDR,
        }
    )


@app.route("/api/emergency/trigger", methods=["POST"])
def trigger_emergency():
    payload = request.get_json(silent=True) or {}
    lat = payload.get("lat")
    lng = payload.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400

    event = simulate_routing({"lat": float(lat), "lng": float(lng), "source": payload.get("source", "browser")})
    log_event(event)
    return jsonify(event)


@app.route("/api/dashboard")
def api_dashboard():
    with STORE_LOCK:
        requests_snapshot = list(LIVE_REQUESTS)[:20]

    summary = {
        "total": len(requests_snapshot),
        "connected": sum(1 for item in requests_snapshot if item["final_status"] == "connected"),
        "rerouted": sum(1 for item in requests_snapshot if item["rerouted"]),
        "fallback": sum(1 for item in requests_snapshot if item["final_status"] == "fallback_sent"),
        "unresolved": sum(1 for item in requests_snapshot if item["final_status"] == "unresolved"),
    }

    heat_points = [
        [
            item["location"]["corrected"]["lat"],
            item["location"]["corrected"]["lng"],
            0.7 if item["final_status"] != "connected" else 0.25,
        ]
        for item in requests_snapshot
    ]

    return jsonify(
        {
            "centers": EMERGENCY_CENTERS,
            "requests": requests_snapshot,
            "summary": summary,
            "failure_heatmap": heat_points,
            "failure_zones": FAILURE_ZONES,
        }
    )


@app.route("/api/logs")
def api_logs():
    status_filter = (request.args.get("status") or "all").lower()

    with STORE_LOCK:
        logs_snapshot = list(CALL_LOGS)

    if status_filter != "all":
        if status_filter == "failed":
            allowed = {"fallback_sent", "unresolved"}
        elif status_filter == "rerouted":
            allowed = {"connected", "fallback_sent", "unresolved"}
            logs_snapshot = [item for item in logs_snapshot if item["rerouted"]]
            return jsonify(logs_snapshot)
        elif status_filter == "success":
            allowed = {"connected"}
        else:
            allowed = {status_filter}

        logs_snapshot = [item for item in logs_snapshot if item["final_status"] in allowed]

    return jsonify(logs_snapshot)


@app.route("/api/ui/feature-click", methods=["POST"])
def api_ui_feature_click():
    payload = request.get_json(silent=True) or {}
    log_ui_action(payload)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

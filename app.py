from __future__ import annotations

import csv
import importlib
import json
import math
import os
import re
import sqlite3
import threading
from functools import wraps
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "static" / "data"
DB_PATH = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "safetytech.db")))
DEFAULT_MAP_LAT = float(os.getenv("DEFAULT_MAP_LAT", "20.5937"))
DEFAULT_MAP_LNG = float(os.getenv("DEFAULT_MAP_LNG", "78.9629"))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-only-change-me")
AUTH_SESSION_KEY = "auth_user_id"
PHONE_PATTERN = re.compile(r"^\+?[1-9]\d{7,14}$")

EMERGENCY_TYPE_CONFIG: dict[str, dict[str, str]] = {
    "medical": {
        "center_type": "hospital",
        "title": "Medical Emergency Response",
        "icon": "🚑",
        "mode_label": "Medical Mode Active",
        "accent_class": "mode-medical",
        "description": "Hospital and ambulance routing workflow",
    },
    "police": {
        "center_type": "police",
        "title": "Police Emergency Response",
        "icon": "🚓",
        "mode_label": "Police Mode Active",
        "accent_class": "mode-police",
        "description": "Crime and security dispatch routing workflow",
    },
    "fire": {
        "center_type": "fire",
        "title": "Fire Emergency Response",
        "icon": "🔥",
        "mode_label": "Fire Mode Active",
        "accent_class": "mode-fire",
        "description": "Fire brigade and rescue dispatch workflow",
    },
}

STORE_LOCK = threading.Lock()
CALL_LOGS: deque[dict[str, Any]] = deque(maxlen=2000)
LIVE_REQUESTS: deque[dict[str, Any]] = deque(maxlen=400)
UI_ACTIONS: deque[dict[str, Any]] = deque(maxlen=600)
SIMULATION_EVENTS: deque[dict[str, Any]] = deque(maxlen=600)
CENTER_CONTROL_STATE: dict[str, dict[str, Any]] = {}
SIMULATION_STATE: dict[str, Any] = {
    "network_congestion": False,
    "auto_rerouting": True,
}
NEARBY_HELPER_STATE: dict[str, Any] = {
    "radius_m": 1000,
    "auto_alert_on_sos": True,
    "sound_alert": True,
    "current_location": {"lat": DEFAULT_MAP_LAT, "lng": DEFAULT_MAP_LNG},
    "emergency_location": {"lat": DEFAULT_MAP_LAT, "lng": DEFAULT_MAP_LNG},
    "last_alert": None,
}
ALLOWED_CENTER_STATUS = {"available", "busy", "offline"}
PUBLIC_ENDPOINTS = {
    "home",
    "main_home",
    "intro",
    "auth_page",
    "login_page",
    "api_auth_signup_email",
    "api_auth_login_email",
    "api_auth_signup_phone",
    "api_auth_login_phone",
    "api_auth_google",
    "logout",
    "center_status",
    "center_status_alias",
}

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

OSM_CENTER_CACHE: dict[str, Any] = {
    "centers": [],
    "anchor": None,
    "timestamp": None,
}


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS emergency_centers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                capacity INTEGER DEFAULT 0,
                load INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS emergency_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                source TEXT NOT NULL,
                final_status TEXT NOT NULL,
                rerouted INTEGER NOT NULL,
                network_strength INTEGER NOT NULL,
                user_lat REAL NOT NULL,
                user_lng REAL NOT NULL,
                location_json TEXT NOT NULL,
                network_json TEXT NOT NULL,
                final_center_json TEXT,
                attempts_json TEXT NOT NULL,
                fallback_json TEXT,
                messages_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS call_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL,
                attempt_number INTEGER NOT NULL,
                center_id TEXT,
                center_name TEXT,
                lat REAL,
                lng REAL,
                distance_km REAL,
                status TEXT NOT NULL,
                reason TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (request_id) REFERENCES emergency_requests(request_id)
            );

            CREATE TABLE IF NOT EXISTS fallback_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (request_id) REFERENCES emergency_requests(request_id)
            );

            CREATE TABLE IF NOT EXISTS ui_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT,
                source TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_emergency_requests_created_at ON emergency_requests(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_emergency_requests_final_status ON emergency_requests(final_status);
            CREATE INDEX IF NOT EXISTS idx_call_attempts_request_id ON call_attempts(request_id);
            CREATE INDEX IF NOT EXISTS idx_ui_actions_timestamp ON ui_actions(timestamp DESC);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT UNIQUE,
                phone TEXT UNIQUE,
                password_hash TEXT,
                google_sub TEXT UNIQUE,
                auth_provider TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
            """
        )


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_phone(value: Any) -> str:
    raw = str(value or "").strip().replace(" ", "").replace("-", "")
    if raw.startswith("00"):
        raw = f"+{raw[2:]}"
    if raw and not raw.startswith("+") and raw.isdigit():
        raw = f"+{raw}"
    return raw


def is_valid_phone(phone: str) -> bool:
    return bool(PHONE_PATTERN.match(phone))


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT id, full_name, email, phone, auth_provider, created_at, last_login_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return dict(row) if row else None


def get_user_by_phone(phone: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    return dict(row) if row else None


def get_user_by_google_sub(google_sub: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
    return dict(row) if row else None


def session_user() -> dict[str, Any] | None:
    user_id = session.get(AUTH_SESSION_KEY)
    if not user_id:
        return None
    return get_user_by_id(int(user_id))


def set_session_user(user_id: int) -> None:
    session[AUTH_SESSION_KEY] = int(user_id)


def clear_session_user() -> None:
    session.pop(AUTH_SESSION_KEY, None)


def redirect_target(default_endpoint: str = "dashboard") -> str:
    candidate = request.args.get("next") or ""
    if not candidate or not candidate.startswith("/"):
        return url_for(default_endpoint)
    if candidate.startswith("//"):
        return url_for(default_endpoint)
    return candidate


def json_redirect_target(payload: dict[str, Any], default_endpoint: str = "dashboard") -> str:
    candidate = str(payload.get("next") or "").strip()
    if not candidate or not candidate.startswith("/") or candidate.startswith("//"):
        return url_for(default_endpoint)
    return candidate


@app.context_processor
def inject_auth_context() -> dict[str, Any]:
    return {
        "auth_user": session_user(),
        "google_client_id": os.getenv("GOOGLE_CLIENT_ID", "").strip(),
    }


@app.before_request
def require_authentication():
    endpoint = request.endpoint
    if not endpoint:
        return None

    if endpoint == "static" or endpoint in PUBLIC_ENDPOINTS:
        return None

    if session_user():
        return None

    if request.path.startswith("/api/"):
        return jsonify({"error": "Authentication required"}), 401

    next_path = request.full_path if request.query_string else request.path
    return redirect(url_for("auth_page", next=next_path))


def require_json_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = session_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        return func(*args, **kwargs)

    return wrapper


def verify_google_credential(credential: str) -> dict[str, Any] | None:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id or not credential:
        return None

    try:
        google_requests = importlib.import_module("google.auth.transport.requests")
        google_id_token = importlib.import_module("google.oauth2.id_token")
    except Exception:
        return None

    try:
        token_data = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
        )
    except Exception:
        return None

    email = normalize_email(token_data.get("email"))
    if not token_data.get("sub") or not email:
        return None

    return {
        "sub": str(token_data.get("sub")),
        "email": email,
        "full_name": str(token_data.get("name") or "Google User").strip() or "Google User",
    }


def sync_emergency_centers() -> None:
    centers = configured_emergency_centers()
    if not centers:
        return

    with get_db_connection() as conn:
        now = now_iso()
        # Remove legacy static seed rows so OSM/live data drives the map.
        conn.execute("DELETE FROM emergency_centers WHERE id LIKE 'EC-%'")
        conn.executemany(
            """
            INSERT INTO emergency_centers (id, name, type, lat, lng, capacity, load, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                type=excluded.type,
                lat=excluded.lat,
                lng=excluded.lng,
                capacity=excluded.capacity,
                load=excluded.load,
                updated_at=excluded.updated_at
            """,
            [
                (
                    center["id"],
                    center.get("name", "Unknown Center"),
                    center.get("type", "emergency"),
                    center["lat"],
                    center["lng"],
                    center.get("capacity", 0),
                    center.get("load", 0),
                    now,
                )
                for center in centers
            ],
        )


def write_event_to_db(entry: dict[str, Any]) -> None:
    fallback_json = json.dumps(entry["fallback"]) if entry.get("fallback") else None
    final_center_json = json.dumps(entry["final_center"]) if entry.get("final_center") else None

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO emergency_requests (
                request_id,
                created_at,
                source,
                final_status,
                rerouted,
                network_strength,
                user_lat,
                user_lng,
                location_json,
                network_json,
                final_center_json,
                attempts_json,
                fallback_json,
                messages_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry["request_id"],
                entry["created_at"],
                entry["source"],
                entry["final_status"],
                1 if entry["rerouted"] else 0,
                int(entry["network"]["strength"]),
                float(entry["location"]["corrected"]["lat"]),
                float(entry["location"]["corrected"]["lng"]),
                json.dumps(entry["location"]),
                json.dumps(entry["network"]),
                final_center_json,
                json.dumps(entry["attempts"]),
                fallback_json,
                json.dumps(entry["messages"]),
            ),
        )

        conn.execute("DELETE FROM call_attempts WHERE request_id = ?", (entry["request_id"],))
        conn.executemany(
            """
            INSERT INTO call_attempts (
                request_id,
                attempt_number,
                center_id,
                center_name,
                lat,
                lng,
                distance_km,
                status,
                reason,
                timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    entry["request_id"],
                    attempt["attempt"],
                    attempt.get("center_id"),
                    attempt.get("center_name"),
                    attempt.get("lat"),
                    attempt.get("lng"),
                    attempt.get("distance_km"),
                    attempt["status"],
                    attempt.get("reason"),
                    attempt["timestamp"],
                )
                for attempt in entry["attempts"]
            ],
        )

        conn.execute("DELETE FROM fallback_events WHERE request_id = ?", (entry["request_id"],))
        if entry.get("fallback"):
            conn.execute(
                """
                INSERT INTO fallback_events (request_id, channel, status, timestamp)
                VALUES (?, ?, ?, ?)
                """,
                (
                    entry["request_id"],
                    entry["fallback"]["channel"],
                    entry["fallback"]["status"],
                    entry["fallback"]["timestamp"],
                ),
            )


def fetch_recent_requests(limit: int = 20) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT request_id, created_at, source, final_status, rerouted, location_json,
                   network_json, attempts_json, final_center_json, fallback_json, messages_json
            FROM emergency_requests
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    requests: list[dict[str, Any]] = []
    for row in rows:
        requests.append(
            {
                "request_id": row["request_id"],
                "created_at": row["created_at"],
                "source": row["source"],
                "location": json.loads(row["location_json"]),
                "network": json.loads(row["network_json"]),
                "attempts": json.loads(row["attempts_json"]),
                "rerouted": bool(row["rerouted"]),
                "final_status": row["final_status"],
                "final_center": json.loads(row["final_center_json"]) if row["final_center_json"] else None,
                "fallback": json.loads(row["fallback_json"]) if row["fallback_json"] else None,
                "messages": json.loads(row["messages_json"]),
            }
        )
    return requests


def fetch_logs_from_db(status_filter: str = "all") -> list[dict[str, Any]]:
    query = """
        SELECT request_id, created_at, source, final_status, rerouted, network_strength,
               user_lat, user_lng, attempts_json, fallback_json, messages_json
        FROM emergency_requests
    """
    params: list[Any] = []

    if status_filter != "all":
        if status_filter == "failed":
            query += " WHERE final_status IN (?, ?)"
            params.extend(["fallback_sent", "unresolved"])
        elif status_filter == "success":
            query += " WHERE final_status = ?"
            params.append("connected")
        elif status_filter == "rerouted":
            query += " WHERE rerouted = 1"
        else:
            query += " WHERE final_status = ?"
            params.append(status_filter)

    query += " ORDER BY created_at DESC LIMIT 200"

    with get_db_connection() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        {
            "timestamp": row["created_at"],
            "request_id": row["request_id"],
            "source": row["source"],
            "final_status": row["final_status"],
            "rerouted": bool(row["rerouted"]),
            "network_strength": row["network_strength"],
            "user_lat": row["user_lat"],
            "user_lng": row["user_lng"],
            "details": {
                "attempts": json.loads(row["attempts_json"]),
                "fallback": json.loads(row["fallback_json"]) if row["fallback_json"] else None,
                "messages": json.loads(row["messages_json"]),
            },
        }
        for row in rows
    ]


def parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return default


def normalize_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"connected", "success", "ok"}:
        return "connected"
    if normalized in {"fallback_sent", "fallback", "fallback-ok"}:
        return "fallback_sent"
    if normalized in {"unresolved", "failed", "error"}:
        return "unresolved"
    return "unresolved"


def build_event_from_cdr_row(row: dict[str, str], row_number: int) -> dict[str, Any]:
    request_id = (row.get("request_id") or row.get("event_id") or f"CDR-{int(datetime.now().timestamp() * 1000)}-{row_number}").strip()
    created_at = (row.get("created_at") or row.get("timestamp") or now_iso()).strip()
    source = (row.get("source") or "mobile").strip().lower()
    final_status = normalize_status(row.get("final_status"))

    lat = float(row.get("lat") or row.get("latitude") or 0.0)
    lng = float(row.get("lng") or row.get("longitude") or 0.0)
    network_strength = int(float(row.get("network_strength") or row.get("signal_strength") or 55))
    network_strength = max(1, min(99, network_strength))

    tower_id = (row.get("tower_id") or "unknown").strip()
    provider = (row.get("provider") or "unknown").strip()
    rerouted = parse_bool(row.get("rerouted"), default=final_status != "connected")

    attempts_json = row.get("attempts_json")
    fallback_json = row.get("fallback_json")
    messages_json = row.get("messages_json")
    failure_reason = (row.get("failure_reason") or "cdr_import_failure").strip()

    if attempts_json:
        attempts = json.loads(attempts_json)
    else:
        attempts = [
            {
                "attempt": 1,
                "center_id": row.get("center_id") or "cdr-center",
                "center_name": row.get("center_name") or "Imported Center",
                "lat": None,
                "lng": None,
                "distance_km": None,
                "status": "connected" if final_status == "connected" else "failed",
                "reason": None if final_status == "connected" else failure_reason,
                "timestamp": created_at,
            }
        ]

    if fallback_json:
        fallback = json.loads(fallback_json)
    elif final_status == "fallback_sent":
        fallback = {
            "channel": row.get("fallback_channel") or "sms",
            "status": row.get("fallback_status") or "sent",
            "timestamp": created_at,
        }
    else:
        fallback = None

    if messages_json:
        messages = json.loads(messages_json)
    else:
        if final_status == "connected":
            messages = ["Imported CDR: call connected"]
        elif final_status == "fallback_sent":
            messages = ["Imported CDR: primary route failed", "Imported CDR: fallback alert sent"]
        else:
            messages = ["Imported CDR: unresolved failure"]

    return {
        "request_id": request_id,
        "created_at": created_at,
        "source": source,
        "location": {
            "gps": {"lat": lat, "lng": lng},
            "network": {"lat": lat, "lng": lng, "tower_id": tower_id},
            "corrected": {"lat": lat, "lng": lng},
        },
        "network": {
            "tower_id": tower_id,
            "provider": provider,
            "strength": network_strength,
            "call_success_probability": round(network_strength / 100, 2),
        },
        "attempts": attempts,
        "rerouted": rerouted,
        "final_status": final_status,
        "final_center": None,
        "fallback": fallback,
        "messages": messages,
    }


def import_cdr_rows(rows: list[dict[str, str]]) -> dict[str, Any]:
    imported = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for row_number, row in enumerate(rows, start=2):
        try:
            event = build_event_from_cdr_row(row, row_number)
            if event["location"]["corrected"]["lat"] == 0.0 and event["location"]["corrected"]["lng"] == 0.0:
                raise ValueError("lat/lng is missing or invalid")
            log_event(event)
            imported += 1
        except Exception as exc:
            failed += 1
            if len(errors) < 25:
                errors.append({"row": row_number, "error": str(exc)})

    return {"imported": imported, "failed": failed, "errors": errors}


def load_json(file_name: str) -> Any:
    with open(DATA_DIR / file_name, "r", encoding="utf-8") as f:
        return json.load(f)


def _cache_is_fresh(max_age_seconds: int = 300) -> bool:
    timestamp = OSM_CENTER_CACHE.get("timestamp")
    if not timestamp:
        return False
    age_seconds = (datetime.now(timezone.utc) - timestamp).total_seconds()
    return age_seconds <= max_age_seconds


def _cache_anchor_is_close(lat: float, lng: float, max_distance_km: float = 2.0) -> bool:
    anchor = OSM_CENTER_CACHE.get("anchor")
    if not anchor:
        return False
    return haversine_km(float(anchor["lat"]), float(anchor["lng"]), lat, lng) <= max_distance_km


def fetch_live_osm_centers(lat: float, lng: float, radius_m: int = 10000) -> list[dict[str, Any]]:
    if _cache_is_fresh() and _cache_anchor_is_close(lat, lng):
        cached = OSM_CENTER_CACHE.get("centers") or []
        return deepcopy(cached)

    overpass_query = f"""
        [out:json][timeout:12];
        (
          node["amenity"="hospital"](around:{radius_m},{lat},{lng});
          way["amenity"="hospital"](around:{radius_m},{lat},{lng});
          node["amenity"="police"](around:{radius_m},{lat},{lng});
          way["amenity"="police"](around:{radius_m},{lat},{lng});
          node["amenity"="fire_station"](around:{radius_m},{lat},{lng});
          way["amenity"="fire_station"](around:{radius_m},{lat},{lng});
        );
        out center;
    """.strip()

    payload = url_parse.urlencode({"data": overpass_query}).encode("utf-8")
    req = url_request.Request("https://overpass-api.de/api/interpreter", data=payload, method="POST")

    try:
        with url_request.urlopen(req, timeout=14) as response:
            raw = response.read().decode("utf-8")
        parsed = json.loads(raw)
    except Exception:
        return deepcopy(OSM_CENTER_CACHE.get("centers") or [])

    type_map = {
        "hospital": "hospital",
        "police": "police",
        "fire_station": "fire",
    }
    capacity_defaults = {
        "hospital": 30,
        "police": 20,
        "fire": 14,
    }

    centers: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for element in parsed.get("elements", []):
        tags = element.get("tags") or {}
        amenity = str(tags.get("amenity") or "").strip().lower()
        mapped_type = type_map.get(amenity)
        if not mapped_type:
            continue

        element_lat = element.get("lat")
        element_lng = element.get("lon")
        if element_lat is None or element_lng is None:
            center = element.get("center") or {}
            element_lat = center.get("lat")
            element_lng = center.get("lon")
        if element_lat is None or element_lng is None:
            continue

        center_id = f"OSM-{mapped_type}-{element.get('id')}"
        if center_id in seen_ids:
            continue
        seen_ids.add(center_id)

        default_name = f"{mapped_type.title()} Center {element.get('id')}"
        centers.append(
            {
                "id": center_id,
                "name": str(tags.get("name") or default_name),
                "type": mapped_type,
                "lat": float(element_lat),
                "lng": float(element_lng),
                "capacity": capacity_defaults[mapped_type],
                "load": 0,
            }
        )

    OSM_CENTER_CACHE.update(
        {
            "centers": centers,
            "anchor": {"lat": lat, "lng": lng},
            "timestamp": datetime.now(timezone.utc),
        }
    )

    return deepcopy(centers)


def configured_emergency_centers() -> list[dict[str, Any]]:
    state = get_nearby_helper_state()
    origin = state.get("current_location") or {"lat": DEFAULT_MAP_LAT, "lng": DEFAULT_MAP_LNG}
    lat = float(origin.get("lat", DEFAULT_MAP_LAT))
    lng = float(origin.get("lng", DEFAULT_MAP_LNG))
    centers = fetch_live_osm_centers(lat, lng)
    return centers


def configured_nearby_helpers() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT request_id, source, user_lat, user_lng, created_at
            FROM emergency_requests
            ORDER BY created_at DESC
            LIMIT 60
            """
        ).fetchall()

    helpers: list[dict[str, Any]] = []
    seen_coordinates: set[tuple[float, float]] = set()
    for index, row in enumerate(rows, start=1):
        lat = float(row["user_lat"])
        lng = float(row["user_lng"])
        coordinate_key = (round(lat, 4), round(lng, 4))
        if coordinate_key in seen_coordinates:
            continue
        seen_coordinates.add(coordinate_key)

        request_id = str(row["request_id"])
        helpers.append(
            {
                "id": f"USR-{request_id[-6:]}-{index}",
                "name": f"Nearby User {request_id[-4:]}",
                "lat": lat,
                "lng": lng,
                "role": str(row["source"] or "community"),
            }
        )

    return helpers


def nearby_helper_center(lat: float, lng: float) -> dict[str, Any]:
    return {
        "lat": lat,
        "lng": lng,
    }


def nearby_helper_distance_m(helper: dict[str, Any], location: dict[str, float]) -> float:
    return haversine_km(location["lat"], location["lng"], float(helper["lat"]), float(helper["lng"])) * 1000


def build_nearby_helper_snapshot(
    helper: dict[str, Any],
    location: dict[str, float],
    emergency_type: str,
    radius_m: int,
    status_override: str | None = None,
) -> dict[str, Any]:
    distance_m = nearby_helper_distance_m(helper, location)
    if status_override:
        status = status_override
    elif distance_m <= radius_m:
        status = "available"
    else:
        status = "ignored"

    if status == "responding":
        eta = max(1, round(distance_m / 420))
    elif status == "available":
        eta = max(1, round(distance_m / 600))
    else:
        eta = None

    return {
        "id": helper["id"],
        "name": helper.get("name") or helper["id"],
        "lat": float(helper["lat"]),
        "lng": float(helper["lng"]),
        "distance_m": round(distance_m, 1),
        "status": status,
        "eta_min": eta,
        "label": helper.get("role") or emergency_type,
        "emergency_type": emergency_type,
    }


def get_nearby_helper_state() -> dict[str, Any]:
    with STORE_LOCK:
        return deepcopy(NEARBY_HELPER_STATE)


def set_nearby_helper_state(payload: dict[str, Any]) -> dict[str, Any]:
    radius_m = int(payload.get("radius_m") or NEARBY_HELPER_STATE["radius_m"])
    radius_m = max(250, min(5000, radius_m))

    current_location = payload.get("current_location")
    emergency_location = payload.get("emergency_location")

    next_state = {
        "radius_m": radius_m,
        "auto_alert_on_sos": parse_bool(payload.get("auto_alert_on_sos"), NEARBY_HELPER_STATE["auto_alert_on_sos"]),
        "sound_alert": parse_bool(payload.get("sound_alert"), NEARBY_HELPER_STATE["sound_alert"]),
    }

    if isinstance(current_location, dict) and "lat" in current_location and "lng" in current_location:
        next_state["current_location"] = {
            "lat": float(current_location["lat"]),
            "lng": float(current_location["lng"]),
        }

    if isinstance(emergency_location, dict) and "lat" in emergency_location and "lng" in emergency_location:
        next_state["emergency_location"] = {
            "lat": float(emergency_location["lat"]),
            "lng": float(emergency_location["lng"]),
        }

    with STORE_LOCK:
        NEARBY_HELPER_STATE.update(next_state)
        return deepcopy(NEARBY_HELPER_STATE)


def log_nearby_helper_event(kind: str, summary: str, target: str = "global", source: str = "nearby-helpers") -> dict[str, Any]:
    event = {
        "timestamp": now_iso(),
        "kind": kind,
        "summary": summary,
        "target": target,
        "source": source,
    }
    with STORE_LOCK:
        SIMULATION_EVENTS.appendleft(event)
    log_ui_action({"action": f"nearby:{kind}", "target": target, "source": source})
    return event


def simulate_nearby_helper_alert(
    location: dict[str, float],
    emergency_type: str,
    radius_m: int,
    source: str = "manual",
) -> dict[str, Any]:
    helpers = configured_nearby_helpers()
    helper_snapshots = [
        build_nearby_helper_snapshot(helper, location, emergency_type, radius_m)
        for helper in helpers
    ]
    helper_snapshots.sort(key=lambda item: item["distance_m"])

    within_radius = [item for item in helper_snapshots if item["distance_m"] <= radius_m]
    response_target_count = max(1, min(4, round(len(within_radius) * 0.4))) if within_radius else 0

    for index, helper in enumerate(helper_snapshots):
        if helper["distance_m"] > radius_m:
            helper["status"] = "ignored"
            helper["eta_min"] = None
            continue
        if index < response_target_count:
            helper["status"] = "responding"
            helper["eta_min"] = max(1, round(helper["distance_m"] / 320))
        elif index < response_target_count + 2:
            helper["status"] = "available"
            helper["eta_min"] = max(1, round(helper["distance_m"] / 600))
        else:
            helper["status"] = "ignored"
            helper["eta_min"] = None

    notified = len(within_radius)
    responding = sum(1 for helper in helper_snapshots if helper["status"] == "responding")
    ignored = sum(1 for helper in helper_snapshots if helper["status"] == "ignored")

    summary = f"Nearby alert sent to {notified} helpers; {responding} responding."
    response = {
        "ok": True,
        "alert_id": f"NB-{int(datetime.now().timestamp() * 1000)}",
        "timestamp": now_iso(),
        "source": source,
        "emergency_type": emergency_type,
        "radius_m": radius_m,
        "location": location,
        "message": "🚨 Emergency nearby — help needed!",
        "preview": {
            "headline": "🚨 Emergency nearby — help needed!",
            "details": f"{emergency_type.title()} emergency at {location['lat']:.5f}, {location['lng']:.5f}",
            "radius_label": f"{radius_m}m radius",
        },
        "helpers": helper_snapshots,
        "stats": {
            "notified": notified,
            "responding": responding,
            "ignored": ignored,
        },
        "animation": {
            "ripple_radius_m": radius_m,
            "responding_ids": [helper["id"] for helper in helper_snapshots if helper["status"] == "responding"],
        },
    }

    with STORE_LOCK:
        NEARBY_HELPER_STATE.update(
            {
                "radius_m": radius_m,
                "current_location": dict(location),
                "emergency_location": dict(location),
                "last_alert": response,
            }
        )

    log_nearby_helper_event("nearby-alert", summary, target="global", source=source)
    for helper in helper_snapshots:
        if helper["status"] == "responding":
            log_nearby_helper_event(
                "helper-response",
                f"{helper['name']} is responding in {helper['eta_min']} min.",
                target=helper["id"],
                source=source,
            )

    return response


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


def compute_network_strength(lat: float, lng: float, congestion: bool = False) -> dict[str, Any]:
    tower = nearest_cell_tower(lat, lng)
    distance = haversine_km(lat, lng, tower["lat"], tower["lng"])
    distance_penalty = min(40, distance * 10)
    congestion_penalty = 18 if congestion else 0
    strength = max(5, min(99, int(tower["base_strength"] - distance_penalty - congestion_penalty)))
    probability = round(max(0.05, min(0.99, strength / 100)), 3)

    return {
        "tower_id": tower["id"],
        "provider": tower["provider"],
        "strength": strength,
        "call_success_probability": round(probability, 3),
    }


def normalize_emergency_type(value: Any) -> str:
    emergency_type = str(value or "medical").strip().lower()
    return emergency_type if emergency_type in EMERGENCY_TYPE_CONFIG else "medical"


def sorted_centers(lat: float, lng: float, emergency_type: str = "medical") -> list[dict[str, Any]]:
    ranked = []
    expected_center_type = EMERGENCY_TYPE_CONFIG[normalize_emergency_type(emergency_type)]["center_type"]
    for center in load_emergency_centers():
        if str(center.get("type") or "").strip().lower() != expected_center_type:
            continue
        c = deepcopy(center)
        c["distance_km"] = round(haversine_km(lat, lng, c["lat"], c["lng"]), 2)
        runtime = evaluate_center_runtime(c)
        c.update(runtime)
        c["load_level"] = load_level_for_center(c, runtime)
        c["priority_score"] = routing_priority_for_center(c, runtime)
        ranked.append(c)
    ranked.sort(key=lambda x: (x["priority_score"], x["distance_km"]))
    return ranked


def load_level_for_center(center: dict[str, Any], runtime: dict[str, Any] | None = None) -> str:
    active_runtime = runtime or evaluate_center_runtime(center)
    effective_load = int(active_runtime.get("effective_load") or center.get("load") or 0)
    capacity = max(1, int(center.get("capacity") or 0))
    ratio = effective_load / capacity

    if active_runtime.get("status") == "offline" or active_runtime.get("force_failure"):
        return "high"
    if ratio < 0.45:
        return "low"
    if ratio < 0.8:
        return "medium"
    return "high"


def routing_priority_for_center(center: dict[str, Any], runtime: dict[str, Any] | None = None) -> float:
    active_runtime = runtime or evaluate_center_runtime(center)
    priority = float(active_runtime.get("effective_load", 0))
    if active_runtime.get("status") == "busy" or active_runtime.get("overload"):
        priority += 15.0
    if not active_runtime.get("available", True):
        priority += 100.0
    if SIMULATION_STATE.get("network_congestion"):
        priority += 3.0
    return priority


def resolve_center_type(center_id: str, raw_type: Any) -> str:
    normalized = str(raw_type or "").strip().lower()
    if normalized in {"hospital", "police", "fire"}:
        return normalized

    return "hospital"


def load_emergency_centers() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, type, lat, lng, capacity, load
            FROM emergency_centers
            ORDER BY id
            """
        ).fetchall()

    if rows:
        centers_from_db = [
            {
                "id": row["id"],
                "name": row["name"],
                "type": resolve_center_type(row["id"], row["type"]),
                "lat": float(row["lat"]),
                "lng": float(row["lng"]),
                "capacity": int(row["capacity"] or 0),
                "load": int(row["load"] or 0),
            }
            for row in rows
        ]

        centers_from_db.sort(key=lambda center: center["id"])
        return centers_from_db

    live_centers = configured_emergency_centers()
    if live_centers:
        return [
            {
                "id": center["id"],
                "name": center.get("name", "Unknown Center"),
                "type": resolve_center_type(center["id"], center.get("type")),
                "lat": float(center["lat"]),
                "lng": float(center["lng"]),
                "capacity": int(center.get("capacity") or 0),
                "load": int(center.get("load") or 0),
            }
            for center in live_centers
        ]

    return []


def normalize_center_status_id(center_id: str) -> int | str:
    value = str(center_id).strip()
    if value.isdigit():
        return int(value)

    match = re.search(r"(\d+)$", value)
    if not match:
        return value

    numeric = int(match.group(1))
    # Convert EC-101 -> 1, EC-102 -> 2 ... for the local status endpoint mapping.
    if numeric >= 101:
        return numeric - 100
    return numeric


def get_center_control(center_id: str) -> dict[str, Any]:
    with STORE_LOCK:
        existing = CENTER_CONTROL_STATE.get(center_id)
    if existing:
        return {
            "status": existing.get("status", "available"),
            "overload": bool(existing.get("overload", False)),
            "force_failure": bool(existing.get("force_failure", False)),
        }
    return {"status": "available", "overload": False, "force_failure": False}


def get_simulation_state() -> dict[str, Any]:
    with STORE_LOCK:
        return deepcopy(SIMULATION_STATE)


def update_simulation_state(payload: dict[str, Any]) -> dict[str, Any]:
    next_state = {
        "network_congestion": parse_bool(payload.get("network_congestion"), SIMULATION_STATE["network_congestion"]),
        "auto_rerouting": parse_bool(payload.get("auto_rerouting"), SIMULATION_STATE["auto_rerouting"]),
    }

    with STORE_LOCK:
        SIMULATION_STATE.update(next_state)
        return deepcopy(SIMULATION_STATE)


def append_simulation_event(kind: str, summary: str, target: str = "", source: str = "admin") -> dict[str, Any]:
    event = {
        "timestamp": now_iso(),
        "kind": kind,
        "summary": summary,
        "target": target,
        "source": source,
    }
    with STORE_LOCK:
        SIMULATION_EVENTS.appendleft(event)
    log_ui_action({"action": f"simulation:{kind}", "target": target, "source": source})
    return event


def evaluate_center_runtime(center: dict[str, Any]) -> dict[str, Any]:
    control = get_center_control(center["id"])

    capacity = int(center.get("capacity") or 0)
    base_load = int(center.get("load") or 0)
    effective_load = base_load + (1 if control["overload"] else 0)

    availability = True
    if control["force_failure"]:
        availability = False
    elif control["status"] == "offline":
        availability = False
    elif capacity <= 0:
        availability = False

    runtime_status = control["status"]
    if control["force_failure"]:
        runtime_status = "offline"
    elif control["status"] == "available" and control["overload"]:
        runtime_status = "busy"
    elif control["status"] == "available" and not availability:
        runtime_status = "busy" if not control["force_failure"] else "offline"

    return {
        "status": runtime_status,
        "available": availability,
        "overload": control["overload"],
        "force_failure": control["force_failure"],
        "effective_load": effective_load,
        "load_level": load_level_for_center(center, {**control, "status": runtime_status, "available": availability, "effective_load": effective_load}),
        "priority_score": routing_priority_for_center(center, {**control, "status": runtime_status, "available": availability, "effective_load": effective_load}),
    }


def load_emergency_centers_with_runtime() -> list[dict[str, Any]]:
    centers = []
    for center in load_emergency_centers():
        runtime = evaluate_center_runtime(center)
        enriched = deepcopy(center)
        enriched.update(
            {
                "runtime_status": runtime["status"],
                "available": runtime["available"],
                "overload": runtime["overload"],
                "force_failure": runtime["force_failure"],
                "effective_load": runtime["effective_load"],
                "load_level": runtime["load_level"],
                "priority_score": runtime["priority_score"],
            }
        )
        centers.append(enriched)
    return centers


def build_center_status_endpoint(base_url: str, status_id: int | str) -> str:
    if "{center_id}" in base_url:
        return base_url.format(center_id=url_parse.quote(str(status_id)))
    return f"{base_url.rstrip('/')}/{url_parse.quote(str(status_id))}"


def check_center_availability(center_id: str, center: dict[str, Any] | None = None) -> bool:
    resolved_center = center or next((item for item in load_emergency_centers() if item["id"] == center_id), None)
    if not resolved_center:
        return False

    runtime = evaluate_center_runtime(resolved_center)
    if runtime["force_failure"] or runtime["status"] == "offline":
        return False

    status_api_url = os.getenv("CENTER_STATUS_API_URL", "http://127.0.0.1:5000/center-status/{center_id}").strip()
    if status_api_url:
        try:
            status_id = normalize_center_status_id(center_id)
            endpoint = build_center_status_endpoint(status_api_url, status_id)
            with url_request.urlopen(endpoint, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, dict) and "available" in payload:
                return bool(payload["available"])
        except (url_error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            pass

    return runtime["available"]


def send_alert_sms(location: dict[str, float], center: dict[str, Any] | None) -> dict[str, Any]:
    sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    sender = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    recipient = os.getenv("TWILIO_TO_NUMBER", "").strip()

    center_label = center["name"] if center else "No center available"
    message_body = (
        f"Res Q alert: routing failed for location "
        f"({location['lat']:.6f}, {location['lng']:.6f}). {center_label}."
    )

    if sid and token and sender and recipient:
        try:
            twilio_rest = __import__("twilio.rest", fromlist=["Client"])
            client = twilio_rest.Client(sid, token)
            api_response = client.messages.create(body=message_body, from_=sender, to=recipient)
            return {
                "channel": "sms",
                "status": "sent",
                "timestamp": now_iso(),
                "provider": "twilio",
                "message_sid": api_response.sid,
            }
        except Exception as exc:  # pragma: no cover - integration path
            return {
                "channel": "sms",
                "status": "failed",
                "timestamp": now_iso(),
                "provider": "twilio",
                "error": str(exc),
            }

    print(f"[ALERT_SMS_FALLBACK] {message_body}")
    return {
        "channel": "sms",
        "status": "logged",
        "timestamp": now_iso(),
        "provider": "console",
    }


def route_emergency_call(payload: dict[str, Any]) -> dict[str, Any]:
    lat = float(payload["lat"])
    lng = float(payload["lng"])
    user_id = str(payload.get("user_id") or "anonymous")
    source = str(payload.get("source") or "browser").lower()
    emergency_type = normalize_emergency_type(payload.get("emergency_type"))
    request_time = str(payload.get("timestamp") or now_iso())
    request_id = str(payload.get("request_id") or f"REQ-{int(datetime.now().timestamp() * 1000)}")
    simulation_state = get_simulation_state()

    centers = sorted_centers(lat, lng, emergency_type=emergency_type)
    network_data = compute_network_strength(lat, lng, congestion=bool(simulation_state.get("network_congestion")))

    attempts: list[dict[str, Any]] = []
    selected_center: dict[str, Any] | None = None

    for attempt_index, center in enumerate(centers, start=1):
        available = check_center_availability(center["id"], center)
        attempt_status = "connected" if available else "failed"

        if simulation_state.get("network_congestion") and attempt_index == 1 and network_data["strength"] < 45:
            available = False
            attempt_status = "failed"

        attempts.append(
            {
                "attempt": attempt_index,
                "center_id": center["id"],
                "center_name": center["name"],
                "lat": center["lat"],
                "lng": center["lng"],
                "distance_km": center["distance_km"],
                "status": attempt_status,
                "reason": None if available else "center_unavailable",
                "timestamp": now_iso(),
            }
        )

        if available:
            selected_center = center
            break

        if not simulation_state.get("auto_rerouting", True):
            break

    rerouted = selected_center is not None and len(attempts) > 1
    if selected_center and rerouted:
        status = "rerouted"
        final_status = "connected"
        message = "Connected after rerouting to nearest available center"
    elif selected_center:
        status = "connected"
        final_status = "connected"
        message = "Connected to nearest available center"
    else:
        status = "failed"
        final_status = "unresolved"
        message = "No available emergency center found"

    fallback = None
    if status == "failed":
        fallback = send_alert_sms({"lat": lat, "lng": lng}, selected_center)

    location_data = {
        "gps": {"lat": lat, "lng": lng},
        "network": {
            "lat": lat,
            "lng": lng,
            "tower_id": network_data["tower_id"],
        },
        "corrected": {"lat": lat, "lng": lng},
    }

    route_data = {
        "from": {"lat": lat, "lng": lng},
        "to": {"lat": selected_center["lat"], "lng": selected_center["lng"]} if selected_center else None,
        "polyline": [[lat, lng], [selected_center["lat"], selected_center["lng"]]] if selected_center else [],
    }

    payload_network_strength = payload.get("network_strength")
    if payload_network_strength is None:
        effective_strength = network_data["strength"]
    else:
        effective_strength = int(float(payload_network_strength))

    response = {
        "request_id": request_id,
        "created_at": request_time,
        "source": source,
        "user_id": user_id,
        "emergency_type": emergency_type,
        "location": location_data,
        "network": {
            "tower_id": network_data["tower_id"],
            "provider": network_data["provider"],
            "strength": effective_strength,
            "call_success_probability": network_data["call_success_probability"],
            "info": payload.get("network") or {},
        },
        "user_location": {"lat": lat, "lng": lng},
        "assigned_center": selected_center,
        "selected_center": selected_center,
        "status": status,
        "reroute_attempts": attempts,
        "message": message,
        "route": route_data,
        "attempts": attempts,
        "rerouted": rerouted,
        "final_status": final_status,
        "final_center": selected_center,
        "fallback": fallback,
        "messages": [message],
        "simulation_state": simulation_state,
    }

    return response


def log_event(entry: dict[str, Any]) -> None:
    write_event_to_db(entry)

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
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO ui_actions (timestamp, action, target, source)
            VALUES (?, ?, ?, ?)
            """,
            (
                now_iso(),
                action.get("action", "unknown"),
                action.get("target", ""),
                action.get("source", "dashboard"),
            ),
        )

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
    return render_template("intro.html")


@app.route("/auth")
def auth_page() -> Any:
    if session_user():
        return redirect(redirect_target())
    return render_template("auth.html", next=redirect_target())


@app.route("/login")
def login_page() -> Any:
    return redirect(url_for("auth_page", next=request.args.get("next") or ""))


@app.route("/logout", methods=["GET", "POST"])
def logout() -> Any:
    clear_session_user()
    return redirect(url_for("auth_page"))


@app.route("/home")
def main_home() -> str:
    return redirect(url_for("dashboard"))


@app.route("/intro")
def intro() -> str:
    return render_template("intro.html")


@app.route("/emergency")
def emergency() -> str:
    return render_template("emergency.html")


@app.route("/emergency/<emergency_type>")
def emergency_type_page(emergency_type: str) -> str:
    normalized = normalize_emergency_type(emergency_type)
    config = EMERGENCY_TYPE_CONFIG[normalized]
    return render_template(
        "emergency_mode.html",
        emergency_type=normalized,
        emergency_title=config["title"],
        mode_icon=config["icon"],
        mode_label=config["mode_label"],
        accent_class=config["accent_class"],
        mode_description=config["description"],
    )


@app.route("/dashboard")
def dashboard() -> str:
    return render_template("dashboard.html")


@app.route("/admin")
def admin() -> str:
    return render_template("admin.html")


@app.route("/admin/control-center")
def admin_control_center() -> str:
    return redirect(url_for("admin"))


@app.route("/nearby-helpers")
def nearby_helpers() -> str:
    return render_template("nearby_helpers.html")


@app.route("/logs")
def logs() -> str:
    return render_template("logs.html")


@app.route("/about")
def about() -> str:
    return render_template("about.html")


@app.route("/center-status/<int:center_id>")
def center_status(center_id: int):
    centers = load_emergency_centers()
    if 1 <= center_id <= len(centers):
        center = centers[center_id - 1]
        available = evaluate_center_runtime(center)["available"]
        return jsonify({"available": available})

    return jsonify({"available": True})


@app.route("/center-status/<center_id>")
def center_status_alias(center_id: str):
    normalized = normalize_center_status_id(center_id)
    if isinstance(normalized, int):
        return center_status(normalized)
    return jsonify({"available": True})


@app.route("/api/bootstrap")
@require_json_auth
def api_bootstrap():
    requested_emergency_type = request.args.get("emergency_type")
    centers = load_emergency_centers_with_runtime()
    response_emergency_type = None

    if requested_emergency_type:
        response_emergency_type = normalize_emergency_type(requested_emergency_type)
        expected_center_type = EMERGENCY_TYPE_CONFIG[response_emergency_type]["center_type"]
        centers = [
            center
            for center in centers
            if str(center.get("type") or "").strip().lower() == expected_center_type
        ]

    return jsonify(
        {
            "centers": centers,
            "failure_zones": FAILURE_ZONES,
            "recent_events": fetch_recent_requests(limit=5),
            "emergency_type": response_emergency_type,
            "simulation_state": get_simulation_state(),
        }
    )


@app.route("/api/emergency/trigger", methods=["POST"])
@require_json_auth
def trigger_emergency():
    payload = request.get_json(silent=True) or {}
    lat = payload.get("lat")
    lng = payload.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400

    event = route_emergency_call(
        {
            "lat": float(lat),
            "lng": float(lng),
            "source": payload.get("source", "browser"),
            "emergency_type": payload.get("emergency_type"),
            "user_id": payload.get("user_id"),
            "timestamp": payload.get("timestamp"),
            "network": payload.get("network"),
            "network_strength": payload.get("network_strength"),
            "request_id": payload.get("request_id"),
        }
    )
    log_event(event)

    nearby_alert = None
    if get_nearby_helper_state().get("auto_alert_on_sos"):
        nearby_alert = simulate_nearby_helper_alert(
            {"lat": float(lat), "lng": float(lng)},
            emergency_type=event.get("emergency_type") or normalize_emergency_type(payload.get("emergency_type")),
            radius_m=int(get_nearby_helper_state().get("radius_m") or 1000),
            source="sos",
        )

    response = dict(event)
    if nearby_alert:
        response["nearby_alert"] = nearby_alert
    return jsonify(response)


@app.route("/api/dashboard")
@require_json_auth
def api_dashboard():
    with STORE_LOCK:
        requests_snapshot = list(LIVE_REQUESTS)[:20]

    if not requests_snapshot:
        requests_snapshot = fetch_recent_requests(limit=20)

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
            "centers": load_emergency_centers_with_runtime(),
            "requests": requests_snapshot,
            "summary": summary,
            "failure_heatmap": heat_points,
            "failure_zones": FAILURE_ZONES,
            "simulation_state": get_simulation_state(),
            "nearby_helper_state": get_nearby_helper_state(),
        }
    )


@app.route("/api/admin/centers")
@require_json_auth
def api_admin_centers():
    return jsonify({"centers": load_emergency_centers_with_runtime(), "simulation_state": get_simulation_state()})


@app.route("/api/admin/simulation", methods=["GET", "POST"])
@require_json_auth
def api_admin_simulation():
    if request.method == "GET":
        return jsonify({"simulation_state": get_simulation_state()})

    payload = request.get_json(silent=True) or {}
    state = update_simulation_state(payload)
    append_simulation_event(
        "global-update",
        f"Network congestion {'enabled' if state['network_congestion'] else 'disabled'}, auto rerouting {'enabled' if state['auto_rerouting'] else 'disabled'}.",
    )
    return jsonify({"ok": True, "simulation_state": state})


@app.route("/api/admin/simulation/reset", methods=["POST"])
@require_json_auth
def api_admin_simulation_reset():
    with STORE_LOCK:
        SIMULATION_STATE.update({"network_congestion": False, "auto_rerouting": True})
        CENTER_CONTROL_STATE.clear()
        SIMULATION_EVENTS.appendleft(
            {
                "timestamp": now_iso(),
                "kind": "reset",
                "summary": "All simulations reset.",
                "target": "global",
                "source": "admin",
            }
        )

    log_ui_action({"action": "simulation:reset", "target": "global", "source": "admin"})
    return jsonify({"ok": True, "simulation_state": get_simulation_state()})


@app.route("/api/admin/center-control", methods=["POST"])
@require_json_auth
def api_admin_center_control():
    payload = request.get_json(silent=True) or {}
    center_id = str(payload.get("center_id") or "").strip()
    if not center_id:
        return jsonify({"error": "center_id is required"}), 400

    if not any(center.get("id") == center_id for center in load_emergency_centers()):
        return jsonify({"error": f"Center not found: {center_id}"}), 404

    status = str(payload.get("status") or "available").strip().lower()
    if status not in ALLOWED_CENTER_STATUS:
        return jsonify({"error": "status must be one of: available, busy, offline"}), 400

    overload = bool(payload.get("overload", False))
    force_failure = bool(payload.get("force_failure", False))

    with STORE_LOCK:
        CENTER_CONTROL_STATE[center_id] = {
            "status": status,
            "overload": overload,
            "force_failure": force_failure,
        }

    updated = next((center for center in load_emergency_centers_with_runtime() if center["id"] == center_id), None)
    if updated:
        append_simulation_event(
            "center-update",
            f"{updated['name']} set to {updated['runtime_status']}; overload {'on' if updated['overload'] else 'off'}; failure {'on' if updated['force_failure'] else 'off'}.",
            target=center_id,
        )
    return jsonify({"ok": True, "center": updated})


@app.route("/api/nearby-helpers", methods=["GET", "POST"])
@require_json_auth
def api_nearby_helpers():
    if request.method == "GET":
        state = get_nearby_helper_state()
        location = state.get("current_location") or {"lat": DEFAULT_MAP_LAT, "lng": DEFAULT_MAP_LNG}
        radius_m = int(state.get("radius_m") or 1000)
        emergency_type = normalize_emergency_type(request.args.get("emergency_type") or "medical")
        helpers = [
            build_nearby_helper_snapshot(helper, location, emergency_type, radius_m)
            for helper in configured_nearby_helpers()
        ]
        helpers.sort(key=lambda item: item["distance_m"])
        return jsonify({"state": state, "helpers": helpers})

    payload = request.get_json(silent=True) or {}
    state = set_nearby_helper_state(payload)
    return jsonify({"ok": True, "state": state})


@app.route("/api/nearby-helpers/trigger", methods=["POST"])
@require_json_auth
def api_nearby_helpers_trigger():
    payload = request.get_json(silent=True) or {}
    lat = payload.get("lat")
    lng = payload.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400

    emergency_type = normalize_emergency_type(payload.get("emergency_type"))
    radius_m = int(payload.get("radius_m") or get_nearby_helper_state().get("radius_m") or 1000)
    alert = simulate_nearby_helper_alert({"lat": float(lat), "lng": float(lng)}, emergency_type, radius_m, source="manual")
    return jsonify(alert)


@app.route("/api/logs")
@require_json_auth
def api_logs():
    status_filter = (request.args.get("status") or "all").lower()

    with STORE_LOCK:
        logs_snapshot = list(CALL_LOGS)
        simulation_snapshot = list(SIMULATION_EVENTS)
        nearby_snapshot = list(UI_ACTIONS)

    if not logs_snapshot:
        logs_snapshot = fetch_logs_from_db(status_filter=status_filter)

    simulation_rows: list[dict[str, Any]] = []
    for event in simulation_snapshot:
        simulation_rows.append(
            {
                "timestamp": event["timestamp"],
                "request_id": f"SIM-{event['timestamp'][-6:]}",
                "source": event.get("source", "admin"),
                "final_status": "connected" if event["kind"] == "global-update" else "unresolved",
                "rerouted": False,
                "network_strength": 88 if event["kind"] == "global-update" else 100,
                "user_lat": 0,
                "user_lng": 0,
                "details": {
                    "attempts": [],
                    "fallback": None,
                    "messages": [event["summary"]],
                },
                "kind": "simulation",
                "summary": event["summary"],
                "target": event.get("target", ""),
            }
        )

    nearby_rows: list[dict[str, Any]] = []
    for event in nearby_snapshot:
        if not str(event.get("action") or "").startswith("nearby:"):
            continue
        nearby_rows.append(
            {
                "timestamp": event["timestamp"],
                "request_id": f"NB-{event['timestamp'][-6:]}",
                "source": event.get("source", "nearby-helpers"),
                "final_status": "connected",
                "rerouted": False,
                "network_strength": 100,
                "user_lat": 0,
                "user_lng": 0,
                "details": {
                    "attempts": [],
                    "fallback": None,
                    "messages": [event["action"], event.get("target") or "global"],
                },
                "kind": "nearby",
                "summary": event["action"],
                "target": event.get("target", ""),
            }
        )

    if status_filter == "all":
        logs_snapshot = nearby_rows + simulation_rows + logs_snapshot
    elif status_filter == "failed":
        logs_snapshot = [item for item in logs_snapshot if item["final_status"] in {"fallback_sent", "unresolved"}]
    elif status_filter == "rerouted":
        logs_snapshot = [item for item in logs_snapshot if item["rerouted"]]
    elif status_filter == "success":
        logs_snapshot = [item for item in logs_snapshot if item["final_status"] == "connected"]

    return jsonify(logs_snapshot)


@app.route("/api/ui/feature-click", methods=["POST"])
@require_json_auth
def api_ui_feature_click():
    payload = request.get_json(silent=True) or {}
    log_ui_action(payload)
    return jsonify({"ok": True})


@app.route("/api/cdr/import", methods=["POST"])
@require_json_auth
def api_cdr_import():
    rows: list[dict[str, str]] = []

    if "cdr_file" in request.files:
        uploaded = request.files["cdr_file"]
        if not uploaded.filename:
            return jsonify({"error": "No file selected"}), 400
        decoded = uploaded.stream.read().decode("utf-8-sig")
        rows = list(csv.DictReader(decoded.splitlines()))
    else:
        payload = request.get_json(silent=True) or {}
        file_path = payload.get("file_path")
        if not file_path:
            return jsonify({"error": "Provide multipart field 'cdr_file' or JSON {'file_path': '...'}"}), 400

        path = Path(file_path)
        if not path.is_absolute():
            path = BASE_DIR / path

        if not path.exists() or not path.is_file():
            return jsonify({"error": f"File not found: {path}"}), 404

        with path.open("r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))

    if not rows:
        return jsonify({"error": "No CDR rows found in CSV"}), 400

    result = import_cdr_rows(rows)
    return jsonify(
        {
            "ok": True,
            "total_rows": len(rows),
            "imported": result["imported"],
            "failed": result["failed"],
            "errors": result["errors"],
        }
    )


@app.route("/api/auth/signup-email", methods=["POST"])
def api_auth_signup_email():
    payload = request.get_json(silent=True) or {}
    full_name = str(payload.get("full_name") or "").strip()
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    if len(full_name) < 2:
        return jsonify({"error": "full_name must be at least 2 characters"}), 400
    if not email or "@" not in email:
        return jsonify({"error": "Valid email is required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    if get_user_by_email(email):
        return jsonify({"error": "An account with this email already exists"}), 409

    password_hash = generate_password_hash(password)
    now = now_iso()
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users (full_name, email, password_hash, auth_provider, created_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (full_name, email, password_hash, "email", now, now),
        )

    set_session_user(int(cursor.lastrowid))
    return jsonify(
        {
            "ok": True,
            "user": session_user(),
            "redirect": json_redirect_target(payload),
        }
    )


@app.route("/api/auth/login-email", methods=["POST"])
def api_auth_login_email():
    payload = request.get_json(silent=True) or {}
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")
    user = get_user_by_email(email)

    if not user or not user.get("password_hash") or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    with get_db_connection() as conn:
        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso(), int(user["id"])))
    set_session_user(int(user["id"]))

    return jsonify(
        {
            "ok": True,
            "user": session_user(),
            "redirect": json_redirect_target(payload),
        }
    )


@app.route("/api/auth/signup-phone", methods=["POST"])
def api_auth_signup_phone():
    payload = request.get_json(silent=True) or {}
    full_name = str(payload.get("full_name") or "").strip()
    phone = normalize_phone(payload.get("phone"))
    password = str(payload.get("password") or "")

    if len(full_name) < 2:
        return jsonify({"error": "full_name must be at least 2 characters"}), 400
    if not is_valid_phone(phone):
        return jsonify({"error": "Phone must be in international format, for example +919876543210"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    if get_user_by_phone(phone):
        return jsonify({"error": "An account with this phone number already exists"}), 409

    password_hash = generate_password_hash(password)
    now = now_iso()
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users (full_name, phone, password_hash, auth_provider, created_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (full_name, phone, password_hash, "phone", now, now),
        )

    set_session_user(int(cursor.lastrowid))
    return jsonify(
        {
            "ok": True,
            "user": session_user(),
            "redirect": json_redirect_target(payload),
        }
    )


@app.route("/api/auth/login-phone", methods=["POST"])
def api_auth_login_phone():
    payload = request.get_json(silent=True) or {}
    phone = normalize_phone(payload.get("phone"))
    password = str(payload.get("password") or "")
    user = get_user_by_phone(phone)

    if not user or not user.get("password_hash") or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid phone or password"}), 401

    with get_db_connection() as conn:
        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso(), int(user["id"])))
    set_session_user(int(user["id"]))

    return jsonify(
        {
            "ok": True,
            "user": session_user(),
            "redirect": json_redirect_target(payload),
        }
    )


@app.route("/api/auth/google", methods=["POST"])
def api_auth_google():
    payload = request.get_json(silent=True) or {}
    credential = str(payload.get("credential") or "")
    token_payload = verify_google_credential(credential)

    if not token_payload:
        return jsonify({"error": "Google sign-in failed. Check GOOGLE_CLIENT_ID and google-auth dependency."}), 400

    user = get_user_by_google_sub(token_payload["sub"])
    now = now_iso()
    if user:
        with get_db_connection() as conn:
            conn.execute(
                """
                UPDATE users
                SET full_name = ?, email = ?, last_login_at = ?
                WHERE id = ?
                """,
                (token_payload["full_name"], token_payload["email"], now, int(user["id"])),
            )
        set_session_user(int(user["id"]))
    else:
        existing_email = get_user_by_email(token_payload["email"])
        if existing_email and not existing_email.get("google_sub"):
            with get_db_connection() as conn:
                conn.execute(
                    """
                    UPDATE users
                    SET google_sub = ?, auth_provider = ?, full_name = ?, last_login_at = ?
                    WHERE id = ?
                    """,
                    (
                        token_payload["sub"],
                        "google",
                        token_payload["full_name"],
                        now,
                        int(existing_email["id"]),
                    ),
                )
            set_session_user(int(existing_email["id"]))
        else:
            with get_db_connection() as conn:
                cursor = conn.execute(
                    """
                    INSERT INTO users (full_name, email, google_sub, auth_provider, created_at, last_login_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        token_payload["full_name"],
                        token_payload["email"],
                        token_payload["sub"],
                        "google",
                        now,
                        now,
                    ),
                )
            set_session_user(int(cursor.lastrowid))

    return jsonify(
        {
            "ok": True,
            "user": session_user(),
            "redirect": json_redirect_target(payload),
        }
    )


init_db()
sync_emergency_centers()


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

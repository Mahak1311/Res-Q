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

CREATE TABLE IF NOT EXISTS ai_decision_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    request_id TEXT,
    source TEXT NOT NULL,
    emergency_type TEXT NOT NULL,
    user_lat REAL NOT NULL,
    user_lng REAL NOT NULL,
    selected_center_id TEXT,
    selected_center_name TEXT,
    selected_score REAL NOT NULL,
    confidence REAL NOT NULL,
    explanation TEXT NOT NULL,
    ranked_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_decision_logs_created_at ON ai_decision_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decision_logs_request_id ON ai_decision_logs(request_id);

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

CREATE INDEX IF NOT EXISTS idx_emergency_requests_created_at ON emergency_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_final_status ON emergency_requests(final_status);
CREATE INDEX IF NOT EXISTS idx_call_attempts_request_id ON call_attempts(request_id);
CREATE INDEX IF NOT EXISTS idx_ui_actions_timestamp ON ui_actions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);

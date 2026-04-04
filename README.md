# Res Q - Emergency Call Failure & Misrouting Detection System

Res Q is a full-stack hackathon prototype that simulates emergency call failures in real time and reroutes to the nearest available emergency center.

## Features

- Authentication:
  - Sign up and login with Email + Password
  - Sign up and login with Phone + Password
  - Google Sign-In (ID token verification on backend)
- Multi-page web app:
  - Home
  - Emergency Trigger (SOS simulation)
  - Authority Dashboard (Live map + requests)
  - Logs (event table with filters)
  - About
- Real-time emergency simulation:
  - Call failure detection (`dropped`, `busy`, `no_response`)
  - Timeout and rerouting logic
  - Fallback alert (`sms` or `internet_alert`)
- Geolocation workflow:
  - Browser GPS or mock coordinates
  - GPS + cell tower fusion for corrected location
- Dashboard intelligence:
  - OpenStreetMap + Leaflet integration
  - Emergency center markers
  - User markers and route lines
  - Failure-prone area overlays and heatmap
- Event logging:
  - Request-level call history with timestamps
  - Status filters (`success`, `failed`, `rerouted`)

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Flask (Python)
- Mapping: OpenStreetMap + Leaflet.js
- Data: JSON mock datasets
- Persistence: SQLite (auto-created at runtime)

## Run Locally

1. Create virtual environment (recommended)
2. Install dependencies

```bash
pip install -r requirements.txt
```

3. Start server

```bash
python app.py
```

Optional environment variables for authentication:

- `SECRET_KEY` (recommended for production)
- `GOOGLE_CLIENT_ID` (required to enable Google Sign-In)
- `OFFLINE_MODE` (`true`/`false`, default: `false`)

### Google Sign-In Setup

1. Open Google Cloud Console and create/select a project.
2. Configure OAuth consent screen.
3. Create credentials: **OAuth client ID** -> **Web application**.
4. Add authorized origins:
  - `http://127.0.0.1:5000`
  - `http://localhost:5000`
5. Copy the client ID into `.env` as:

```env
GOOGLE_CLIENT_ID=your_google_web_client_id
```

6. Restart the Flask server.

The auth page will automatically show the Google sign-in button when `GOOGLE_CLIENT_ID` is set.

### Full Offline Profile

Set this in `.env`:

```env
OFFLINE_MODE=true
```

When enabled, the app keeps local functionality but disables internet dependencies:

- Google Sign-In is hidden/disabled (use email, phone, or demo login)
- Live OSM center fetching is skipped (local center seed data is used)
- External SMS provider calls are skipped and logged locally
- Frontend map route requests are skipped; fallback straight-line rendering remains

Online mode is unchanged when `OFFLINE_MODE=false`.

4. Open:

- http://127.0.0.1:5000/

## Database (Now Enabled)

The app now persists emergency data to SQLite so records survive restarts.

- Default DB file: `safetytech.db` (project root)
- Optional override: set environment variable `DATABASE_PATH`
- SQL schema file: `db/schema.sql`

### Stored Tables

- `emergency_requests`: one row per emergency event
- `call_attempts`: one row per routing attempt
- `fallback_events`: fallback delivery details (`sms` / `internet_alert`)
- `emergency_centers`: synchronized center metadata
- `ui_actions`: dashboard/emergency page interactions
- `users`: local users and Google-linked identities

### Notes

- Existing in-memory queues are still used for live UI responsiveness.
- If app memory is empty after restart, dashboard/log APIs read from SQLite.

## CDR CSV Import

You can now import CDR-like records directly into the app database.

- Endpoint: `POST /api/cdr/import`
- Modes:
  - Multipart upload field: `cdr_file`
  - JSON body with file path: `{ "file_path": "static/data/cdr_import_template.csv" }`

### Minimal CSV Columns

- `request_id`
- `created_at`
- `source`
- `lat`
- `lng`
- `network_strength`
- `final_status` (`connected`, `fallback_sent`, `unresolved`)

Optional columns are supported, including: `rerouted`, `tower_id`, `provider`, `failure_reason`, `fallback_channel`, `fallback_status`, `attempts_json`, `fallback_json`, `messages_json`.

Starter file: `static/data/cdr_import_template.csv`

### Example Import (PowerShell)

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/api/cdr/import -ContentType "application/json" -Body '{"file_path":"static/data/cdr_import_template.csv"}'
```

## Project Structure

```text
safetytech/
├─ app.py
├─ requirements.txt
├─ README.md
├─ templates/
│  ├─ base.html
│  ├─ home.html
│  ├─ emergency.html
│  ├─ dashboard.html
│  ├─ logs.html
│  └─ about.html
└─ static/
   ├─ css/
   │  └─ styles.css
   ├─ js/
   │  ├─ common.js
   │  ├─ emergency.js
   │  ├─ dashboard.js
   │  └─ logs.js
   └─ data/
      ├─ emergency_centers.json
      └─ mock_cdr.json
```

# Res Q - Emergency Call Failure & Misrouting Detection System

Res Q is a full-stack hackathon prototype that simulates emergency call failures in real time and reroutes to the nearest available emergency center.

## Features

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

4. Open:

- http://127.0.0.1:5000/

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

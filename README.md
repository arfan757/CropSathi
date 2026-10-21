# CropSathi (क्रॉप साथी)
### Early Crop Disease Detection & Satellite Field Health Intelligence Platform

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **CropSathi** bridges macro-level satellite remote sensing with field-level leaf pathology diagnostics to flag crop stress, water deficits, and disease outbreaks days before irreversible damage occurs. Built for smallholder farmers, village extension workers, and agricultural officers.

---

## The Problem

Traditional crop scouting is reactive: farmers often identify fungal blights, rusts, and viral infections only after leaves wilt or lesions cover whole canopies. Satellite-only vegetation indices frequently generate false alarms over mixed pixels and urban rooftops, while standalone vision apps cannot assess crop canopy vigor or irrigation stress across whole field parcels.

**CropSathi solves this with a two-tiered intelligence pipeline:**
1. **Macro-Sensing:** Continuously monitors farm polygons using European Space Agency (ESA) Sentinel-2 multi-spectral optical reflectance and NASA/USGS Landsat 8/9 thermal radiance.
2. **Micro-Verification:** When satellite vegetation indices detect stress anomalies, the platform prompts the farmer to upload geo-tagged leaf photos. A dual-model vision system (38-class PlantVillage CNN + Google Gemini 1.5 Flash Vision) corroborates the remote signal and issues localized, stage-specific remediation advisories.

---

## Key Features

- 🗺️ **Interactive GIS Field Polygon Mapping:** Precision boundary drawing using Leaflet GIS with automatic geodesic area (hectares) and centroid calculation.
- 🛰️ **Multi-Spectral Satellite Monitoring:** Computes Normalized Difference Vegetation Index (NDVI) and Normalized Difference Red Edge (NDRE) via Copernicus Data Space.
- 🌡️ **Thermal Water Stress (CWSI):** Ingests Landsat 8/9 Land Surface Temperature (LST) and calculates Crop Water Stress Index via the empirical Idso method.
- 🛡️ **Surface Validation Guardrail:** Automatically rejects non-agricultural surfaces (urban rooftops, concrete roads, barren rocks) with strict physical reflectance thresholds ($\text{NDVI} < 0.20$).
- 🔬 **Dual-Engine Leaf Pathology Diagnosis:** Fast 38-class PlantVillage deep learning classifier combined with multimodal Gemini 1.5 Flash Vision for nuanced symptom confirmation.
- 💊 **Actionable Remediation Pipeline:** Delivers structured treatment plans (Cultural, Physical, Biological, and Chemical remedies with precise dosage guidelines) aligned with ICAR / TNAU standards.
- 🌐 **Multilingual Interface:** Complete localized UI support in English, Hindi (हिंदी), and Marathi (मराठी).
- ⏰ **Automated Follow-ups & Reminders:** Scheduled background workers track treatment efficacy and notify farmers via in-app feeds, SMS, and WhatsApp alerts.

---

## System Architecture

```
[ Frontend: Web GIS & Farmer Dashboard ]
  │   - Leaflet Polygon Boundary Mapping
  │   - Multi-Photo Camera / Image Upload Flow
  │   - Multilingual UI (English, Hindi, Marathi)
  ▼
[ Backend: Node.js / Express API Gateway ]
  │   - JWT Auth & User Profile Management
  │   - Automated Cron Schedulers (Weather & Satellite)
  │   - Surface Validation Gatekeeper (NDVI < 0.20 rejection)
  │   - 3-Signal Health Fusion Engine (NDVI + NDRE + CWSI)
  ├───▶ [ Database: MongoDB Atlas ]
  │       - Farm Polygons, Baselines, Diagnosis Cases, Advisories
  ├───▶ [ Remote Sensing: Copernicus Data Space Ecosystem ]
  │       - Sentinel-2 Optical (10-20m) & Landsat 8/9 Thermal (30m)
  ├───▶ [ Microservice: FastAPI Plant Disease CNN ]
  │       - 38 PlantVillage Classes (TensorFlow / Keras)
  └───▶ [ Vision LLM: Google Gemini 1.5 Flash ]
          - Multimodal leaf diagnosis & prescription synthesis
```

---

## Repository Structure

```text
CropSathi/
├── .env.example              # Environment variables template (backend + ML)
├── .gitignore                # Comprehensive Git ignore rules
├── package.json              # Root build scripts (Tailwind compilation & packaging)
├── tailwind.config.js        # Tailwind CSS configuration & safelist rules
├── tailwind.input.css        # Tailwind stylesheet directives
├── render.yaml               # Cloud multi-service blueprint (Render)
├── vercel.json               # Caching & security headers configuration (Vercel)
├── docs/                     # Project specifications & technical documentation
│   ├── ARCHITECTURE.md       # Full architectural design & mathematical formulation
│   ├── BACKEND_SPEC.md       # API endpoint contracts & database schema reference
│   ├── DEPLOYMENT.md         # Deployment runbook (Vercel, Render, Railway, Atlas)
│   ├── DESIGN.md             # UI design system tokens, typography & palette
│   ├── FIELD_VALIDITY_VERIFICATION.md  # Spectral surface rejection logic
│   ├── FIX_SUMMARY.md        # Technical resolution logs
│   ├── FRONTEND_PRD.md       # Screen specifications & user flows
│   ├── NOTIFICATION_TRIGGERS.md # Alert trigger thresholds
│   ├── PHASES.md             # Project roadmap & milestones
│   └── PRD.md                # Product Requirements Document (SIH26131)
├── frontend/                 # Client application (HTML5, Vanilla JS, Tailwind CSS)
│   ├── index.html            # Entry point (redirects to login)
│   ├── login.html            # Farmer authentication & registration
│   ├── dashboard.html        # Main farm status hub, weather & urgent alerts
│   ├── add-field.html        # Interactive boundary drawing & crop stage registration
│   ├── my-fields.html        # Field list & satellite status map
│   ├── diagnose.html         # Leaf pathology image upload & diagnosis portal
│   ├── advisory.html         # Active prescription feed
│   ├── advisory-detail.html  # Comprehensive remedy breakdown & follow-up scheduler
│   ├── analytics.html        # Historical spectral time-series charts
│   ├── notifications.html    # Notification center (Urgent, Advisory, System)
│   ├── settings.html         # User profile, GPS coords & language preferences
│   ├── config.js             # Dynamic API endpoint configuration
│   ├── preferences.js        # Multilingual translation dictionaries & dark mode
│   ├── nav-profile.js        # Global header synchronization
│   ├── ui.js                 # Shared UI helpers (toast alerts, modals, session check)
│   ├── tokens.css            # CSS custom properties & design tokens
│   ├── app.css               # Compiled production Tailwind stylesheet
│   └── ui.css                # Custom animations & component styles
├── backend/                  # REST API & background processing service
│   ├── server.js             # Express application entry point
│   ├── package.json          # Node dependencies & automation scripts
│   ├── .env.example          # Backend-specific environment template
│   ├── src/
│   │   ├── config/           # Database connector & domain rule matrices
│   │   ├── controllers/      # Route request & response handlers
│   │   ├── cron/             # Scheduled background worker jobs
│   │   ├── middleware/       # JWT authentication & route protection
│   │   ├── models/           # 14 Mongoose schema models
│   │   ├── routes/           # Express API endpoints (/api/*)
│   │   └── services/         # Copernicus client, Gemini vision, health scoring
│   ├── scripts/              # Database seeders & crop-stage backfill utilities
│   └── tests/                # Automated test suites
├── ml-service/               # Plant pathology CNN microservice
│   ├── app.py                # FastAPI inference server (/predict, /health)
│   ├── requirements.txt      # Python dependencies (TensorFlow, FastAPI, Pillow)
│   ├── runtime.txt           # Python runtime version
│   └── test-*.JPG            # Sample leaf test images
└── archive/                  # Archived diagnostic & scratch scripts
    ├── check-latest-case.js
    ├── test-direct.js
    ├── test-minimax-flow.js
    ├── test-real-image.js
    └── FIX_IMPLEMENTATION_SUMMARY.md
```

---

## Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | HTML5, Vanilla JavaScript (ES6+), Tailwind CSS 3.4, Leaflet GIS, Lucide Icons |
| **Backend** | Node.js (v18+), Express.js, Mongoose ODM, Sharp, JWT, Node-cron, Geotiff |
| **Machine Learning** | Python 3.11, FastAPI, TensorFlow/Keras (38 PlantVillage classes), Uvicorn |
| **Vision AI** | Google Gemini 1.5 Flash Vision (Multimodal diagnosis) |
| **Remote Sensing** | Sentinel-2 Optical (Copernicus CDSE), Landsat 8/9 Thermal (USGS/NASA) |
| **Database** | MongoDB Atlas (Cloud Managed NoSQL) |
| **Deployment** | Vercel (Frontend), Render (Backend & ML Services) |

---

## Getting Started

### Prerequisites
- **Node.js** (v18.0.0 or higher) & `npm`
- **Python** (v3.11) & `pip`
- **MongoDB** (Local instance or free MongoDB Atlas URI)
- **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/apikey))

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/arfan757/CropSathi.git
cd CropSathi
```

---

### Step 2: Backend Setup
```bash
cd backend

# Copy environment template
cp .env.example .env

# Edit .env with your MongoDB Atlas URI, JWT Secret, and Gemini API key:
# MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/cropsathi
# JWT_SECRET=your_32_character_secret_key
# GEMINI_API_KEY=your_gemini_api_key

# Install dependencies
npm install

# Seed disease catalogs and crop calendars into MongoDB
npm run seed

# Start development server
npm run dev
# Backend starts at: http://localhost:5000
```

---

### Step 3: ML Microservice Setup (Optional for CNN Inference)
```bash
cd ml-service

# Create virtual environment
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install requirements
pip install -r requirements.txt

# Download model weights (if not already downloaded)
curl -L -o trained_plant_disease_model.keras https://raw.githubusercontent.com/goutam-dev/crop-disease-detection/7e405a6ea149009b63e2421533ff3ee9d0a6e9bf/trained_plant_disease_model.keras

# Launch ML service
uvicorn app:app --host 127.0.0.1 --port 10000
# Health check available at: http://127.0.0.1:10000/health
```

---

### Step 4: Frontend Setup
The frontend is built with static web standards and connects automatically:
- When running locally, [frontend/config.js](file:///c:/Users/arfan/Documents/Crop%20sathi/CropSathi/frontend/config.js) detects `localhost` and routes API calls to `http://localhost:5000`.
- Simply open [frontend/index.html](file:///c:/Users/arfan/Documents/Crop%20sathi/CropSathi/frontend/index.html) directly in your web browser, or serve it using VS Code Live Server:
```bash
# Optional: re-compile Tailwind CSS if you make markup changes
npm install
npm run build:css

# Serve frontend with any local HTTP server:
npx serve frontend -p 3000
# Open http://localhost:3000 in your browser
```

---

## Environment Variables

| Variable | Required | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `PORT` | No | `5000` | Port for Express API server |
| `NODE_ENV` | Yes | `development` | Environment mode (`development` or `production`) |
| `MONGODB_URI` | Yes | `mongodb+srv://...` | MongoDB connection string |
| `JWT_SECRET` | Yes | `min_32_chars_random` | Secret key used for signing JWT tokens |
| `JWT_EXPIRE` | No | `30d` | Token expiration lifespan |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Whitelisted frontend origins (comma-separated) |
| `GEMINI_API_KEY` | Yes | `AIzaSy...` | Google AI Studio API key for multimodal vision |
| `OPENROUTER_API_KEY` | No | `sk-or-...` | Optional fallback reasoning API key |
| `COPERNICUS_CLIENT_ID` | No | `oauth-client-id` | Copernicus Data Space OAuth Client ID |
| `COPERNICUS_CLIENT_SECRET` | No | `oauth-secret` | Copernicus Data Space OAuth Client Secret |
| `ML_SERVICE_URL` | No | `http://127.0.0.1:10000`| URL of Python PlantVillage CNN microservice |
| `CRON_SECRET` | No | `secret_token` | Auth bearer secret for manual cron trigger endpoints |

---

## Current Status & Roadmap

### Current Implementation Status (v1.0 Working MVP)
- [x] **Field GIS Boundary Mapping:** Interactive polygon drawing, vertex snapping, and area calculation.
- [x] **Land-Cover Classification Guardrail:** Automatic rejection of non-vegetative surfaces ($\text{NDVI} < 0.20$).
- [x] **Satellite Processing Engine:** Sentinel-2 multi-spectral pipeline with dynamic regional baselines.
- [x] **Dual-Engine Leaf Pathology:** Integration with PlantVillage CNN and Gemini 1.5 Flash Vision.
- [x] **Actionable Prescriptions:** Stage-appropriate remediation regimens (cultural, biological, chemical).
- [x] **Scheduled Automated Cron Jobs:** Daily weather sync, anomaly detection scans, and reminder dispatches.
- [x] **Multilingual Support:** Live English, Hindi, and Marathi translations.

### Future Roadmap
- [ ] Offline-first mobile app using React Native / Flutter with local image caching.
- [ ] Push notifications via WhatsApp Business API / WebPush.
- [ ] Direct integration with local PMKSK / Krishi Seva Kendra inventory APIs for pesticide availability.
- [ ] Edge model inference via TensorFlow Lite directly inside client browsers.

---

## Documentation

For in-depth technical specifications, please consult the documents in the [docs/](docs/) folder:
- [System Architecture & Math Models](docs/ARCHITECTURE.md)
- [Complete Backend API Specification](docs/BACKEND_SPEC.md)
- [Production Deployment Runbook](docs/DEPLOYMENT.md)
- [UI Design & Color Token Guide](docs/DESIGN.md)
- [Surface Validation & Spectral Gatekeeper](docs/FIELD_VALIDITY_VERIFICATION.md)
- [Phase Roadmap & SIH Milestones](docs/PHASES.md)

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
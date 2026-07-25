# 🌿 AgriSense — Smart Farming System

Precision agriculture powered by IoT, AI, and real-time soil & weather intelligence.

## Architecture

```
agrisense/
├── apps/
│   ├── api/          Node.js 20 + Express + TypeScript (REST + WebSocket)
│   ├── ml/           Python 3.11 + FastAPI (ML inference service)
│   └── web/          React 18 + TypeScript + Vite + Tailwind (dashboard)
├── infrastructure/
│   ├── postgres/     init.sql — 14-table schema + TimescaleDB hypertables
│   ├── mosquitto/    MQTT broker config
│   └── nginx/        Reverse proxy + rate limiting
└── .github/workflows ci.yml — lint → test → Docker build → push
```

## Four Pillars

| Pillar | Tech | Endpoints |
|--------|------|-----------|
| Soil Intelligence | pH/NPK/moisture IoT sensors + SFS engine | `GET /sfs/:farmId` |
| Crop Growth | GDD engine + NDVI satellite | `GET /cycles/:id/gdd` |
| Weather Engine | OpenWeatherMap + Tomorrow.io + LSTM | `GET /weather/:farmId/forecast` |
| AI Planting Advisor | XGBoost + SHAP XAI | `POST /recommendations/crops` |

## Quick Start

### 1. Prerequisites
- Docker + Docker Compose
- Node.js 20
- Python 3.11
- Copy `.env.example` → `.env` and fill in API keys

### 2. Start infrastructure
```bash
cd infrastructure
docker compose up -d db redis mqtt
```

### 3. Run the database schema
```bash
docker exec -i agrisense_db psql -U agrisense agrisense < infrastructure/postgres/init.sql
```

### 4. Start the API
```bash
cd apps/api && npm install && npm run dev
```

### 5. Start the ML service
```bash
cd apps/ml && pip install -r requirements.txt && uvicorn main:app --reload --port 8000
```

### 6. Start the frontend
```bash
cd apps/web && npm install && npm run dev
# Open http://localhost:5173
```

### OR: Run everything with Docker
```bash
docker compose -f infrastructure/docker-compose.yml up
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login → JWT |
| GET  | `/api/v1/farms` | List all farms |
| POST | `/api/v1/farms` | Create farm |
| GET  | `/api/v1/farms/:id/summary` | Dashboard hero data |
| POST | `/api/v1/sensors/register` | Register IoT node |
| POST | `/api/v1/sensors/:id/readings` | Ingest sensor data |
| GET  | `/api/v1/sfs/:farmId` | Soil Feasibility Score |
| GET  | `/api/v1/weather/:farmId/forecast` | 14-day forecast |
| GET  | `/api/v1/weather/:farmId/history` | Historical weather |
| GET  | `/api/v1/crops/calendar/:zone` | Planting calendar |
| POST | `/api/v1/cycles` | Start crop cycle |
| GET  | `/api/v1/cycles/:id/gdd` | GDD computation |
| POST | `/api/v1/recommendations/crops` | AI crop recommendation |
| GET  | `/api/v1/alerts?farm_id=` | List alerts |
| POST | `/api/v1/payments/subscribe` | M-Pesa STK Push |

## ML Service Endpoints (internal)

| Endpoint | Model | Notes |
|----------|-------|-------|
| `POST /sfs/compute` | Rule-based (8-param, audit-fixed weights) | All 8 params scored |
| `POST /gdd/compute` | Physics + null-safe stage lookup | Cassava-safe |
| `POST /recommend/crops` | XGBoost fallback to rule-based | SHAP explanations |
| `POST /anomaly/detect` | Welford online Z-score | Per-node rolling stats |
| `POST /pest-risk` | GBM / rule-based | Temp + humidity trigger |
| `POST /irrigation/schedule` | RL-inspired / physics | Kc stage factors |

## WebSocket Events

Connect: `ws://host/ws?token=<JWT>`

Subscribe: `{ "type": "SUBSCRIBE", "farm_ids": ["<uuid>"] }`

| Event | Direction | Payload |
|-------|-----------|---------|
| `SENSOR_UPDATE` | Server → Client | `{ node_id, sensor_type, value, time }` |
| `ALERT_FIRED` | Server → Client | Full alert object |
| `GDD_TICK` | Server → Client | `{ gdd_daily, gdd_cumulative, stage }` |
| `PING / PONG` | Both | heartbeat |

## v4 — Live-Built & Verified Features (July 2026)

Built and live-tested against the running stack, not just written — see `HARDWARE_SIMULATION_REPORT.md`, `FEASIBILITY_STUDY_GAP_ANALYSIS.md`, and `QWEN_QODER_IMPLEMENTATION_PROMPT.md` for full context.

- **Open-Meteo as a 3rd weather-ensemble source** (`weatherService.ts`) — generalized the disagreement-flagging merge from 2 to N sources. Network-blocked in this sandbox (`api.open-meteo.com` not in the egress allowlist); parsing logic validated against Open-Meteo's real documented schema and the N-way merge validated with realistic agree/disagree/missing-source scenarios instead.
- **Quick Soil Check — manual SFS entry** (`POST /sfs/:farmId/manual`, migration `003_quick_soil_check.sql`) — the direct competitive response to UjuziKilimo's SoilPal Pro handheld spectrometer (see gap analysis §1). Any farmer can type in a reading from any source and get the same SFS/recommendation engine a sensor-fed farm gets, at a fixed conservative trust score (70) so it never claims more authority than calibrated hardware. Same physical-bounds validation as the sensor pathway — live-tested rejecting an impossible pH=22 submission with the identical guardrail. Frontend form on the Soil Health page, confirmed working via a genuine browser click-through (a second manual entry appeared in the database that was never submitted via curl).
- **Data-sharing consent enforcement** (`middleware/consent.ts`, `PATCH /users/me`) — `users.data_sharing_consent` existed in the schema since migration 002 with nothing reading or writing it. Now a live DB-checked guard (not a JWT claim, so revocation takes effect on the very next request) protects any consent-gated route.
- **Regional SFS benchmarking** (`GET /insights/benchmark/:farmId`) — first real consumer of the consent guard. Lets an opted-in farmer see how their soil score compares to other opted-in farms in their county. Enforces a minimum-3-peer privacy floor before showing any aggregate (never fabricates a comparison from too small a pool) and only draws from farms whose owners have *also* consented. Live-tested end-to-end: blocked without consent (403), unblocked after opting in, and the returned per-parameter county averages were independently checked against raw DB values and matched exactly.
- **Test coverage:** Jest 30/30 (7 new tests for the above), pytest 32/32, zero TypeScript/ESLint/flake8/bandit findings across API, Web, and ML.

## Blueprint Audit Fixes Applied

See `BLUEPRINT_AUDIT.md` for the full audit report. Key fixes:
- SFS weights updated to cover all 8 parameters (§I1)
- Feature vector corrected to 26 variables (§I2)
- RBAC roles properly mapped to subscription tiers (§I4)
- Cassava null GDD stage handled gracefully (§I7)
- Kenya EAF planting calendar overrides added (§I9)
- 14 gaps filled: JWT spec, DB schema, MQTT topics, SMS, M-Pesa, WebSocket, error codes, rate limiting, env vars, retention policy, sensor provisioning, onboarding, test strategy, CI/CD

## Deployment & Git Workflow

### Branching Strategy

We follow a **Git Flow**-inspired workflow:

```
main       ── Production-ready (protected, auto-deploys)
develop    ── Integration branch (protected)
feat/*     ── New features
fix/*      ── Bug fixes
release/*  ── Release preparation
hotfix/*   ── Urgent production fixes (from main)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, commit conventions, and PR process.

### CI/CD Pipeline

The [GitHub Actions pipeline](.github/workflows/ci.yml) runs automatically:

| Stage | Trigger | What happens |
|-------|---------|-------------|
| 🔒 Secrets scan | Every push | Gitleaks checks for leaked credentials |
| 🔬 CodeQL | Every push | GitHub's security analysis |
| 🧹 Lint & Types | Every push | ESLint, flake8, bandit, TypeScript |
| 🧪 Tests | Every push | Jest (API), pytest (ML) — Node 20/22, Python 3.11/3.12 |
| 📦 Docker build | main, develop, tags | Multi-arch images → GHCR |
| 🔍 Vuln scan | main | Trivy scans production images |
| 🚀 Deploy staging | develop | SSH deploy to staging |
| 🚀 Deploy production | main, tags | SSH deploy to production |
| 🏷️ Release | tags | GitHub Release + changelog |

### Git Conventions

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add soil moisture threshold alerts
fix(ml): handle null GDD stage for cassava
chore(deps): bump express from 4.18.2 to 4.19.0
```

Pre-commit hooks (husky + commitlint + lint-staged) enforce these automatically after running:

```bash
make git-hooks
```

### Quick Deploy (Local)

```bash
# Full stack via Docker Compose
make up

# Or start just infrastructure + local dev
make infra-up
npm run dev
```

### Production Deploy

Images are automatically pushed to `ghcr.io` on pushes to `main`. Deploy to production:

```bash
# Via Docker Compose (on the server)
cd /opt/agrisense
docker compose pull
docker compose up -d
```

Cloud (AWS ECS / GCP Cloud Run): pull images from GHCR and deploy via your cloud provider.

### Commit Message Hooks

Install commit-msg validation and pre-commit linting:

```bash
make git-hooks
```

This runs `commitlint` on every commit message and `lint-staged` on staged files.

## License

MIT License — Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.

AgriSense Smart Farming System was created by **Thoth of Codes**, Ruai Tech Solutions, Ruai Town Centre, Nairobi, Kenya. See [`LICENSE`](./LICENSE) for the full text. Every source file carries the same copyright and license header.

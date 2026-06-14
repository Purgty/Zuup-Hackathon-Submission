# Zuup — Operator Dashboard Implementation Walkthrough

## What Was Built

The complete **Zuup Demand-Aware Bus Allocation Platform** is implemented and running as a hackathon demo. Here's what was delivered:

---

## System Status

| Component | Status | Port |
|---|---|---|
| Backend HTTP API | ✅ Running | 4000 |
| Backend WebSocket | ✅ Running | 4001 |
| React Dashboard | ✅ Running | 5173 |
| SQLite Database | ✅ Seeded | `backend/data/zuup.db` |

---

## Architecture Implemented

```
┌─────────────────────────────────────────────────────────────┐
│  Operator Dashboard (React + MapLibre GL)   :5173           │
│  ┌──────────────┐ ┌────────────────┐ ┌───────────────────┐  │
│  │  Bus Map     │ │  Alert Queue   │ │ Fleet / Routes    │  │
│  │  (MapLibre)  │ │ (Approve/Rej.) │ │ Health Panels     │  │
│  └──────────────┘ └────────────────┘ └───────────────────┘  │
└────────────────────────── ws://localhost:4001 ───────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│  Backend (Node.js + TypeScript)            :4000             │
│                                                             │
│  ┌────────────────┐   ┌────────────────────────────────┐   │
│  │  EventBus      │   │  StateStore (in-memory)         │   │
│  │  (EventEmitter │◄──│  routes, stops, buses           │   │
│  │  ≈ Kafka)      │   │  check-ins, alerts, reroutes    │   │
│  └────────────────┘   └────────────────────────────────┘   │
│          │                                                  │
│  ┌───────┴──────────────────────────────────────────────┐  │
│  │  Services                                             │  │
│  │  • SimulatorService        (demo scenario)            │  │
│  │  • RouteIntelligenceService (demand snapshots, 30s)   │  │
│  │  • RerouteEngine           (5-step hierarchy)         │  │
│  │  • CheckInLifecycleManager (confidence decay, 60s)    │  │
│  │  • DemandIngestionService  (check-in API)             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Adapters (injection points)                         │   │
│  │  IRoutingService   → MockRoutingService (Haversine)  │   │
│  │  INotificationService → MockNotificationService      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  SQLite (better-sqlite3) → routes, stops, drivers,         │
│                            demand baselines, audit logs     │
└─────────────────────────────────────────────────────────────┘
```

---

## Demo Scenario (Auto-Plays)

The `SimulatorService` runs this scenario automatically every time the backend starts:

| Time | Event |
|---|---|
| 0s | 8 buses begin moving across 3 Bangalore routes |
| 0–30s | Organic check-ins (1-3 pax) generate background demand |
| 30s | **SURGE**: 25 passengers check in at Koramangala Junction (Route 1) |
| 30s | `RouteIntelligenceService` detects overload (demand: 40+) |
| 30–90s | Additional surge check-ins (4 pax every 15s) keep demand high |
| 30s+ | `RerouteEngine` runs the 5-step hierarchy: |
|      | → Step 1: Bunching check |
|      | → If no bunching: Step 4/5: find cross-route candidate |
|      | → Issues a **Tier 2 alert** in the dashboard |
| On operator click | **Approve** the reroute — driver notification sent |
| +5s | Driver auto-confirms (simulated) |
| +35s | Bus completes reroute, **Tier 3 success alert** issued |

---

## Files Created

### Backend (`backend/src/`)

| File | Purpose |
|---|---|
| [types/index.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/types/index.ts) | All 15 domain entity types |
| [database/db.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/database/db.ts) | SQLite schema init |
| [database/seed.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/database/seed.ts) | Bangalore routes, stops, drivers, baselines |
| [events/EventBus.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/events/EventBus.ts) | In-memory pub/sub (Kafka-compatible API) |
| [algorithms/confidence.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/algorithms/confidence.ts) | §5.1 confidence decay |
| [algorithms/demandCalculator.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/algorithms/demandCalculator.ts) | §5.2 manifest+latent+scheduled |
| [algorithms/bunchingDetector.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/algorithms/bunchingDetector.ts) | §5.3 bunching check |
| [algorithms/rerouteChecks.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/algorithms/rerouteChecks.ts) | §5.5–§5.10 all pre-flight checks |
| [services/StateStore.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/services/StateStore.ts) | Singleton real-time state |
| [services/RerouteEngine.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/services/RerouteEngine.ts) | Core decision engine |
| [services/SimulatorService.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/services/SimulatorService.ts) | Hackathon demo scenario |
| [app.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/src/app.ts) | **DI container** — injection point |

### Dashboard (`dashboard/src/`)

| File | Purpose |
|---|---|
| [store/useStore.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/store/useStore.ts) | Zustand global state |
| [hooks/useWebSocket.ts](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/hooks/useWebSocket.ts) | Auto-reconnect WS hook |
| [index.css](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/index.css) | Full dark-mode design system |
| [components/Map/BusMap.tsx](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/components/Map/BusMap.tsx) | MapLibre GL live bus tracking |
| [components/Alerts/AlertQueue.tsx](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/components/Alerts/AlertQueue.tsx) | Tiered alert queue with approve/reject |
| [components/Fleet/FleetPanel.tsx](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/components/Fleet/FleetPanel.tsx) | Fleet occupancy panel |
| [components/Routes/RouteHealthPanel.tsx](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/components/Routes/RouteHealthPanel.tsx) | Route health overview |
| [App.tsx](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/dashboard/src/App.tsx) | Main dashboard layout |

---

## Quick Start

```bash
# Terminal 1 — Backend
cd backend
npm run seed   # Seeds the database (only needed once)
npm run dev    # Starts API + WebSocket

# Terminal 2 — Dashboard
cd dashboard
npm run dev    # Starts React dashboard at http://localhost:5173
```

---

## API Injection (Adding Real APIs)

| Service | File | Change |
|---|---|---|
| Routing | [backend/.env](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/.env) | `ROUTING_ADAPTER=mapbox` + `MAPBOX_TOKEN=...` |
| Notifications | [backend/.env](file:///c:/Users/aswin/OneDrive/Desktop/Zuup%20Hackathon%20Submission/backend/.env) | `NOTIFICATION_ADAPTER=firebase` + `FIREBASE_SERVER_KEY=...` |
| Map tiles | Add `VITE_MAP_STYLE=mapbox://...` to `dashboard/.env` | |

No service code changes required — swap is entirely environment-variable driven.

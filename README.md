# Zuup — Demand-Aware Bus Allocation Platform

A real-time transit management system that dynamically reallocates buses based on live passenger demand while guaranteeing every existing route remains protected.

## Quick Start

**Backend (Terminal 1):**
```bash
cd backend
npm install
npm run seed
npm run dev
```

**Dashboard (Terminal 2):**
```bash
cd dashboard
npm install
npm run dev
```

Then open `http://localhost:5173` for the Operator Dashboard.  
The simulator starts automatically — watch buses move and demand build in real time.

## Architecture

- **Backend**: Node.js + TypeScript + Express + WebSocket (port 4000)
- **Dashboard**: React 18 + TypeScript + MapLibre GL JS + Vite (port 5173)
- **Database**: SQLite (zero setup, auto-created on first run)
- **Event Bus**: In-memory Node.js EventEmitter (simulates Kafka)

## Injecting Real APIs

All external services are behind interfaces. To swap from mock to real:

| Service | Default (Mock) | Real Option | How to Switch |
|---|---|---|---|
| Routing/ETA | Haversine math | Mapbox/HERE API | Set `ROUTING_ADAPTER=mapbox` in `.env` + add `MAPBOX_TOKEN` |
| Notifications | console.log | Firebase FCM | Set `NOTIFICATION_ADAPTER=firebase` + add `FIREBASE_KEY` |
| Map Tiles | MapLibre demo tiles | Mapbox GL | Set `VITE_MAP_STYLE=mapbox://...` in dashboard `.env` |

Copy `backend/.env.example` to `backend/.env` to configure.

## Demo Scenario (Auto-plays)

1. System starts with **8 buses** on **3 routes** through Bangalore
2. After ~30s, a **demand surge** builds at Koramangala Junction (Route 1)
3. The **Reroute Engine** runs the full 5-step hierarchy and recommends reallocating **Bus KA-01-B-5678** from Route 2
4. A **Tier 2 alert** appears in the dashboard — click Approve to confirm
5. The bus reroutes and the demand is served

## Project Structure

```
├── backend/            Node.js + TypeScript API server
│   ├── src/
│   │   ├── algorithms/ Core business logic (pure functions)
│   │   ├── adapters/   Mock + real API adapters
│   │   ├── interfaces/ Service contracts (IRoutingService, etc.)
│   │   ├── services/   Backend services (Reroute Engine, Simulator, etc.)
│   │   ├── routes/     REST API endpoints
│   │   └── websocket/  Real-time streaming to dashboard
│   └── prisma/         SQLite schema
└── dashboard/          React operator dashboard
    └── src/
        ├── components/ Map, Alerts, Fleet, Routes panels
        ├── hooks/      WebSocket + data hooks
        └── store/      Zustand state management
```

# Slide 4: Tech Stack & Real-Time Scalability

ZUUP is engineered as a highly scalable, event-driven distributed system designed to handle the throughput of a massive modern city fleet.

## Frontend (The Operator Dashboard)
- **React + TypeScript:** For a robust, type-safe UI architecture.
- **MapLibre GL / Mapbox:** High-performance WebGL rendering. Capable of smoothly animating thousands of fleet vehicles, dynamic flow arrows, and real-time geographical dash-arrays at a locked 60 FPS.
- **De-Abstracted UI:** Designed for transparency. Hovering over stops exposes the literal mathematical equations the AI is using, building trust with human operators.

## Backend (The Intelligence Engine)
- **Node.js + Express:** Handles high-concurrency API requests.
- **WebSocket Synchronization:** Pushes continuous 60Hz coordinate updates and state changes to connected dashboards globally without polling.
- **In-Memory State Store / Redis:** The core algorithmic engine runs entirely in memory. It uses structural references rather than database lookups for routing decisions, resulting in sub-millisecond calculation times. Ready to map to a high-throughput Redis cluster in production.
- **Decoupled OSRM Geospatial Engine:** Physical road routing and snapping are handled by a dedicated OSRM instance, entirely decoupled from the internal business logic graph.
- **Event-Driven Architecture (Pub/Sub):** Components like the `CheckInLifecycleManager`, `Notification Engine`, and `RouteIntelligenceService` react asynchronously to a central EventBus (like Kafka), ensuring zero blocking during massive demand spikes.

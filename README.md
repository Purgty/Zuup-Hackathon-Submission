<div align="center">
  <h1>🚌 ZUUP</h1>
  <p><b>AI-Powered Demand-Responsive Transit & Dynamic Fleet Optimisation Platform</b></p>
  <p><i>Eliminating ghost buses, slashing wait times, and making public transit fluid.</i></p>
</div>

---

## 🚀 The Vision & Business Model

Public transit systems worldwide suffer from static, rigid scheduling. Buses run empty during off-peak hours on certain routes while passengers are left stranded on others due to sudden demand surges. **ZUUP** transforms traditional static bus fleets into dynamic, demand-responsive networks.

### The Business Case
- **B2G (Municipalities):** Drastically reduce "empty miles" to save fuel and cut emissions, while improving public perception and ridership of city transport.
- **B2B (Private Operators):** Optimise fleet utility, ensuring vehicles are always deployed where demand density yields the highest revenue.
- **Cost Reduction:** Automates the role of physical dispatchers with a real-time AI decision engine.

---

## 🧠 Core Algorithms & The Reroute Engine

At the heart of ZUUP is the **Route Intelligence Service** and the **Reroute Engine**, operating continuously to balance supply and demand.

### 1. Unified Demand Aggregation
The system does not just count people on a bus. It calculates **Total Demand** per stop using:
`Scheduled Baseline + Live QR Check-ins + Latent Prediction Algorithms`.

### 2. The 4-Step Reroute Hierarchy
When a surge is detected (Demand > Capacity), the engine evaluates solutions in order of least disruption:
1. **Holding / Headway Adjustment:** Delaying a preceding bus to absorb the trailing crowd.
2. **Skip-Stop Express:** Instructing a full bus to skip stops to quickly cycle back to the surge.
3. **Short-Turn:** Instructing a bus near the terminus (with 0 drop-offs) to instantly U-turn and become an inbound express.
4. **Express Overlay (Nearest-Terminus Algorithm):** Dispatching a reserve bus. The engine calculates the fractional distance (Travel Cost) of the surge stop and deploys the Reserve Bus from the *closest geographical terminus* (Start or End), rather than blindly sending buses from the depot.

### 3. Service Guarantee Constraints
Before any bus is borrowed from a route, the algorithm runs a mathematical constraint check. It ensures that removing the bus will not violate the `maxWaitMinutes` or `lastBusProtection` threshold for the route it is leaving.

---

## 🛡️ Handling Real-World Chaos (Edge Cases)

Real-world transit is messy. ZUUP is built with extreme edge cases in mind, specifically addressing the following scenarios:

### Edge Case 1: The "Phantom" Check-In (QR Abandonment)
**The Problem:** A passenger scans the QR code at the bus stop, but then changes their mind, takes a cab, or walks away. How does the system avoid dispatching a bus for ghosts?
**The Solution:** The `CheckInLifecycleManager`. 
- **Time-to-Live (TTL):** Check-ins organically decay over time.
- **Bus Correlation Sweeps:** When a bus passes a stop, the system checks if the passenger boarded. If 2 consecutive buses pass the stop and the passenger has not scanned their boarding ticket, the system marks the check-in as `ABANDONED` and immediately subtracts that phantom demand from the Route Intelligence calculations.

### Edge Case 2: Evaporating Demand (Mid-Reroute Cancellations)
**The Problem:** A reserve bus is deployed to handle a surge of 80 people. But while the bus is en route, 60 of those people squeeze into an existing bus, or rain starts and they leave. Does the reserve bus uselessly complete its journey?
**The Solution:** Continuous Evaluation. 
- Reroute orders are **not** fire-and-forget. The `RouteIntelligenceService` evaluates active reroutes every 30 seconds.
- If the live demand at the target stop drops below the capacity threshold while the reserve bus is still driving, the engine triggers a `RETURN_TO_ROUTE` override, instantly sending the bus back to the depot or its home terminus.

### Edge Case 3: The Orphaned Passengers (Cross-Route Chaos)
**The Problem:** Route A and Route B intersect. A bus on Route A completes its drop-offs and is dynamically rerouted by the AI to help Route B. But 5 minutes later, a different bus arrives at the intersection and drops off transferring passengers who *need* Route A. Because Route A's bus was stolen, these passengers are now stranded.
**The Solution:** Strict Service Guarantee Enforcements.
- The system prevents this chaos *before* it happens. When evaluating taking a bus from Route A to help Route B, the algorithm simulates the future state of Route A.
- If stealing the bus causes the remaining stops on Route A to violate their `minBusesInService` or `maxWaitMinutes` thresholds (meaning newly dropped-off passengers would be stranded), the AI **rejects** the cross-route allocation. 
- Instead, the system cascades to a Tier 1 Alert and deploys a dedicated Reserve fleet, ensuring core routes are never cannibalised to the point of stranding transferring passengers.

---

## 🏗️ Architecture & Real-Time Scalability

ZUUP is designed as a modern, event-driven distributed system.

- **Frontend Dashboard:** React + TypeScript + MapLibre GL. High-performance WebGL rendering capable of animating thousands of fleet vehicles seamlessly at 60 FPS.
- **Backend Services:** Node.js + Express + WebSocket. 
- **In-Memory State Store:** The core routing engine operates entirely in memory using standard structural references, ensuring sub-millisecond algorithmic calculations. In production, this maps directly to a high-throughput Redis instance.
- **Decoupled Geospatial Engine:** Integrates cleanly with Mapbox/OSRM for underlying physical road routing, completely decoupled from the internal logical graph.
- **Pub/Sub Event Bus:** All state changes (GPS ticks, Check-ins, Reroute orders) are published via an internal EventBus, allowing independent microservices (Notification Engine, Lifecycle Manager, Intelligence Service) to react asynchronously. 

---

## 💻 The Operator Dashboard

The central command centre for municipal transit admins. 
- **De-Abstracted AI:** Transit operators don't want black boxes. The dashboard explicitly exposes the math. Hovering over a stop reveals the exact formula (`Base + Surge = Total Demand`), and deploying a bus draws the explicit `Travel Cost` calculation under the vehicle.
- **Automated Alerts:** A 3-Tier alert system auto-categorises issues from minor delays (Tier 3) to system overloads requiring human override (Tier 1).
- **Interactive Scenarios:** Built-in demo simulation buttons to instantly inject crowd surges at specific nodes to watch the AI's real-time physical response.

<br/>
<div align="center">
  <i>Built for the Future of Fluid Cities.</i>
</div>

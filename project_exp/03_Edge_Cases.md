# Slide 3: Resilience & Handling "Real World Chaos"

Real-world transit is messy. ZUUP is built with advanced edge-case handling to ensure the AI doesn't break down when human unpredictability strikes.

## 1. The "Phantom" Check-In (QR Abandonment)
**Scenario:** A passenger scans the QR check-in but then takes a cab or walks away.
**Solution:** The `CheckInLifecycleManager` uses a Time-to-Live (TTL) decay and bus correlation sweeps. If two buses pass the stop and the passenger hasn't boarded, the system marks the check-in as `ABANDONED` and immediately subtracts the "ghost" demand from the AI engine.

## 2. Evaporating Demand (Mid-Reroute Cancellations)
**Scenario:** A reserve bus is deployed for a massive crowd, but the crowd dissipates (e.g. people walk) before the bus arrives. 
**Solution:** Continuous Evaluation. Reroutes are not "fire-and-forget". The engine re-evaluates active reroutes every 30 seconds. If demand falls below capacity, the system triggers a `RETURN_TO_ROUTE` override, instantly recalling the bus to the depot to save fuel.

## 3. The Orphaned Passengers (Cross-Route Chaos)
**Scenario:** Bus A is rerouted to help Route B. But a connecting bus drops off new passengers at Route A's remaining stops. Because Bus A was stolen, these new passengers are stranded.
**Solution:** Solved directly by the **Service Guarantee Constraints**. The engine simulates the drop-offs. If stealing Bus A strands new passengers, the cross-route allocation is completely rejected, and a dedicated Reserve Fleet bus is deployed to Route B instead. Core routes are never cannibalised.

## 4. Complete Reserve Fleet Exhaustion (The "Doomsday" Scenario)
**Scenario:** A massive event occurs and absolutely all reserve buses across the entire system are already deployed or broken down. 
**Solution:** The system gracefully bypasses the standard Reserve Overlay tier and falls back to **Cross-Route Reallocation**. The AI scans every single active service bus in the city, ranks them based on current occupancy, ETA to the surge, and the impact of stealing them, and automatically re-routes the optimal, least-crowded service bus from a quiet route to save the surging route.

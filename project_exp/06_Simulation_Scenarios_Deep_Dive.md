# ZUUP Simulation Scenarios: Deep-Dive Analysis

This document provides a highly technical, research-grade analysis of the ZUUP autonomous routing algorithm's behaviour during various edge cases. It breaks down the mathematical decision-making framework utilised by the engine during live demo scenarios.

---

## 1. Surge at Route End (The Fractional Cost Optimisation)
**Scenario Triggered:** 40 passengers injected at **Dairy Circle** (The final stop on Route 1).

### Algorithmic Breakdown:
When a surge is detected, naive public transit systems dispatch a reserve bus from a central depot. ZUUP, however, employs a **Geographic Fractional Distance Algorithm** (`findClosestReserveForSurge`).

1. **Fraction Calculation:** The engine maps the surge stop's index over the total route length. 
   - MG Road (Start) = Fraction `0.0`
   - Dairy Circle (End) = Fraction `1.0`
2. **The Cost Function:** The engine calculates the **Travel Cost** (wasted distance an empty bus must drive to reach the crowd) from all available terminuses. 
   - `Cost from Start Terminus` = $|1.0 - 0.0| = 1.0$
   - `Cost from End Terminus` = $|1.0 - 1.0| = 0.0$
3. **Decision & Action:** The algorithm mathematically proves that deploying from the end of the route is vastly superior. It activates reserve bus **KA-01-A-RSV-B** stationed at the End Terminus (Dairy Circle) with a perfect Travel Cost of `0.00`. The bus drops into the active route directly at the point of failure.

---

## 2. Surge at Route Start
**Scenario Triggered:** 40 passengers injected at **MG Road** (The first stop on Route 1).

### Algorithmic Breakdown:
Following the same Cost Function logic, the engine computes the optimal deployment vector for a surge at the absolute beginning of the route.

1. **Fraction Calculation:** MG Road is index 0.
   - Fraction = `0.0`
2. **The Cost Function:** 
   - `Cost from Start Terminus` = $|0.0 - 0.0| = 0.0$
   - `Cost from End Terminus` = $|0.0 - 1.0| = 1.0$
3. **Decision & Action:** The algorithm activates reserve bus **KA-01-A-RSV-A** stationed at the Start Terminus. The UI will explicitly render the badge `Cost: 0.00` underneath the bus, proving to operators that the AI is making the most geographically efficient decision possible.

---

## 3. The Overwhelming Surge (Tiered Reserve Exhaustion)
**Scenario Triggered:** 80 passengers injected at Dairy Circle. 8 seconds later, another 60 passengers arrive.

### Algorithmic Breakdown:
This scenario tests the engine's ability to handle sustained, cascading failure events where a single reserve bus is insufficient.

1. **First Wave (80 pax):** The engine triggers `Step 4: Express Overlay`. It calculates the Travel Cost, selects the End Terminus reserve (**KA-01-A-RSV-B**), and deploys it.
2. **Second Wave (60 pax):** 8 seconds later, the system detects that the demand *still* vastly exceeds the capacity of the active buses + the newly deployed reserve. 
3. **Exhaustion Fallback:** The engine searches for another reserve at the End Terminus but finds none. It calculates the Travel Cost for the Start Terminus reserve (**KA-01-A-RSV-A**). Even though the Travel Cost is `1.0`, it is the only remaining route-matched reserve, so it is deployed. 
4. **Result:** Both reserves are injected into the system in a staggered formation, preventing a catastrophic localized collapse.

---

## 4. Reserves Broken / Cross-Route Steal (The "Doomsday" Edge Case)
**Scenario Triggered:** Every reserve bus in the city breaks down. A massive 90-passenger surge hits MG Road on Route 1.

### Algorithmic Breakdown:
This is the most complex edge case in the system. When `Step 4: Express Overlay` fails entirely (returning `null`), the engine escalates to `Step 5: Cross-Route Reallocation`. It must steal an active service bus from Route 2 or Route 3 to save Route 1, without destroying the other routes in the process.

**The 5-Stage Validation Pipeline:**
Before a bus is stolen, the AI scans every `IN_SERVICE` bus in the city and runs them through strict mathematical constraints:
1. **Service Protection Check:** "If I steal this bus from Route 2, will Route 2 drop below its minimum guaranteed frequency of 15 minutes?" If yes, reject.
2. **Latent Cascade Check:** "Are there crowds waiting down the line on Route 2 that this bus was supposed to pick up?" If yes, reject.
3. **Orphaned Passenger Constraint:** "Are there passengers currently sitting on this bus who will be stranded if I divert it to Route 1?" The system simulates the drop-offs. If passengers are stranded, reject.
4. **Driver Shift Constraint:** "Does the driver have enough time left in their shift to complete this detour?" If no, reject.

**The Confidence Scoring Engine:**
All buses that survive the constraints are scored:
$$Score = CurrentDemand \times ETA\_Confidence \times \left(\frac{1}{OccupancyPct + 0.1}\right)$$
- *ETA Confidence:* Inversely proportional to travel time. A bus 2 minutes away scores much higher than a bus 15 minutes away.
- *Occupancy:* Emptier buses score exponentially higher, as they provide more relief capacity.

**Decision & Action:** The highest-scoring bus is issued a `REROUTE_RECOMMENDED` order. Once approved by the operator, the bus physically alters its trajectory, abandons its old route, and provides immediate relief to the overwhelming surge on Route 1.

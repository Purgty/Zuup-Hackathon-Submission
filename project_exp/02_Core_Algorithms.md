# Slide 2: Core Algorithms & The AI Engine

At the heart of ZUUP is the **Route Intelligence Service**, powered by a suite of algorithms designed to balance supply and demand without stranding passengers.

## 1. Unified Demand Aggregation
The algorithm doesn't just guess demand. It calculates a precise `Total Demand` metric:
**Formula:** `Scheduled Baseline Demand + Live QR Check-ins + Latent Predictions = Total Demand`

## 2. The 4-Step Reroute Hierarchy
When a surge outpaces capacity, the engine doesn't just blindly send a bus. It evaluates interventions from least to most disruptive:
1. **Holding (Headway Adjustment):** Delay a preceding bus to absorb the upcoming crowd.
2. **Skip-Stop Express:** A full bus skips non-essential stops to quickly cycle back to the surge.
3. **Short-Turn:** A bus near the terminus (empty) U-turns instantly to become an inbound express.
4. **Express Overlay (Reserve Deployment):** Dispatching a dedicated reserve bus from the depot.

## 3. Nearest-Terminus Travel Cost Algorithm
If Step 4 (Reserve Deployment) is triggered, the engine calculates the geographical "fractional distance" of the surge stop. It then mathematically selects the reserve bus physically located at the closest terminus (Start or End) rather than arbitrarily dispatching from a central depot.

## 4. Strict Service Guarantees
Before "stealing" a bus from one route to help another, the system runs a constraint check. It simulates the future state of the original route. If stealing the bus causes the remaining stops to violate `maxWaitMinutes` or `minBusesInService` thresholds, the system rejects the theft and deploys a reserve bus instead.

# Demand-Aware Bus Allocation Platform
# Final Implementation Architecture

**Document Status**: Complete Specification  
**Scope**: Full production system — all components, logic, edge cases, failure modes, and build phases

---

## Table of Contents

1. System Purpose & Design Philosophy
2. Core Design Principles
3. System Components (What Gets Built)
4. Complete Data Architecture
5. Business Logic & Algorithms
6. Response Hierarchy & Decision Flow
7. Complete Edge Case & Failure Mode Catalog
8. System Architecture & Infrastructure
9. Technology Stack
10. Phased Build Roadmap
11. System Invariants (Rules That Cannot Be Broken)

---

## 1. System Purpose & Design Philosophy

### What This Is

A demand-aware bus allocation platform that helps public transport operators make real-time decisions about where their buses should be. It does not replace the existing fixed-route network. It makes the existing fleet more responsive to where demand actually is, while guaranteeing that every passenger — including those on low-demand routes — always has a reliable service option.

### What It Is Not

It is not an on-demand transport system. Routes remain fixed and predictable. The system only changes which buses are running on which routes at which times. A passenger who knows Route 12 goes from their home to the city center can still rely on that fact. The system changes how many buses are on Route 12 at a given time, not what Route 12 is.

### The Core Trade-off It Manages

Every reallocation involves a trade-off: helping overcrowded routes always has a cost somewhere else. The system's job is to find reallocations where the benefit of helping the overcrowded route is larger than the cost to the route giving up a bus — and to refuse any reallocation where that is not the case, no matter how crowded the target route is.

### Who Uses It

- **Transport operators**: City bus corporations, private operators under public-service contracts, campus and campus shuttle systems, airport shuttle operators
- **Control room operators**: The humans who approve, reject, or override recommendations
- **Drivers**: Receive and confirm routing instructions
- **Passengers**: Check in at stops, receive notifications, provide demand signals

---

## 2. Core Design Principles

These principles govern every design decision in the system. When two requirements conflict, these principles are the tie-breaker.

**P1 — Serve the passenger already waiting before the one who might arrive.**
A bird in hand. Latent demand is considered, but manifest demand takes priority.

**P2 — Do not move a bus until you have accounted for every passenger on it and every passenger who will need it next.**
Before any reallocation, the system checks both current onboard passengers and future stop demand. Rerouting is not valid if it abandons people already riding.

**P3 — Human operators decide. The system recommends.**
No reroute is executed without either a driver confirmation or an operator override. The system does not command vehicles; it advises humans who command vehicles. Exceptions: low-risk holds and spacing adjustments may be automated if the operator has enabled that mode.

**P4 — Use the least disruptive intervention that solves the problem.**
Try headway spacing before short-service. Try short-service before cross-route reallocation. Escalate only when lower-cost options are exhausted.

**P5 — Demand at ETA, not demand at recommendation time, drives decisions.**
By the time a bus arrives somewhere, conditions will have changed. Every recommendation is based on forecasted demand at the time of arrival, not current demand.

**P6 — Every low-demand passenger is still a passenger.**
Minimum service guarantees are hard limits, not guidelines. A route cannot be stripped of its last bus regardless of how many people are waiting elsewhere.

**P7 — Fail safely.**
When the system cannot make a confident decision, it does nothing and alerts the operator. The default state — buses running their scheduled routes — is always safe.

**P8 — Log everything for learning.**
Every recommendation, confirmation, rejection, and outcome is recorded. The system improves over time from this data.

---

## 3. System Components (What Gets Built)

### 3.1 Backend Services

**Demand Ingestion Service**
Receives check-in events from all input channels: QR kiosks, passenger app, driver headcount reports, and manual operator entry. Validates each check-in (route-stop mismatch rejection, rate limiting, anomaly detection). Creates and updates PassengerCheckIn records. Publishes demand.updated events to the event bus.

**Check-in Lifecycle Manager**
Runs continuously. Applies confidence decay to all active check-ins based on elapsed time, bus arrivals at the stop, and GPS signals. Transitions check-ins through state machine states. Publishes state change events. Separates satisfied demand (boarded) from lost demand (abandoned without boarding) for accurate reporting.

**Vehicle Tracking Service**
Ingests GPS position updates from all buses every 10–30 seconds. Computes current stop, next stop, ETA to all future stops on current route, and occupancy percentage. Flags stale GPS (last update > 3 minutes) and removes stale buses from reroute candidate pools. Detects bunching (two buses on the same route within a configurable gap threshold). Tracks on-board passenger manifests.

**Route Intelligence Service**
Owns the demand calculation for every stop-route pair. Combines manifest demand (weighted check-ins), latent demand (incoming transfer passengers), and scheduled demand (historical baseline adjusted for calendar type). Produces StopDemandSnapshots every 30 seconds. Identifies overloaded stops (demand exceeds capacity threshold) and underloaded routes (buses running well below capacity). Triggers reroute consideration events.

**Latent Demand Tracker**
Monitors all buses currently in service. When a passenger checks in on Bus C and declares a destination on Route A, a LatentDemandRecord is created for the relevant Route A stop. Tracks ETAs of source vehicles to target stops. Escalates latent demand urgency as source vehicle approaches. Auto-expires records when ETA window passes and logs whether the latent demand materialised.

**Reroute Engine**
The core decision service. Receives overload triggers from Route Intelligence. Runs a full decision pipeline for each candidate reroute: response hierarchy check, cascade check, service protection check, on-board passenger check, vehicle capability check, driver shift check, ETA demand forecast, commit window configuration. Produces RerouteOrder records. Manages soft-commit and commit transitions. Provides reversal functionality. Coordinates short-service dispatch as an alternative to full reallocation.

**Headway Manager**
Monitors route headways (gaps between buses) independently of demand. When bunching is detected, recommends hold or spacing actions before the Reroute Engine is engaged. Runs skip-stop or short-turn recommendations for schedule recovery. This service is always evaluated first before cross-route reallocation is considered.

**Event Schedule Service**
Stores known upcoming events (sports matches, concerts, festivals, school calendar, public holidays) with their expected demand impact, affected stops, and timing. Feeds calendar-adjusted demand baselines to Route Intelligence. Triggers pre-surge preparation protocols 90 minutes before large events end. Flags last-bus-of-service windows for all routes.

**Notification Service**
Handles all outbound communication: driver app push notifications (reroute instructions), passenger app updates (expected wait times, service disruption alerts, alternative routes), operator dashboard alerts (tiered by severity). Manages delivery confirmation and retry.

**Audit and Learning Service**
Records every reroute recommendation, its rationale snapshot (what the data looked like at the time), the outcome, and the delta between predicted demand and actual demand at arrival. Feeds this data back to calibrate the demand decay model and ETA forecasting model over time. Produces daily performance reports.

**Data Governance Service**
Handles all privacy-compliance operations: anonymisation of passenger records after trip completion, enforcement of data retention policies, consent record management, audit trail for any data access, and breach detection alerting. Required for DPDPA compliance and equivalent regulations in other markets.

### 3.2 Operator-Facing Applications

**Control Room Dashboard**
A browser-based real-time map and alert console for transport operators. Shows live bus positions, stop-level demand heatmap, current reroute orders and their statuses, alert queue with tiered severity, and full route health overview. Allows operators to approve, reject, override, or manually create any operational action. Includes one-click reroute reversal.

### 3.3 Driver-Facing Applications

**Driver App**
Mobile application (iOS and Android, with Progressive Web App fallback). Displays current route, next stop, onboard passenger count, any active reroute instructions, and shift information. Allows driver to confirm or reject reroute recommendations within the confirmation window. Shows post-reroute context to drivers who take over mid-shift.

### 3.4 Passenger-Facing Interfaces

**Stop QR Kiosk Interface**
A lightweight web page rendered on a kiosk or a scannable QR code that opens in the passenger's phone browser. Allows passengers to declare their intended route, optionally their destination stop, and group size. No app installation required. Works on basic smartphones.

**Passenger App** (Phase 4)
Native iOS and Android app for regular users. Provides check-in, real-time bus ETAs, route demand levels, service disruption notifications, and transfer information. Provides the GPS signal used for abandonment detection.

### 3.5 Infrastructure Services

**API Gateway**: Authentication, rate limiting, WebSocket connection management for real-time dashboard updates, routing of all external requests.

**Event Bus**: Asynchronous messaging backbone. All services communicate through events rather than direct calls, enabling independent scaling and graceful failure isolation.

**Simulation Engine** (for testing and demos): A configurable bus and passenger simulator that can recreate any operational scenario including bunching, breakdowns, surge events, and cascade failures. Used for pre-deployment validation and live demonstrations.

---

## 4. Complete Data Architecture

### 4.1 PassengerCheckIn

```
PassengerCheckIn {
  id                    UUID            primary key
  device_id             STRING          hashed device identifier (never raw)
  stop_id               FK → BusStop
  route_id              FK → BusRoute   declared intended route
  destination_stop_id   FK → BusStop    optional declared destination
  group_size            INT             1–10, defaults to 1
  group_confirmed_count INT             how many of group actually boarded
  state                 ENUM {
                          ACTIVE,
                          PENDING,      bus arriving within 3 min
                          BOARDING,     bus at stop, door open
                          BOARDED,      confirmed door scan
                          ABANDONED,    left without boarding system bus
                          EXPIRED,      time limit elapsed
                          SERVED        journey complete
                        }
  abandon_reason        ENUM {
                          GPS_DRIFT,
                          EXPLICIT_CANCEL,
                          BUS_MISSED_TWICE,
                          TIME_EXPIRED,
                          ROUTE_INVALID
                        } NULLABLE
  confidence_score      FLOAT           0.0–1.0, decays over time
  demand_weight         FLOAT           computed: confidence × group_size
  satisfaction_type     ENUM {
                          BOARDED_INTENDED,   boarded their declared route
                          BOARDED_ALTERNATIVE, boarded a different route
                          LOST_DEMAND         left via non-system transport
                        } NULLABLE      populated on resolution
  checked_in_at         TIMESTAMP
  state_changed_at      TIMESTAMP
  bus_boarded_id        FK → BusVehicle NULLABLE
  created_at            TIMESTAMP
}
```

### 4.2 BusVehicle

```
BusVehicle {
  id                    UUID
  registration_no       STRING
  fleet_agency_id       FK → Agency     which operator owns this bus
  vehicle_type          ENUM {
                          STANDARD,
                          MINI,
                          ARTICULATED,
                          LOW_FLOOR,
                          ELECTRIC,
                          MIDI
                        }
  capacity_seated       INT
  capacity_standing     INT
  total_capacity        INT             seated + standing
  has_low_floor_access  BOOLEAN         ramp for wheelchair/mobility aid
  is_electric           BOOLEAN
  depot_id              FK → BusDepot  used for range constraint on electrics
  current_route_id      FK → BusRoute  NULLABLE (null if in depot or reserve)
  current_stop_id       FK → BusStop   NULLABLE
  next_stop_id          FK → BusStop   NULLABLE
  occupancy_count       INT             current onboard passengers
  occupancy_pct         FLOAT           computed
  status                ENUM {
                          IN_SERVICE,
                          REROUTING,
                          SHORT_SERVICE,
                          RESERVE,
                          DEPOT,
                          BREAKDOWN,
                          SHIFT_CHANGE
                        }
  active_reroute_id     FK → RerouteOrder NULLABLE
  current_driver_id     FK → Driver
  shift_end_time        TIMESTAMP       driver's scheduled shift end
  last_gps_lat          FLOAT
  last_gps_lng          FLOAT
  last_gps_update       TIMESTAMP
  gps_stale             BOOLEAN         computed: last_gps_update > 3 min ago
  onboard_manifest      JSON            { destination_stop_id: count }
                                        updated at each stop
  created_at            TIMESTAMP
}
```

### 4.3 BusRoute

```
BusRoute {
  id                    UUID
  agency_id             FK → Agency
  name                  STRING
  short_code            STRING
  stops                 ORDERED FK → BusStop[]
  direction             ENUM { OUTBOUND, INBOUND, CIRCULAR }
  scheduled_frequency   INT             minutes between buses
  route_type            ENUM {
                          HIGH_FREQ,    every <10 min
                          MEDIUM_FREQ,  10–30 min
                          LOW_FREQ,     30–90 min
                          FEEDER,       connects to trunk route
                          LAST_MILE
                        }
  operating_schedule    JSON {
                          weekday:  { start, end },
                          saturday: { start, end },
                          sunday:   { start, end },
                          holiday:  { start, end }
                        }
  service_guarantee {
    max_wait_minutes          INT       no stop should wait more than this
    min_buses_in_service      INT       never drop below this count
    last_bus_protection_min   INT       minutes before last service;
                                        buses protected during this window
  }
  terminus_dwell_minutes  INT           scheduled hold at end of route
  intersecting_routes     FK → RouteIntersection[]
  compatible_vehicle_types ENUM[]       which vehicle types can serve this route
  requires_low_floor       BOOLEAN
  created_at              TIMESTAMP
}
```

### 4.4 BusStop

```
BusStop {
  id                    UUID
  name                  STRING
  lat                   FLOAT
  lng                   FLOAT
  geofence_radius_m     INT             default 100, configurable
  routes_serving        FK → BusRoute[]
  stop_cluster_id       FK → StopCluster NULLABLE
                                        for stops within 200m on same route
  requires_low_floor    BOOLEAN
  is_terminus           BOOLEAN
  terminus_route_ids    FK → BusRoute[] routes that terminate here
  is_active             BOOLEAN
  created_at            TIMESTAMP
}
```

### 4.5 StopCluster

```
StopCluster {
  id                    UUID
  name                  STRING
  stops                 FK → BusStop[]  stops within 200m serving same route
  route_id              FK → BusRoute
  centroid_lat          FLOAT
  centroid_lng          FLOAT
}
```
A check-in at any stop in a cluster is treated as demand for the cluster. Boarding at any stop in the cluster resolves the check-in.

### 4.6 LatentDemandRecord

```
LatentDemandRecord {
  id                    UUID
  target_stop_id        FK → BusStop
  target_route_id       FK → BusRoute
  passenger_count       INT
  arrival_eta_earliest  TIMESTAMP
  arrival_eta_latest    TIMESTAMP
  confidence            FLOAT
  source_type           ENUM {
                          CONFIRMED_CHECKIN,    passenger declared destination
                          HISTORICAL_PATTERN,   intersection transfer average
                          EVENT_SCHEDULE,       known event releasing passengers
                          MANUAL_OPERATOR       human operator entered it
                        }
  source_vehicle_id     FK → BusVehicle NULLABLE
  source_route_id       FK → BusRoute NULLABLE
  created_at            TIMESTAMP
  expires_at            TIMESTAMP
  resolved              BOOLEAN
  resolution_type       ENUM {
                          ARRIVED,      passengers showed up as expected
                          PARTIAL,      some arrived
                          NO_SHOW       demand did not materialise
                        } NULLABLE
  actual_count          INT NULLABLE    logged on resolution
}
```

### 4.7 RerouteOrder

```
RerouteOrder {
  id                    UUID
  bus_id                FK → BusVehicle
  agency_id             FK → Agency
  from_route_id         FK → BusRoute
  to_route_id           FK → BusRoute
  handoff_stop_id       FK → BusStop   last stop served on from_route
  join_stop_id          FK → BusStop   first stop served on to_route
  is_partial            BOOLEAN        bus serves remaining from_route stops first
  partial_handoff_stop  FK → BusStop   NULLABLE
  reroute_type          ENUM {
                          FULL_REROUTE,
                          SHORT_SERVICE,
                          EXPRESS_OVERLAY,
                          RETURN_TO_ROUTE    reversal of a prior reroute
                        }
  reason_summary        STRING
  status                ENUM {
                          RECOMMENDED,
                          PENDING_DRIVER,
                          SOFT_COMMITTED,
                          COMMITTED,
                          COMPLETED,
                          CANCELLED,
                          REJECTED,
                          REVERSED
                        }
  onboard_count_at_reroute   INT       how many passengers were on bus when issued
  onboard_impact_assessment  JSON {    populated by cascade check
                               affected_passengers: INT,
                               resolution: STRING,
                               alternate_service: STRING NULLABLE
                             }
  demand_at_recommendation   FLOAT
  demand_predicted_at_eta    FLOAT
  demand_actual_at_arrival   FLOAT NULLABLE
  commit_deadline            TIMESTAMP soft → committed transition
  reversal_deadline          TIMESTAMP after this, reversal is too disruptive
  cascade_check_passed       BOOLEAN
  service_protection_passed  BOOLEAN
  onboard_check_passed       BOOLEAN
  vehicle_capability_passed  BOOLEAN
  driver_shift_check_passed  BOOLEAN
  issued_at                  TIMESTAMP
  driver_notified_at         TIMESTAMP NULLABLE
  driver_confirmed_at        TIMESTAMP NULLABLE
  driver_rejected_at         TIMESTAMP NULLABLE
  operator_approved_by       FK → Operator NULLABLE
  cancelled_reason           STRING NULLABLE
  parent_reroute_id          FK → RerouteOrder NULLABLE  for cascade chains
  chain_depth                INT         0 = original, 1 = consequence, etc.
  created_at                 TIMESTAMP
}
```

### 4.8 RouteIntersection

```
RouteIntersection {
  id                    UUID
  stop_id               FK → BusStop
  route_a_id            FK → BusRoute
  route_b_id            FK → BusRoute
  avg_transfer_volume   JSON { hour_of_day: avg_count }
  dominant_direction    ENUM { A_TO_B, B_TO_A, BIDIRECTIONAL }
  last_recalculated     TIMESTAMP
}
```

### 4.9 StopDemandSnapshot

```
StopDemandSnapshot {
  stop_id               FK → BusStop
  route_id              FK → BusRoute
  snapshot_time         TIMESTAMP
  manifest_demand       FLOAT       weighted sum of active check-ins
  latent_demand         FLOAT       expected incoming passengers within window
  scheduled_demand      FLOAT       historical baseline for this time/day-type
  total_demand          FLOAT       sum of all three
  next_bus_eta_min      INT         minutes to next scheduled bus
  available_capacity    INT         space on next expected bus
  demand_to_capacity_ratio FLOAT
  overload_flag         BOOLEAN
  underload_flag        BOOLEAN
  bunching_flag         BOOLEAN     two buses on this route are closely grouped
  data_confidence       FLOAT       how fresh and reliable the inputs are
}
```

### 4.10 HistoricalDemandBaseline

```
HistoricalDemandBaseline {
  stop_id               FK → BusStop
  route_id              FK → BusRoute
  day_type              ENUM {
                          WEEKDAY,
                          SATURDAY,
                          SUNDAY,
                          PUBLIC_HOLIDAY,
                          SCHOOL_HOLIDAY,
                          EVENT_DAY,
                          FESTIVAL_DAY,
                          MONSOON_WEEKDAY   separate pattern for monsoon season
                        }
  hour_of_day           INT         0–23
  avg_demand            FLOAT
  p75_demand            FLOAT       75th percentile (surge planning)
  p95_demand            FLOAT       95th percentile (worst case planning)
  last_updated          TIMESTAMP
}
```

### 4.11 Driver & Shift Records

```
Driver {
  id                    UUID
  agency_id             FK → Agency
  name                  STRING
  license_no            STRING
  current_vehicle_id    FK → BusVehicle NULLABLE
  shift_start           TIMESTAMP
  shift_end             TIMESTAMP
  reroute_rejections_today INT       reset at midnight
  is_available          BOOLEAN
}

ShiftHandoff {
  id                    UUID
  vehicle_id            FK → BusVehicle
  outgoing_driver_id    FK → Driver
  incoming_driver_id    FK → Driver
  handoff_time          TIMESTAMP
  active_reroute_id     FK → RerouteOrder NULLABLE
  handoff_briefing      JSON {        generated by system for incoming driver
                           current_route: STRING,
                           deviation_from_schedule: STRING,
                           active_reroute_context: STRING,
                           next_action: STRING,
                           onboard_count: INT
                         }
  incoming_driver_acknowledged BOOLEAN
}
```

### 4.12 Event & Calendar Records

```
ScheduledEvent {
  id                    UUID
  name                  STRING
  venue_stop_ids        FK → BusStop[]
  start_time            TIMESTAMP
  end_time              TIMESTAMP
  expected_attendance   INT
  demand_multiplier     FLOAT         applied to affected stops during event
  pre_surge_window_min  INT           how early to enter pre-surge mode
  affected_route_ids    FK → BusRoute[]
  reserve_buses_needed  INT           pre-computed recommendation
  status                ENUM { UPCOMING, ACTIVE, SURGE_MODE, COMPLETED }
}

CalendarConfig {
  date                  DATE          specific date
  day_type              ENUM          override for this specific date
  notes                 STRING
}
```

### 4.13 Agency & Tenancy

```
Agency {
  id                    UUID
  name                  STRING
  city                  STRING
  cross_agency_sharing  BOOLEAN       if true, can share fleet with other agencies
  data_sharing_partners FK → Agency[] other agencies this one shares stop data with
  created_at            TIMESTAMP
}
```

### 4.14 AuditLog

```
AuditLog {
  id                    UUID
  event_type            STRING        free-form event name
  entity_type           STRING        which model is affected
  entity_id             UUID
  performed_by_type     ENUM { SYSTEM, OPERATOR, DRIVER }
  performed_by_id       UUID NULLABLE
  data_snapshot         JSONB         state of the entity at the time
  outcome               STRING NULLABLE
  created_at            TIMESTAMP
}
```

### 4.15 RoadSegmentStatus

```
RoadSegmentStatus {
  id                    UUID
  segment_name          STRING
  lat_start, lng_start  FLOAT
  lat_end,   lng_end    FLOAT
  affected_route_ids    FK → BusRoute[]
  disruption_type       ENUM {
                          FLOODED,
                          VIP_CONVOY,
                          MAINTENANCE,
                          ACCIDENT,
                          PROTEST,
                          UNKNOWN
                        }
  is_blocked            BOOLEAN
  reported_at           TIMESTAMP
  expected_clear_time   TIMESTAMP NULLABLE
  reported_by           ENUM { OPERATOR, DRIVER, SYSTEM, EXTERNAL_FEED }
}
```

---

## 5. Business Logic & Algorithms

### 5.1 Check-in Confidence Decay

Run every 60 seconds on all ACTIVE check-ins.

```
confidence(check_in) =
  base (1.0)
  × time_factor(minutes_since_checkin)
  × miss_factor(buses_missed_at_this_stop_for_this_route)
  × gps_factor(phone_position)
  × history_factor(abandonment_rate_for_this_device)

time_factor(m):
  m < 10  → 1.00
  m < 20  → 0.90
  m < 30  → 0.70
  m < 45  → 0.50
  m ≥ 45  → 0.25

miss_factor(n):
  n = 0 → 1.00
  n = 1 → 0.60
  n ≥ 2 → 0.15

gps_factor:
  in geofence        → 1.00
  outside > 150m     → 0.05   (trigger ABANDONED transition)
  GPS unavailable    → 0.85   (neutral penalty; cannot confirm)

history_factor:
  device has < 10% historical abandonment rate → 1.00
  device has 10–40% historical abandonment     → 0.85
  device has > 40% historical abandonment      → 0.65
  (prevents serial false check-ins from inflating demand)

demand_weight = confidence × group_confirmed_pending
  where group_confirmed_pending = group_size - group_confirmed_boarded
```

### 5.2 Total Stop Demand

```
TotalDemand(stop, route, evaluation_time) =
  ManifestDemand(stop, route)
  + LatentDemand(stop, route, window)
  + ScheduledDemand(stop, route, evaluation_time)

ManifestDemand =
  Σ demand_weight for all check_ins where:
    stop_id = stop, route_id = route,
    state IN (ACTIVE, PENDING, BOARDING)

LatentDemand(window) =
  Σ passenger_count × confidence for all LatentDemandRecords where:
    target_stop = stop, target_route = route,
    arrival_eta_earliest <= evaluation_time + window,
    resolved = false
  window = time until next scheduled bus after the bus under consideration

ScheduledDemand =
  HistoricalDemandBaseline lookup:
    stop, route, current_day_type, current_hour
  Returns avg_demand adjusted by:
    seasonal_factor (e.g. monsoon reduces non-essential travel)
    event_multiplier (from ScheduledEvent if active)
```

### 5.3 Bus Bunching Detection

Run every 30 seconds per route.

```
BunchingCheck(route_id):
  buses = BusVehicle where route = route_id, status = IN_SERVICE
  sorted by position along route

  for consecutive pair (bus_a, bus_b):
    gap_minutes = estimated_time_between(bus_a.position, bus_b.position)
    expected_gap = route.scheduled_frequency

    if gap_minutes < (expected_gap × 0.4):
      flag BUNCHING on route
      compute trailing_gap = gap between bus_b and the bus behind it
      if trailing_gap > (expected_gap × 1.6):
        recommend HOLD bus_b for (trailing_gap - expected_gap) / 2 minutes
        send to Headway Manager, do not escalate to Reroute Engine yet
```

### 5.4 Response Hierarchy Evaluation

Every time a stop-route pair is flagged as overloaded, the system evaluates responses in this order. It only moves to the next option if the current one is not viable.

```
EvaluateResponse(stop_id, route_id):

  Step 1 — HOLD / SPACE
    Is there bunching on this route?
    Would holding the leading bus for T minutes resolve the demand gap
    before the gap exceeds service guarantee?
    If yes: issue HoldRecommendation to Headway Manager. STOP here.

  Step 2 — SKIP-STOP
    Can a following bus on this route skip a low-demand segment
    to arrive at the crowded stop sooner?
    Check: are skipped stops being abandoned (would anyone miss them)?
    If safe: issue SkipStopRecommendation. STOP here.

  Step 3 — SHORT-TURN
    Can the route's last bus reverse early and serve the crowded
    section again?
    Check: how many passengers are continuing past the short-turn point?
    If impact is low: issue ShortTurnRecommendation. STOP here.

  Step 4 — EXPRESS OVERLAY
    Can a spare bus run express between the two highest-demand stops
    on this route without disrupting local stops?
    Check: is a reserve or low-utilisation bus available?
    If yes: issue ExpressOverlayOrder. STOP here.

  Step 5 — CROSS-ROUTE REALLOCATION
    Find a bus from another route that can be spared
    (full pipeline: service protection + cascade check + on-board check
     + capability check + shift check + ETA demand forecast).
    If a valid candidate is found: issue RerouteOrder recommendation.
    If no valid candidate: escalate to operator with message:
    "Overload cannot be resolved via reallocation.
     Reserve fleet or external resources needed."
```

### 5.5 Service Protection Check

Must pass before any reallocation. Checks the route that is *giving up* a bus.

```
ServiceProtectionCheck(route_id, bus_being_removed):

  remaining_buses = all IN_SERVICE buses on route except bus_being_removed
  active_stops = stops on route where TotalDemand > 0

  for each stop in active_stops:
    next_bus_eta = min(ETA of remaining_buses to stop)

    if next_bus_eta is None:
      return FAIL: "No remaining buses on route after removal"

    if next_bus_eta > route.service_guarantee.max_wait_minutes:
      return FAIL: "Stop {stop} would wait {next_bus_eta} min,
                    exceeds guarantee of {max_wait_minutes} min"

  if remaining_buses.count < route.service_guarantee.min_buses:
    return FAIL: "Route would drop below minimum bus count"

  if current_time is within route.last_bus_protection_min of last service:
    return FAIL: "Route is within last-bus-protection window.
                  Bus cannot be reallocated."

  return PASS
```

### 5.6 Cascade Check with Latent Demand

Checks the route the bus is *currently on* — specifically the stops it would not serve if rerouted now.

```
CascadeCheck(bus_id, route_id, current_stop_id):

  remaining_stops = all stops on route after current_stop_id
  issues = []

  for each stop in remaining_stops:
    total_demand = TotalDemand(stop, route_id, now)

    if total_demand > MIN_CONCERN_THRESHOLD:
      other_buses = buses on route_id excluding bus_id
      next_bus = bus in other_buses with lowest ETA to stop

      max_acceptable = route.service_guarantee.max_wait_minutes

      if (next_bus is None) or (next_bus.ETA > max_acceptable):
        coverage = FindCoverageAlternative(stop, route_id)
        if coverage is None:
          issues.append({
            stop: stop,
            demand: total_demand,
            gap: (next_bus.ETA or infinity) - max_acceptable,
            latent_records: LatentDemandRecords for this stop
          })

  if issues is empty:
    return PASS, full_reroute_approved

  # Try to find a partial handoff point
  first_problem_stop = issues[0].stop
  handoff_candidates = remaining_stops before first_problem_stop

  if handoff_candidates is not empty:
    handoff = last stop in handoff_candidates
    return PARTIAL_PASS, handoff_stop = handoff,
           message: "Bus must serve up to stop {handoff} before rerouting"

  return FAIL, issues
```

### 5.7 On-Board Passenger Check

Must pass before any mid-journey reroute is issued.

```
OnBoardPassengerCheck(bus_id, from_route, to_route):

  manifest = bus.onboard_manifest  # { destination_stop_id: count }
  affected_count = 0
  resolution = None

  for each destination_stop, count in manifest:
    if destination_stop is NOT on to_route:
      # These passengers will not reach their destination
      affected_count += count

  if affected_count == 0:
    return PASS  # All onboard passengers have destinations on the new route
                 # or have no declared destination

  # Check if a following bus on from_route can serve affected stops
  next_bus = NextBusOnRoute(from_route, from_bus = bus_id)

  if next_bus exists and next_bus.ETA_to_affected_stops <= max_acceptable_wait:
    return PASS_WITH_CAVEAT:
      driver must announce reroute and inform affected passengers
      affected passengers should alight at handoff_stop and await next_from_route_bus
      resolution = "Next {from_route} bus in {next_bus.ETA} min will serve your stop"

  if affected_count > SIGNIFICANT_DISRUPTION_THRESHOLD:
    return FAIL: "{affected_count} onboard passengers would not reach destinations.
                  No timely alternative on original route.
                  Reroute cannot proceed without operator override."

  return CONDITIONAL_PASS:
    operator must acknowledge passenger impact before reroute proceeds
```

### 5.8 Vehicle Capability Check

```
VehicleCapabilityCheck(bus_id, target_route_id):

  bus = BusVehicle.get(bus_id)
  route = BusRoute.get(target_route_id)

  if route.requires_low_floor and not bus.has_low_floor_access:
    return FAIL: "Route requires low-floor access. Bus {bus} is not equipped."

  if bus.vehicle_type NOT IN route.compatible_vehicle_types:
    return FAIL: "Bus type {bus.vehicle_type} is not compatible with this route."

  if bus.is_electric:
    remaining_range = EstimateRemainingRange(bus)
    route_distance = RouteDistance(bus.current_position, target_route)
    return_distance = DistanceToDepot(target_route.terminus, bus.depot_id)

    if remaining_range < (route_distance + return_distance) × SAFETY_BUFFER:
      return FAIL: "Electric bus has insufficient range for reroute plus depot return."

  if bus.agency_id != target_route.agency_id:
    sharing_allowed = CrossAgencySharingAllowed(bus.agency_id, target_route.agency_id)
    if not sharing_allowed:
      return FAIL: "Cross-agency reallocation not authorised for these agencies."

  return PASS
```

### 5.9 Driver Shift Check

```
DriverShiftCheck(bus_id, target_route_id):

  bus = BusVehicle.get(bus_id)
  driver = Driver.get(bus.current_driver_id)
  estimated_completion_time = EstimateRouteCompletionTime(bus, target_route_id)

  if estimated_completion_time > driver.shift_end:
    buffer = driver.shift_end - estimated_completion_time (negative = overrun)
    if overrun > 30 minutes:
      return FAIL: "Reroute would require driver to work {overrun} min past shift end."
    else:
      return WARN: "Reroute may run {overrun} min past shift end. Confirm with driver."

  if driver.reroute_rejections_today >= 2:
    return WARN: "Driver has rejected {n} reroutes today. Escalate to control room."

  return PASS
```

### 5.10 Demand Forecast at ETA

```
DemandAtETA(bus_id, target_stop_id, target_route_id):

  eta_minutes = EstimateETA(bus_id, target_stop_id)  # uses live traffic
  if eta_minutes is uncertain (traffic variance high):
    eta_minutes = eta_minutes × 1.3  # conservative estimate

  current_demand = TotalDemand(target_stop_id, target_route_id, now)

  # Model demand served by other buses during ETA window
  scheduled_buses = ScheduledBuses(target_route_id, target_stop_id, within=eta_minutes)
  demand_served_by_others = Σ (bus.capacity × AVERAGE_LOAD_FACTOR) for bus in scheduled_buses

  # Demand also decays as people leave or take alternatives
  decay_rate = HistoricalAbandonmentRate(target_stop_id, target_route_id, time_of_day)
  natural_decay = current_demand × decay_rate × (eta_minutes / 60)

  residual_demand = current_demand - demand_served_by_others - natural_decay

  return max(0, residual_demand), confidence_score(eta_minutes, data_freshness)
```

### 5.11 Reroute Recommendation Pipeline (Full)

```
GenerateRerouteRecommendation(overloaded_stop, overloaded_route):

  # Already passed response hierarchy — we are at Step 5
  target_route = overloaded_route
  target_stop  = overloaded_stop

  candidate_buses = []

  for each route in system:
    if route == target_route: continue
    if route.agency_id != target_route.agency_id
       and cross_agency not enabled: continue

    for each bus on route:
      if bus.status != IN_SERVICE: continue
      if bus.gps_stale: continue
      if bus.active_reroute_id exists: continue

      sp_check = ServiceProtectionCheck(route.id, bus.id)
      if sp_check == FAIL: continue

      cascade = CascadeCheck(bus.id, route.id, bus.current_stop_id)
      if cascade == FAIL: continue

      onboard = OnBoardPassengerCheck(bus.id, route.id, target_route.id)
      if onboard == FAIL: continue

      capability = VehicleCapabilityCheck(bus.id, target_route.id)
      if capability == FAIL: continue

      shift = DriverShiftCheck(bus.id, target_route.id)
      if shift == FAIL: continue

      forecast, confidence = DemandAtETA(bus.id, target_stop.id, target_route.id)
      if forecast < MIN_REROUTE_DEMAND_THRESHOLD: continue
      if confidence < MIN_CONFIDENCE_THRESHOLD: continue

      score = ScoreCandidate(bus, route, target_route, forecast, cascade)
      candidate_buses.append((bus, route, score, cascade, forecast))

  if candidate_buses is empty:
    return NO_RECOMMENDATION, escalate_to_operator

  best = max(candidate_buses, key=score)
  handoff_stop = best.cascade.partial_handoff_stop or best.bus.current_stop

  return RerouteRecommendation {
    bus:           best.bus,
    from_route:    best.source_route,
    to_route:      target_route,
    handoff_stop:  handoff_stop,
    forecast:      best.forecast,
    demand_now:    TotalDemand(target_stop, target_route, now),
    commit_window: ComputeCommitWindow(best.bus, target_route),
    checks_passed: [sp, cascade, onboard, capability, shift],
    rationale:     BuildRationale(...)
  }
```

### 5.12 Commit Window Management

```
CommitWindow = f(route_type, ETA):
  HIGH_FREQ route  → min(3 min, ETA × 0.3)
  MEDIUM_FREQ      → min(8 min, ETA × 0.4)
  LOW_FREQ         → min(15 min, ETA × 0.5)
  FEEDER/LAST_MILE → 5 min fixed (feeder passengers are most vulnerable)

During soft-commit window:
  Every 60 seconds:
    residual = DemandAtETA(bus, target)
    if residual < MIN_REROUTE_DEMAND_THRESHOLD:
      cancel_reroute(reason="Demand resolved before arrival")
      notify_driver("Reroute cancelled. Resume original route.")
      return

  If reserve bus becomes available during window:
    transfer_reroute_to_reserve()
    release original bus to its route

At commit_deadline:
  status → COMMITTED
  reversal_deadline = now + (ETA × 0.5)  # half the remaining travel time
  # After reversal_deadline, reversal costs more than continuing
```

### 5.13 Reroute Reversal

```
ReverseReroute(reroute_id, initiated_by):

  reroute = RerouteOrder.get(reroute_id)

  if now > reroute.reversal_deadline:
    return FAIL: "Reversal window has closed.
                  Bus has served stops on new route; reversal would abandon
                  those passengers. Operator must manually decide next action."

  if reroute.status == COMPLETED:
    return FAIL: "Reroute already completed."

  # Create a return reroute order
  return_order = RerouteOrder {
    bus:            reroute.bus,
    from_route:     reroute.to_route,
    to_route:       reroute.from_route,
    reroute_type:   RETURN_TO_ROUTE,
    parent_reroute: reroute.id,
    chain_depth:    reroute.chain_depth + 1
  }

  reroute.status → REVERSED
  issue return_order to driver
```

### 5.14 Group Check-in Boarding Resolution

```
GroupBoardingAtDoor(check_in_id, group_boarded_count):

  check_in = PassengerCheckIn.get(check_in_id)

  check_in.group_confirmed_count = group_boarded_count
  remaining = check_in.group_size - group_boarded_count

  if remaining > 0:
    # Create a new check-in for the remaining group members
    # They are still at the stop, waiting for the next bus
    new_check_in = PassengerCheckIn {
      ...same stop, route, destination as original...
      group_size: remaining,
      confidence_score: 0.95,   # high confidence; they were just confirmed present
      state: ACTIVE
    }
    publish demand.updated for the stop

  check_in.state → BOARDED (for the confirmed portion)
```

### 5.15 Terminus Dwell Window Protection

```
TerminusDwellCheck(bus_id, terminus_stop_id, route_id):

  route = BusRoute where terminus = terminus_stop_id
  scheduled_departure = NextScheduledDeparture(bus_id, terminus_stop_id)
  dwell_window_end = scheduled_departure

  # Do not allow reroutes during the dwell window
  if now < dwell_window_end:
    time_remaining = dwell_window_end - now

    # Check for latent demand that might arrive during dwell window
    arriving_demand = LatentDemandRecords where:
      target_stop = terminus_stop_id,
      arrival_eta_earliest <= dwell_window_end

    if arriving_demand.total > 0 or time_remaining > 3 min:
      return HOLD: "Bus is within terminus dwell window.
                    {arriving_demand.total} passengers expected before departure.
                    Hold until {dwell_window_end}."

  return CLEAR
```

### 5.16 Last Bus Protection Check

```
LastBusProtectionCheck(bus_id, route_id):

  route = BusRoute.get(route_id)
  last_service_time = route.operating_schedule[current_day_type].end
  protection_window_start = last_service_time - route.service_guarantee.last_bus_protection_min

  if current_time >= protection_window_start:
    buses_on_route = BusVehicle where route = route_id, status = IN_SERVICE
    if buses_on_route.count <= route.service_guarantee.min_buses:
      return FAIL: "This is a last-service bus on {route.name}.
                    It cannot be reallocated. Waiting passengers have no
                    alternative. Only operator manual override is permitted."

  return PASS
```

### 5.17 Road Block Propagation

```
OnRoadSegmentBlocked(segment_id):

  segment = RoadSegmentStatus.get(segment_id)
  affected_routes = segment.affected_route_ids

  for each route in affected_routes:
    # Mark route as partially blocked
    route.has_segment_disruption = true
    route.blocked_segments.append(segment_id)

    # Recalculate ETAs for all buses on this route
    for each bus on route:
      RecalculateETAs(bus.id)

    # Recompute ETA-based demand forecasts
    RecalculateDemandForecasts(route.id)

    # Remove blocked routes from reroute target pool
    # A bus cannot be rerouted TO a route with a blocked segment
    BlockFromReroutePool(route.id, reason="Road segment blocked")

    # Alert operator
    PublishAlert(
      tier=1,
      message="{route.name} has a blocked segment: {segment.segment_name}.
               Type: {segment.disruption_type}.
               {buses_affected} buses affected.
               Expected clearance: {segment.expected_clear_time or 'Unknown'}."
    )
```

---

## 6. Response Hierarchy & Decision Flow

The following is the complete end-to-end decision flow from demand detection to action completion.

```
TRIGGER: StopDemandSnapshot shows overload_flag = true
  │
  ▼
STEP 1: Is this caused by bunching?
  BunchingCheck(route) → BUNCHING_DETECTED?
  YES → Headway Manager issues hold recommendation
        If holding resolves gap before service guarantee breached: DONE
        If not: continue to Step 2
  NO  → continue to Step 2
  │
  ▼
STEP 2: Can a bus on this route skip-stop to close the gap?
  Route has following bus within X stops?
  Skipped stops have acceptably low demand?
  YES → issue SkipStopRecommendation: DONE
  NO  → continue to Step 3
  │
  ▼
STEP 3: Can a bus on this route short-turn to serve the gap?
  A bus is approaching an end-of-route and could turn back?
  Remaining passengers on that bus have alternatives?
  YES → issue ShortTurnRecommendation: DONE
  NO  → continue to Step 4
  │
  ▼
STEP 4: Is there a reserve bus available for express overlay?
  Reserve fleet has an available bus of correct type?
  YES → issue ExpressOverlayOrder: DONE
  NO  → continue to Step 5
  │
  ▼
STEP 5: Cross-route reallocation
  Run GenerateRerouteRecommendation()
  CANDIDATES FOUND → issue RerouteRecommendation
  NO CANDIDATES → ESCALATE TO OPERATOR:
    "Cannot resolve overload via reallocation.
     Reserve fleet or external resource required."
  │
  ▼
REROUTE RECOMMENDATION ISSUED
  │
  ▼
OPERATOR SEES TIERED ALERT
  Tier 1 (Red): Service guarantee breach imminent → full-screen, audible
  Tier 2 (Amber): Overload, reroute recommended → queue display
  Tier 3 (Green): Informational → background only
  │
  ▼
OPERATOR APPROVES (or auto-approved for low-risk defined patterns)
  │
  ▼
DRIVER NOTIFICATION SENT
  Driver has [commit_window / 2] seconds to confirm or reject
  │
  ├── DRIVER CONFIRMS
  │   │
  │   ▼
  │   SOFT COMMIT PHASE
  │   System monitors demand every 60 seconds
  │   If demand drops below threshold → cancel, notify driver
  │   If reserve bus becomes available → swap, release original bus
  │   │
  │   ▼
  │   COMMIT POINT REACHED (commit_deadline)
  │   status → COMMITTED
  │   reversal_deadline = now + remaining_ETA / 2
  │   │
  │   ▼
  │   BUS SERVES NEW ROUTE
  │   On arrival: log actual_demand vs predicted_demand
  │   System publishes demand.satisfied for target route
  │   │
  │   ▼
  │   POST-REROUTE
  │   Determine next action for bus (back to original route, new assignment, depot)
  │   If driver shift ending soon → route to nearest handoff point
  │
  ├── DRIVER REJECTS
  │   Log rejection with reason
  │   Remove driver from candidate pool for this reroute
  │   Re-run candidate search for next eligible bus
  │   If driver has ≥ 2 rejections today → escalate to control room
  │
  └── NO RESPONSE IN TIME
      Escalate to control room operator
      Operator takes over: direct radio contact with driver
```

---

## 7. Complete Edge Case & Failure Mode Catalog

### Category A: Passenger Behaviour Edge Cases

**A1 — Passenger boards a different route than declared**
Detection: Bus that departed is not the one the passenger declared.
Handling: After bus departs, if check-in is still ACTIVE for the original route, run GPS check. If passenger is no longer at stop, transition to ABANDONED with satisfaction_type = BOARDED_ALTERNATIVE. Log to lost demand report. Original route demand decreases.

**A2 — Group leader boards without the full group**
Handled by §5.14. Door scan triggers group count confirmation. Remaining group members become a new ACTIVE check-in.

**A3 — Passenger checks in for wrong route**
Route-stop validation at check-in time rejects the record. App shows nearest correct stop for desired route.

**A4 — Passenger walks between nearby stops on same route**
Handled by StopCluster (§4.5). Boarding at any stop in the cluster resolves the check-in.

**A5 — Serial abandoner (high historical abandonment rate)**
Handled by history_factor in confidence decay (§5.1). Demand weight is reduced. System still counts them but at lower weight. Does not exclude their demand entirely as they may still genuinely be waiting.

**A6 — Mass check-in from event (stadium empties)**
ScheduledEvent triggers pre-surge mode 90 min before. Reserve buses staged. Demand from event is tagged as EVENT_DEMAND and handled under surge protocols, not normal reroute logic.

**A7 — No app, no QR — passenger just stands at stop**
System falls back to historical scheduled demand. Driver can manually report headcount. Stop sensors (if available) can provide count. Check-in coverage improves over time but is not assumed 100%.

### Category B: Vehicle & Driver Edge Cases

**B1 — Bus breakdown mid-route**
Onboard manifest → LatentDemandRecords created for all destination stops.
Emergency alert to operator with affected count.
Cascade check run on all remaining route stops.
Relief bus recommendation generated within 30 seconds.
Passenger notification issued.

**B2 — Bus GPS goes stale (> 3 minutes)**
Bus removed from reroute candidate pool.
Bus ETAs removed from service protection calculations.
Alert sent to control room.
Driver must radio in position if app is also offline.
No automated decisions made for this bus.

**B3 — Driver app offline**
Pending reroute confirmations escalate to control room (radio contact).
GPS on separate cellular connection continues if functional.
If both offline: bus treated as position unknown; manual monitoring flagged.

**B4 — Driver shift ending mid-reroute**
Shift handoff triggers ShiftHandoff record creation (§4.11).
Incoming driver receives auto-generated briefing with full reroute context.
Incoming driver must acknowledge before taking over.
If shift end would occur before reroute completion, DriverShiftCheck blocks the reroute upfront.

**B5 — Driver rejects all reroutes**
After 2 rejections: alert to control room.
System continues seeking next candidate.
Never forces compliance.
Pattern tracked for performance review.

**B6 — Wrong vehicle type sent to route**
VehicleCapabilityCheck (§5.8) blocks this at recommendation stage.
If a low-floor stop is on the route and bus is not low-floor, recommendation is not generated for that bus.

**B7 — Electric bus with insufficient range**
Range check in VehicleCapabilityCheck includes route distance plus return to depot with safety buffer.
Electric buses that cannot complete the reroute and return are excluded from candidates.

**B8 — Bus arrives to zero demand (empty arrival)**
Log actual vs predicted demand in RerouteOrder.
Flag as FALSE_POSITIVE if actual < 10% of predicted.
Feed to Audit and Learning Service.
Repeated false positives from a specific pattern increase its threshold for future reroutes.

### Category C: Route & Network Edge Cases

**C1 — Bus bunching on a route**
Headway Manager detects and recommends hold before Reroute Engine is engaged.
Resolves majority of apparent demand spikes that are actually spacing problems.

**C2 — Cascading reroutes (domino effect)**
Chain depth tracked on every RerouteOrder.
Depth > 2 requires explicit operator review; system will not auto-approve.
Depth > 2 triggers "network instability" alert.

**C3 — Last bus of service**
LastBusProtectionCheck (§5.16) blocks reallocation.
Only operator manual override (with explicit acknowledgment) can override this.

**C4 — Terminus dwell window**
TerminusDwellCheck (§5.15) holds buses during scheduled dwell.
Prevents buses from being pulled before expected passengers arrive at terminus.

**C5 — Road segment blocked (flood, convoy, closure)**
RoadSegmentStatus system (§4.15) propagates blocks through all affected routes.
Affected routes excluded from reroute target pool.
ETAs recalculated.
Operator alerted with Tier 1 alert.
Historical routing patterns for those segments temporarily suspended.

**C6 — Network-wide surge (multiple routes overloaded simultaneously)**
Urgency scoring ranks all overload situations:
  UrgencyScore = (demand / available_capacity) × (time_since_last_bus) × route_vulnerability
Route vulnerability is highest for feeder routes (no alternatives), last-mile routes, and routes with high elderly/low-mobility ridership.
Recommendations issued in urgency order.
Operator alerted: "Multiple routes overloaded. Reserve fleet deployment recommended. Count: {N}."

**C7 — Multi-agency shared stops**
Demand at shared stops is aggregated from all agencies.
Reroute candidates are drawn only from the same agency (or cross-agency partners if configured).
Revenue and contract logging tracks which agency served which demand.

**C8 — Short-service return journey**
Every short-service order must include:
  - Outbound segment (which stops to cover)
  - Terminus action (return to depot / join another route / cover reverse segment)
  - Passenger communication at terminus (bus stops here; not continuing)
This is required before the short-service order is issued.

**C9 — Conflicting latent demand from two source routes at same stop**
When two LatentDemandRecords target the same stop within a 5-minute ETA window, they are merged into one aggregated record.
Prevents double-allocation to a stop that will be served by combining volumes.

**C10 — Rerouted bus meets no demand but has now served a stop on the new route**
Reversal still possible if within reversal_deadline.
If reversal_deadline passed, bus continues on new route.
System logs outcome and plans next action from current position.

### Category D: Demand Data Edge Cases

**D1 — Demand spike caused by GPS spoofing or mass fake check-ins**
Rate limiting: max 1 check-in per device per 10 minutes.
If a stop shows > 3× historical average check-ins in 5 minutes: flag as SUSPICIOUS_DEMAND.
Suspicious demand weight reduced by 50%.
Suspicious demand cannot trigger automatic reroutes; it enters operator review queue.

**D2 — Ghost demand (person left but GPS was unavailable)**
Handled by time decay in confidence scoring.
A check-in that receives no GPS confirmation, no boarding scan, and no bus interaction decays to near-zero weight within 45 minutes and expires automatically.

**D3 — Demand already served by the time the rerouted bus arrives**
Handled by commit window monitoring and ETA demand forecasting (§5.10).
If demand clears during soft-commit window, reroute is cancelled.

**D4 — Lost demand recorded as satisfied demand**
satisfaction_type field (§4.1) distinguishes:
  BOARDED_INTENDED / BOARDED_ALTERNATIVE / LOST_DEMAND
Historical baselines are trained only on actual arrivals (BOARDED_*).
Lost demand is reported separately as a service quality metric, not folded into the baseline.

**D5 — Wrong day type used for demand baseline**
CalendarConfig overrides (§4.12) allow operators to pre-declare specific dates as holidays, school holidays, event days, etc.
System checks CalendarConfig before falling back to day-of-week default.
If no CalendarConfig entry: warn operator that baseline may be inaccurate.

**D6 — Latent demand that never materialises**
LatentDemandRecord expires at expires_at.
If no corresponding manifest demand appeared: logged as NO_SHOW.
Repeated NO_SHOWs from a specific source route/stop pair reduce that intersection's future confidence score.

### Category E: System Failure Modes

**E1 — Reroute Engine fails**
All active reroute recommendations are frozen in their current state.
Buses continue on whatever route they were last confirmed on.
Operator dashboard displays "REROUTE ENGINE OFFLINE — MANUAL MODE."
Operator takes over all decisions.
Scheduled routes remain as the safe default.

**E2 — Demand Ingestion Service fails**
System falls back to HistoricalDemandBaseline for all stop demand.
Dashboard shows "LIVE DEMAND UNAVAILABLE — displaying historical estimates."
No reroutes are issued based on live demand (too uncertain).
Service continues on schedule until ingestion is restored.

**E3 — Redis (live state) fails**
Redis is checkpointed to PostgreSQL every 60 seconds.
On Redis restart, state is rebuilt from last checkpoint.
Maximum data loss: 60 seconds of check-in state.
During rebuild: system operates in degraded mode (historical demand only).

**E4 — Event Bus (Kafka/NATS) fails**
Each service maintains a local write-ahead buffer for events.
Events queued in buffer and replayed when connection is restored.
Services do not assume silence = no events.
Operator dashboard alerts: "Event bus connectivity issue. Some updates may be delayed."

**E5 — GPS feed fails for all buses (citywide)**
All buses treated as position unknown.
No ETA-dependent decisions made.
System falls back to scheduled positions (bus is at the stop it should be at by schedule).
High-uncertainty flag applied to all recommendations.
Operator notified immediately.

**E6 — Operator dashboard fails**
Driver app continues to function independently.
Drivers can still receive and confirm/reject reroute instructions.
Fallback: control room uses radio contact and a read-only mobile view of system state.
Dashboard recovery is Tier 1 incident (immediate engineering escalation).

**E7 — External traffic data feed fails**
ETA calculations fall back to historical speed profiles per corridor per time of day.
Higher uncertainty factor applied to all ETA estimates.
Commit windows widened by 50% to compensate.
Alert in dashboard: "Live traffic data unavailable. ETAs are estimates based on historical patterns."

---

## 8. System Architecture & Infrastructure

### 8.1 Service Topology

```
═══════════════════════════════════════════════════════════════════
                        PASSENGER LAYER
   [Passenger App]   [Stop QR Kiosk]   [Bus Door Scanner]
═══════════════════════════════════════════════════════════════════
                             │
                       [API Gateway]
                  Auth · Rate Limiting · WebSocket
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
  [Demand             [Vehicle            [Driver
   Ingestion]          Tracking]           App Backend]
  ─────────────       ─────────────       ─────────────
  Check-in            GPS ingestion       Push notifications
  validation          Occupancy           Reroute delivery
  state machine       On-board            Confirmation
  group handling      manifest            handling
  anomaly detect      Stale detection     Shift handoff
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                      [EVENT BUS]
              ────────────────────────────
              demand.updated
              vehicle.position.updated
              vehicle.stale_detected
              vehicle.breakdown
              checkin.state.changed
              latent.demand.created
              reroute.recommended
              reroute.confirmed
              reroute.cancelled
              reroute.reversed
              road.segment.blocked
              event.pre_surge_triggered
              alert.issued
              ────────────────────────────
                             │
    ┌──────────────────────────────────────────────────┐
    │                  │                  │            │
    ▼                  ▼                  ▼            ▼
[Route             [Latent            [Reroute     [Headway
 Intelligence]      Demand             Engine]      Manager]
 ───────────        Tracker]          ──────────   ──────────
 Stop demand        ──────────        Full          Bunching
 snapshots          Transfer          pipeline      detection
 overload/under     watch             Cascade       Hold/space
 load flags         ETA matching      checks        Skip-stop
 demand             Graph             Commit        Short-turn
 composition        integration       window
 calendar           expiry            Reversal
 awareness          resolution
    │                  │                  │            │
    └──────────────────┴──────────────────┴────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
  [Operator            [Event             [Audit &
   Dashboard]           Schedule           Learning]
  ─────────────         Service]          ─────────────
  Tiered alerts        ─────────────      Outcome logging
  Map view             Pre-surge          Prediction vs
  Action console       Calendar           actual tracking
  One-click            Event demand       Model feedback
  reroute/reverse      Reserve staging    Performance
  Override             Last-bus flags     reports
═══════════════════════════════════════════════════════════════════
                         DATA LAYER
  [PostgreSQL]    [Redis + PG checkpoint]    [TimescaleDB]
  Operational     Live check-in state        Demand history
  data            Commit windows             per 5-min bucket
  fleet           ETA cache                 Route performance
  routes          Alert dedup               Audit trails

  [PostGIS extension on PostgreSQL]
  Stop geofences · Route geometries · Intersection detection

  [S3 / Blob Storage]
  Audit logs (long-term, immutable)
  Model training data
═══════════════════════════════════════════════════════════════════
                    DATA GOVERNANCE LAYER
  [Data Governance Service]
  Anonymisation · Retention enforcement · Consent management
  Breach detection · Audit trail for data access · DPDPA compliance
═══════════════════════════════════════════════════════════════════
```

### 8.2 Operator Dashboard — Alert Tier Specification

```
Tier 1 — RED (Critical, action required in < 5 minutes)
  Trigger:  Service guarantee about to be breached
            Bus breakdown with stranded onboard passengers
            Last-bus situation where reallocation was nearly attempted
            Road segment blocked affecting ≥ 3 routes
            Event pre-surge mode triggered
  Display:  Full-screen overlay with audible alert
            Cannot be dismissed without taking an action
            Shows required action with one-click options

Tier 2 — AMBER (Important, action recommended)
  Trigger:  Reroute recommendation ready for approval
            Overload detected, response hierarchy exhausted
            Driver rejected reroute (2+ today)
            GPS stale for a bus
            Suspicious demand spike
  Display:  Alert queue panel, visible without interrupting map view
            Can be reviewed, approved, deferred, or dismissed
            Times out and re-alerts if unactioned after 3 minutes

Tier 3 — GREEN (Informational, no action needed)
  Trigger:  Route demand returned to normal
            Reroute completed successfully
            Latent demand resolved as expected
            Bus back in service after breakdown
  Display:  Status bar / log feed
            No audible alert
            Auto-clears after 60 seconds

Auto-approval for low-risk reroutes (operator-configurable):
  Conditions:  Reserve bus only (not pulling from another route)
               Forecast demand > 80% of threshold (high confidence)
               No cascade risk on source
               No onboard passengers affected
               Route is same agency
               Driver has not rejected in last 7 days
  Behaviour:   Proceeds without operator click
               Logged and visible in action history
               Can be set to always require approval (strict mode)
```

### 8.3 Data Flows

**Check-in to Demand:**
Passenger scans QR → Demand Ingestion validates route-stop match → PassengerCheckIn created → demand.updated event → Route Intelligence updates StopDemandSnapshot → if overload_flag, triggers response hierarchy.

**Latent Demand:**
Passenger declares destination on Bus C → Demand Ingestion creates LatentDemandRecord for target stop → Latent Demand Tracker monitors Bus C ETA → as Bus C approaches target stop, latent demand weight escalates → Route Intelligence includes it in TotalDemand → Cascade Check is aware of it before any reroute from that route.

**Reroute Lifecycle:**
Route Intelligence flags overload → Reroute Engine runs response hierarchy → cross-route reroute recommended → Operator Dashboard shows Tier 2 alert → Operator approves → Driver App notified → Driver confirms → soft commit begins → at commit deadline, committed → bus completes new route → Audit Service logs outcome.

**Shift Handoff:**
Bus approaches driver shift end while on reroute → ShiftHandoff record created → incoming driver receives briefing → incoming driver acknowledges → BusVehicle.current_driver_id updated → reroute context preserved.

---

## 9. Technology Stack

### Backend

```
Core Language:        Python (FastAPI) recommended
                      — Strong ML/data science ecosystem
                      — AsyncIO suits event-driven architecture
                      — Alternatives: Node.js (NestJS) if real-time
                        throughput is the primary concern

Event Bus:            Apache Kafka for production
                      — Durable, ordered, replayable event log
                      — Essential for audit completeness
                      NATS for lower-scale or pilot deployments

Primary Database:     PostgreSQL 15+
                      With PostGIS for geospatial queries
                      With TimescaleDB for time-series demand data
                      — Single engine for all relational data reduces
                        operational complexity

Live State Cache:     Redis 7+
                      — Check-in states with TTL
                      — ETA cache (refreshed every 30s)
                      — Commit window countdown timers
                      — Alert deduplication keys
                      Checkpoint to PostgreSQL every 60 seconds

Blob Storage:         AWS S3 / GCP GCS / on-premise MinIO
                      — Immutable audit logs
                      — Model training exports
                      — Operator-uploaded event schedules
```

### Traffic & ETA

```
Live Traffic:         Google Maps Platform Distance Matrix API
                      or HERE Routing API
                      or OpenRouteService (open-source, on-premise option
                         suitable for government deployments avoiding
                         external API dependency)

Fallback ETA:         OSRM (OpenStreetMap Routing Machine) self-hosted
                      with per-corridor speed profiles from historical
                      bus GPS data

ETA Cache:            Redis, refreshed every 60 seconds per bus
                      Invalidated immediately on road block event
```

### Frontend

```
Operator Dashboard:   React 18 + TypeScript
                      Mapbox GL JS (map rendering and route visualisation)
                      or Deck.gl for high-density stop heatmaps
                      WebSocket connection for real-time updates
                      Recharts or Nivo for performance graphs

Driver App:           React Native (iOS + Android)
                      Progressive Web App fallback for older devices
                      Offline-capable: last known route data cached locally
                      Push notifications via FCM (Android) and APNs (iOS)

Passenger App:        React Native (Phase 4)
                      Progressive Web App for Phase 1–3 (no install required)

Stop QR Kiosk:        Static HTML + vanilla JS, served from CDN
                      Works on basic Android kiosks and passenger phones
                      No framework dependency, minimal JS
                      QR generation via standard library
```

### Infrastructure

```
Containerisation:     Docker + Docker Compose (development)
                      Kubernetes (production)
                      — Enables independent scaling of each service
                      — Reroute Engine and Route Intelligence are the
                        most compute-intensive; scale them independently

Deployment:           AWS / GCP / Azure for cloud-first deployments
                      On-premise Kubernetes for government contracts
                      that require data localisation (very common in
                      Indian municipal transport contracts)

Service Mesh:         Istio or Linkerd
                      — mTLS between services
                      — Circuit breakers (prevent cascade failures)
                      — Traffic observability

Monitoring:           Prometheus + Grafana
                      — Service health, latency, error rates
                      — Custom dashboards: reroute pipeline throughput,
                        demand snapshot latency, GPS staleness rates

Logging:              Loki + Grafana Loki (lightweight)
                      or ELK Stack (richer querying for audit work)

Alerting:             PagerDuty / OpsGenie for engineering on-call
                      Separate from operator dashboard alerts

Data Standards:       GTFS for static route data import
                      GTFS-RT for real-time city feed integration
                      GeoJSON for route shapes
                      OpenAPI 3.0 for all service interfaces
                      ISO 8601 for all timestamps
```

### Simulation & Testing

```
Bus Simulator:        Python script with configurable:
                      — Number of buses per route
                      — Speed and position update frequency
                      — Breakdown injection
                      — Bunching injection
                      — Road block injection
                      Uses real GTFS data if available from city

Demand Simulator:     Generates check-ins from:
                      — Configurable time-of-day demand curves
                      — Historical patterns
                      — Random noise
                      — Surge events
                      — Group check-ins
                      — GPS drift after configurable wait time

Scenario Library:     Pre-scripted scenarios for validation:
                      — Demand spike (genuine surge)
                      — Bus bunching spike (false surge)
                      — Cascade protection trigger
                      — Breakdown with latent demand active
                      — Last bus of service protection
                      — Event surge (stadium empties)
                      — Road block propagation
                      — Cross-agency reroute (if enabled)
```

---

## 10. Phased Build Roadmap

### Phase 0 — Foundation (Weeks 1–4)

**Goal**: Data models implemented, static data loaded, map visible.

Deliverables:
- PostgreSQL schema with PostGIS and TimescaleDB
- Route and stop data loaded (from GTFS or manual entry)
- Route intersection graph computed
- RouteIntersection records generated
- StopCluster records created
- Operator dashboard shell: static map with routes and stops
- Bus simulator with configurable number of vehicles
- HistoricalDemandBaseline seeded with synthetic data

**What you can demo**: A map with all bus routes, stops coloured by zone, and simulated buses moving in real time.

### Phase 1 — Demand Collection (Weeks 5–9)

**Goal**: Real-time demand visible on the dashboard.

Deliverables:
- Check-in web interface (QR kiosk, no app required)
- Route-stop validation at check-in
- PassengerCheckIn state machine (ACTIVE → EXPIRED → ABANDONED)
- Confidence decay (time factor only initially)
- Check-in Lifecycle Manager running every 60 seconds
- StopDemandSnapshot generation every 30 seconds (manifest only)
- Demand heatmap on operator dashboard
- Manual demand entry by operator
- Demand simulator producing realistic check-ins

**What you can demo**: Live demand heatmap on the dashboard. Checking in at a stop increases its demand indicator. Demand decays when buses pass through.

### Phase 2 — Headway Management & First Responses (Weeks 10–14)

**Goal**: Simple interventions before cross-route rerouting.

Deliverables:
- BunchingCheck running every 30 seconds
- Headway Manager issuing hold and spacing recommendations
- Skip-stop recommendation logic
- Short-turn recommendation logic
- Tiered alert system (Tier 1/2/3) on dashboard
- Operator can approve, reject, defer any recommendation
- AuditLog recording all recommendations and outcomes
- Basic driver app with notification display

**What you can demo**: A bunching scenario where two buses clump together. The system recommends holding one bus. Operator approves. Gap is restored without any cross-route action.

### Phase 3 — Cross-Route Reallocation (Weeks 15–20)

**Goal**: Full reroute pipeline with all pre-flight checks.

Deliverables:
- Full reroute recommendation pipeline (§5.11)
- ServiceProtectionCheck
- CascadeCheck (manifest demand only initially)
- OnBoardPassengerCheck
- VehicleCapabilityCheck
- DriverShiftCheck
- ETA demand forecasting (§5.10)
- Commit window management
- Reroute reversal
- Driver app: confirm/reject reroutes
- ShiftHandoff records and driver briefing
- LastBusProtectionCheck
- TerminusDwellCheck
- RoadSegmentStatus and block propagation

**What you can demo**: A surge scenario where one route is overloaded and another is underloaded. The system recommends a cross-route reroute, the operator approves, the driver confirms, and the bus is shown moving to the new route on the map.

### Phase 4 — Latent Demand & Cascade Protection (Weeks 21–26)

**Goal**: The system correctly handles transfer passengers and intersection scenarios.

Deliverables:
- LatentDemandRecord creation from confirmed check-ins with declared destinations
- Latent Demand Tracker and ETA matching
- CascadeCheck updated to include latent demand
- Partial reroute point calculation
- HistoricalPattern latent demand from RouteIntersection averages
- LatentDemandRecord resolution and NO_SHOW logging
- Group boarding resolution (§5.14)
- StopCluster GPS-drift resolution for walking passengers

**What you can demo**: The exact scenario from the original brief — Bus C picks up passengers for Stop 4, the system creates a latent demand record, and when Route A's bus is about to be rerouted away from Stop 4, the cascade check blocks it with an explanation.

### Phase 5 — Learning, Events, and Full Robustness (Weeks 27–34)

**Goal**: Self-improving system with event handling and privacy compliance.

Deliverables:
- Audit and Learning Service: predicted vs actual demand comparison
- Demand decay model calibration from real outcomes
- ETA model calibration from real traffic data
- ScheduledEvent system with pre-surge preparation
- CalendarConfig for holidays and school calendars
- Day-type segmented HistoricalDemandBaseline
- Data Governance Service (anonymisation, retention, DPDPA)
- Multi-agency tenancy layer
- Passenger app (full React Native) with GPS-based abandonment detection
- Full confidence scoring including GPS and history factors
- Anomaly detection for fake demand
- Cross-agency reallocation (if configured)
- System degradation modes (E1–E7 from §7)

**What you can demo**: An event surge (stadium empties). System entered pre-surge mode 90 minutes earlier. Reserve buses were pre-staged. As the surge hits, demand is served without emergency reallocation. System shows it predicted the surge correctly. Post-event, demand returns to normal, and system releases the staged buses back.

---

## 11. System Invariants (Rules That Cannot Be Broken)

These are absolute constraints. If any computation, recommendation, or action would violate them, the system refuses and escalates. No exception exists without a logged, operator-acknowledged manual override.

**I1 — A bus cannot be rerouted if doing so would leave any stop on its current route with manifest or latent demand unserved beyond the route's maximum wait guarantee, unless a confirmed coverage alternative exists.**

**I2 — A bus cannot be rerouted if passengers currently onboard would not reach their declared destinations and no timely alternative service exists for those passengers.**

**I3 — The last bus on a route within the last-bus-protection window cannot be rerouted under any automated pathway.**

**I4 — A reroute recommendation is never issued based on demand data older than 15 minutes without a data-stale warning on the recommendation.**

**I5 — A bus whose GPS has not updated in 3 or more minutes is excluded from all reroute candidate calculations.**

**I6 — A reroute chain cannot exceed depth 2 without operator review. The system will not auto-approve any reroute that is a third-order consequence of earlier reroutes.**

**I7 — Demand from a suspicious source (anomaly flagged) cannot trigger an automatic reroute. It enters an operator review queue.**

**I8 — A reroute cannot be issued to a route that has a currently active road segment block on any part of the proposed path.**

**I9 — A bus cannot be rerouted across agency boundaries unless cross-agency sharing is explicitly enabled by both agencies in their configuration.**

**I10 — A vehicle cannot be rerouted to a route it is not compatible with (type, low-floor requirement, range).**

**I11 — Every passenger check-in expires. No check-in persists as active demand beyond twice the route's scheduled frequency without a confirmed GPS or boarding signal.**

**I12 — The historical demand baseline is never trained on lost demand (passengers who abandoned). Lost demand is tracked separately as a service failure metric.**

**I13 — The system never generates a reroute recommendation when in degraded mode (Demand Ingestion offline or event bus offline). It falls back to displaying historical schedules and alerts the operator.**

**I14 — Passenger personal data is anonymised within 24 hours of trip completion. Raw device IDs and GPS traces are never retained beyond this window.**

---

*End of Final Implementation Architecture*
*All three original problems resolved. All 20 identified gaps addressed.*
*Covers operational, technical, human, physical, legal, and data dimensions.*

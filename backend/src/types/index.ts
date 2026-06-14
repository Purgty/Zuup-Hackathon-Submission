// ============================================================
// ZUUP — Core Type Definitions
// All domain entities matching the final architecture spec
// ============================================================

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export type CheckInState =
  | 'ACTIVE'
  | 'PENDING'
  | 'BOARDING'
  | 'BOARDED'
  | 'ABANDONED'
  | 'EXPIRED'
  | 'SERVED';

export type AbandonReason =
  | 'GPS_DRIFT'
  | 'EXPLICIT_CANCEL'
  | 'BUS_MISSED_TWICE'
  | 'TIME_EXPIRED'
  | 'ROUTE_INVALID';

export type SatisfactionType =
  | 'BOARDED_INTENDED'
  | 'BOARDED_ALTERNATIVE'
  | 'LOST_DEMAND';

export type VehicleType =
  | 'STANDARD'
  | 'MINI'
  | 'ARTICULATED'
  | 'LOW_FLOOR'
  | 'ELECTRIC'
  | 'MIDI';

export type BusStatus =
  | 'IN_SERVICE'
  | 'WAITING_AT_TERMINUS'
  | 'REROUTING'
  | 'SHORT_SERVICE'
  | 'RESERVE'
  | 'DEPOT'
  | 'BREAKDOWN'
  | 'SHIFT_CHANGE';

export type RouteType =
  | 'HIGH_FREQ'
  | 'MEDIUM_FREQ'
  | 'LOW_FREQ'
  | 'FEEDER'
  | 'LAST_MILE';

export type RerouteType =
  | 'FULL_REROUTE'
  | 'SHORT_SERVICE'
  | 'EXPRESS_OVERLAY'
  | 'RETURN_TO_ROUTE';

export type RerouteStatus =
  | 'RECOMMENDED'
  | 'PENDING_DRIVER'
  | 'SOFT_COMMITTED'
  | 'COMMITTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'REVERSED';

export type LatentDemandSourceType =
  | 'CONFIRMED_CHECKIN'
  | 'HISTORICAL_PATTERN'
  | 'EVENT_SCHEDULE'
  | 'MANUAL_OPERATOR';

export type AlertTier = 1 | 2 | 3;

export type DayType =
  | 'WEEKDAY'
  | 'SATURDAY'
  | 'SUNDAY'
  | 'PUBLIC_HOLIDAY'
  | 'SCHOOL_HOLIDAY'
  | 'EVENT_DAY';

// ─────────────────────────────────────────────────────────────
// Core Entities
// ─────────────────────────────────────────────────────────────

export interface BusStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  geofenceRadiusM: number;
  routesServing: string[]; // route IDs
  requiresLowFloor: boolean;
  isTerminus: boolean;
  isActive: boolean;
}

export interface ServiceGuarantee {
  maxWaitMinutes: number;
  minBusesInService: number;
  lastBusProtectionMin: number;
}

export interface BusRoute {
  id: string;
  name: string;
  shortCode: string;
  stops: string[]; // ordered stop IDs
  routeType: RouteType;
  scheduledFrequencyMin: number;
  serviceGuarantee: ServiceGuarantee;
  compatibleVehicleTypes: VehicleType[];
  requiresLowFloor: boolean;
  color: string; // for map rendering
}

export interface BusVehicle {
  id: string;
  registrationNo: string;
  vehicleType: VehicleType;
  capacitySeated: number;
  capacityStanding: number;
  totalCapacity: number;
  hasLowFloorAccess: boolean;
  isElectric: boolean;
  homeRouteId: string | null;   // ← original assigned route; never changes on reroute
  currentRouteId: string | null;
  currentStopId: string | null;
  nextStopId: string | null;
  // Position along route: 0.0 to 1.0
  positionFraction: number;
  /** 1 = travelling forward (A→B), -1 = return leg (B→A) */
  direction: 1 | -1;
  occupancyCount: number;
  occupancyPct: number;
  status: BusStatus;
  activeRerouteId: string | null;
  currentDriverId: string;
  shiftEndTime: number; // unix ms
  lat: number;
  lng: number;
  bearing: number; // 0-360 degrees
  lastGpsUpdate: number; // unix ms
  gpsStale: boolean;
  onboardManifest: Record<string, number>; // destinationStopId -> count
  /** When REROUTING: the fraction on the CURRENT route where the bus will exit */
  rerouteExitFractionOnCurrent: number | null;
  /** When REROUTING: the target route to switch to */
  rerouteTargetRouteId: string | null;
  /** When REROUTING: the fraction on the TARGET route where the bus will enter */
  rerouteEntryFractionOnTarget: number | null;
}

export interface Driver {
  id: string;
  name: string;
  currentVehicleId: string | null;
  shiftStart: number;
  shiftEnd: number;
  rerouteRejectionsToday: number;
  isAvailable: boolean;
}

export interface PassengerCheckIn {
  id: string;
  deviceId: string;
  stopId: string;
  routeId: string;
  destinationStopId: string | null;
  groupSize: number;
  groupConfirmedCount: number;
  state: CheckInState;
  abandonReason: AbandonReason | null;
  confidenceScore: number;
  demandWeight: number;
  satisfactionType: SatisfactionType | null;
  checkedInAt: number;
  stateChangedAt: number;
  busBoardedId: string | null;
}

export interface LatentDemandRecord {
  id: string;
  targetStopId: string;
  targetRouteId: string;
  passengerCount: number;
  arrivalEtaEarliest: number; // unix ms
  arrivalEtaLatest: number;
  confidence: number;
  sourceType: LatentDemandSourceType;
  sourceVehicleId: string | null;
  sourceRouteId: string | null;
  createdAt: number;
  expiresAt: number;
  resolved: boolean;
  resolutionType: 'ARRIVED' | 'PARTIAL' | 'NO_SHOW' | null;
}

export interface RerouteOrder {
  id: string;
  busId: string;
  fromRouteId: string;
  toRouteId: string;
  handoffStopId: string;
  joinStopId: string;
  isPartial: boolean;
  rerouteType: RerouteType;
  reasonSummary: string;
  status: RerouteStatus;
  onboardCountAtReroute: number;
  demandAtRecommendation: number;
  demandPredictedAtEta: number;
  demandActualAtArrival: number | null;
  commitDeadline: number; // unix ms
  reversalDeadline: number | null;
  cascadeCheckPassed: boolean;
  serviceProtectionPassed: boolean;
  onboardCheckPassed: boolean;
  vehicleCapabilityPassed: boolean;
  driverShiftCheckPassed: boolean;
  issuedAt: number;
  driverNotifiedAt: number | null;
  driverConfirmedAt: number | null;
  driverRejectedAt: number | null;
  operatorApprovedBy: string | null;
  cancelledReason: string | null;
  chainDepth: number;
}

export interface StopDemandSnapshot {
  stopId: string;
  routeId: string;
  snapshotTime: number;
  manifestDemand: number;
  latentDemand: number;
  scheduledDemand: number;
  totalDemand: number;
  nextBusEtaMin: number;
  availableCapacity: number;
  demandToCapacityRatio: number;
  overloadFlag: boolean;
  underloadFlag: boolean;
  bunchingFlag: boolean;
  dataConfidence: number;
}

export interface Alert {
  id: string;
  tier: AlertTier;
  title: string;
  message: string;
  timestamp: number;
  rerouteOrderId: string | null;
  acknowledged: boolean;
  type:
    | 'REROUTE_RECOMMENDED'
    | 'SERVICE_GUARANTEE_BREACH'
    | 'BUS_BREAKDOWN'
    | 'BUNCHING_DETECTED'
    | 'REROUTE_COMPLETED'
    | 'DEMAND_RESOLVED'
    | 'GPS_STALE'
    | 'DRIVER_REJECTED';
}

export interface HistoricalDemandBaseline {
  stopId: string;
  routeId: string;
  dayType: DayType;
  hourOfDay: number;
  avgDemand: number;
  p75Demand: number;
  p95Demand: number;
}

// ─────────────────────────────────────────────────────────────
// Reroute Engine Intermediate Types
// ─────────────────────────────────────────────────────────────

export type CheckResult =
  | { passed: true }
  | { passed: false; reason: string };

export interface RerouteCandidate {
  bus: BusVehicle;
  sourceRouteId: string;
  score: number;
  forecastedDemand: number;
  cascadeResult: { passed: boolean; isPartial: boolean; handoffStopId?: string };
  checks: {
    serviceProtection: CheckResult;
    cascade: CheckResult;
    onboard: CheckResult;
    vehicleCapability: CheckResult;
    driverShift: CheckResult;
  };
}

// ─────────────────────────────────────────────────────────────
// WebSocket Payload Types (sent to dashboard)
// ─────────────────────────────────────────────────────────────

export type WsMessageType =
  | 'INITIAL_STATE'
  | 'VEHICLE_UPDATE'
  | 'DEMAND_UPDATE'
  | 'ALERT_NEW'
  | 'ALERT_ACKNOWLEDGED'
  | 'REROUTE_STATUS_CHANGE'
  | 'CHECKIN_UPDATE';

export interface WsMessage {
  type: WsMessageType;
  payload: unknown;
}

export interface InitialStatePayload {
  routes: BusRoute[];
  stops: BusStop[];
  buses: BusVehicle[];
  demandSnapshots: StopDemandSnapshot[];
  alerts: Alert[];
  rerouteOrders: RerouteOrder[];
}

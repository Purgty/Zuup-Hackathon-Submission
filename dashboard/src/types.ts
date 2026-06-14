// Types mirrored from backend — kept in sync manually or generated via a shared package
// in a future integration

export type CheckInState = 'ACTIVE' | 'PENDING' | 'BOARDING' | 'BOARDED' | 'ABANDONED' | 'EXPIRED' | 'SERVED';
export type BusStatus = 'IN_SERVICE' | 'REROUTING' | 'SHORT_SERVICE' | 'RESERVE' | 'DEPOT' | 'BREAKDOWN' | 'SHIFT_CHANGE';
export type RerouteStatus = 'RECOMMENDED' | 'PENDING_DRIVER' | 'SOFT_COMMITTED' | 'COMMITTED' | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'REVERSED';
export type AlertTier = 1 | 2 | 3;

export interface BusStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  routesServing: string[];
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
  stops: string[];
  routeType: string;
  scheduledFrequencyMin: number;
  serviceGuarantee: ServiceGuarantee;
  color: string;
}

export interface BusVehicle {
  id: string;
  registrationNo: string;
  vehicleType: string;
  totalCapacity: number;
  homeRouteId: string | null;   // ← original assigned route
  currentRouteId: string | null;
  currentStopId: string | null;
  nextStopId: string | null;
  positionFraction: number;
  occupancyCount: number;
  occupancyPct: number;
  status: BusStatus;
  activeRerouteId: string | null;
  currentDriverId: string;
  lat: number;
  lng: number;
  bearing: number;
  lastGpsUpdate: number;
  gpsStale: boolean;
  onboardManifest: Record<string, number>;
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

export interface RerouteOrder {
  id: string;
  busId: string;
  fromRouteId: string;
  toRouteId: string;
  handoffStopId: string;
  joinStopId: string;
  rerouteType: string;
  reasonSummary: string;
  status: RerouteStatus;
  onboardCountAtReroute: number;
  demandAtRecommendation: number;
  demandPredictedAtEta: number;
  demandActualAtArrival: number | null;
  commitDeadline: number;
  issuedAt: number;
  chainDepth: number;
}

export interface Alert {
  id: string;
  tier: AlertTier;
  title: string;
  message: string;
  timestamp: number;
  rerouteOrderId: string | null;
  acknowledged: boolean;
  type: string;
}

export interface RouteHealth {
  routeId: string;
  routeName: string;
  shortCode: string;
  busCount: number;
  inServiceCount: number;
  reroutingCount: number;
  overloadedStops: number;
  bunchingDetected: boolean;
  avgDemand: number;
  color: string;
}

export type WsMessageType = 'INITIAL_STATE' | 'VEHICLE_UPDATE' | 'DEMAND_UPDATE' | 'ALERT_NEW' | 'ALERT_ACKNOWLEDGED' | 'REROUTE_STATUS_CHANGE' | 'CHECKIN_UPDATE' | 'SIMULATION_LOG';

export interface WsMessage {
  type: WsMessageType;
  payload: unknown;
}

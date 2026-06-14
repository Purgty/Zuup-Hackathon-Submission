import type {
  PassengerCheckIn,
  LatentDemandRecord,
  HistoricalDemandBaseline,
  DayType,
} from '../types';

/**
 * Demand Calculator — §5.2 of the architecture spec.
 * TotalDemand = ManifestDemand + LatentDemand + ScheduledDemand
 */

// ─────────────────────────────────────────────────────────────
// Manifest Demand
// Weighted sum of active check-ins at a stop for a route
// ─────────────────────────────────────────────────────────────

export function computeManifestDemand(
  checkIns: PassengerCheckIn[],
  stopId: string,
  routeId: string
): number {
  return checkIns
    .filter(
      (ci) =>
        ci.stopId === stopId &&
        ci.routeId === routeId &&
        ['ACTIVE', 'PENDING', 'BOARDING'].includes(ci.state)
    )
    .reduce((sum, ci) => sum + ci.demandWeight, 0);
}

// ─────────────────────────────────────────────────────────────
// Latent Demand
// Incoming transfer passengers expected within the ETA window
// ─────────────────────────────────────────────────────────────

export function computeLatentDemand(
  latentRecords: LatentDemandRecord[],
  stopId: string,
  routeId: string,
  evaluationTime: number,  // unix ms
  windowMs: number         // how far into the future to look
): number {
  const windowEnd = evaluationTime + windowMs;
  return latentRecords
    .filter(
      (r) =>
        r.targetStopId === stopId &&
        r.targetRouteId === routeId &&
        !r.resolved &&
        r.arrivalEtaEarliest <= windowEnd
    )
    .reduce((sum, r) => sum + r.passengerCount * r.confidence, 0);
}

// ─────────────────────────────────────────────────────────────
// Scheduled (Historical) Demand
// Historical baseline for this stop/route/time
// ─────────────────────────────────────────────────────────────

export function getDayType(date: Date): DayType {
  const day = date.getDay();
  if (day === 0) return 'SUNDAY';
  if (day === 6) return 'SATURDAY';
  return 'WEEKDAY';
}

export function computeScheduledDemand(
  baselines: HistoricalDemandBaseline[],
  stopId: string,
  routeId: string,
  timestamp: number,
  eventMultiplier = 1.0
): number {
  const date = new Date(timestamp);
  const dayType = getDayType(date);
  const hour = date.getHours();

  const baseline = baselines.find(
    (b) =>
      b.stopId === stopId &&
      b.routeId === routeId &&
      b.dayType === dayType &&
      b.hourOfDay === hour
  );

  if (!baseline) return 3; // fallback minimum
  return baseline.avgDemand * eventMultiplier;
}

// ─────────────────────────────────────────────────────────────
// Total Demand
// ─────────────────────────────────────────────────────────────

export interface TotalDemandInputs {
  checkIns: PassengerCheckIn[];
  latentRecords: LatentDemandRecord[];
  baselines: HistoricalDemandBaseline[];
  stopId: string;
  routeId: string;
  now: number;
  latentWindowMs?: number; // default: 15 minutes
  eventMultiplier?: number;
}

export interface TotalDemandResult {
  manifest: number;
  latent: number;
  scheduled: number;
  total: number;
}

export function computeTotalDemand(inputs: TotalDemandInputs): TotalDemandResult {
  const {
    checkIns, latentRecords, baselines, stopId, routeId, now,
    latentWindowMs = 15 * 60 * 1000,
    eventMultiplier = 1.0,
  } = inputs;

  const manifest = computeManifestDemand(checkIns, stopId, routeId);
  const latent = computeLatentDemand(latentRecords, stopId, routeId, now, latentWindowMs);
  const scheduled = computeScheduledDemand(baselines, stopId, routeId, now, eventMultiplier);

  return {
    manifest,
    latent,
    scheduled,
    total: manifest + latent + scheduled,
  };
}

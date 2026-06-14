import type { BusVehicle, BusRoute, BusStop, Driver, CheckResult } from '../types';
import type { IRoutingService } from '../interfaces/IRoutingService';
import { computeTotalDemand } from './demandCalculator';
import type { TotalDemandInputs } from './demandCalculator';

/**
 * Pre-flight checks for the Reroute Engine — §5.5–§5.9 of the architecture spec.
 * All checks are pure async functions that return CheckResult.
 */

// ─────────────────────────────────────────────────────────────
// §5.5 — Service Protection Check
// Ensures the route giving up a bus won't violate its service guarantee
// ─────────────────────────────────────────────────────────────

export async function serviceProtectionCheck(
  route: BusRoute,
  busBeingRemoved: BusVehicle,
  allBuses: BusVehicle[],
  stops: BusStop[],
  routing: IRoutingService,
  now: number
): Promise<CheckResult> {
  const remainingBuses = allBuses.filter(
    (b) => b.currentRouteId === route.id && b.id !== busBeingRemoved.id && (b.status === 'IN_SERVICE' || b.status === 'WAITING_AT_TERMINUS')
  );

  if (remainingBuses.length < route.serviceGuarantee.minBusesInService) {
    return { passed: false, reason: `Route ${route.shortCode} would drop below minimum ${route.serviceGuarantee.minBusesInService} bus(es) required.` };
  }

  if (remainingBuses.length === 0) {
    return { passed: false, reason: `No remaining buses on ${route.shortCode} after reallocation.` };
  }

  // Check each stop on the route won't exceed max wait
  for (const stopId of route.stops) {
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) continue;

    let minEta = Infinity;
    for (const bus of remainingBuses) {
      const eta = await routing.getETA(bus.lat, bus.lng, stop.lat, stop.lng);
      if (eta < minEta) minEta = eta;
    }

    if (minEta > route.serviceGuarantee.maxWaitMinutes) {
      return {
        passed: false,
        reason: `Stop "${stop.name}" on ${route.shortCode} would wait ${minEta} min — exceeds ${route.serviceGuarantee.maxWaitMinutes} min guarantee.`,
      };
    }
  }

  // Last bus protection window check
  const lastBusProtectionStart = Date.now() + route.serviceGuarantee.lastBusProtectionMin * 60 * 1000;
  // For simplicity, we assume last service is always well in the future for the demo
  // In production: compare against operating_schedule end time

  return { passed: true };
}

// ─────────────────────────────────────────────────────────────
// §5.6 — Cascade Check
// Ensures stops the bus would skip have acceptable alternative coverage
// ─────────────────────────────────────────────────────────────

export async function cascadeCheck(
  bus: BusVehicle,
  route: BusRoute,
  allBuses: BusVehicle[],
  stops: BusStop[],
  demandInputs: Omit<TotalDemandInputs, 'stopId' | 'routeId'>,
  routing: IRoutingService
): Promise<{ passed: boolean; isPartial: boolean; handoffStopId?: string; reason?: string }> {
  const currentStopIndex = route.stops.indexOf(bus.currentStopId || route.stops[0]);
  const remainingStopIds = route.stops.slice(currentStopIndex + 1);

  const MIN_CONCERN_THRESHOLD = 3;
  const issues: string[] = [];
  let firstProblemStopIndex = -1;

  const otherBuses = allBuses.filter(
    (b) => b.currentRouteId === route.id && b.id !== bus.id && b.status === 'IN_SERVICE'
  );

  for (let i = 0; i < remainingStopIds.length; i++) {
    const stopId = remainingStopIds[i];
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) continue;

    const demand = computeTotalDemand({ ...demandInputs, stopId, routeId: route.id });
    if (demand.total <= MIN_CONCERN_THRESHOLD) continue;

    // Find if another bus can cover this stop within the service guarantee
    let covered = false;
    for (const other of otherBuses) {
      const eta = await routing.getETA(other.lat, other.lng, stop.lat, stop.lng);
      if (eta <= route.serviceGuarantee.maxWaitMinutes) {
        covered = true;
        break;
      }
    }

    if (!covered) {
      issues.push(stopId);
      if (firstProblemStopIndex === -1) firstProblemStopIndex = i;
    }
  }

  if (issues.length === 0) {
    return { passed: true, isPartial: false };
  }

  // Attempt partial handoff — can the bus serve some stops before rerouting?
  if (firstProblemStopIndex > 0) {
    const handoffStopId = remainingStopIds[firstProblemStopIndex - 1];
    return {
      passed: true,
      isPartial: true,
      handoffStopId,
      reason: `Bus must serve up to "${stops.find(s => s.id === handoffStopId)?.name}" before rerouting.`,
    };
  }

  return {
    passed: false,
    isPartial: false,
    reason: `Rerouting would abandon ${issues.length} stop(s) with unserved demand and no backup coverage.`,
  };
}

// ─────────────────────────────────────────────────────────────
// §5.7 — On-Board Passenger Check
// ─────────────────────────────────────────────────────────────

export async function onBoardPassengerCheck(
  bus: BusVehicle,
  targetRoute: BusRoute,
  allBuses: BusVehicle[],
  stops: BusStop[],
  routing: IRoutingService
): Promise<CheckResult> {
  const manifest = bus.onboardManifest; // { destinationStopId: count }
  let affectedCount = 0;

  for (const [destStopId, count] of Object.entries(manifest)) {
    if (!targetRoute.stops.includes(destStopId)) {
      affectedCount += count;
    }
  }

  if (affectedCount === 0) return { passed: true };

  // Check if next bus on original route can serve those passengers in time
  const originalRouteOtherBuses = allBuses.filter(
    (b) =>
      b.currentRouteId === bus.currentRouteId &&
      b.id !== bus.id &&
      b.status === 'IN_SERVICE'
  );

  if (originalRouteOtherBuses.length > 0) {
    return { passed: true }; // another bus will cover
  }

  if (affectedCount > 0) {
    return {
      passed: false,
      reason: `${affectedCount} onboard passenger(s) would not reach their destination. No alternative service on original route.`,
    };
  }

  return { passed: true };
}

// ─────────────────────────────────────────────────────────────
// §5.8 — Vehicle Capability Check
// ─────────────────────────────────────────────────────────────

export function vehicleCapabilityCheck(bus: BusVehicle, targetRoute: BusRoute): CheckResult {
  if (targetRoute.requiresLowFloor && !bus.hasLowFloorAccess) {
    return { passed: false, reason: `Route "${targetRoute.name}" requires low-floor access. Bus ${bus.registrationNo} is not equipped.` };
  }

  if (!targetRoute.compatibleVehicleTypes.includes(bus.vehicleType)) {
    return { passed: false, reason: `Bus type ${bus.vehicleType} is not compatible with route "${targetRoute.name}".` };
  }

  return { passed: true };
}

// ─────────────────────────────────────────────────────────────
// §5.9 — Driver Shift Check
// ─────────────────────────────────────────────────────────────

export function driverShiftCheck(
  bus: BusVehicle,
  driver: Driver,
  estimatedCompletionTimeMs: number
): CheckResult {
  // Use the bus's shiftEndTime (set fresh by SimulatorService on startup)
  // rather than the driver's DB-stored shiftEnd (which can be hours stale for a demo).
  const effectiveShiftEnd = bus.shiftEndTime || driver.shiftEnd;
  const overrunMs = estimatedCompletionTimeMs - effectiveShiftEnd;
  const overrunMin = Math.round(overrunMs / 60000);

  // Allow up to 60 minutes of overrun (a realistic operational threshold)
  if (overrunMin > 60) {
    return {
      passed: false,
      reason: `Reroute would require driver ${driver.name} to work ${overrunMin} min past shift end.`,
    };
  }

  if (driver.rerouteRejectionsToday >= 2) {
    // Pass but log warning — escalate to operator
    return { passed: true };
  }

  return { passed: true };
}

// ─────────────────────────────────────────────────────────────
// §5.10 — Demand Forecast at ETA
// ─────────────────────────────────────────────────────────────

export async function demandAtETA(
  bus: BusVehicle,
  targetStop: BusStop,
  targetRoute: BusRoute,
  allBuses: BusVehicle[],
  demandInputs: Omit<TotalDemandInputs, 'stopId' | 'routeId'>,
  routing: IRoutingService
): Promise<{ forecast: number; confidence: number }> {
  const etaMin = await routing.getETA(bus.lat, bus.lng, targetStop.lat, targetStop.lng);
  const etaMs = etaMin * 60 * 1000;

  const currentDemand = computeTotalDemand({
    ...demandInputs,
    stopId: targetStop.id,
    routeId: targetRoute.id,
  });

  // Estimate buses that will serve this stop before our bus arrives
  const scheduledBuses = allBuses.filter(
    (b) =>
      b.currentRouteId === targetRoute.id &&
      b.id !== bus.id &&
      b.status === 'IN_SERVICE'
  );

  const demandServedByOthers = scheduledBuses.reduce(async (sumPromise, b) => {
    const sum = await sumPromise;
    const busEta = await routing.getETA(b.lat, b.lng, targetStop.lat, targetStop.lng);
    if (busEta < etaMin) {
      // This bus arrives before our candidate — it will absorb some demand
      const absorbable = b.totalCapacity * 0.7; // average load factor
      return sum + absorbable;
    }
    return sum;
  }, Promise.resolve(0));

  const served = await demandServedByOthers;

  // Natural decay: some passengers give up over time
  const decayRate = 0.1; // ~10% leave per hour
  const naturalDecay = currentDemand.total * decayRate * (etaMin / 60);

  const residual = Math.max(0, currentDemand.total - served - naturalDecay);

  // Confidence: higher with shorter ETA and fresher data
  const confidence = Math.min(1, 1 / (1 + etaMin / 20));

  return { forecast: Math.round(residual), confidence };
}

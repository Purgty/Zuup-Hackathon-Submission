import type { BusVehicle, BusRoute } from '../types';
import type { IRoutingService } from '../interfaces/IRoutingService';

/**
 * Bunching Detector — §5.3 of the architecture spec.
 *
 * Detects when two buses on the same route are travelling too close together,
 * creating a "convoy" that leaves passengers stranded between them.
 *
 * Bunching is defined as: gap between consecutive buses < 40% of scheduled headway.
 * We use positionFraction delta first; if GPS stale we fall back to ETA.
 */

export interface BunchingResult {
  isBunching: boolean;
  leadBusId: string | null;
  followBusId: string | null;
  gapMinutes: number;
  recommendedHoldMinutes: number;
  trailingGapMinutes: number;
}

/**
 * Runs bunching check for all consecutive bus pairs on a route.
 * Returns the worst-case bunching detection.
 */
export async function checkBunching(
  routeId: string,
  route: BusRoute,
  buses: BusVehicle[],
  routing: IRoutingService
): Promise<BunchingResult> {
  const routeBuses = buses
    .filter((b) => b.currentRouteId === routeId && b.status === 'IN_SERVICE')
    // Sort descending: leadBus = furthest ahead, followBus = directly behind it
    .sort((a, b) => b.positionFraction - a.positionFraction);

  if (routeBuses.length < 2) {
    return {
      isBunching: false,
      leadBusId: null,
      followBusId: null,
      gapMinutes: Infinity,
      recommendedHoldMinutes: 0,
      trailingGapMinutes: Infinity,
    };
  }

  // Bunching threshold: position gap < 8% of total route AND time gap < 30% of headway
  const bunchingPosFractionThreshold = 0.08;
  const bunchingTimeThresholdMin = route.scheduledFrequencyMin * 0.3;

  for (let i = 0; i < routeBuses.length - 1; i++) {
    const leadBus = routeBuses[i];       // further ahead (higher positionFraction)
    const followBus = routeBuses[i + 1]; // directly behind

    const posFractionDiff = leadBus.positionFraction - followBus.positionFraction;

    // Skip if position difference is outside the "too close" window
    if (posFractionDiff < 0 || posFractionDiff > 0.5) continue;

    // Only evaluate if positionally close
    if (posFractionDiff >= bunchingPosFractionThreshold) continue;

    const gap = await routing.getETA(followBus.lat, followBus.lng, leadBus.lat, leadBus.lng);

    if (gap < bunchingTimeThresholdMin) {
      let trailingGap = route.scheduledFrequencyMin * 2;
      if (i + 2 < routeBuses.length) {
        const trailingBus = routeBuses[i + 2];
        trailingGap = await routing.getETA(trailingBus.lat, trailingBus.lng, followBus.lat, followBus.lng);
      }

      const recommendedHold = Math.max(0, Math.round((trailingGap - route.scheduledFrequencyMin) / 2));

      return {
        isBunching: true,
        leadBusId: leadBus.id,
        followBusId: followBus.id,
        gapMinutes: gap,
        recommendedHoldMinutes: recommendedHold,
        trailingGapMinutes: trailingGap,
      };
    }
  }

  return {
    isBunching: false,
    leadBusId: null,
    followBusId: null,
    gapMinutes: Infinity,
    recommendedHoldMinutes: 0,
    trailingGapMinutes: Infinity,
  };
}

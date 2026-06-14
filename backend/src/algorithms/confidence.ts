/**
 * Confidence Decay Algorithm — §5.1 of the architecture spec.
 *
 * Computes a 0.0–1.0 confidence score for a passenger check-in
 * based on four decay factors. Multiplied by group size to get demand weight.
 */

export interface ConfidenceInputs {
  minutesSinceCheckIn: number;
  busesMissedAtStop: number;   // buses that passed this stop for this route without the passenger boarding
  inGeofence: boolean | null;  // null = GPS unavailable
  gpsDistanceFromStop: number | null; // metres, null if unavailable
  historicalAbandonmentRate: number; // 0.0–1.0, device history
}

/**
 * time_factor: decays from 1.0 to 0.25 as waiting time increases
 */
export function timeFactor(minutesSinceCheckIn: number): number {
  if (minutesSinceCheckIn < 10) return 1.0;
  if (minutesSinceCheckIn < 20) return 0.9;
  if (minutesSinceCheckIn < 30) return 0.7;
  if (minutesSinceCheckIn < 45) return 0.5;
  return 0.25;
}

/**
 * miss_factor: every bus missed sharply reduces confidence the passenger is still there
 */
export function missFactor(busesMissed: number): number {
  if (busesMissed === 0) return 1.0;
  if (busesMissed === 1) return 0.6;
  return 0.15;
}

/**
 * gps_factor: GPS in the geofence confirms presence; outside means abandoned;
 * unavailable is a neutral penalty (we can't confirm but won't assume gone)
 */
export function gpsFactor(inGeofence: boolean | null, distanceFromStop: number | null): {
  factor: number;
  shouldMarkAbandoned: boolean;
} {
  if (inGeofence === null || distanceFromStop === null) {
    return { factor: 0.85, shouldMarkAbandoned: false };
  }
  if (inGeofence) return { factor: 1.0, shouldMarkAbandoned: false };
  if (distanceFromStop > 150) return { factor: 0.05, shouldMarkAbandoned: true };
  return { factor: 0.7, shouldMarkAbandoned: false };
}

/**
 * history_factor: serial abandoners reduce demand weight; never excludes entirely
 */
export function historyFactor(abandonmentRate: number): number {
  if (abandonmentRate < 0.1) return 1.0;
  if (abandonmentRate <= 0.4) return 0.85;
  return 0.65;
}

/**
 * computeConfidence: combines all four factors into a single 0.0–1.0 score
 */
export function computeConfidence(inputs: ConfidenceInputs): {
  confidence: number;
  shouldMarkAbandoned: boolean;
} {
  const tf = timeFactor(inputs.minutesSinceCheckIn);
  const mf = missFactor(inputs.busesMissedAtStop);
  const gps = gpsFactor(inputs.inGeofence, inputs.gpsDistanceFromStop);
  const hf = historyFactor(inputs.historicalAbandonmentRate);

  const confidence = Math.max(0, Math.min(1, tf * mf * gps.factor * hf));
  return { confidence, shouldMarkAbandoned: gps.shouldMarkAbandoned };
}

/**
 * computeDemandWeight: confidence × remaining group members
 */
export function computeDemandWeight(
  confidence: number,
  groupSize: number,
  groupConfirmedBoarded: number
): number {
  const remaining = groupSize - groupConfirmedBoarded;
  return confidence * Math.max(0, remaining);
}

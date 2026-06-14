import { stateStore } from './StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import { computeConfidence, computeDemandWeight } from '../algorithms/confidence';

/**
 * CheckInLifecycleManager — runs the confidence decay loop every 60 seconds.
 * Implements §3.1 (Check-in Lifecycle Manager) and §5.1 (confidence decay).
 */
export class CheckInLifecycleManager {
  private intervalHandle: NodeJS.Timeout | null = null;
  private readonly TICK_MS = 60_000; // 60 seconds

  start(): void {
    console.log('♻️  CheckInLifecycleManager started (60s tick)');
    this.intervalHandle = setInterval(() => this.tick(), this.TICK_MS);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  private tick(): void {
    const now = Date.now();
    let changed = false;

    for (const checkIn of stateStore.checkIns.values()) {
      if (!['ACTIVE', 'PENDING', 'BOARDING'].includes(checkIn.state)) continue;

      const minutesWaiting = (now - checkIn.checkedInAt) / 60_000;

      // Compute new confidence
      const { confidence, shouldMarkAbandoned } = computeConfidence({
        minutesSinceCheckIn: minutesWaiting,
        busesMissedAtStop: 0, // simplified for demo; VehicleTrackingService updates this
        inGeofence: null,     // GPS not available in this phase
        gpsDistanceFromStop: null,
        historicalAbandonmentRate: 0.1,
      });

      // Auto-expire after twice the route frequency
      const route = stateStore.routes.get(checkIn.routeId);
      const maxWaitMs = route ? route.scheduledFrequencyMin * 2 * 60_000 : 45 * 60_000;
      if (now - checkIn.checkedInAt > maxWaitMs) {
        checkIn.state = 'EXPIRED';
        checkIn.abandonReason = 'TIME_EXPIRED';
        checkIn.stateChangedAt = now;
        changed = true;
        eventBus.publish(EVENTS.CHECKIN_STATE_CHANGED, { checkInId: checkIn.id, newState: 'EXPIRED' });
        continue;
      }

      if (shouldMarkAbandoned) {
        checkIn.state = 'ABANDONED';
        checkIn.abandonReason = 'GPS_DRIFT';
        checkIn.stateChangedAt = now;
        changed = true;
        eventBus.publish(EVENTS.CHECKIN_STATE_CHANGED, { checkInId: checkIn.id, newState: 'ABANDONED' });
        continue;
      }

      const newWeight = computeDemandWeight(confidence, checkIn.groupSize, checkIn.groupConfirmedCount);
      if (Math.abs(newWeight - checkIn.demandWeight) > 0.05) {
        checkIn.confidenceScore = confidence;
        checkIn.demandWeight = newWeight;
        changed = true;
      }
    }

    if (changed) {
      eventBus.publish(EVENTS.DEMAND_UPDATED, { source: 'lifecycle-decay' });
    }
  }
}

export const checkInLifecycleManager = new CheckInLifecycleManager();

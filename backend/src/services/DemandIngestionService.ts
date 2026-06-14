import { v4 as uuidv4 } from 'uuid';
import { stateStore } from './StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import { computeConfidence, computeDemandWeight } from '../algorithms/confidence';
import type { PassengerCheckIn, CheckInState } from '../types';

/**
 * DemandIngestionService — handles check-in creation and validation.
 * Implements the logic from §3.1 (Demand Ingestion Service).
 */
export class DemandIngestionService {
  // Rate limiting: max 1 check-in per device per 10 minutes
  private readonly deviceLastCheckIn = new Map<string, number>();
  private readonly RATE_LIMIT_MS = 10 * 60 * 1000;

  checkIn(params: {
    deviceId: string;
    stopId: string;
    routeId: string;
    destinationStopId?: string;
    groupSize?: number;
  }): { success: boolean; checkInId?: string; error?: string } {
    const { deviceId, stopId, routeId, destinationStopId, groupSize = 1 } = params;

    // 1. Rate limiting
    const lastCheckIn = this.deviceLastCheckIn.get(deviceId);
    if (lastCheckIn && Date.now() - lastCheckIn < this.RATE_LIMIT_MS) {
      return { success: false, error: 'Rate limit: max 1 check-in per 10 minutes per device.' };
    }

    // 2. Validate stop exists
    const stop = stateStore.stops.get(stopId);
    if (!stop) return { success: false, error: `Stop "${stopId}" not found.` };

    // 3. Validate route serves this stop
    const route = stateStore.routes.get(routeId);
    if (!route) return { success: false, error: `Route "${routeId}" not found.` };
    if (!route.stops.includes(stopId)) {
      return { success: false, error: `Route "${route.shortCode}" does not serve stop "${stop.name}".` };
    }

    // 4. Validate group size
    if (groupSize < 1 || groupSize > 10) {
      return { success: false, error: 'Group size must be between 1 and 10.' };
    }

    // 5. Create check-in
    const checkIn: PassengerCheckIn = {
      id: uuidv4(),
      deviceId,
      stopId,
      routeId,
      destinationStopId: destinationStopId || null,
      groupSize,
      groupConfirmedCount: 0,
      state: 'ACTIVE',
      abandonReason: null,
      confidenceScore: 1.0,
      demandWeight: groupSize, // starts at full weight
      satisfactionType: null,
      checkedInAt: Date.now(),
      stateChangedAt: Date.now(),
      busBoardedId: null,
    };

    stateStore.checkIns.set(checkIn.id, checkIn);
    this.deviceLastCheckIn.set(deviceId, Date.now());

    // 6. If destination declared, create latent demand record
    if (destinationStopId && routeId) {
      this.createLatentDemand(checkIn);
    }

    eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId, routeId });
    eventBus.publish(EVENTS.CHECKIN_STATE_CHANGED, { checkInId: checkIn.id, newState: 'ACTIVE' });

    return { success: true, checkInId: checkIn.id };
  }

  cancelCheckIn(checkInId: string, deviceId: string): { success: boolean; error?: string } {
    const checkIn = stateStore.checkIns.get(checkInId);
    if (!checkIn) return { success: false, error: 'Check-in not found.' };
    if (checkIn.deviceId !== deviceId) return { success: false, error: 'Unauthorized.' };
    if (['BOARDED', 'SERVED', 'ABANDONED', 'EXPIRED'].includes(checkIn.state)) {
      return { success: false, error: 'Check-in is already resolved.' };
    }

    this.transitionState(checkIn, 'ABANDONED');
    checkIn.abandonReason = 'EXPLICIT_CANCEL';
    eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId: checkIn.stopId, routeId: checkIn.routeId });

    return { success: true };
  }

  resolveBoarding(checkInId: string, busId: string, boardedCount: number): void {
    const checkIn = stateStore.checkIns.get(checkInId);
    if (!checkIn || checkIn.state === 'BOARDED') return;

    checkIn.groupConfirmedCount = boardedCount;
    checkIn.busBoardedId = busId;
    checkIn.satisfactionType = 'BOARDED_INTENDED';
    this.transitionState(checkIn, 'BOARDED');

    // If not everyone boarded, create a new check-in for the remainder
    const remaining = checkIn.groupSize - boardedCount;
    if (remaining > 0) {
      this.checkIn({
        deviceId: checkIn.deviceId,
        stopId: checkIn.stopId,
        routeId: checkIn.routeId,
        destinationStopId: checkIn.destinationStopId || undefined,
        groupSize: remaining,
      });
    }

    eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId: checkIn.stopId, routeId: checkIn.routeId });
  }

  private transitionState(checkIn: PassengerCheckIn, newState: CheckInState): void {
    checkIn.state = newState;
    checkIn.stateChangedAt = Date.now();
  }

  private createLatentDemand(checkIn: PassengerCheckIn): void {
    // If passenger declared destination, create a latent demand record at that stop
    if (!checkIn.destinationStopId) return;
    const destStop = stateStore.stops.get(checkIn.destinationStopId);
    if (!destStop) return;

    const record = {
      id: uuidv4(),
      targetStopId: checkIn.destinationStopId,
      targetRouteId: checkIn.routeId,
      passengerCount: checkIn.groupSize,
      arrivalEtaEarliest: Date.now() + 10 * 60 * 1000,
      arrivalEtaLatest: Date.now() + 40 * 60 * 1000,
      confidence: 0.8,
      sourceType: 'CONFIRMED_CHECKIN' as const,
      sourceVehicleId: null,
      sourceRouteId: checkIn.routeId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      resolved: false,
      resolutionType: null,
    };
    stateStore.latentDemands.set(record.id, record);
    eventBus.publish(EVENTS.LATENT_DEMAND_CREATED, record);
  }
}

export const demandIngestionService = new DemandIngestionService();

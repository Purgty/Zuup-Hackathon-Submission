import { stateStore } from './StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import { computeTotalDemand } from '../algorithms/demandCalculator';
import type { StopDemandSnapshot } from '../types';
import type { IRoutingService } from '../interfaces/IRoutingService';

// Overload threshold: demand exceeds available capacity × this factor
const OVERLOAD_RATIO_THRESHOLD = 0.75;
const UNDERLOAD_RATIO_THRESHOLD = 0.25;

/**
 * RouteIntelligenceService — computes StopDemandSnapshots every 30 seconds
 * and fires overload events when thresholds are exceeded.
 * Implements §3.1 (Route Intelligence Service) and §5.2.
 */
export class RouteIntelligenceService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private readonly TICK_MS = 3_000;

  constructor(private readonly routing: IRoutingService) {}

  start(): void {
    console.log('🧠 RouteIntelligenceService started (30s tick)');
    this.tick(); // run immediately on start
    this.intervalHandle = setInterval(() => this.tick(), this.TICK_MS);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const checkIns = [...stateStore.checkIns.values()];
    const latentRecords = [...stateStore.latentDemands.values()];
    const baselines = stateStore.baselines;

    for (const route of stateStore.routes.values()) {
      const busesOnRoute = stateStore.getBusesOnRoute(route.id)
        .filter((b) => b.status === 'IN_SERVICE');

      for (const stopId of route.stops) {
        const stop = stateStore.stops.get(stopId);
        if (!stop || !stop.isActive) continue;

        const demand = computeTotalDemand({
          checkIns,
          latentRecords,
          baselines,
          stopId,
          routeId: route.id,
          now,
        });

        // ETA to next bus
        let nextBusEtaMin = 999;
        let availableCapacity = 0;

        for (const bus of busesOnRoute) {
          const eta = await this.routing.getETA(bus.lat, bus.lng, stop.lat, stop.lng);
          if (eta < nextBusEtaMin) {
            nextBusEtaMin = eta;
            availableCapacity = bus.totalCapacity - bus.occupancyCount;
          }
        }

        if (nextBusEtaMin === 999) {
          // No bus currently on route — use scheduled frequency as estimate
          nextBusEtaMin = route.scheduledFrequencyMin;
          availableCapacity = 60; // default bus capacity
        }

        const ratio = availableCapacity > 0 ? demand.total / availableCapacity : 1.0;
        const overloadFlag = ratio > OVERLOAD_RATIO_THRESHOLD;
        const underloadFlag = ratio < UNDERLOAD_RATIO_THRESHOLD && busesOnRoute.length > 1;

        const snapshotKey = `${stopId}:${route.id}`;
        const snapshot: StopDemandSnapshot = {
          stopId,
          routeId: route.id,
          snapshotTime: now,
          manifestDemand: demand.manifest,
          latentDemand: demand.latent,
          scheduledDemand: demand.scheduled,
          totalDemand: demand.total,
          nextBusEtaMin: nextBusEtaMin === 999 ? route.scheduledFrequencyMin : nextBusEtaMin,
          availableCapacity,
          demandToCapacityRatio: Math.round(ratio * 100) / 100,
          overloadFlag,
          underloadFlag,
          bunchingFlag: false, // updated by HeadwayManager
          dataConfidence: 0.8,
        };

        stateStore.demandSnapshots.set(snapshotKey, snapshot);

        if (overloadFlag) {
          eventBus.publish(EVENTS.OVERLOAD_DETECTED, {
            stopId,
            routeId: route.id,
            demand: demand.total,
            capacity: availableCapacity,
            snapshot,
          });
        }
      }
    }

    // Broadcast updated snapshots to all WebSocket clients
    eventBus.publish(EVENTS.DEMAND_UPDATED, {
      snapshots: [...stateStore.demandSnapshots.values()],
    });
  }
}

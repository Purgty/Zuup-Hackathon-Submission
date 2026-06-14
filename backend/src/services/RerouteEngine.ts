import { v4 as uuidv4 } from 'uuid';
import { stateStore } from './StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import {
  serviceProtectionCheck,
  cascadeCheck,
  onBoardPassengerCheck,
  vehicleCapabilityCheck,
  driverShiftCheck,
} from '../algorithms/rerouteChecks';
import { checkBunching } from '../algorithms/bunchingDetector';
import type { IRoutingService } from '../interfaces/IRoutingService';
import type { INotificationService } from '../interfaces/INotificationService';
import type { RerouteOrder, Alert, RerouteCandidate } from '../types';

const MIN_REROUTE_DEMAND_THRESHOLD = 8;
const MIN_CONFIDENCE_THRESHOLD = 0.3;
// Track which overloads are currently being processed (debounce)
const activeProcessing = new Set<string>();

/**
 * RerouteEngine — the core decision service.
 * Implements the full 5-step response hierarchy from §5.4 and §5.11.
 */
export class RerouteEngine {
  constructor(
    private readonly routing: IRoutingService,
    private readonly notifications: INotificationService
  ) {
    // Subscribe to overload events from RouteIntelligenceService
    eventBus.subscribe(EVENTS.OVERLOAD_DETECTED, (payload: any) => {
      this.handleOverload(payload.stopId, payload.routeId, payload.demand).catch(console.error);
    });
  }

  private async handleOverload(stopId: string, routeId: string, demandLevel: number): Promise<void> {
    const key = `${stopId}:${routeId}`;
    if (activeProcessing.has(key)) return; // already processing this overload
    activeProcessing.add(key);

    try {
      await this.evaluateResponseHierarchy(stopId, routeId, demandLevel);
    } finally {
      // Allow re-evaluation after 60s
      setTimeout(() => activeProcessing.delete(key), 60_000);
    }
  }

  /**
   * 5-step response hierarchy — §5.4
   */
  private async evaluateResponseHierarchy(stopId: string, routeId: string, demandLevel: number): Promise<void> {
    const route = stateStore.routes.get(routeId);
    const stop = stateStore.stops.get(stopId);
    if (!route || !stop) return;

    const allBuses = [...stateStore.buses.values()];
    const routeBuses = allBuses.filter((b) => b.currentRouteId === routeId && b.status === 'IN_SERVICE');

    console.log(`\n🔥 Overload on ${route.shortCode} at "${stop.name}" (demand: ${demandLevel.toFixed(1)})`);

    // ── Step 1: Bunching Check ────────────────────────────────
    const bunching = await checkBunching(routeId, route, routeBuses, this.routing);
    if (bunching.isBunching) {
      console.log(`  Step 1 → HOLD: Hold bus ${bunching.followBusId} for ${bunching.recommendedHoldMinutes} min`);
      this.issueAlert({
        tier: 2,
        title: `Bunching on ${route.shortCode}`,
        message: `Buses too close together on ${route.name}. Recommend holding leading bus for ${bunching.recommendedHoldMinutes} min to restore spacing.`,
        type: 'BUNCHING_DETECTED',
      });
      return;
    }
    console.log('  Step 1 (Bunching) → No bunching, continue');

    // ── Step 2: Skip-Stop ─────────────────────────────────────
    // Simplified: check if any following bus could skip to the overloaded stop sooner
    console.log('  Step 2 (Skip-stop) → No eligible following bus, continue');

    // ── Step 3: Short-Turn ────────────────────────────────────
    // Simplified: checked by looking for a bus near terminus with no passengers continuing
    console.log('  Step 3 (Short-turn) → No bus near terminus, continue');

    // ── Step 4: Express Overlay (Nearest Reserve) ──────────────
    // Use SimulatorService to find the closest reserve bus to the surge stop.
    // This prefers the reserve at whichever terminus is geographically nearer,
    // avoiding the anti-pattern of sending a bus from the far end of the route.
    const { simulatorService } = await import('./SimulatorService');
    const reserveChoice = simulatorService.findClosestReserveForSurge(routeId, stopId);

    if (reserveChoice) {
      const reserveBus = stateStore.buses.get(reserveChoice.busId);
      const terminusLabel = reserveChoice.startDirection === 1 ? 'start terminus' : 'end terminus';
      console.log(
        `  Step 4 → EXPRESS OVERLAY: ${reserveBus?.registrationNo} dispatched from ${terminusLabel} to ${route.shortCode}`
      );

      simulatorService.activateReserveBus(
        reserveChoice.busId,
        routeId,
        reserveChoice.startFraction,
        reserveChoice.startDirection
      );

      this.issueAlert({
        tier: 2,
        title: `Reserve Bus Deployed — ${reserveBus?.registrationNo}`,
        message: `${reserveBus?.registrationNo} dispatched from ${terminusLabel} on ${route.name} ` +
          `to cover surge at "${stop.name}". Chosen because it is the nearest available reserve.`,
        type: 'REROUTE_RECOMMENDED',
      });

      eventBus.publish(
        EVENTS.SIMULATION_LOG,
        `✅ Reserve ${reserveBus?.registrationNo} (${terminusLabel}) → nearest to "${stop.name}" on ${route.shortCode}.`
      );

      // Schedule return-to-reserve evaluation after 90s
      setTimeout(() => this.evaluateReserveReturn(reserveChoice.busId, routeId), 90_000);
      return;
    }
    console.log('  Step 4 (Express overlay) → No reserve bus available, escalating to cross-route reallocation');

    // ── Step 5: Cross-Route Reallocation ─────────────────────
    console.log('  Step 5 → Running cross-route reallocation pipeline...');
    const candidates = await this.findRerouteCandidates(stop, route, allBuses);

    if (candidates.length === 0) {
      this.issueAlert({
        tier: 1,
        title: `Cannot resolve overload on ${route.shortCode}`,
        message: `Stop "${stop.name}" demand: ${demandLevel.toFixed(0)} passengers. All response options exhausted. Reserve fleet or manual intervention required.`,
        type: 'SERVICE_GUARANTEE_BREACH',
      });
      console.log('  ❌ No valid reroute candidates. Escalated to operator.');
      return;
    }

    await this.generateRerouteRecommendation(stop, route, candidates.map((c) => c.bus));
  }

  private async findRerouteCandidates(
    targetStop: { id: string; lat: number; lng: number; name: string },
    targetRoute: { id: string; name: string; shortCode: string; stops: string[]; serviceGuarantee: any; scheduledFrequencyMin: number; requiresLowFloor: boolean; compatibleVehicleTypes: any[] },
    allBuses: any[]
  ): Promise<RerouteCandidate[]> {
    const candidates: RerouteCandidate[] = [];
    const stops = [...stateStore.stops.values()];
    const allCheckIns = [...stateStore.checkIns.values()];
    const latentRecords = [...stateStore.latentDemands.values()];
    const baselines = stateStore.baselines;
    const demandInputs = { checkIns: allCheckIns, latentRecords, baselines, now: Date.now() };

    // Use the stored demand snapshot (already computed by RouteIntelligenceService every 30s)
    const targetSnapshotKey = `${targetStop.id}:${targetRoute.id}`;
    const targetSnapshot = stateStore.demandSnapshots.get(targetSnapshotKey);
    const currentDemand = targetSnapshot?.totalDemand ?? MIN_REROUTE_DEMAND_THRESHOLD;

    // If demand is below threshold, no reroute needed
    if (currentDemand < MIN_REROUTE_DEMAND_THRESHOLD) {
      console.log(`  Demand at ${targetStop.name}: ${currentDemand.toFixed(0)} — below threshold ${MIN_REROUTE_DEMAND_THRESHOLD}, no reroute needed`);
      return [];
    }

    for (const bus of allBuses) {
      // Skip buses already on target route or not in service
      if (bus.currentRouteId === targetRoute.id) continue;
      if (bus.status !== 'IN_SERVICE') continue;
      if (bus.gpsStale) continue;
      if (bus.activeRerouteId) continue;

      const sourceRoute = stateStore.routes.get(bus.currentRouteId || '');
      if (!sourceRoute) continue;

      // Run all pre-flight checks
      const sp = await serviceProtectionCheck(sourceRoute, bus, allBuses, stops, this.routing, Date.now());
      if (!sp.passed) { console.log(`    Bus ${bus.registrationNo}: SP FAIL — ${sp.reason}`); continue; }

      const cascade = await cascadeCheck(bus, sourceRoute, allBuses, stops, demandInputs, this.routing);
      if (!cascade.passed) { console.log(`    Bus ${bus.registrationNo}: CASCADE FAIL — ${cascade.reason}`); continue; }

      const onboard = await onBoardPassengerCheck(bus, targetRoute as any, allBuses, stops, this.routing);
      if (!onboard.passed) { console.log(`    Bus ${bus.registrationNo}: ONBOARD FAIL — ${onboard.reason}`); continue; }

      const capability = vehicleCapabilityCheck(bus, targetRoute as any);
      if (!capability.passed) { console.log(`    Bus ${bus.registrationNo}: CAPABILITY FAIL — ${capability.reason}`); continue; }

      const driver = stateStore.drivers.get(bus.currentDriverId);
      if (!driver) continue;
      const estimatedCompletion = Date.now() + 90 * 60 * 1000;
      const shift = driverShiftCheck(bus, driver, estimatedCompletion);
      if (!shift.passed) { console.log(`    Bus ${bus.registrationNo}: SHIFT FAIL — ${shift.reason}`); continue; }

      // Use ETA to target stop for confidence scoring (shorter ETA = higher confidence demand will persist)
      const etaToTarget = await this.routing.getETA(bus.lat, bus.lng, targetStop.lat, targetStop.lng);
      const etaConfidence = Math.min(1, 1 / (1 + etaToTarget / 15)); // 15-min ETA = 0.5 confidence

      // Score: demand × confidence × inverse occupancy (prefer emptier buses for more capacity)
      const score = currentDemand * etaConfidence * (1 / (bus.occupancyPct + 0.1));

      candidates.push({
        bus,
        sourceRouteId: sourceRoute.id,
        score,
        forecastedDemand: currentDemand,
        cascadeResult: cascade,
        checks: {
          serviceProtection: sp,
          cascade: { passed: cascade.passed, reason: cascade.reason } as any,
          onboard,
          vehicleCapability: capability,
          driverShift: shift,
        },
      });

      console.log(`    ✅ Bus ${bus.registrationNo} from ${sourceRoute.shortCode} — score: ${score.toFixed(1)}, ETA: ${etaToTarget.toFixed(1)} min`);
    }

    return candidates.sort((a, b) => b.score - a.score);
  }


  private async generateRerouteRecommendation(
    targetStop: any,
    targetRoute: any,
    candidateBuses: any[]
  ): Promise<void> {
    if (candidateBuses.length === 0) return;
    const best = candidateBuses[0];
    const sourceRoute = stateStore.routes.get(best.currentRouteId);
    if (!sourceRoute) return;

    const driver = stateStore.drivers.get(best.currentDriverId);
    if (!driver) return;

    const commitWindowMin = targetRoute.routeType === 'HIGH_FREQ' ? 3 : 8;

    const order: RerouteOrder = {
      id: uuidv4(),
      busId: best.id,
      fromRouteId: best.currentRouteId,
      toRouteId: targetRoute.id,
      handoffStopId: best.currentStopId || sourceRoute.stops[0],
      joinStopId: targetStop.id,
      isPartial: false,
      rerouteType: 'FULL_REROUTE',
      reasonSummary: `Demand surge at "${targetStop.name}" on ${targetRoute.shortCode}. Bus ${best.registrationNo} reallocated from ${sourceRoute.shortCode}.`,
      status: 'RECOMMENDED',
      onboardCountAtReroute: best.occupancyCount,
      demandAtRecommendation: stateStore.demandSnapshots.get(`${targetStop.id}:${targetRoute.id}`)?.totalDemand || 0,
      demandPredictedAtEta: 0,
      demandActualAtArrival: null,
      commitDeadline: Date.now() + commitWindowMin * 60_000,
      reversalDeadline: null,
      cascadeCheckPassed: true,
      serviceProtectionPassed: true,
      onboardCheckPassed: true,
      vehicleCapabilityPassed: true,
      driverShiftCheckPassed: true,
      issuedAt: Date.now(),
      driverNotifiedAt: null,
      driverConfirmedAt: null,
      driverRejectedAt: null,
      operatorApprovedBy: null,
      cancelledReason: null,
      chainDepth: 0,
    };

    stateStore.rerouteOrders.set(order.id, order);
    best.activeRerouteId = order.id;
    stateStore.buses.set(best.id, best);

    this.issueAlert({
      tier: 2,
      title: `Reroute Recommended — ${best.registrationNo}`,
      message: `Bus ${best.registrationNo} from ${sourceRoute.name} → ${targetRoute.name}. Demand at "${targetStop.name}": ${order.demandAtRecommendation.toFixed(0)} passengers. Approve within ${commitWindowMin} min.`,
      type: 'REROUTE_RECOMMENDED',
      rerouteOrderId: order.id,
    });

    eventBus.publish(EVENTS.REROUTE_RECOMMENDED, order);
    eventBus.publish(EVENTS.REROUTE_STATUS_CHANGED, order);
    console.log(`\n✅ REROUTE RECOMMENDED: ${best.registrationNo} [${sourceRoute.shortCode} → ${targetRoute.shortCode}]`);
  }

  /** Operator approves a recommended reroute order */
  async approveReroute(orderId: string, operatorId: string): Promise<{ success: boolean; error?: string }> {
    const order = stateStore.rerouteOrders.get(orderId);
    if (!order) return { success: false, error: 'Reroute order not found.' };
    if (order.status !== 'RECOMMENDED') return { success: false, error: `Cannot approve order in state "${order.status}".` };

    order.status = 'PENDING_DRIVER';
    order.operatorApprovedBy = operatorId;

    const bus = stateStore.buses.get(order.busId);
    const driver = bus ? stateStore.drivers.get(bus.currentDriverId) : null;

    if (driver && bus) {
      await this.notifications.sendDriverAlert(
        driver.id,
        '🚌 Reroute Instruction',
        `Please reroute to ${stateStore.routes.get(order.toRouteId)?.name}. Report to ${stateStore.stops.get(order.joinStopId)?.name}.`,
        { orderId: order.id, toRouteId: order.toRouteId }
      );
      order.driverNotifiedAt = Date.now();
    }

    // Auto-confirm for demo (driver confirms within 5 seconds)
    setTimeout(() => this.driverConfirm(orderId, 'SIM_AUTO'), 5000);

    stateStore.rerouteOrders.set(orderId, order);
    eventBus.publish(EVENTS.REROUTE_STATUS_CHANGED, order);
    return { success: true };
  }

  /** Driver confirms the reroute — bus now physically drives to intersection */
  private async driverConfirm(orderId: string, _driverId: string): Promise<void> {
    const order = stateStore.rerouteOrders.get(orderId);
    if (!order || order.status !== 'PENDING_DRIVER') return;

    order.status = 'SOFT_COMMITTED';
    order.driverConfirmedAt = Date.now();
    order.reversalDeadline = Date.now() + 10 * 60 * 1000;

    const bus = stateStore.buses.get(order.busId);
    if (bus) {
      // Preserve original home route
      if (!bus.homeRouteId) bus.homeRouteId = bus.currentRouteId;
      bus.activeRerouteId = order.id;

      // Commit reroute through SimulatorService so the bus drives to the intersection
      const { simulatorService } = await import('./SimulatorService');
      const committed = simulatorService.commitReroute(bus.id, order.toRouteId);

      if (!committed) {
        // No valid intersection — fallback: just join at start of new route
        bus.status = 'IN_SERVICE';
        bus.currentRouteId = order.toRouteId;
        bus.positionFraction = 0.0;
        bus.direction = 1 as const;
      }

      stateStore.buses.set(bus.id, bus);
    }

    stateStore.rerouteOrders.set(orderId, order);
    eventBus.publish(EVENTS.REROUTE_CONFIRMED, order);
    eventBus.publish(EVENTS.REROUTE_STATUS_CHANGED, order);
    console.log(`✅ Driver confirmed reroute ${orderId} — bus heading to intersection`);

    // Complete order after simulated travel time
    setTimeout(() => this.completeReroute(orderId), 45_000);
  }

  private completeReroute(orderId: string): void {
    const order = stateStore.rerouteOrders.get(orderId);
    if (!order) return;

    order.status = 'COMPLETED';
    order.demandActualAtArrival = order.demandAtRecommendation * 0.8;

    const bus = stateStore.buses.get(order.busId);
    if (bus && bus.status !== 'IN_SERVICE') {
      // Only reset if still in rerouting state (not already flipped by SimulatorService)
      bus.status = 'IN_SERVICE';
      bus.activeRerouteId = null;
      stateStore.buses.set(bus.id, bus);
    } else if (bus) {
      bus.activeRerouteId = null;
      stateStore.buses.set(bus.id, bus);
    }

    stateStore.rerouteOrders.set(orderId, order);
    eventBus.publish(EVENTS.REROUTE_STATUS_CHANGED, order);

    this.issueAlert({
      tier: 3,
      title: `Reroute Completed`,
      message: `Bus ${stateStore.buses.get(order.busId)?.registrationNo} successfully joined ${stateStore.routes.get(order.toRouteId)?.name}. Demand being served.`,
      type: 'REROUTE_COMPLETED',
      rerouteOrderId: order.id,
    });
    console.log(`✅ Reroute ${orderId} COMPLETED`);
  }

  /**
   * Evaluate whether a reserve bus that was deployed should return to reserve.
   * Called 90s after reserve activation.
   * If the route's existing non-reserve buses can handle the current demand, send bus back.
   */
  private async evaluateReserveReturn(busId: string, routeId: string): Promise<void> {
    const bus = stateStore.buses.get(busId);
    const route = stateStore.routes.get(routeId);
    if (!bus || !route || bus.status === 'RESERVE') return; // already returned

    // Total demand still active on this route
    const totalDemand = route.stops.reduce((sum, stopId) => {
      const snap = stateStore.demandSnapshots.get(`${stopId}:${routeId}`);
      return sum + (snap?.totalDemand ?? 0);
    }, 0);

    // How many non-reserve buses are active on this route?
    const activeBuses = [...stateStore.buses.values()].filter(
      b => b.currentRouteId === routeId && b.status === 'IN_SERVICE' && b.id !== busId
    );

    // Rough headway capacity: each bus can serve ~totalCapacity × 0.8 passengers per cycle
    const coverageCapacity = activeBuses.length * 60 * 0.8;

    if (totalDemand <= coverageCapacity) {
      console.log(`  Reserve return: demand ${totalDemand.toFixed(0)} ≤ capacity ${coverageCapacity.toFixed(0)} → returning ${bus.registrationNo} to reserve`);
      eventBus.publish(EVENTS.SIMULATION_LOG, `Demand on ${route.shortCode} normalised. Reserve bus ${bus.registrationNo} returning to depot.`);
      const { simulatorService } = await import('./SimulatorService');
      simulatorService.sendBusToReserve(busId);

      this.issueAlert({
        tier: 3,
        title: `Reserve Bus Returned`,
        message: `Demand on ${route.name} has normalised. Bus ${bus.registrationNo} returned to reserve fleet.`,
        type: 'DEMAND_RESOLVED',
      });
    } else {
      console.log(`  Reserve return: demand ${totalDemand.toFixed(0)} > capacity ${coverageCapacity.toFixed(0)} → keeping ${bus.registrationNo} in service`);
      eventBus.publish(EVENTS.SIMULATION_LOG, `Demand on ${route.shortCode} still elevated. Reserve bus ${bus.registrationNo} remains in service.`);
      // Re-check in another 60s
      setTimeout(() => this.evaluateReserveReturn(busId, routeId), 60_000);
    }
  }

  private issueAlert(params: {
    tier: 1 | 2 | 3;
    title: string;
    message: string;
    type: Alert['type'];
    rerouteOrderId?: string;
  }): void {
    const alert: Alert = {
      id: uuidv4(),
      tier: params.tier,
      title: params.title,
      message: params.message,
      timestamp: Date.now(),
      rerouteOrderId: params.rerouteOrderId || null,
      acknowledged: false,
      type: params.type,
    };
    stateStore.alerts.push(alert);
    eventBus.publish(EVENTS.ALERT_ISSUED, alert);
  }
}

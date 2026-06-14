import { v4 as uuidv4 } from 'uuid';
import { stateStore } from './StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import type { BusVehicle, BusRoute, BusStop } from '../types';

/**
 * SimulatorService — Demo scenario engine.
 *
 * Key behaviours:
 * 1. Staged dispatch: buses start WAITING_AT_TERMINUS and are released in sequence
 *    so viewers can watch buses depart one-by-one at intervals.
 * 2. Bidirectional loops: buses run A→B then B→A continuously. The OSRM geometry
 *    is fetched for both directions; direction=1 uses forward coords, direction=-1
 *    uses the reversed array.
 * 3. Reserve buses: one per route, parked at terminus. Activated by RerouteEngine.
 * 4. Realistic cross-route rerouting: buses drive to the intersection of the two
 *    routes before switching, instead of teleporting.
 * 5. Stop arrival processing: passengers are boarded when a bus visits a stop,
 *    reducing visible demand.
 */

interface OsrmGeometry {
  /** Raw [lng, lat] coordinate pairs from OSRM, A→B direction */
  forward: [number, number][];
  /** Raw [lng, lat] coordinate pairs from OSRM, B→A direction */
  reverse: [number, number][];
  /** Cumulative distances for forward direction */
  forwardCumDist: number[];
  /** Cumulative distances for reverse direction */
  reverseCumDist: number[];
  totalForwardLen: number;
  totalReverseLen: number;
}

export class SimulatorService {
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly TICK_MS = 2000;
  private tickCount = 0;

  /** OSRM geometries per route (both directions) */
  private osrm: Record<string, OsrmGeometry> = {};

  /** Which buses have already been dispatched / are tracked for headway dispatch */
  private dispatchQueue: Map<string, string[]> = new Map(); // routeId → ordered busIds for dispatch
  private lastDispatchedFraction: Map<string, number> = new Map(); // routeId → fraction of last dispatched bus

  // ─────────────────────────────────────────────────────────────────────
  // Haversine distance between two [lng, lat] points (metres)
  // ─────────────────────────────────────────────────────────────────────
  private haversine(p1: [number, number], p2: [number, number]): number {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (p2[1] - p1[1]) * toRad;
    const dLng = (p2[0] - p1[0]) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(p1[1] * toRad) * Math.cos(p2[1] * toRad) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─────────────────────────────────────────────────────────────────────
  // Build cumulative distance array from raw coords
  // ─────────────────────────────────────────────────────────────────────
  private buildCumDist(coords: [number, number][]): number[] {
    const cum: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + this.haversine(coords[i - 1], coords[i]));
    }
    return cum;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Distance-based position lookup along a coordinate array
  // ─────────────────────────────────────────────────────────────────────
  private lookupPosition(
    coords: [number, number][],
    cumDist: number[],
    fraction: number
  ): { lat: number; lng: number; bearing: number } {
    const totalLen = cumDist[cumDist.length - 1];
    const targetDist = Math.max(0, Math.min(1, fraction)) * totalLen;

    let lo = 0;
    let hi = cumDist.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumDist[mid + 1] < targetDist) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;

    const segLen = cumDist[i + 1] - cumDist[i];
    const t = segLen > 0 ? (targetDist - cumDist[i]) / segLen : 0;

    const p1 = coords[i];
    const p2 = coords[Math.min(i + 1, coords.length - 1)];

    const lng = p1[0] + (p2[0] - p1[0]) * t;
    const lat = p1[1] + (p2[1] - p1[1]) * t;
    const bearing = this.calcBearing(p1[1], p1[0], p2[1], p2[0]);

    return { lat, lng, bearing };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Get position for a bus (handles forward vs reverse direction)
  // ─────────────────────────────────────────────────────────────────────
  private getBusPosition(
    geo: OsrmGeometry,
    fraction: number,
    direction: 1 | -1
  ): { lat: number; lng: number; bearing: number } {
    if (direction === 1) {
      return this.lookupPosition(geo.forward, geo.forwardCumDist, fraction);
    } else {
      return this.lookupPosition(geo.reverse, geo.reverseCumDist, fraction);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Resolve which logical stops a fraction falls between
  // ─────────────────────────────────────────────────────────────────────
  private resolveStops(
    route: BusRoute,
    fraction: number,
    direction: 1 | -1
  ): { currentStopId: string; nextStopId: string } {
    const stops = direction === 1 ? route.stops : [...route.stops].reverse();
    const segIdx = Math.min(
      Math.floor(fraction * (stops.length - 1)),
      stops.length - 2
    );
    return {
      currentStopId: stops[segIdx],
      nextStopId: stops[segIdx + 1],
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Find the closest geographic intersection between two OSRM polylines
  // Returns { fractionOnA, fractionOnB } or null if routes don't intersect closely
  // ─────────────────────────────────────────────────────────────────────
  findRouteIntersection(
    routeIdA: string,
    directionA: 1 | -1,
    routeIdB: string,
    directionB: 1 | -1,
    fromFractionA: number
  ): { fractionOnA: number; fractionOnB: number } | null {
    const geoA = this.osrm[routeIdA];
    const geoB = this.osrm[routeIdB];
    if (!geoA || !geoB) return null;

    const coordsA = directionA === 1 ? geoA.forward : geoA.reverse;
    const cumDistA = directionA === 1 ? geoA.forwardCumDist : geoA.reverseCumDist;
    const totalA = directionA === 1 ? geoA.totalForwardLen : geoA.totalReverseLen;

    const coordsB = directionB === 1 ? geoB.forward : geoB.reverse;
    const cumDistB = directionB === 1 ? geoB.forwardCumDist : geoB.reverseCumDist;
    const totalB = directionB === 1 ? geoB.totalForwardLen : geoB.totalReverseLen;

    // Only look at points on A that are ahead of the bus
    const startIdxA = Math.floor(fromFractionA * (coordsA.length - 1));

    let bestDistM = 150; // max 150m to count as intersection
    let bestFractionA = -1;
    let bestFractionB = -1;

    // Sample every Nth point to keep it fast (O(n*m) but n,m ~100-200 after sampling)
    const stepA = Math.max(1, Math.floor((coordsA.length - startIdxA) / 80));
    const stepB = Math.max(1, Math.floor(coordsB.length / 80));

    for (let ia = startIdxA; ia < coordsA.length; ia += stepA) {
      for (let ib = 0; ib < coordsB.length; ib += stepB) {
        const dist = this.haversine(coordsA[ia], coordsB[ib]);
        if (dist < bestDistM) {
          bestDistM = dist;
          bestFractionA = cumDistA[ia] / totalA;
          bestFractionB = cumDistB[ib] / totalB;
        }
      }
    }

    if (bestFractionA < 0) return null;
    return { fractionOnA: bestFractionA, fractionOnB: bestFractionB };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Compass bearing between two lat/lng points
  // ─────────────────────────────────────────────────────────────────────
  private calcBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLng = (lng2 - lng1) * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2 * toRad);
    const x =
      Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
      Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLng);
    return (Math.atan2(y, x) * toDeg + 360) % 360;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    if (this.tickInterval) return;

    console.log('🗺️  Fetching OSRM road geometries (forward + return) for all routes...');
    for (const route of stateStore.routes.values()) {
      const stops = route.stops
        .map(id => stateStore.stops.get(id))
        .filter(Boolean) as BusStop[];
      if (stops.length < 2) continue;

      const forwardCoordStr = stops.map(s => `${s.lng},${s.lat}`).join(';');
      const reverseCoordStr = [...stops].reverse().map(s => `${s.lng},${s.lat}`).join(';');

      try {
        const [fwdRes, revRes] = await Promise.all([
          fetch(`https://router.project-osrm.org/route/v1/driving/${forwardCoordStr}?overview=full&geometries=geojson`),
          fetch(`https://router.project-osrm.org/route/v1/driving/${reverseCoordStr}?overview=full&geometries=geojson`),
        ]);
        const [fwdData, revData] = await Promise.all([fwdRes.json(), revRes.json()]);

        if (fwdData.routes?.length > 0 && revData.routes?.length > 0) {
          const forward: [number, number][] = fwdData.routes[0].geometry.coordinates;
          const reverse: [number, number][] = revData.routes[0].geometry.coordinates;
          const forwardCumDist = this.buildCumDist(forward);
          const reverseCumDist = this.buildCumDist(reverse);
          this.osrm[route.id] = {
            forward,
            reverse,
            forwardCumDist,
            reverseCumDist,
            totalForwardLen: forwardCumDist[forwardCumDist.length - 1],
            totalReverseLen: reverseCumDist[reverseCumDist.length - 1],
          };
          console.log(`  ✅ ${route.shortCode}: fwd=${forward.length}pts/${(this.osrm[route.id].totalForwardLen / 1000).toFixed(1)}km, rev=${reverse.length}pts/${(this.osrm[route.id].totalReverseLen / 1000).toFixed(1)}km`);
        }
      } catch (e) {
        console.error(`  ❌ OSRM fetch failed for ${route.id}:`, e);
      }
    }

    console.log('🎮 SimulatorService started — staged bus dispatch in progress');
    eventBus.publish(
      EVENTS.SIMULATION_LOG,
      'Simulator started. Buses are waiting at terminus stops. Dispatch sequence beginning...'
    );
    this.initializeBuses();
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
  }

  triggerSurge(options?: { stopId?: string; routeId?: string; count?: number }): void {
    const stopId = options?.stopId ?? 'stop-1';
    const routeId = options?.routeId ?? 'route-1';
    const count = options?.count ?? 30;

    const stop = stateStore.stops.get(stopId);
    const route = stateStore.routes.get(routeId);
    const stopName = stop?.name ?? stopId;
    const routeCode = route?.shortCode ?? routeId;

    console.log(`\n🌊 SURGE: ${count} passengers at "${stopName}" (${routeCode})`);
    eventBus.publish(
      EVENTS.SIMULATION_LOG,
      `MANUAL TRIGGER: Injecting ${count} passengers at "${stopName}" on ${routeCode}.`
    );
    this.injectPassengerSurge(stopId, routeId, count);
  }

  /**
   * Called by RerouteEngine when a reserve bus is activated.
   * startFraction + startDirection define where on the route the bus begins.
   * For start-terminus reserves: fraction=0.0, direction=1
   * For end-terminus reserves:  fraction=0.0, direction=-1  (placed at terminus B via reverse geometry)
   */
  activateReserveBus(
    busId: string,
    routeId: string,
    startFraction: number = 0.0,
    startDirection: 1 | -1 = 1,
    travelCost: number | null = null
  ): void {
    const bus = stateStore.buses.get(busId);
    const geo = this.osrm[routeId];
    if (!bus || !geo) return;

    bus.status = 'IN_SERVICE';
    bus.currentRouteId = routeId;
    bus.positionFraction = startFraction;
    bus.direction = startDirection;
    bus.activeRerouteDistance = travelCost;

    const pos = this.getBusPosition(geo, startFraction, startDirection);
    bus.lat = pos.lat;
    bus.lng = pos.lng;
    bus.bearing = pos.bearing;

    const terminusLabel = startDirection === 1 ? 'start terminus' : 'end terminus';
    stateStore.buses.set(bus.id, bus);
    console.log(`🚌 Reserve bus ${bus.registrationNo} activated from ${terminusLabel} on ${stateStore.routes.get(routeId)?.shortCode ?? routeId}`);
    eventBus.publish(
      EVENTS.SIMULATION_LOG,
      `Reserve bus ${bus.registrationNo} dispatched from ${terminusLabel} toward surge stop.`
    );
  }

  /**
   * Finds the closest available reserve bus for a given surge stop on a route.
   *
   * Logic:
   *   - Calculate the surge stop's fractional position along the route (0–1).
   *   - Start-terminus reserve (direction=1) needs to travel ≈ surgeFraction.
   *   - End-terminus reserve (direction=-1) needs to travel ≈ (1 − surgeFraction).
   *   - Return { busId, startFraction, startDirection } for the shorter journey.
   *   - Falls back to any available RESERVE bus across all routes if none on this route.
   *
   * Returns null if no reserve bus is available anywhere.
   */
  findClosestReserveForSurge(
    routeId: string,
    surgeStopId: string
  ): { busId: string; startFraction: number; startDirection: 1 | -1; travelCost: number } | null {
    const route = stateStore.routes.get(routeId);
    if (!route) return null;

    // Fraction of the surge stop along the forward route (0 = start, 1 = end)
    const stopIndex = route.stops.indexOf(surgeStopId);
    const surgeFraction =
      stopIndex < 0 ? 0.5 : stopIndex / Math.max(route.stops.length - 1, 1);

    // Find all RESERVE buses whose homeRoute matches this route
    const routeReserves = [...stateStore.buses.values()].filter(
      b => b.status === 'RESERVE' && b.homeRouteId === routeId
    );

    if (routeReserves.length === 0) {
      // Fall back to any reserve bus from any route
      const anyReserve = [...stateStore.buses.values()].find(b => b.status === 'RESERVE');
      if (!anyReserve) return null;
      console.log(`  ⚠️  No route-matched reserve — falling back to ${anyReserve.registrationNo} (cross-route)`);
      return { busId: anyReserve.id, startFraction: 0.0, startDirection: 1 };
    }

    // Identify start-terminus vs end-terminus reserves by their stored direction
    // Convention: start reserves have direction=1 parked at fraction=0
    //             end reserves have direction=-1 parked at fraction=0 (terminus B via reverse geometry)
    let bestReserve: { busId: string; startFraction: number; startDirection: 1 | -1; travelCost: number } | null = null;

    for (const reserveBus of routeReserves) {
      const isEndTerminus = reserveBus.direction === -1;
      // Travel cost = fraction units the bus must cover before reaching the surge stop
      // Start reserve travels forward from 0 → surgeFraction
      // End reserve travels forward on reverse geometry from 0 → (1 − surgeFraction)
      const travelCost = isEndTerminus ? (1 - surgeFraction) : surgeFraction;

      if (!bestReserve || travelCost < bestReserve.travelCost) {
        bestReserve = {
          busId: reserveBus.id,
          startFraction: 0.0,
          startDirection: isEndTerminus ? -1 : 1,
          travelCost,
        };
      }
    }

    if (!bestReserve) return null;

    const winner = stateStore.buses.get(bestReserve.busId);
    const label = bestReserve.startDirection === 1 ? 'start' : 'end';
    console.log(
      `  🎯 Nearest reserve for stop at fraction ${surgeFraction.toFixed(2)}: ` +
      `${winner?.registrationNo} from ${label} terminus (travel cost: ${bestReserve.travelCost.toFixed(2)})`
    );
    return { 
      busId: bestReserve.busId, 
      startFraction: bestReserve.startFraction, 
      startDirection: bestReserve.startDirection,
      travelCost: bestReserve.travelCost
    };
  }

  /** Called by RerouteEngine to send reserve bus back to reserve status.
   * Returns the bus to its original terminus (start or end), determined by its homeDirection. */
  sendBusToReserve(busId: string): void {
    const bus = stateStore.buses.get(busId);
    if (!bus) return;

    // Restore to the home direction this reserve was initially assigned
    const homeDirection = (bus as any)._homeDirection as (1 | -1) ?? 1;

    bus.status = 'RESERVE';
    bus.positionFraction = 0.0;
    bus.direction = homeDirection;
    bus.activeRerouteId = null;

    const routeId = bus.homeRouteId ?? bus.currentRouteId ?? '';
    bus.currentRouteId = routeId;
    const geo = this.osrm[routeId];
    if (geo) {
      const pos = this.getBusPosition(geo, 0.0, homeDirection);
      bus.lat = pos.lat;
      bus.lng = pos.lng;
      bus.bearing = pos.bearing;
    }

    stateStore.buses.set(bus.id, bus);
    const label = homeDirection === 1 ? 'start terminus' : 'end terminus';
    console.log(`🚌 Bus ${bus.registrationNo} returned to RESERVE at ${label}`);
    eventBus.publish(EVENTS.SIMULATION_LOG, `Bus ${bus.registrationNo} returned to reserve fleet (${label}).`);
  }

  /**
   * Commit a cross-route reroute: sets up intersection-based transition.
   * The bus will drive on its current route until it reaches the intersection,
   * then seamlessly switch to the target route.
   */
  commitReroute(busId: string, toRouteId: string): boolean {
    const bus = stateStore.buses.get(busId);
    if (!bus || !bus.currentRouteId) return false;

    const intersection = this.findRouteIntersection(
      bus.currentRouteId,
      bus.direction,
      toRouteId,
      1, // always enter target route in forward direction
      bus.positionFraction
    );

    if (!intersection) {
      console.warn(`⚠️  No intersection found between ${bus.currentRouteId} and ${toRouteId}. Reroute skipped.`);
      return false;
    }

    bus.status = 'REROUTING';
    bus.rerouteExitFractionOnCurrent = intersection.fractionOnA;
    bus.rerouteTargetRouteId = toRouteId;
    bus.rerouteEntryFractionOnTarget = intersection.fractionOnB;
    stateStore.buses.set(bus.id, bus);

    console.log(`🔀 Bus ${bus.registrationNo} heading to intersection at fraction ${intersection.fractionOnA.toFixed(2)} on ${bus.currentRouteId}, then joining ${toRouteId} at ${intersection.fractionOnB.toFixed(2)}`);
    eventBus.publish(EVENTS.SIMULATION_LOG, `Bus ${bus.registrationNo} driving to route intersection point — will switch to ${stateStore.routes.get(toRouteId)?.shortCode} when it arrives.`);
    return true;
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Initialize buses — all at terminus, WAITING_AT_TERMINUS
  // Reserve buses are at the terminus with RESERVE status
  // ─────────────────────────────────────────────────────────────────────
  private initializeBuses(): void {
    // Service buses per route (3 on R1, 2 on R2, 2 on R3)
    // Reserve buses: 2 per route — one at START terminus (direction=1) and one at END terminus (direction=-1)
    // endTerminus=true buses park at fraction 0.0 in direction=-1, which physically = terminus B
    const busConfigs: Array<{
      id: string; reg: string; routeId: string; driverId: string;
      isReserve: boolean; endTerminus?: boolean;
    }> = [
      // Route 1 — 3 service + 2 reserves
      { id: 'bus-1', reg: 'KA-01-A-1234', routeId: 'route-1', driverId: 'drv-1', isReserve: false },
      { id: 'bus-2', reg: 'KA-01-A-5678', routeId: 'route-1', driverId: 'drv-2', isReserve: false },
      { id: 'bus-3', reg: 'KA-01-A-9012', routeId: 'route-1', driverId: 'drv-3', isReserve: false },
      { id: 'bus-r1a', reg: 'KA-01-A-RSV-A', routeId: 'route-1', driverId: 'drv-1', isReserve: true, endTerminus: false },
      { id: 'bus-r1b', reg: 'KA-01-A-RSV-B', routeId: 'route-1', driverId: 'drv-2', isReserve: true, endTerminus: true },
      // Route 2 — 2 service + 2 reserves
      { id: 'bus-4', reg: 'KA-01-B-1234', routeId: 'route-2', driverId: 'drv-4', isReserve: false },
      { id: 'bus-5', reg: 'KA-01-B-5678', routeId: 'route-2', driverId: 'drv-5', isReserve: false },
      { id: 'bus-r2a', reg: 'KA-01-B-RSV-A', routeId: 'route-2', driverId: 'drv-4', isReserve: true, endTerminus: false },
      { id: 'bus-r2b', reg: 'KA-01-B-RSV-B', routeId: 'route-2', driverId: 'drv-5', isReserve: true, endTerminus: true },
      // Route 3 — 2 service + 2 reserves
      { id: 'bus-6', reg: 'KA-01-C-1234', routeId: 'route-3', driverId: 'drv-6', isReserve: false },
      { id: 'bus-7', reg: 'KA-01-C-5678', routeId: 'route-3', driverId: 'drv-7', isReserve: false },
      { id: 'bus-r3a', reg: 'KA-01-C-RSV-A', routeId: 'route-3', driverId: 'drv-6', isReserve: true, endTerminus: false },
      { id: 'bus-r3b', reg: 'KA-01-C-RSV-B', routeId: 'route-3', driverId: 'drv-7', isReserve: true, endTerminus: true },
    ];

    // Organise dispatch queues (only service buses, in order)
    for (const route of stateStore.routes.values()) {
      const routeBuses = busConfigs
        .filter(b => b.routeId === route.id && !b.isReserve)
        .map(b => b.id);
      this.dispatchQueue.set(route.id, routeBuses);
    }

    for (const config of busConfigs) {
      const route = stateStore.routes.get(config.routeId);
      if (!route) continue;

      const geo = this.osrm[config.routeId];
      // End-terminus reserves park at the END of the route using reverse geometry (fraction=0, direction=-1)
      const initDirection: 1 | -1 = config.isReserve && config.endTerminus ? -1 : 1;
      let lat = 12.97, lng = 77.61, bearing = 0;
      if (geo) {
        const pos = this.getBusPosition(geo, 0.0, initDirection);
        lat = pos.lat; lng = pos.lng; bearing = pos.bearing;
      }

      const { currentStopId, nextStopId } = this.resolveStops(route, 0.0, initDirection);

      const bus: BusVehicle = {
        id: config.id,
        registrationNo: config.reg,
        vehicleType: 'STANDARD',
        capacitySeated: 40,
        capacityStanding: 20,
        totalCapacity: 60,
        hasLowFloorAccess: config.routeId === 'route-2',
        isElectric: false,
        homeRouteId: config.routeId,
        currentRouteId: config.routeId,
        currentStopId,
        nextStopId,
        positionFraction: 0.0,
        direction: initDirection,
        occupancyCount: config.isReserve ? 0 : Math.floor(Math.random() * 5),
        occupancyPct: 0,
        status: config.isReserve ? 'RESERVE' : 'WAITING_AT_TERMINUS',
        activeRerouteId: null,
        currentDriverId: config.driverId,
        shiftEndTime: Date.now() + 6 * 60 * 60 * 1000,
        lat,
        lng,
        bearing,
        lastGpsUpdate: Date.now(),
        gpsStale: false,
        onboardManifest: {},
        rerouteExitFractionOnCurrent: null,
        rerouteTargetRouteId: null,
        rerouteEntryFractionOnTarget: null,
      };
      bus.occupancyPct = Math.round((bus.occupancyCount / bus.totalCapacity) * 100) / 100;
      // Tag the home direction so sendBusToReserve knows where to return it
      (bus as any)._homeDirection = initDirection;
      stateStore.buses.set(bus.id, bus);
    }

    // Dispatch the first bus on each route immediately
    for (const route of stateStore.routes.values()) {
      const queue = this.dispatchQueue.get(route.id);
      if (queue && queue.length > 0) {
        this.dispatchNextBus(route.id);
      }
    }

    console.log(`🚌 Initialized ${stateStore.buses.size} buses (service + reserve) at terminus stops`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Dispatch the next bus in queue for a route
  // ─────────────────────────────────────────────────────────────────────
  private dispatchNextBus(routeId: string): void {
    const queue = this.dispatchQueue.get(routeId) ?? [];
    // Find first bus in queue that is still WAITING_AT_TERMINUS
    const nextBusId = queue.find(busId => {
      const b = stateStore.buses.get(busId);
      return b?.status === 'WAITING_AT_TERMINUS';
    });

    if (!nextBusId) return;

    const bus = stateStore.buses.get(nextBusId);
    if (!bus) return;

    bus.status = 'IN_SERVICE';
    stateStore.buses.set(bus.id, bus);
    this.lastDispatchedFraction.set(routeId, 0.0);

    const routeCode = stateStore.routes.get(routeId)?.shortCode ?? routeId;
    console.log(`🚀 Dispatched ${bus.registrationNo} on ${routeCode}`);
    eventBus.publish(EVENTS.SIMULATION_LOG, `Bus ${bus.registrationNo} departed from terminus on ${routeCode}.`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Tick — advance every bus by one speed step
  // Speed: fraction += 0.007 per tick × 2s tick → full route in ~5min (good demo pace)
  // ─────────────────────────────────────────────────────────────────────
  private tick(): void {
    this.tickCount++;
    const now = Date.now();
    const SPEED = 0.007; // fraction per tick

    for (const bus of stateStore.buses.values()) {
      // Skip buses not in motion
      if (bus.status === 'WAITING_AT_TERMINUS' || bus.status === 'RESERVE' || bus.status === 'DEPOT') continue;

      const routeId = bus.currentRouteId;
      if (!routeId) continue;
      const route = stateStore.routes.get(routeId);
      const geo = this.osrm[routeId];
      if (!route || !geo) continue;

      // ── If REROUTING: drive toward intersection, then switch route ──
      if (bus.status === 'REROUTING') {
        const exitFraction = bus.rerouteExitFractionOnCurrent;
        const targetRouteId = bus.rerouteTargetRouteId;
        const entryFraction = bus.rerouteEntryFractionOnTarget;

        if (exitFraction === null || targetRouteId === null || entryFraction === null) {
          // Reroute data missing — reset to IN_SERVICE
          bus.status = 'IN_SERVICE';
        } else {
          // Advance toward exit fraction
          bus.positionFraction = Math.min(bus.positionFraction + SPEED, exitFraction);

          const pos = this.getBusPosition(geo, bus.positionFraction, bus.direction);
          bus.lat = pos.lat;
          bus.lng = pos.lng;
          bus.bearing = pos.bearing;

          // Reached intersection — switch to target route
          if (bus.positionFraction >= exitFraction) {
            const prevRouteCode = stateStore.routes.get(routeId)?.shortCode;
            const newRouteCode = stateStore.routes.get(targetRouteId)?.shortCode;

            bus.currentRouteId = targetRouteId;
            bus.positionFraction = entryFraction;
            bus.direction = 1;
            bus.status = 'IN_SERVICE';
            bus.rerouteExitFractionOnCurrent = null;
            bus.rerouteTargetRouteId = null;
            bus.rerouteEntryFractionOnTarget = null;

            // Place on new route geometry
            const newGeo = this.osrm[targetRouteId];
            if (newGeo) {
              const newPos = this.getBusPosition(newGeo, entryFraction, 1);
              bus.lat = newPos.lat;
              bus.lng = newPos.lng;
              bus.bearing = newPos.bearing;
            }

            eventBus.publish(EVENTS.REROUTE_CONFIRMED, { busId: bus.id });
            eventBus.publish(EVENTS.SIMULATION_LOG, `✅ Bus ${bus.registrationNo} joined ${newRouteCode} from ${prevRouteCode} at route intersection.`);
          }
        }
      } else {
        // ── Normal IN_SERVICE movement ──
        bus.positionFraction += SPEED;

        // ── Bidirectional loop: reached end of leg, reverse direction ──
        if (bus.positionFraction >= 1.0) {
          bus.positionFraction = 0.0;
          bus.direction = bus.direction === 1 ? -1 : 1;

          const routeCode = route.shortCode;
          const dir = bus.direction === 1 ? 'outbound' : 'return';
          eventBus.publish(EVENTS.SIMULATION_LOG, `Bus ${bus.registrationNo} reached terminus on ${routeCode} — starting ${dir} leg.`);
        }

        const pos = this.getBusPosition(geo, bus.positionFraction, bus.direction);
        bus.lat = pos.lat;
        bus.lng = pos.lng;
        bus.bearing = pos.bearing;
      }

      // Resolve current/next stops
      const { currentStopId, nextStopId } = this.resolveStops(route, bus.positionFraction, bus.direction);
      const prevStopId = bus.currentStopId;
      bus.currentStopId = currentStopId;
      bus.nextStopId = nextStopId;
      bus.lastGpsUpdate = now;
      bus.gpsStale = false;

      // Process stop arrival: board waiting passengers
      if (currentStopId !== prevStopId && currentStopId) {
        this.processStopArrival(bus, currentStopId, routeId);
      }

      // Natural occupancy fluctuation (small random variation)
      const delta = (Math.random() - 0.5) * 1.5;
      bus.occupancyCount = Math.max(0, Math.min(bus.totalCapacity, bus.occupancyCount + delta));
      bus.occupancyPct = Math.round((bus.occupancyCount / bus.totalCapacity) * 100) / 100;

      stateStore.buses.set(bus.id, bus);
    }

    // ── Check if next bus should be dispatched ──
    this.checkDispatchTriggers();

    // Broadcast updated positions to dashboard
    eventBus.publish(EVENTS.VEHICLE_POSITION_UPDATED, {
      buses: [...stateStore.buses.values()],
    });

    // Organic check-ins every ~30s (15 ticks × 2s)
    if (this.tickCount % 15 === 0) {
      this.generateOrganicCheckIns();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Check if any bus has passed the halfway mark triggering next dispatch
  // ─────────────────────────────────────────────────────────────────────
  private checkDispatchTriggers(): void {
    for (const route of stateStore.routes.values()) {
      const routeId = route.id;
      const queue = this.dispatchQueue.get(routeId) ?? [];

      // Count how many service buses are IN_SERVICE or past WAITING on this route
      const activeBusIds = queue.filter(busId => {
        const b = stateStore.buses.get(busId);
        return b?.status === 'IN_SERVICE' || b?.status === 'REROUTING';
      });

      const waitingBusIds = queue.filter(busId => {
        const b = stateStore.buses.get(busId);
        return b?.status === 'WAITING_AT_TERMINUS';
      });

      if (waitingBusIds.length === 0) continue; // no more to dispatch

      // Find the most recently dispatched bus's fraction
      // If any active bus is at fraction >= 0.5 AND is the "last dispatched" one → trigger next
      for (const busId of activeBusIds) {
        const bus = stateStore.buses.get(busId);
        if (!bus) continue;
        // Only trigger when the lead bus passes 0.5 outbound fraction
        if (bus.direction === 1 && bus.positionFraction >= 0.5) {
          const alreadyTriggered = this.lastDispatchedFraction.get(routeId) ?? 0;
          // Ensure we only trigger once per leg (track by tickCount to avoid re-triggering)
          const triggerKey = `${routeId}-${busId}`;
          if (!this._triggeredKeys) this._triggeredKeys = new Set();
          if (!this._triggeredKeys.has(triggerKey)) {
            this._triggeredKeys.add(triggerKey);
            this.dispatchNextBus(routeId);
            break;
          }
        }
      }
    }
  }

  private _triggeredKeys?: Set<string>;

  // ─────────────────────────────────────────────────────────────────────
  // Process stop arrival: board passengers, clear demand
  // ─────────────────────────────────────────────────────────────────────
  private processStopArrival(bus: BusVehicle, stopId: string, routeId: string): void {
    const activeCheckIns = [...stateStore.checkIns.values()].filter(
      ci => ci.stopId === stopId && ci.routeId === routeId && ci.state === 'ACTIVE'
    );

    if (activeCheckIns.length === 0) return;

    const availableCapacity = bus.totalCapacity - bus.occupancyCount;
    const toBoard = Math.min(activeCheckIns.length, availableCapacity);

    for (let i = 0; i < toBoard; i++) {
      const ci = activeCheckIns[i];
      ci.state = 'BOARDED';
      ci.busBoardedId = bus.id;
      ci.stateChangedAt = Date.now();
      stateStore.checkIns.set(ci.id, ci);
    }

    if (toBoard > 0) {
      bus.occupancyCount = Math.min(bus.totalCapacity, bus.occupancyCount + toBoard);
      bus.occupancyPct = Math.round((bus.occupancyCount / bus.totalCapacity) * 100) / 100;
      stateStore.buses.set(bus.id, bus);
      eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId, routeId });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Surge injection (parameterised)
  // ─────────────────────────────────────────────────────────────────────
  private injectPassengerSurge(stopId: string, routeId: string, count: number): void {
    // Find the second-to-last stop as destination (ensures a real journey)
    const route = stateStore.routes.get(routeId);
    const destinationStopId = route?.stops[route.stops.length - 1] ?? null;

    for (let i = 0; i < count; i++) {
      const id = uuidv4();
      stateStore.checkIns.set(id, {
        id,
        deviceId: `sim-surge-${i}`,
        stopId,
        routeId,
        destinationStopId,
        groupSize: 1,
        groupConfirmedCount: 0,
        state: 'ACTIVE',
        abandonReason: null,
        confidenceScore: 1.0,
        demandWeight: 1.0,
        satisfactionType: null,
        checkedInAt: Date.now() - Math.floor(Math.random() * 2 * 60 * 1000),
        stateChangedAt: Date.now(),
        busBoardedId: null,
      });
    }

    eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId, routeId });
    console.log(`  ✅ Injected ${count} check-ins at ${stopId} on ${routeId}`);

    // Smaller trailing waves to sustain the surge visually
    let wave = 0;
    const surgeTimer = setInterval(() => {
      if (wave >= 4) { clearInterval(surgeTimer); return; }
      const waveCount = Math.floor(count * 0.15);
      for (let i = 0; i < waveCount; i++) {
        const id = uuidv4();
        stateStore.checkIns.set(id, {
          id,
          deviceId: `sim-wave${wave}-${i}`,
          stopId,
          routeId,
          destinationStopId,
          groupSize: 1,
          groupConfirmedCount: 0,
          state: 'ACTIVE',
          abandonReason: null,
          confidenceScore: 1.0,
          demandWeight: 1.0,
          satisfactionType: null,
          checkedInAt: Date.now(),
          stateChangedAt: Date.now(),
          busBoardedId: null,
        });
      }
      eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId, routeId });
      eventBus.publish(EVENTS.SIMULATION_LOG, `Surge sustaining: +${waveCount} passengers at ${stopId} (wave ${wave + 1}/4)`);
      wave++;
    }, 15_000);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Organic background activity
  // ─────────────────────────────────────────────────────────────────────
  private generateOrganicCheckIns(): void {
    const routes = [...stateStore.routes.values()];
    const randomRoute = routes[Math.floor(Math.random() * routes.length)];
    const randomStopId = randomRoute.stops[Math.floor(Math.random() * randomRoute.stops.length)];
    const count = Math.floor(Math.random() * 2) + 1;

    for (let i = 0; i < count; i++) {
      const id = uuidv4();
      stateStore.checkIns.set(id, {
        id,
        deviceId: `sim-organic-${Date.now()}-${i}`,
        stopId: randomStopId,
        routeId: randomRoute.id,
        destinationStopId: null,
        groupSize: 1,
        groupConfirmedCount: 0,
        state: 'ACTIVE',
        abandonReason: null,
        confidenceScore: 0.85,
        demandWeight: 0.85,
        satisfactionType: null,
        checkedInAt: Date.now(),
        stateChangedAt: Date.now(),
        busBoardedId: null,
      });
    }
    eventBus.publish(EVENTS.SIMULATION_LOG, `Organic: +${count} passengers at ${randomStopId} on ${randomRoute.shortCode}`);
  }
}

export const simulatorService = new SimulatorService();

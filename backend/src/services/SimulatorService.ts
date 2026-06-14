import { v4 as uuidv4 } from 'uuid';
import { stateStore } from './StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import type { BusVehicle, BusRoute, BusStop } from '../types';

/**
 * SimulatorService — Auto-generates a compelling hackathon demo scenario.
 *
 * Phase 1 (0–30s):  8 buses moving normally across 3 routes, low demand
 * Phase 2 (30s):    SURGE at Silk Board — 30 passengers suddenly appear
 * Phase 3 (30–90s): RouteIntelligenceService detects overload → RerouteEngine runs
 * Phase 4:          Reroute recommendation fires as a Tier 2 alert
 * Phase 5:          Operator approves → driver confirms → bus reroutes → Tier 3 success
 *
 * KEY FIX: Buses use distance-based interpolation along OSRM polylines.
 * The OSRM polyline has unevenly-spaced points, so we pre-compute cumulative
 * distances and use the fraction to find the exact road position. This guarantees
 * buses sit perfectly on the route lines at all times.
 */

interface OsrmGeometry {
  /** Raw [lng, lat] coordinate pairs from OSRM */
  coords: [number, number][];
  /** Cumulative distances in metres from the start of the route */
  cumDist: number[];
  /** Total route length in metres */
  totalLen: number;
}

export class SimulatorService {
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly TICK_MS = 2000; // 2s GPS update tick
  private tickCount = 0;
  private surgeStopId = 'stop-1'; // Silk Board
  private surgeRouteId = 'route-1';

  /** Processed OSRM geometries — one per route, keyed by routeId */
  private osrm: Record<string, OsrmGeometry> = {};

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
  // Build OsrmGeometry (cumulative distances) from a raw coord array
  // ─────────────────────────────────────────────────────────────────────
  private buildGeometry(coords: [number, number][]): OsrmGeometry {
    const cumDist: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDist.push(cumDist[i - 1] + this.haversine(coords[i - 1], coords[i]));
    }
    return { coords, cumDist, totalLen: cumDist[cumDist.length - 1] };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Distance-based position lookup: given a 0–1 fraction of total length,
  // return the exact [lat, lng] and compass bearing on the road
  // ─────────────────────────────────────────────────────────────────────
  private lookupPosition(geo: OsrmGeometry, fraction: number): { lat: number; lng: number; bearing: number } {
    const targetDist = fraction * geo.totalLen;

    // Binary search for the segment containing targetDist
    let lo = 0;
    let hi = geo.cumDist.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (geo.cumDist[mid + 1] < targetDist) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;

    const segLen = geo.cumDist[i + 1] - geo.cumDist[i];
    const t = segLen > 0 ? (targetDist - geo.cumDist[i]) / segLen : 0;

    const p1 = geo.coords[i];
    const p2 = geo.coords[i + 1];

    const lng = p1[0] + (p2[0] - p1[0]) * t;
    const lat = p1[1] + (p2[1] - p1[1]) * t;
    const bearing = this.calcBearing(p1[1], p1[0], p2[1], p2[0]);

    return { lat, lng, bearing };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Resolve which logical stops a fraction falls between
  // ─────────────────────────────────────────────────────────────────────
  private resolveStops(route: BusRoute, fraction: number): { currentStopId: string; nextStopId: string } {
    const stops = route.stops;
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
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    if (this.tickInterval) return;

    console.log('🗺️  Fetching OSRM road geometries for simulator...');
    for (const route of stateStore.routes.values()) {
      const stops = route.stops
        .map(id => stateStore.stops.get(id))
        .filter(Boolean) as BusStop[];
      if (stops.length < 2) continue;

      const coordStr = stops.map(s => `${s.lng},${s.lat}`).join(';');
      try {
        const res = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`
        );
        const data = await res.json();
        if (data.routes?.length > 0) {
          const raw: [number, number][] = data.routes[0].geometry.coordinates;
          this.osrm[route.id] = this.buildGeometry(raw);
          console.log(`  ✅ ${route.shortCode}: ${raw.length} waypoints, ${(this.osrm[route.id].totalLen / 1000).toFixed(1)} km`);
        }
      } catch (e) {
        console.error(`  ❌ OSRM fetch failed for ${route.id}:`, e);
      }
    }

    console.log('🎮 SimulatorService started — demo scenario beginning');
    eventBus.publish(
      EVENTS.SIMULATION_LOG,
      'Simulator started. Buses initialized on OSRM road geometry. Awaiting manual surge trigger.'
    );
    this.initializeBuses();
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
  }

  triggerSurge(): void {
    console.log('\n🌊 SURGE: Manual demand spike at Silk Board (Route 1) triggered!');
    eventBus.publish(
      EVENTS.SIMULATION_LOG,
      'MANUAL TRIGGER: Injecting massive passenger surge at Silk Board (R1).'
    );
    this.injectPassengerSurge();
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Initialize buses at evenly-spaced positions on their routes
  // ─────────────────────────────────────────────────────────────────────
  private initializeBuses(): void {
    const routeConfigs = [
      // Route 1: 3 buses
      { id: 'bus-1', reg: 'KA-01-A-1234', routeId: 'route-1', positionFraction: 0.0,  driverId: 'drv-1' },
      { id: 'bus-2', reg: 'KA-01-A-5678', routeId: 'route-1', positionFraction: 0.33, driverId: 'drv-2' },
      { id: 'bus-3', reg: 'KA-01-A-9012', routeId: 'route-1', positionFraction: 0.66, driverId: 'drv-3' },
      // Route 2: 3 buses (bus-6 is the reroute candidate — mid-route, low occupancy)
      { id: 'bus-4', reg: 'KA-01-B-1234', routeId: 'route-2', positionFraction: 0.0,  driverId: 'drv-4' },
      { id: 'bus-5', reg: 'KA-01-B-5678', routeId: 'route-2', positionFraction: 0.33, driverId: 'drv-5' },
      { id: 'bus-6', reg: 'KA-01-B-9012', routeId: 'route-2', positionFraction: 0.66, driverId: 'drv-6' },
      // Route 3: 2 buses
      { id: 'bus-7', reg: 'KA-01-C-1234', routeId: 'route-3', positionFraction: 0.0,  driverId: 'drv-7' },
      { id: 'bus-8', reg: 'KA-01-C-5678', routeId: 'route-3', positionFraction: 0.5,  driverId: 'drv-8' },
    ];

    for (const config of routeConfigs) {
      const route = stateStore.routes.get(config.routeId);
      if (!route) continue;

      const geo = this.osrm[config.routeId];
      let lat = 12.97, lng = 77.61, bearing = 0;
      if (geo) {
        const pos = this.lookupPosition(geo, config.positionFraction);
        lat = pos.lat; lng = pos.lng; bearing = pos.bearing;
      }

      const { currentStopId, nextStopId } = this.resolveStops(route, config.positionFraction);

      const bus: BusVehicle = {
        id: config.id,
        registrationNo: config.reg,
        vehicleType: 'STANDARD',
        capacitySeated: 40,
        capacityStanding: 20,
        totalCapacity: 60,
        hasLowFloorAccess: config.id === 'bus-4',
        isElectric: false,
        homeRouteId: config.routeId,
        currentRouteId: config.routeId,
        currentStopId,
        nextStopId,
        positionFraction: config.positionFraction,
        occupancyCount: Math.floor(Math.random() * 15) + 5,
        occupancyPct: 0,
        status: 'IN_SERVICE',
        activeRerouteId: null,
        currentDriverId: config.driverId,
        shiftEndTime: Date.now() + 6 * 60 * 60 * 1000,
        lat,
        lng,
        bearing,
        lastGpsUpdate: Date.now(),
        gpsStale: false,
        onboardManifest: {},
      };
      bus.occupancyPct = Math.round((bus.occupancyCount / bus.totalCapacity) * 100) / 100;
      stateStore.buses.set(bus.id, bus);
    }

    console.log(`🚌 Initialized ${stateStore.buses.size} buses on OSRM road geometry`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Tick — advance every bus by one speed step
  // ─────────────────────────────────────────────────────────────────────
  private tick(): void {
    this.tickCount++;
    const now = Date.now();

    for (const bus of stateStore.buses.values()) {
      if (bus.status === 'REROUTING' || bus.status === 'DEPOT') continue;

      const routeId = bus.currentRouteId;
      if (!routeId) continue;
      const route = stateStore.routes.get(routeId);
      if (!route) continue;

      // Advance fraction — 0.003 / tick × 2s tick → full route in ~11 min
      bus.positionFraction = (bus.positionFraction + 0.003) % 1.0;

      const geo = this.osrm[routeId];
      if (geo) {
        const pos = this.lookupPosition(geo, bus.positionFraction);
        bus.lat = pos.lat;
        bus.lng = pos.lng;
        bus.bearing = pos.bearing;
      }

      const { currentStopId, nextStopId } = this.resolveStops(route, bus.positionFraction);
      bus.currentStopId = currentStopId;
      bus.nextStopId = nextStopId;
      bus.lastGpsUpdate = now;
      bus.gpsStale = false;

      // Natural occupancy fluctuation
      const delta = (Math.random() - 0.5) * 2;
      bus.occupancyCount = Math.max(0, Math.min(bus.totalCapacity, bus.occupancyCount + delta));
      bus.occupancyPct = Math.round((bus.occupancyCount / bus.totalCapacity) * 100) / 100;

      stateStore.buses.set(bus.id, bus);
    }

    // Broadcast to dashboard
    eventBus.publish(EVENTS.VEHICLE_POSITION_UPDATED, {
      buses: [...stateStore.buses.values()],
    });

    // Organic check-ins every ~30s (15 ticks × 2s)
    if (this.tickCount % 15 === 0) {
      this.generateOrganicCheckIns();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Surge injection
  // ─────────────────────────────────────────────────────────────────────
  private injectPassengerSurge(): void {
    const initialSurge = 30;

    for (let i = 0; i < initialSurge; i++) {
      stateStore.checkIns.set(uuidv4(), {
        id: uuidv4(),
        deviceId: `sim-surge-${i}`,
        stopId: this.surgeStopId,
        routeId: this.surgeRouteId,
        destinationStopId: 'stop-5',
        groupSize: 1,
        groupConfirmedCount: 0,
        state: 'ACTIVE',
        abandonReason: null,
        confidenceScore: 1.0,
        demandWeight: 1.0,
        satisfactionType: null,
        checkedInAt: Date.now() - Math.floor(Math.random() * 3 * 60 * 1000),
        stateChangedAt: Date.now(),
        busBoardedId: null,
      });
    }

    eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId: this.surgeStopId, routeId: this.surgeRouteId });
    eventBus.publish(EVENTS.SIMULATION_LOG, `Injected ${initialSurge} surge check-ins at Silk Board.`);
    console.log(`  ✅ Injected ${initialSurge} surge check-ins at Silk Board`);

    let wave = 0;
    const surgeTimer = setInterval(() => {
      if (wave >= 6) { clearInterval(surgeTimer); return; }
      for (let i = 0; i < 5; i++) {
        const id = uuidv4();
        stateStore.checkIns.set(id, {
          id,
          deviceId: `sim-wave${wave}-${i}`,
          stopId: this.surgeStopId,
          routeId: this.surgeRouteId,
          destinationStopId: 'stop-5',
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
      eventBus.publish(EVENTS.DEMAND_UPDATED, { stopId: this.surgeStopId, routeId: this.surgeRouteId });
      eventBus.publish(EVENTS.SIMULATION_LOG, `Sustaining surge: Added 5 more check-ins (Wave ${wave + 1}/6)`);
      wave++;
    }, 20_000);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Organic activity
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
        confidenceScore: 0.9,
        demandWeight: 0.9,
        satisfactionType: null,
        checkedInAt: Date.now(),
        stateChangedAt: Date.now(),
        busBoardedId: null,
      });
    }
    eventBus.publish(
      EVENTS.SIMULATION_LOG,
      `Organic activity: Generated ${count} check-ins at ${randomStopId} on ${randomRoute.shortCode}`
    );
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
}

export const simulatorService = new SimulatorService();

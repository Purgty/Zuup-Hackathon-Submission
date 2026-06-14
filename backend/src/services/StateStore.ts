import type {
  BusVehicle,
  BusRoute,
  BusStop,
  Driver,
  PassengerCheckIn,
  LatentDemandRecord,
  RerouteOrder,
  StopDemandSnapshot,
  Alert,
  HistoricalDemandBaseline,
} from '../types';
import db, { initDatabase } from '../database/db';

/**
 * StateStore — Single source of truth for all real-time and persistent data.
 *
 * - Real-time data (buses, check-ins, alerts, reroutes) lives in memory for speed.
 * - Static data (routes, stops, drivers, baselines) is loaded from SQLite at startup.
 * - Audit logs are written to SQLite.
 */
export class StateStore {
  // ─── Real-time in-memory state ───────────────────────────────
  buses = new Map<string, BusVehicle>();
  checkIns = new Map<string, PassengerCheckIn>();
  latentDemands = new Map<string, LatentDemandRecord>();
  rerouteOrders = new Map<string, RerouteOrder>();
  alerts: Alert[] = [];

  // Computed every 30s by RouteIntelligenceService
  // Key: `${stopId}:${routeId}`
  demandSnapshots = new Map<string, StopDemandSnapshot>();

  // ─── Persistent data (loaded from SQLite at startup) ─────────
  routes = new Map<string, BusRoute>();
  stops = new Map<string, BusStop>();
  drivers = new Map<string, Driver>();
  baselines: HistoricalDemandBaseline[] = [];

  // ─────────────────────────────────────────────────────────────
  // Bootstrap — load static data from database
  // ─────────────────────────────────────────────────────────────

  load(): void {
    initDatabase();

    // Routes
    const rawRoutes = db.prepare('SELECT * FROM bus_routes').all() as any[];
    for (const r of rawRoutes) {
      this.routes.set(r.id, {
        id: r.id,
        name: r.name,
        shortCode: r.short_code,
        stops: JSON.parse(r.stops),
        routeType: r.route_type,
        scheduledFrequencyMin: r.scheduled_frequency_min,
        serviceGuarantee: JSON.parse(r.service_guarantee),
        compatibleVehicleTypes: JSON.parse(r.compatible_vehicle_types),
        requiresLowFloor: r.requires_low_floor === 1,
        color: r.color,
      });
    }

    // Stops
    const rawStops = db.prepare('SELECT * FROM bus_stops').all() as any[];
    for (const s of rawStops) {
      this.stops.set(s.id, {
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        geofenceRadiusM: s.geofence_radius_m,
        routesServing: JSON.parse(s.routes_serving),
        requiresLowFloor: s.requires_low_floor === 1,
        isTerminus: s.is_terminus === 1,
        isActive: s.is_active === 1,
      });
    }

    // Drivers
    const rawDrivers = db.prepare('SELECT * FROM drivers').all() as any[];
    for (const d of rawDrivers) {
      this.drivers.set(d.id, {
        id: d.id,
        name: d.name,
        currentVehicleId: d.current_vehicle_id,
        shiftStart: d.shift_start,
        shiftEnd: d.shift_end,
        rerouteRejectionsToday: d.reroute_rejections_today,
        isAvailable: d.is_available === 1,
      });
    }

    // Baselines
    const rawBaselines = db.prepare('SELECT * FROM historical_demand_baselines').all() as any[];
    this.baselines = rawBaselines.map((b) => ({
      stopId: b.stop_id,
      routeId: b.route_id,
      dayType: b.day_type,
      hourOfDay: b.hour_of_day,
      avgDemand: b.avg_demand,
      p75Demand: b.p75_demand,
      p95Demand: b.p95_demand,
    }));

    console.log(`✅ StateStore loaded: ${this.routes.size} routes, ${this.stops.size} stops, ${this.drivers.size} drivers, ${this.baselines.length} baselines`);
  }

  // ─────────────────────────────────────────────────────────────
  // Convenience accessors
  // ─────────────────────────────────────────────────────────────

  getBusesOnRoute(routeId: string): BusVehicle[] {
    return [...this.buses.values()].filter((b) => b.currentRouteId === routeId);
  }

  getActiveCheckIns(stopId: string, routeId: string): PassengerCheckIn[] {
    return [...this.checkIns.values()].filter(
      (ci) => ci.stopId === stopId && ci.routeId === routeId && ['ACTIVE', 'PENDING', 'BOARDING'].includes(ci.state)
    );
  }

  getActiveAlerts(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  getPendingRerouteOrders(): RerouteOrder[] {
    return [...this.rerouteOrders.values()].filter((r) =>
      ['RECOMMENDED', 'PENDING_DRIVER', 'SOFT_COMMITTED'].includes(r.status)
    );
  }

  getSnapshot(): {
    buses: BusVehicle[];
    routes: BusRoute[];
    stops: BusStop[];
    demandSnapshots: StopDemandSnapshot[];
    alerts: Alert[];
    rerouteOrders: RerouteOrder[];
  } {
    return {
      buses: [...this.buses.values()],
      routes: [...this.routes.values()],
      stops: [...this.stops.values()],
      demandSnapshots: [...this.demandSnapshots.values()],
      alerts: this.alerts.slice(-50), // last 50 alerts
      rerouteOrders: [...this.rerouteOrders.values()],
    };
  }
}

// Singleton instance shared across all services
export const stateStore = new StateStore();

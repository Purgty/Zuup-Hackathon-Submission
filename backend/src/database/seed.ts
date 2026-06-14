/**
 * Seed script — populates the SQLite database with a realistic Bangalore demo scenario.
 * Routes: 3 routes through Bangalore corridors
 * Stops:  14 stops across the routes (some shared = transfer points)
 * Buses:  8 buses (3 on R1, 3 on R2, 2 on R3)
 * Drivers: 8 drivers
 *
 * Run: npm run seed
 */

import dotenv from 'dotenv';
dotenv.config();

import { v4 as uuidv4 } from 'uuid';
import db, { initDatabase } from './db';
import type {
  BusRoute,
  BusStop,
  Driver,
  HistoricalDemandBaseline,
  DayType,
} from '../types';

// ─────────────────────────────────────────────────────────────
// Define Stops (Clean Bangalore Corridors)
// ─────────────────────────────────────────────────────────────

const stops: BusStop[] = [
  // Route 1: City Center to South (MG Road to Dairy Circle)
  { id: 'stop-1', name: 'MG Road', lat: 12.9752, lng: 77.6095, geofenceRadiusM: 150, routesServing: ['route-1', 'route-3'], requiresLowFloor: false, isTerminus: true, isActive: true },
  { id: 'stop-2', name: 'Brigade Road', lat: 12.9732, lng: 77.6075, geofenceRadiusM: 100, routesServing: ['route-1'], requiresLowFloor: false, isTerminus: false, isActive: true },
  { id: 'stop-3', name: 'Richmond Circle', lat: 12.9645, lng: 77.5971, geofenceRadiusM: 100, routesServing: ['route-1'], requiresLowFloor: false, isTerminus: false, isActive: true },
  { id: 'stop-4', name: 'Shantinagar TTMC', lat: 12.9515, lng: 77.5954, geofenceRadiusM: 150, routesServing: ['route-1'], requiresLowFloor: false, isTerminus: false, isActive: true },
  { id: 'stop-5', name: 'Dairy Circle', lat: 12.9377, lng: 77.5998, geofenceRadiusM: 120, routesServing: ['route-1', 'route-2'], requiresLowFloor: false, isTerminus: true, isActive: true },

  // Route 2: East to South (Indiranagar to Dairy Circle)
  { id: 'stop-6', name: 'Indiranagar 100ft', lat: 12.9784, lng: 77.6408, geofenceRadiusM: 150, routesServing: ['route-2', 'route-3'], requiresLowFloor: true, isTerminus: true, isActive: true },
  { id: 'stop-7', name: 'Domlur TTMC', lat: 12.9622, lng: 77.6383, geofenceRadiusM: 100, routesServing: ['route-2'], requiresLowFloor: false, isTerminus: false, isActive: true },
  { id: 'stop-8', name: 'Sony World Junction', lat: 12.9365, lng: 77.6253, geofenceRadiusM: 100, routesServing: ['route-2'], requiresLowFloor: false, isTerminus: false, isActive: true },
  { id: 'stop-9', name: 'Forum Mall Koramangala', lat: 12.9344, lng: 77.6111, geofenceRadiusM: 100, routesServing: ['route-2'], requiresLowFloor: false, isTerminus: false, isActive: true },
  // stop-5 (Dairy Circle) is shared terminus

  // Route 3: East to City Center (Indiranagar to MG Road)
  { id: 'stop-10', name: 'Ulsoor Lake', lat: 12.9760, lng: 77.6225, geofenceRadiusM: 100, routesServing: ['route-3'], requiresLowFloor: false, isTerminus: false, isActive: true },
  // stop-1 (MG Road) is shared terminus
];

// ─────────────────────────────────────────────────────────────
// Define Routes
// ─────────────────────────────────────────────────────────────

const routes: BusRoute[] = [
  {
    id: 'route-1',
    name: 'MG Road → Dairy Circle',
    shortCode: 'R1',
    stops: ['stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5'],
    routeType: 'HIGH_FREQ',
    scheduledFrequencyMin: 10,
    serviceGuarantee: { maxWaitMinutes: 15, minBusesInService: 2, lastBusProtectionMin: 20 },
    compatibleVehicleTypes: ['STANDARD', 'MIDI'],
    requiresLowFloor: false,
    color: '#3b82f6', // blue
  },
  {
    id: 'route-2',
    name: 'Indiranagar → Dairy Circle',
    shortCode: 'R2',
    stops: ['stop-6', 'stop-7', 'stop-8', 'stop-9', 'stop-5'],
    routeType: 'MEDIUM_FREQ',
    scheduledFrequencyMin: 15,
    serviceGuarantee: { maxWaitMinutes: 25, minBusesInService: 1, lastBusProtectionMin: 30 },
    compatibleVehicleTypes: ['STANDARD', 'LOW_FLOOR'],
    requiresLowFloor: false,
    color: '#10b981', // green
  },
  {
    id: 'route-3',
    name: 'Indiranagar → MG Road',
    shortCode: 'R3',
    stops: ['stop-6', 'stop-10', 'stop-1'],
    routeType: 'MEDIUM_FREQ',
    scheduledFrequencyMin: 15,
    serviceGuarantee: { maxWaitMinutes: 20, minBusesInService: 1, lastBusProtectionMin: 30 },
    compatibleVehicleTypes: ['STANDARD', 'ARTICULATED'],
    requiresLowFloor: false,
    color: '#f59e0b', // amber
  },
];

// ─────────────────────────────────────────────────────────────
// Define Drivers
// ─────────────────────────────────────────────────────────────

const shiftStart = Date.now() - 2 * 60 * 60 * 1000; // started 2 hours ago
const shiftEnd = shiftStart + 8 * 60 * 60 * 1000;   // 8-hour shift

const drivers: Driver[] = [
  { id: 'drv-1', name: 'Rajan Kumar', currentVehicleId: 'bus-1', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-2', name: 'Suresh Nair', currentVehicleId: 'bus-2', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-3', name: 'Arjun Rao', currentVehicleId: 'bus-3', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-4', name: 'Priya Menon', currentVehicleId: 'bus-4', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-5', name: 'Karthik Iyer', currentVehicleId: 'bus-5', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-6', name: 'Deepa Srinivas', currentVehicleId: 'bus-6', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-7', name: 'Venkat Reddy', currentVehicleId: 'bus-7', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
  { id: 'drv-8', name: 'Anitha Bhat', currentVehicleId: 'bus-8', shiftStart, shiftEnd, rerouteRejectionsToday: 0, isAvailable: true },
];

// ─────────────────────────────────────────────────────────────
// Generate Historical Demand Baselines
// ─────────────────────────────────────────────────────────────

function generateBaselines(): HistoricalDemandBaseline[] {
  const baselines: HistoricalDemandBaseline[] = [];
  const dayTypes: DayType[] = ['WEEKDAY', 'SATURDAY', 'SUNDAY'];

  // Demand profiles per stop (hour → avg passengers)
  const stopDemandProfiles: Record<string, number[]> = {
    'stop-1': [3,2,1,2,4,8,18,25,22,12,10,13,15,18,14,12,17,25,22,14,10,7,4,3], // Silk Board (high)
    'stop-2': [1,1,0,1,2,4,10,15,12,7,6,8,9,11,9,7,10,15,13,9,6,4,2,1],
    'stop-3': [2,1,1,1,3,6,14,20,16,9,8,10,12,14,11,9,13,20,17,11,8,5,3,2],
    'stop-4': [2,1,1,1,3,6,13,18,15,8,7,9,11,13,10,8,12,18,15,10,7,5,3,2],
    'stop-5': [3,2,1,2,4,7,16,22,18,10,9,12,14,16,13,11,15,22,19,12,9,6,4,3], // Corp Circle (high)
    'stop-6': [2,1,1,1,3,5,12,16,14,7,7,9,10,12,9,8,11,16,14,9,7,4,3,2],
    'stop-7': [1,1,0,1,2,4,9,13,11,6,6,8,9,10,8,7,10,14,12,8,6,4,2,1],
    'stop-8': [1,1,0,1,2,4,8,12,10,5,5,7,8,9,7,6,9,12,10,7,5,3,2,1],
    'stop-9': [1,1,0,1,2,4,8,12,10,6,5,7,8,9,7,6,8,12,10,7,5,3,2,1],
    'stop-10': [2,1,1,1,3,5,12,17,14,8,7,9,11,13,10,8,12,17,14,9,7,4,3,2],
    'stop-11': [2,1,1,1,3,5,11,15,12,7,6,8,10,11,9,7,10,15,13,8,6,4,3,2],
    'stop-12': [1,1,0,1,2,4,9,13,11,6,5,7,8,9,7,6,9,13,11,7,5,3,2,1],
    'stop-13': [1,1,0,1,2,3,7,10,8,5,4,6,7,8,6,5,7,10,9,6,4,3,2,1],
    'stop-14': [2,1,1,1,2,5,12,18,14,8,7,9,11,13,10,8,12,18,15,10,7,5,3,2],
    'stop-15': [3,2,1,2,4,8,18,25,22,12,10,13,15,18,14,12,17,25,22,14,10,7,4,3],
  };

  for (const stop of stops) {
    const profile = stopDemandProfiles[stop.id] || new Array(24).fill(5);

    for (const dayType of dayTypes) {
      for (let h = 0; h < 24; h++) {
        let avg = profile[h];
        if (dayType === 'SATURDAY') avg *= 0.7;
        if (dayType === 'SUNDAY') avg *= 0.5;

        // Each stop serves at least one route; add record for primary route
        const routeIds = stop.routesServing;
        for (const routeId of routeIds) {
          baselines.push({
            stopId: stop.id,
            routeId,
            dayType,
            hourOfDay: h,
            avgDemand: avg,
            p75Demand: avg * 1.4,
            p95Demand: avg * 2.1,
          });
        }
      }
    }
  }

  return baselines;
}

// ─────────────────────────────────────────────────────────────
// Main Seed Function
// ─────────────────────────────────────────────────────────────

function seed(): void {
  console.log('🌱 Initializing database...');
  initDatabase();

  // Clear existing data
  db.exec(`
    DELETE FROM bus_routes;
    DELETE FROM bus_stops;
    DELETE FROM drivers;
    DELETE FROM historical_demand_baselines;
    DELETE FROM audit_logs;
  `);
  console.log('🗑️  Cleared existing data');

  // Insert stops
  const insertStop = db.prepare(`
    INSERT INTO bus_stops (id, name, lat, lng, geofence_radius_m, routes_serving, requires_low_floor, is_terminus, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const stop of stops) {
    insertStop.run(stop.id, stop.name, stop.lat, stop.lng, stop.geofenceRadiusM,
      JSON.stringify(stop.routesServing), stop.requiresLowFloor ? 1 : 0, stop.isTerminus ? 1 : 0, stop.isActive ? 1 : 0);
  }
  console.log(`✅ Inserted ${stops.length} stops`);

  // Insert routes
  const insertRoute = db.prepare(`
    INSERT INTO bus_routes (id, name, short_code, stops, route_type, scheduled_frequency_min, service_guarantee, compatible_vehicle_types, requires_low_floor, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const route of routes) {
    insertRoute.run(route.id, route.name, route.shortCode, JSON.stringify(route.stops),
      route.routeType, route.scheduledFrequencyMin, JSON.stringify(route.serviceGuarantee),
      JSON.stringify(route.compatibleVehicleTypes), route.requiresLowFloor ? 1 : 0, route.color);
  }
  console.log(`✅ Inserted ${routes.length} routes`);

  // Insert drivers
  const insertDriver = db.prepare(`
    INSERT INTO drivers (id, name, current_vehicle_id, shift_start, shift_end, reroute_rejections_today, is_available)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const driver of drivers) {
    insertDriver.run(driver.id, driver.name, driver.currentVehicleId, driver.shiftStart, driver.shiftEnd,
      driver.rerouteRejectionsToday, driver.isAvailable ? 1 : 0);
  }
  console.log(`✅ Inserted ${drivers.length} drivers`);

  // Insert baselines
  const baselines = generateBaselines();
  const insertBaseline = db.prepare(`
    INSERT INTO historical_demand_baselines (stop_id, route_id, day_type, hour_of_day, avg_demand, p75_demand, p95_demand)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertManyBaselines = db.transaction((items: HistoricalDemandBaseline[]) => {
    for (const b of items) {
      insertBaseline.run(b.stopId, b.routeId, b.dayType, b.hourOfDay, b.avgDemand, b.p75Demand, b.p95Demand);
    }
  });
  insertManyBaselines(baselines);
  console.log(`✅ Inserted ${baselines.length} demand baseline records`);

  console.log('\n🚌 Database seeded successfully!');
  console.log('   Routes:', routes.map(r => `${r.shortCode} (${r.name})`).join(', '));
  console.log('   Stops:', stops.length);
  console.log('   Drivers:', drivers.length);
  console.log('   Baselines:', baselines.length);
  console.log('\n   Run "npm run dev" to start the server.');
}

seed();

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || './data/zuup.db';
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bus_routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_code TEXT NOT NULL,
      stops TEXT NOT NULL,          -- JSON array of stop IDs (ordered)
      route_type TEXT NOT NULL,
      scheduled_frequency_min INTEGER NOT NULL,
      service_guarantee TEXT NOT NULL, -- JSON
      compatible_vehicle_types TEXT NOT NULL, -- JSON array
      requires_low_floor INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS bus_stops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      geofence_radius_m INTEGER NOT NULL DEFAULT 100,
      routes_serving TEXT NOT NULL,  -- JSON array
      requires_low_floor INTEGER NOT NULL DEFAULT 0,
      is_terminus INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_vehicle_id TEXT,
      shift_start INTEGER NOT NULL,
      shift_end INTEGER NOT NULL,
      reroute_rejections_today INTEGER NOT NULL DEFAULT 0,
      is_available INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS historical_demand_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stop_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      day_type TEXT NOT NULL,
      hour_of_day INTEGER NOT NULL,
      avg_demand REAL NOT NULL,
      p75_demand REAL NOT NULL,
      p95_demand REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      performed_by_type TEXT NOT NULL,
      performed_by_id TEXT,
      data_snapshot TEXT,           -- JSON
      outcome TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

export default db;

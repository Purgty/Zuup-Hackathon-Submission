import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────

export const EVENTS = {
  DEMAND_UPDATED: 'demand.updated',
  VEHICLE_POSITION_UPDATED: 'vehicle.position.updated',
  VEHICLE_STALE_DETECTED: 'vehicle.stale_detected',
  VEHICLE_BREAKDOWN: 'vehicle.breakdown',
  CHECKIN_STATE_CHANGED: 'checkin.state.changed',
  LATENT_DEMAND_CREATED: 'latent.demand.created',
  REROUTE_RECOMMENDED: 'reroute.recommended',
  REROUTE_CONFIRMED: 'reroute.confirmed',
  REROUTE_CANCELLED: 'reroute.cancelled',
  REROUTE_REVERSED: 'reroute.reversed',
  REROUTE_STATUS_CHANGED: 'reroute.status.changed',
  ALERT_ISSUED: 'alert.issued',
  ALERT_ACKNOWLEDGED: 'alert.acknowledged',
  OVERLOAD_DETECTED: 'route.overload.detected',
  BUNCHING_DETECTED: 'route.bunching.detected',
  SIMULATION_LOG: 'simulation.log',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// ─────────────────────────────────────────────────────────────
// Singleton Event Bus (simulates Kafka for local dev)
// ─────────────────────────────────────────────────────────────

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // accommodate many service subscribers
  }

  publish(event: EventName, payload: unknown): void {
    this.emit(event, payload);
  }

  subscribe(event: EventName, handler: (payload: unknown) => void): void {
    this.on(event, handler);
  }

  unsubscribe(event: EventName, handler: (payload: unknown) => void): void {
    this.off(event, handler);
  }
}

// Export a single shared instance
export const eventBus = new EventBus();

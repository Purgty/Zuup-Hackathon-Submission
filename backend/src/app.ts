import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { stateStore } from './services/StateStore';
import { checkInLifecycleManager } from './services/CheckInLifecycleManager';
import { RouteIntelligenceService } from './services/RouteIntelligenceService';
import { RerouteEngine } from './services/RerouteEngine';
import { simulatorService } from './services/SimulatorService';
import { OperatorStreamHandler } from './websocket/OperatorStreamHandler';

// ─── Adapter selection (INJECTION POINT) ─────────────────────────────────────
// Change ROUTING_ADAPTER and NOTIFICATION_ADAPTER in your .env to swap adapters

import { MockRoutingService } from './adapters/mock/MockRoutingService';
import { MockNotificationService } from './adapters/mock/MockNotificationService';
import { MapboxRoutingService } from './adapters/real/MapboxRoutingService';

import type { IRoutingService } from './interfaces/IRoutingService';
import type { INotificationService } from './interfaces/INotificationService';

function createRoutingService(): IRoutingService {
  const adapter = process.env.ROUTING_ADAPTER || 'mock';
  if (adapter === 'mapbox') {
    console.log('🗺️  Routing adapter: Mapbox');
    return new MapboxRoutingService(process.env.MAPBOX_TOKEN || '');
  }
  console.log('🗺️  Routing adapter: Mock (Haversine)');
  return new MockRoutingService();
}

function createNotificationService(): INotificationService {
  const adapter = process.env.NOTIFICATION_ADAPTER || 'mock';
  if (adapter === 'firebase') {
    console.log('📱 Notification adapter: Firebase FCM');
    // return new FirebaseNotificationService(process.env.FIREBASE_SERVER_KEY || '');
    throw new Error('Firebase adapter not yet implemented. Set NOTIFICATION_ADAPTER=mock');
  }
  console.log('📱 Notification adapter: Mock (console.log)');
  return new MockNotificationService();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

import operatorRoutes from './routes/operator.routes';
import demandRoutes from './routes/demand.routes';

// ─────────────────────────────────────────────────────────────────────────────

export async function createApp() {
  // 1. Load static data from database
  stateStore.load();

  // 2. Create adapter instances (the injection point)
  const routingService = createRoutingService();
  const notificationService = createNotificationService();

  // 3. Wire up services with their dependencies
  const routeIntelligenceService = new RouteIntelligenceService(routingService);
  const rerouteEngine = new RerouteEngine(routingService, notificationService);

  // 4. Start background services
  checkInLifecycleManager.start();
  routeIntelligenceService.start();
  await simulatorService.start();

  // 5. Create Express app
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // 6. Attach services to app.locals so routes can access them
  app.locals.rerouteEngine = rerouteEngine;
  app.locals.routingService = routingService;

  // 7. Register routes
  app.use('/api/operator', operatorRoutes);
  app.use('/api/demand', demandRoutes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      buses: stateStore.buses.size,
      checkIns: stateStore.checkIns.size,
      alerts: stateStore.alerts.length,
      routes: stateStore.routes.size,
      stops: stateStore.stops.size,
    });
  });

  // 8. Start WebSocket server
  const wsPort = parseInt(process.env.WS_PORT || '4001');
  new OperatorStreamHandler(wsPort);

  return app;
}

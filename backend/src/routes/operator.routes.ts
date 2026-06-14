import { Router, Request, Response } from 'express';
import { stateStore } from '../services/StateStore';
import { eventBus, EVENTS } from '../events/EventBus';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';

const router = Router();

/** GET /api/operator/routes/health — route health overview */
router.get('/routes/health', (_req: Request, res: Response) => {
  const health = [...stateStore.routes.values()].map((route) => {
    const buses = stateStore.getBusesOnRoute(route.id);
    const snapshots = route.stops
      .map((stopId) => stateStore.demandSnapshots.get(`${stopId}:${route.id}`))
      .filter(Boolean);

    const overloadedStops = snapshots.filter((s) => s!.overloadFlag).length;
    const bunchingDetected = snapshots.some((s) => s!.bunchingFlag);
    const avgDemand = snapshots.reduce((sum, s) => sum + s!.totalDemand, 0) / (snapshots.length || 1);

    return {
      routeId: route.id,
      routeName: route.name,
      shortCode: route.shortCode,
      busCount: buses.length,
      inServiceCount: buses.filter((b) => b.status === 'IN_SERVICE').length,
      reroutingCount: buses.filter((b) => b.status === 'REROUTING').length,
      overloadedStops,
      bunchingDetected,
      avgDemand: Math.round(avgDemand * 10) / 10,
      color: route.color,
    };
  });
  res.json({ success: true, data: health });
});

/** GET /api/operator/buses — all bus states */
router.get('/buses', (_req: Request, res: Response) => {
  res.json({ success: true, data: [...stateStore.buses.values()] });
});

/** GET /api/operator/alerts — alert queue */
router.get('/alerts', (_req: Request, res: Response) => {
  res.json({ success: true, data: stateStore.getActiveAlerts() });
});

/** POST /api/operator/alerts/:id/acknowledge */
router.post('/alerts/:id/acknowledge', (req: Request, res: Response) => {
  const alert = stateStore.alerts.find((a) => a.id === req.params.id);
  if (!alert) return res.status(404).json({ success: false, error: 'Alert not found' });
  alert.acknowledged = true;
  eventBus.publish(EVENTS.ALERT_ACKNOWLEDGED, { alertId: alert.id });
  res.json({ success: true });
});

/** GET /api/operator/reroutes — all reroute orders */
router.get('/reroutes', (_req: Request, res: Response) => {
  res.json({ success: true, data: [...stateStore.rerouteOrders.values()] });
});

/** POST /api/operator/reroutes/:id/approve */
router.post('/reroutes/:id/approve', async (req: Request, res: Response) => {
  const { rerouteEngine } = req.app.locals;
  const result = await rerouteEngine.approveReroute(req.params.id, 'operator-1');
  if (!result.success) return res.status(400).json(result);

  // Log to audit
  db.prepare(`
    INSERT INTO audit_logs (id, event_type, entity_type, entity_id, performed_by_type, performed_by_id, outcome, created_at)
    VALUES (?, 'REROUTE_APPROVED', 'RerouteOrder', ?, 'OPERATOR', 'operator-1', 'APPROVED', ?)
  `).run(uuidv4(), req.params.id, Date.now());

  res.json({ success: true, message: 'Reroute approved. Driver notification sent.' });
});

/** POST /api/operator/reroutes/:id/reject */
router.post('/reroutes/:id/reject', (req: Request, res: Response) => {
  const order = stateStore.rerouteOrders.get(req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  order.status = 'CANCELLED';
  order.cancelledReason = req.body.reason || 'Rejected by operator';

  const bus = stateStore.buses.get(order.busId);
  if (bus) { bus.activeRerouteId = null; stateStore.buses.set(bus.id, bus); }

  eventBus.publish(EVENTS.REROUTE_CANCELLED, order);
  eventBus.publish(EVENTS.REROUTE_STATUS_CHANGED, order);

  res.json({ success: true });
});

/** GET /api/operator/demand/snapshots — all stop demand snapshots */
router.get('/demand/snapshots', (_req: Request, res: Response) => {
  res.json({ success: true, data: [...stateStore.demandSnapshots.values()] });
});

/** GET /api/operator/state — full system snapshot for initial load */
router.get('/state', (_req: Request, res: Response) => {
  res.json({ success: true, data: stateStore.getSnapshot() });
});

/** POST /api/operator/simulate/surge — manual trigger for demo */
router.post('/simulate/surge', (req: Request, res: Response) => {
  const { stopId, routeId, count } = req.body ?? {};
  import('../services/SimulatorService').then(({ simulatorService }) => {
    simulatorService.triggerSurge({
      stopId: typeof stopId === 'string' ? stopId : undefined,
      routeId: typeof routeId === 'string' ? routeId : undefined,
      count: typeof count === 'number' ? count : undefined,
    });
    res.json({ success: true, message: `Surge triggered at ${stopId ?? 'stop-1'} on ${routeId ?? 'route-1'}` });
  });
});

/**
 * POST /api/operator/simulate/scenario
 * body: { scenario: 'END_TERMINUS' | 'START_TERMINUS' | 'OVERWHELMING' | 'MULTI_ROUTE' }
 *
 * Runs structured demo scenarios to showcase specific edge cases:
 *   END_TERMINUS   — surge at the last stop of R1 (Dairy Circle) → end terminus reserve deploys
 *   START_TERMINUS — surge at the first stop of R1 (MG Road)    → start terminus reserve deploys
 *   OVERWHELMING   — very large surge that exhausts reserves → triggers cross-route reallocation
 *   MULTI_ROUTE    — simultaneous surges on R1 and R2         → both route reserves deploy in parallel
 */
router.post('/simulate/scenario', (req: Request, res: Response) => {
  const { scenario } = req.body ?? {};
  import('../services/SimulatorService').then(async ({ simulatorService }) => {
    switch (scenario) {

      case 'END_TERMINUS':
        // Surge at Dairy Circle (stop-5) — last stop on R1 (fraction ≈ 1.0)
        // Expected: end-terminus reserve RSV-B deploys, not RSV-A from the start
        simulatorService.triggerSurge({ stopId: 'stop-5', routeId: 'route-1', count: 40 });
        res.json({ success: true, scenario, description: 'Surge at Dairy Circle (R1 end) — end-terminus reserve RSV-B should deploy' });
        break;

      case 'START_TERMINUS':
        // Surge at MG Road (stop-1) — first stop on R1 (fraction = 0.0)
        // Expected: start-terminus reserve RSV-A deploys
        simulatorService.triggerSurge({ stopId: 'stop-1', routeId: 'route-1', count: 40 });
        res.json({ success: true, scenario, description: 'Surge at MG Road (R1 start) — start-terminus reserve RSV-A should deploy' });
        break;

      case 'OVERWHELMING':
        // 80 pax at Dairy Circle (end of R1), then 60 more 8s later to simulate both reserves being used
        // Expected: first surge uses end-terminus reserve; second surge exhausts it and triggers cross-route
        simulatorService.triggerSurge({ stopId: 'stop-5', routeId: 'route-1', count: 80 });
        setTimeout(() => {
          simulatorService.triggerSurge({ stopId: 'stop-5', routeId: 'route-1', count: 60 });
        }, 8_000);
        res.json({ success: true, scenario, description: 'Overwhelming surge at Dairy Circle — reserves exhausted then cross-route reallocation' });
        break;

      case 'MULTI_ROUTE':
        // Simultaneous surges on R1 (end) and R2 (end, also Dairy Circle which is the shared terminus)
        // Expected: R1 end-terminus reserve AND R2 end-terminus reserve both deploy in parallel
        simulatorService.triggerSurge({ stopId: 'stop-5', routeId: 'route-1', count: 40 });
        setTimeout(() => {
          simulatorService.triggerSurge({ stopId: 'stop-5', routeId: 'route-2', count: 40 });
        }, 1_500);
        res.json({ success: true, scenario, description: 'Simultaneous surge at shared Dairy Circle stop on R1 and R2 — parallel reserve deployment' });
        break;

      default:
        res.status(400).json({ success: false, error: `Unknown scenario: ${scenario}` });
    }
  });
});

export default router;

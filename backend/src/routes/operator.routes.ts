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
router.post('/simulate/surge', (_req: Request, res: Response) => {
  import('../services/SimulatorService').then(({ simulatorService }) => {
    simulatorService.triggerSurge();
    res.json({ success: true, message: 'Surge manually triggered' });
  });
});

export default router;

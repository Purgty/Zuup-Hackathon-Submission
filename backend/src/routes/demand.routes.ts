import { Router, Request, Response } from 'express';
import { demandIngestionService } from '../services/DemandIngestionService';
import { stateStore } from '../services/StateStore';

const router = Router();

/** POST /api/demand/check-in */
router.post('/check-in', (req: Request, res: Response) => {
  const { deviceId, stopId, routeId, destinationStopId, groupSize } = req.body;

  if (!deviceId || !stopId || !routeId) {
    return res.status(400).json({ success: false, error: 'deviceId, stopId, and routeId are required.' });
  }

  const result = demandIngestionService.checkIn({
    deviceId, stopId, routeId, destinationStopId, groupSize: groupSize || 1,
  });

  res.status(result.success ? 201 : 400).json(result);
});

/** POST /api/demand/check-in/:id/cancel */
router.post('/check-in/:id/cancel', (req: Request, res: Response) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required.' });
  const result = demandIngestionService.cancelCheckIn(req.params.id, deviceId);
  res.status(result.success ? 200 : 400).json(result);
});

/** GET /api/demand/stops — list all stops with current demand */
router.get('/stops', (_req: Request, res: Response) => {
  const stops = [...stateStore.stops.values()].map((stop) => {
    const snapshots = stop.routesServing.map((routeId) =>
      stateStore.demandSnapshots.get(`${stop.id}:${routeId}`)
    ).filter(Boolean);

    const totalDemand = snapshots.reduce((sum, s) => sum + s!.totalDemand, 0);
    return { ...stop, totalDemand, snapshots };
  });
  res.json({ success: true, data: stops });
});

export default router;

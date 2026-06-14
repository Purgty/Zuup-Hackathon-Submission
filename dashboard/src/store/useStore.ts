import { create } from 'zustand';
import type {
  BusVehicle, BusRoute, BusStop, StopDemandSnapshot,
  Alert, RerouteOrder, RouteHealth,
} from '../types';

interface ZuupStore {
  // Connection state
  connected: boolean;
  setConnected: (v: boolean) => void;

  // Core data
  buses: Record<string, BusVehicle>;
  routes: Record<string, BusRoute>;
  stops: Record<string, BusStop>;
  demandSnapshots: Record<string, StopDemandSnapshot>; // key: `${stopId}:${routeId}`
  alerts: Alert[];
  rerouteOrders: Record<string, RerouteOrder>;
  routeHealth: RouteHealth[];

  // UI state
  selectedBusId: string | null;
  selectedRouteId: string | null;
  showDemandHeatmap: boolean;
  sidebarTab: 'alerts' | 'fleet' | 'routes';
  simulationLogs: Array<{ time: string; message: string }>;

  // Actions
  setInitialState: (payload: any) => void;
  updateBuses: (buses: BusVehicle[]) => void;
  updateDemandSnapshots: (snapshots: StopDemandSnapshot[]) => void;
  addAlert: (alert: Alert) => void;
  acknowledgeAlert: (alertId: string) => void;
  updateRerouteOrder: (order: RerouteOrder) => void;
  setRouteHealth: (health: RouteHealth[]) => void;
  selectBus: (busId: string | null) => void;
  selectRoute: (routeId: string | null) => void;
  setSidebarTab: (tab: 'alerts' | 'fleet' | 'routes') => void;
  toggleDemandHeatmap: () => void;
  addSimulationLog: (msg: string) => void;
}

export const useStore = create<ZuupStore>((set) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),

  buses: {},
  routes: {},
  stops: {},
  demandSnapshots: {},
  alerts: [],
  rerouteOrders: {},
  routeHealth: [],
  simulationLogs: [],

  selectedBusId: null,
  selectedRouteId: null,
  showDemandHeatmap: true,
  sidebarTab: 'alerts',

  addSimulationLog: (msg) => set((state) => ({
    simulationLogs: [...state.simulationLogs, { time: new Date().toLocaleTimeString(), message: msg }].slice(-50),
  })),

  setInitialState: (payload) => {
    const buses: Record<string, BusVehicle> = {};
    const routes: Record<string, BusRoute> = {};
    const stops: Record<string, BusStop> = {};
    const demandSnapshots: Record<string, StopDemandSnapshot> = {};
    const rerouteOrders: Record<string, RerouteOrder> = {};

    (payload.buses || []).forEach((b: BusVehicle) => { buses[b.id] = b; });
    (payload.routes || []).forEach((r: BusRoute) => { routes[r.id] = r; });
    (payload.stops || []).forEach((s: BusStop) => { stops[s.id] = s; });
    (payload.demandSnapshots || []).forEach((s: StopDemandSnapshot) => {
      demandSnapshots[`${s.stopId}:${s.routeId}`] = s;
    });
    (payload.rerouteOrders || []).forEach((o: RerouteOrder) => { rerouteOrders[o.id] = o; });

    const alerts = payload.alerts ? [...payload.alerts] : [];

    // Fallback: if we reconnected and received a RECOMMENDED order but missed the alert
    Object.values(rerouteOrders).forEach((order) => {
      if (order.status === 'RECOMMENDED') {
        const hasAlert = alerts.some((a: Alert) => a.rerouteOrderId === order.id && !a.acknowledged);
        if (!hasAlert) {
          const bus = buses[order.busId];
          alerts.push({
            id: `sync-${order.id}`,
            tier: 2,
            title: `Reroute Recommended — ${bus?.registrationNo ?? order.busId}`,
            message: order.reasonSummary,
            timestamp: order.issuedAt || Date.now(),
            rerouteOrderId: order.id,
            acknowledged: false,
            type: 'REROUTE_RECOMMENDED',
          });
        }
      }
    });

    const hasActiveHighPriorityAlert = alerts.some(
      (a: Alert) => a.tier <= 2 && !a.acknowledged
    );

    set({
      buses,
      routes,
      stops,
      demandSnapshots,
      rerouteOrders,
      alerts,
      ...(hasActiveHighPriorityAlert ? { sidebarTab: 'alerts' as const } : {}),
    });
  },

  updateBuses: (busArray) => set((state) => {
    const buses = { ...state.buses };
    busArray.forEach((b) => { buses[b.id] = b; });
    return { buses };
  }),

  updateDemandSnapshots: (snapshots) => set((state) => {
    const demandSnapshots = { ...state.demandSnapshots };
    snapshots.forEach((s) => { demandSnapshots[`${s.stopId}:${s.routeId}`] = s; });
    return { demandSnapshots };
  }),

  addAlert: (alert) => set((state) => {
    const newState: Partial<ZuupStore> = {
      alerts: [alert, ...state.alerts].slice(0, 100),
    };
    // Auto-switch to Alerts tab for high-priority alerts so operator doesn't miss them
    if (alert.tier <= 2 && !alert.acknowledged) {
      newState.sidebarTab = 'alerts';
    }
    return newState;
  }),

  acknowledgeAlert: (alertId) => set((state) => ({
    alerts: state.alerts.map((a) => a.id === alertId ? { ...a, acknowledged: true } : a),
  })),

  updateRerouteOrder: (order) => set((state) => ({
    rerouteOrders: { ...state.rerouteOrders, [order.id]: order },
  })),

  setRouteHealth: (health) => set({ routeHealth: health }),
  selectBus: (busId) => set({ selectedBusId: busId }),
  selectRoute: (routeId) => set({ selectedRouteId: routeId }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleDemandHeatmap: () => set((state) => ({ showDemandHeatmap: !state.showDemandHeatmap })),
}));

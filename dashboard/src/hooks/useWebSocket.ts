import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { Alert, RerouteOrder, WsMessage } from '../types';

const WS_URL = 'ws://localhost:4001';
const RECONNECT_DELAY_MS = 3000;

function handleMessage(msg: WsMessage): void {
  const {
    setInitialState,
    updateBuses,
    updateDemandSnapshots,
    addAlert,
    acknowledgeAlert,
    updateRerouteOrder,
    addSimulationLog,
  } = useStore.getState();

  switch (msg.type) {
    case 'INITIAL_STATE':
      setInitialState(msg.payload);
      break;
    case 'VEHICLE_UPDATE':
      updateBuses(msg.payload as any[]);
      break;
    case 'DEMAND_UPDATE':
      updateDemandSnapshots(msg.payload as any[]);
      break;
    case 'SIMULATION_LOG':
      addSimulationLog(msg.payload as string);
      break;
    case 'ALERT_NEW':
      addAlert(msg.payload as Alert);
      break;
    case 'ALERT_ACKNOWLEDGED':
      acknowledgeAlert((msg.payload as any).alertId);
      break;
    case 'REROUTE_STATUS_CHANGE': {
      const order = msg.payload as RerouteOrder;
      updateRerouteOrder(order);

      // Fallback: alert may arrive before reroute order is in store (or be missed on reconnect)
      if (order.status === 'RECOMMENDED') {
        const { alerts, buses } = useStore.getState();
        const hasAlert = alerts.some(
          (a) => a.rerouteOrderId === order.id && !a.acknowledged
        );
        if (!hasAlert) {
          const bus = buses[order.busId];
          addAlert({
            id: `sync-${order.id}`,
            tier: 2,
            title: `Reroute Recommended — ${bus?.registrationNo ?? order.busId}`,
            message: order.reasonSummary,
            timestamp: Date.now(),
            rerouteOrderId: order.id,
            acknowledged: false,
            type: 'REROUTE_RECOMMENDED',
          });
        }
      }
      break;
    }
  }
}

/**
 * useWebSocket — connects to the backend WebSocket server and
 * pipes all messages into the Zustand store.
 * Auto-reconnects on disconnect.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setConnected = useStore((s) => s.setConnected);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('✅ WebSocket connected to backend');
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.warn('⚠️ WebSocket disconnected. Reconnecting in 3s...');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [setConnected]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);
}

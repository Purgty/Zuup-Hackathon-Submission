import WebSocket, { WebSocketServer } from 'ws';
import { eventBus, EVENTS } from '../events/EventBus';
import { stateStore } from '../services/StateStore';
import type { WsMessage } from '../types';

/**
 * OperatorStreamHandler — manages WebSocket connections to the operator dashboard.
 * Streams live bus positions, demand updates, and alerts in real time.
 */
export class OperatorStreamHandler {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`📡 Dashboard connected (${this.clients.size} total)`);

      // Send full initial state on connect
      this.sendToClient(ws, {
        type: 'INITIAL_STATE',
        payload: stateStore.getSnapshot(),
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(ws, msg);
        } catch (e) {
          console.error('Invalid WebSocket message:', e);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`📡 Dashboard disconnected (${this.clients.size} remaining)`);
      });

      ws.on('error', (err) => console.error('WS error:', err));
    });

    // Subscribe to all relevant events and broadcast to clients
    eventBus.subscribe(EVENTS.VEHICLE_POSITION_UPDATED, (payload: any) => {
      this.broadcast({ type: 'VEHICLE_UPDATE', payload: payload.buses });
    });

    eventBus.subscribe(EVENTS.DEMAND_UPDATED, () => {
      const snapshots = [...stateStore.demandSnapshots.values()];
      if (snapshots.length > 0) {
        this.broadcast({ type: 'DEMAND_UPDATE', payload: snapshots });
      }
    });

    eventBus.subscribe(EVENTS.ALERT_ISSUED, (payload: any) => {
      this.broadcast({ type: 'ALERT_NEW', payload });
    });

    eventBus.subscribe(EVENTS.REROUTE_STATUS_CHANGED, (payload: any) => {
      this.broadcast({ type: 'REROUTE_STATUS_CHANGE', payload });
    });

    eventBus.subscribe(EVENTS.SIMULATION_LOG, (payload: any) => {
      this.broadcast({ type: 'SIMULATION_LOG', payload });
    });

    eventBus.subscribe(EVENTS.ALERT_ACKNOWLEDGED, (payload: any) => {
      this.broadcast({ type: 'ALERT_ACKNOWLEDGED', payload });
    });

    console.log(`📡 WebSocket server listening on port ${port}`);
  }

  private handleClientMessage(ws: WebSocket, msg: any): void {
    // Messages from the operator dashboard (e.g., approve reroute)
    // These are also handled via the REST API; WS is supplementary
    if (msg.type === 'PING') {
      this.sendToClient(ws, { type: 'INITIAL_STATE', payload: stateStore.getSnapshot() });
    }
  }

  private broadcast(msg: WsMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  private sendToClient(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}

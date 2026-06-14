import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { Alert, RerouteOrder } from '../../types';

export function AlertQueue() {
  const { alerts, rerouteOrders, routes, buses, stops, acknowledgeAlert } = useStore();

  const activeAlerts = alerts
    .filter((a) => !a.acknowledged)
    .sort((a, b) => a.tier - b.tier || b.timestamp - a.timestamp);

  const dismissAlert = async (alertId: string) => {
    try {
      await fetch(`/api/operator/alerts/${alertId}/acknowledge`, { method: 'POST' });
    } catch {/* best-effort */}
    acknowledgeAlert(alertId);
  };

  if (activeAlerts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">✅</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>All clear</div>
        <div style={{ fontSize: '11px', opacity: 0.6 }}>
          Monitoring {Object.keys(routes).length} routes in real time
        </div>
      </div>
    );
  }

  return (
    <>
      {activeAlerts.map((alert) => {
        const rerouteOrder = alert.rerouteOrderId ? rerouteOrders[alert.rerouteOrderId] : null;
        return (
          <AlertCard
            key={alert.id}
            alert={alert}
            rerouteOrder={rerouteOrder || null}
            routes={routes}
            buses={buses}
            stops={stops}
            onDismiss={() => dismissAlert(alert.id)}
          />
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert;
  rerouteOrder: RerouteOrder | null;
  routes: any;
  buses: any;
  stops: any;
  onDismiss: () => void;
}

function AlertCard({ alert, rerouteOrder, routes, buses, stops, onDismiss }: AlertCardProps) {
  const [approving, setApproving] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { selectBus, selectRoute } = useStore();

  useEffect(() => {
    if (!rerouteOrder || rerouteOrder.status !== 'RECOMMENDED') return;
    const update = () => {
      const remaining = Math.max(0, Math.round((rerouteOrder.commitDeadline - Date.now()) / 1000));
      setCountdown(remaining);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [rerouteOrder]);

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rerouteOrder) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/operator/reroutes/${rerouteOrder.id}/approve`, { method: 'POST' });
      if (res.ok) {
        onDismiss();
      }
    } catch (e) {
      console.error('Approve failed:', e);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rerouteOrder) return;
    try {
      await fetch(`/api/operator/reroutes/${rerouteOrder.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by operator' }),
      });
    } catch {/* best-effort */}
    onDismiss();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss();
  };

  const fromRoute = rerouteOrder ? routes[rerouteOrder.fromRouteId] : null;
  const toRoute = rerouteOrder ? routes[rerouteOrder.toRouteId] : null;
  const bus = rerouteOrder ? buses[rerouteOrder.busId] : null;
  const targetStop = rerouteOrder ? stops[rerouteOrder.joinStopId] : null;

  const tierLabel =
    alert.tier === 1 ? 'CRITICAL' :
    alert.tier === 2 ? 'WARNING' :
    'INFO';

  const handleCardClick = () => {
    if (rerouteOrder) {
      selectBus(rerouteOrder.busId);
      selectRoute(rerouteOrder.toRouteId);
    }
  };

  return (
    <div 
      className={`alert-card tier-${alert.tier}`} 
      onClick={handleCardClick}
      style={{ cursor: rerouteOrder ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className={`alert-badge tier-${alert.tier}`}>{tierLabel}</div>
          <div className="alert-title">{alert.title}</div>
          <div className="alert-message">{alert.message}</div>
        </div>
        <div className="alert-time">{new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>

      {/* Reroute details */}
      {rerouteOrder && (fromRoute || toRoute) && (
        <div className="reroute-panel" style={{ marginTop: '12px', marginLeft: '-16px', marginRight: '-16px', marginBottom: '-12px', borderBottom: 'none', borderTop: '1px solid var(--border)' }}>
          <div className="reroute-panel-header">
            <span>RECOMMENDATION DETAILS</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>ID: {rerouteOrder.id.split('-')[0]}</span>
          </div>

          <div className="reroute-grid">
            <div className="reroute-block">
              <div className="reroute-block-title">CANDIDATE BUS</div>
              <div className="reroute-stat-row">
                <span>Bus No:</span>
                <strong>{bus ? bus.registrationNo : 'Unknown'}</strong>
              </div>
              <div className="reroute-stat-row">
                <span>Current Route:</span>
                <strong>{fromRoute ? fromRoute.shortCode : '?'}</strong>
              </div>
              <div className="reroute-stat-row">
                <span>Occupancy:</span>
                <strong>{bus ? bus.occupancyCount : 0} pax</strong>
              </div>
            </div>

            <div className="reroute-block">
              <div className="reroute-block-title">TARGET ROUTE</div>
              <div className="reroute-stat-row">
                <span>Target:</span>
                <strong>{toRoute ? toRoute.shortCode : '?'}</strong>
              </div>
              <div className="reroute-stat-row">
                <span>Demand (ETA):</span>
                <strong>{rerouteOrder.demandAtRecommendation.toFixed(0)}</strong>
              </div>
              <div className="reroute-stat-row">
                <span>Relief Stop:</span>
                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>
                  {targetStop ? targetStop.name : '?'}
                </strong>
              </div>
            </div>
          </div>

          {countdown !== null && rerouteOrder.status === 'RECOMMENDED' && countdown > 0 && (
            <div className="commit-countdown" style={{ marginBottom: '12px', color: 'var(--tier2)' }}>
              Decision Window: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </div>
          )}

          <div className="reroute-actions">
            {rerouteOrder?.status === 'RECOMMENDED' && (
              <>
                <button className="btn btn-success" onClick={handleApprove} disabled={approving}>
                  {approving ? '⏳' : '✓ APPROVE'}
                </button>
                <button className="btn btn-danger" onClick={handleReject}>✕ REJECT</button>
                <button className="btn" onClick={handleDismiss}>SKIP</button>
              </>
            )}
            {rerouteOrder?.status !== 'RECOMMENDED' && (
              <div className={`reroute-status ${rerouteOrder.status}`}>
                {rerouteOrder.status.replace(/_/g, ' ')}
              </div>
            )}
          </div>
        </div>
      )}

      {!rerouteOrder && (
        <div className="alert-actions" style={{ justifyContent: 'flex-end', marginTop: '12px' }}>
          {alert.tier === 3 && (
            <button className="btn" onClick={handleDismiss}>Dismiss</button>
          )}
          {alert.tier === 1 && (
            <button className="btn" onClick={handleDismiss}>Acknowledge</button>
          )}
        </div>
      )}
    </div>
  );
}

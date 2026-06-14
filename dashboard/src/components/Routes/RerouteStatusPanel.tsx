import React from 'react';
import { useStore } from '../../store/useStore';

export function RerouteStatusPanel() {
  const { buses, routes, rerouteOrders } = useStore();

  const busArray = Object.values(buses);

  // Buses currently operating on a route other than their home route
  const reroutedBuses = busArray.filter(
    (b) => b.homeRouteId && b.currentRouteId && b.homeRouteId !== b.currentRouteId
  );

  // Buses that are reserves but currently deployed
  const reserveBuses = busArray.filter(
    (b) => b.status === 'RESERVE' && b.currentRouteId
  );

  if (reroutedBuses.length === 0 && reserveBuses.length === 0) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
        <div style={{ fontSize: '20px', marginBottom: '6px' }}>✅</div>
        All buses on home routes.<br />No reroutes active.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {reroutedBuses.length > 0 && (
        <>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>
            ↪ Rerouted Buses ({reroutedBuses.length})
          </div>
          {reroutedBuses.map((bus) => {
            const homeRoute = routes[bus.homeRouteId!];
            const currentRoute = routes[bus.currentRouteId!];
            const order = bus.activeRerouteId
              ? Object.values(rerouteOrders).find(o => o.id === bus.activeRerouteId)
              : null;

            return (
              <div
                key={bus.id}
                style={{
                  background: 'var(--bg-base)',
                  border: `1px solid ${currentRoute?.color ?? 'var(--border)'}`,
                  borderLeft: `4px solid ${homeRoute?.color ?? 'var(--brand)'}`,
                  borderRadius: '4px',
                  padding: '8px 10px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <strong style={{ fontSize: '13px' }}>🚌 {bus.registrationNo}</strong>
                  <span style={{
                    background: '#f59e0b22',
                    color: '#b45309',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '3px',
                    border: '1px solid #f59e0b44',
                  }}>REROUTED</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ color: homeRoute?.color, fontWeight: 600, fontSize: '11px' }}>
                    🏠 {homeRoute?.shortCode ?? '?'}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <span style={{ color: currentRoute?.color, fontWeight: 600, fontSize: '11px' }}>
                    ↪ {currentRoute?.shortCode ?? '?'}
                  </span>
                </div>
                {order && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {order.reasonSummary}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {reserveBuses.length > 0 && (
        <>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px', marginBottom: '2px' }}>
            🔵 Reserve Buses Deployed ({reserveBuses.length})
          </div>
          {reserveBuses.map((bus) => {
            const currentRoute = routes[bus.currentRouteId!];
            return (
              <div
                key={bus.id}
                style={{
                  background: 'var(--bg-base)',
                  border: '1px solid #8b5cf666',
                  borderLeft: '4px solid #8b5cf6',
                  borderRadius: '4px',
                  padding: '8px 10px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>🚌 {bus.registrationNo}</strong>
                  <span style={{ color: currentRoute?.color, fontWeight: 600, fontSize: '11px' }}>
                    {currentRoute?.shortCode}
                  </span>
                </div>
                <div style={{ fontSize: '10px', color: '#8b5cf6', marginTop: '3px', fontWeight: 600 }}>
                  Reserve bus deployed to meet demand
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { RouteHealth } from '../../types';

export function RouteHealthPanel() {
  const { routes, buses, demandSnapshots } = useStore();
  const [routeHealth, setRouteHealth] = useState<RouteHealth[]>([]);

  // Compute route health locally from store data (also fetched from REST periodically)
  useEffect(() => {
    const health: RouteHealth[] = Object.values(routes).map((route) => {
      const routeBuses = Object.values(buses).filter((b) => b.currentRouteId === route.id);
      const snapshots = route.stops
        .map((stopId) => demandSnapshots[`${stopId}:${route.id}`])
        .filter(Boolean);

      const overloadedStops = snapshots.filter((s) => s!.overloadFlag).length;
      const bunchingDetected = snapshots.some((s) => s!.bunchingFlag);
      const avgDemand = snapshots.length > 0
        ? snapshots.reduce((sum, s) => sum + s!.totalDemand, 0) / snapshots.length
        : 0;

      return {
        routeId: route.id,
        routeName: route.name,
        shortCode: route.shortCode,
        busCount: routeBuses.length,
        inServiceCount: routeBuses.filter((b) => b.status === 'IN_SERVICE').length,
        reroutingCount: routeBuses.filter((b) => b.status === 'REROUTING').length,
        overloadedStops,
        bunchingDetected,
        avgDemand,
        color: route.color,
      };
    });
    setRouteHealth(health);
  }, [routes, buses, demandSnapshots]);

  if (routeHealth.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🗺️</div>
        <div>Loading route data...</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '0 16px' }}>
        <table className="data-table" style={{ marginTop: '0' }}>
          <thead>
            <tr>
              <th>Route</th>
              <th>Health</th>
              <th>Demand</th>
              <th>Capacity</th>
            </tr>
          </thead>
          <tbody>
            {routeHealth.map((health) => {
              const hasCritical = health.overloadedStops > 0;
              const hasWarning = health.bunchingDetected;
              const statusClass = hasCritical ? 'critical' : hasWarning ? 'watch' : 'healthy';
              const statusText = hasCritical ? 'Critical' : hasWarning ? 'Watch' : 'Healthy';
              
              // Mock capacity utilization
              const capacityPct = Math.min(100, Math.round((health.avgDemand / 80) * 100));
              const barColor = hasCritical ? 'var(--tier1)' : hasWarning ? 'var(--tier2)' : 'var(--tier3)';

              return (
                <tr key={health.routeId} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 600, color: health.color }}>{health.shortCode}</td>
                  <td>
                    <span className={`status-chip ${statusClass}`}>{statusText}</span>
                  </td>
                  <td>{health.avgDemand.toFixed(0)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '28px', textAlign: 'right' }}>{capacityPct}%</span>
                      <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${capacityPct}%`, height: '100%', background: barColor }} />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

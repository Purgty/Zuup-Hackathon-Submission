import React from 'react';
import { useStore } from '../../store/useStore';

/**
 * DemandPanel — shows a live demand breakdown per route,
 * displayed as a compact heatmap in the map overlay area.
 */
export function DemandPanel() {
  const { routes, stops, demandSnapshots } = useStore();

  const routeList = Object.values(routes);
  if (routeList.length === 0) {
    return null;
  }

  return (
    <div style={{
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      maxWidth: 220,
    }}>
      {routeList.map((route) => {
        const routeStopData = route.stops.map((stopId) => {
          const stop = stops[stopId];
          const snap = demandSnapshots[`${stopId}:${route.id}`];
          return { stop, snap };
        }).filter((x) => x.stop && x.snap);

        const maxDemand = Math.max(...routeStopData.map((x) => x.snap!.totalDemand), 1);
        const hasOverload = routeStopData.some((x) => x.snap!.overloadFlag);

        return (
          <div key={route.id} style={{
            background: 'rgba(13, 21, 38, 0.92)',
            border: `1px solid ${hasOverload ? route.color : 'var(--border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            backdropFilter: 'blur(10px)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
            }}>
              <div style={{
                width: 18,
                height: 4,
                borderRadius: 2,
                background: route.color,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: route.color }}>
                {route.shortCode}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {route.name}
              </span>
              {hasOverload && (
                <span style={{ fontSize: '10px', color: '#ef4444', fontWeight: 700 }}>⚠️</span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {routeStopData.map(({ stop, snap }) => (
                <div key={stop!.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    width: 70,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    flexShrink: 0,
                  }}>
                    {stop!.name.split(' ')[0]}
                  </div>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.round((snap!.totalDemand / maxDemand) * 100)}%`,
                      background: snap!.overloadFlag
                        ? '#ef4444'
                        : snap!.totalDemand / maxDemand > 0.6
                        ? '#f59e0b'
                        : route.color,
                      borderRadius: 3,
                      transition: 'width 0.8s ease',
                    }} />
                  </div>
                  <div style={{
                    fontSize: '9px',
                    color: snap!.overloadFlag ? '#ef4444' : 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    width: 22,
                    textAlign: 'right',
                    fontWeight: snap!.overloadFlag ? 700 : 400,
                    flexShrink: 0,
                  }}>
                    {Math.round(snap!.totalDemand)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

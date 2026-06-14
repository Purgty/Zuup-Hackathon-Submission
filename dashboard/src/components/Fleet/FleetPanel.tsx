import React from 'react';
import { useStore } from '../../store/useStore';

const STATUS_COLORS: Record<string, string> = {
  IN_SERVICE: '#10b981',
  REROUTING: '#f59e0b',
  RESERVE: '#6366f1',
  DEPOT: '#4a6080',
  BREAKDOWN: '#ef4444',
  SHORT_SERVICE: '#8b5cf6',
  SHIFT_CHANGE: '#64748b',
};

export function FleetPanel() {
  const { buses, routes, selectedBusId, selectBus } = useStore();

  const busArray = Object.values(buses).sort((a, b) => {
    // Sort: REROUTING first, then IN_SERVICE, then others
    const priority = (s: string) => s === 'REROUTING' ? 0 : s === 'IN_SERVICE' ? 1 : 2;
    return priority(a.status) - priority(b.status);
  });

  if (busArray.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🚌</div>
        <div>Awaiting bus data...</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '0 16px' }}>
        <table className="data-table" style={{ marginTop: '0' }}>
          <thead>
            <tr>
              <th>Bus</th>
              <th>Route</th>
              <th>Status</th>
              <th>Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {busArray.map((bus) => {
              const route = routes[bus.currentRouteId || ''];
              const isSelected = bus.id === selectedBusId;
              
              // Mock occupancy bar color
              const capacityPct = Math.round(bus.occupancyPct * 100);
              const barColor = capacityPct > 80 ? 'var(--tier1)' : capacityPct > 55 ? 'var(--tier2)' : 'var(--tier3)';

              return (
                <tr 
                  key={bus.id} 
                  style={{ 
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-card-hover)' : 'transparent',
                    borderLeft: isSelected ? '2px solid var(--brand)' : '2px solid transparent'
                  }}
                  onClick={() => selectBus(isSelected ? null : bus.id)}
                >
                  <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{bus.registrationNo}</td>
                  <td style={{ color: route?.color || 'inherit' }}>{route ? route.shortCode : '-'}</td>
                  <td>
                    <span style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: bus.status === 'REROUTING' ? 'var(--tier2)' : 'inherit' 
                    }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLORS[bus.status] || '#4a6080' }} />
                      {bus.status.replace('_', ' ')}
                    </span>
                  </td>
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

      <div style={{ padding: '16px', marginTop: 'auto' }}>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>
          Status Legend
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

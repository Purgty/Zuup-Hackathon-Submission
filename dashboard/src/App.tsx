import React, { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { useWebSocket } from './hooks/useWebSocket';
import { BusMap } from './components/Map/BusMap';

import { AlertQueue } from './components/Alerts/AlertQueue';
import { FleetPanel } from './components/Fleet/FleetPanel';
import { RouteHealthPanel } from './components/Routes/RouteHealthPanel';
import { RerouteStatusPanel } from './components/Routes/RerouteStatusPanel';
import { SimulationPanel } from './components/Simulation/SimulationPanel';

export default function App() {
  useWebSocket();

  const {
    connected,
    buses,
    alerts,
    demandSnapshots,
    sidebarTab,
    setSidebarTab,
    showDemandHeatmap,
    toggleDemandHeatmap,
  } = useStore();

  const [clock, setClock] = useState(() => new Date().toLocaleTimeString());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  // Computed stats
  const busArray = Object.values(buses);
  const busCount = busArray.length;
  const inServiceCount = busArray.filter((b) => b.status === 'IN_SERVICE').length;
  const activeAlerts = alerts.filter((a) => !a.acknowledged);
  const tier1Count = activeAlerts.filter((a) => a.tier === 1).length;
  const allSnapshots = Object.values(demandSnapshots);
  const totalDemand = allSnapshots.reduce((sum, s) => sum + s.totalDemand, 0);

  return (
    <div className="app-layout">
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <header className="topbar">
        <div className="logo">
          <div className="logo-icon">BM</div>
          <div>
            <div>BMTC BENGALURU</div>
            <div className="topbar-subtitle">Network View</div>
          </div>
        </div>

        <div className="topbar-spacer" />

        <div className="topbar-stats">
          <div className="topbar-stat">
            <div className={`status-icon ${connected ? 'healthy' : 'critical'}`} />
            <span>GPS: <strong>{connected ? 'Healthy' : 'Offline'}</strong></span>
          </div>
          <div className="topbar-stat">
            <div className={`status-icon ${connected ? 'healthy' : 'critical'}`} />
            <span>Demand Feed: <strong>{connected ? 'Healthy' : 'Offline'}</strong></span>
          </div>
          <div className="topbar-stat">
            <div className="status-icon healthy" />
            <span>Event Bus: <strong>Healthy</strong></span>
          </div>
          <div className="topbar-stat" style={{ borderRight: '1px solid #334155', paddingRight: '16px' }}>
            <div className="status-icon healthy" />
            <span>Redis: <strong>Healthy</strong></span>
          </div>

          <div className="topbar-stat" style={{ paddingLeft: '8px' }}>
            🚌 <strong>{inServiceCount}</strong> / {busCount} Buses
          </div>
          <div className="topbar-stat">
            👥 <strong>{Math.round(totalDemand)}</strong> Pax Waiting
          </div>
        </div>

        <div className="topbar-spacer" />

        <div style={{ fontSize: '12px', color: '#94A3B8', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
          {clock}
        </div>
      </header>

      {/* ── Left Sidebar (Route Intelligence) ───────────────── */}
      <aside className="sidebar left">
        <div className="alert-queue-header">
          ROUTE INTELLIGENCE
        </div>
        <div className="sidebar-content">
          <RouteHealthPanel />
        </div>
        <div className="alert-queue-header" style={{ marginTop: '1px', borderTop: '1px solid var(--border)' }}>
          REROUTE STATUS
        </div>
        <div className="sidebar-content">
          <RerouteStatusPanel />
        </div>
      </aside>

      {/* ── Map Area ─────────────────────────────────────────── */}
      <main className="map-area">
        <BusMap />

        {/* Demand overlay toggle */}
        <div className="map-controls">
          <button
            className={`map-btn ${showDemandHeatmap ? 'active' : ''}`}
            onClick={toggleDemandHeatmap}
          >
            🌡️ Demand Layers
          </button>
        </div>

        {/* Per-route demand bars overlay */}


        {/* Map legend */}
        <div className="map-legend">
          <div className="legend-item">
            <div style={{ width: 16, height: 3, background: 'var(--route1)' }} /> R1 (MG Road)
          </div>
          <div className="legend-item">
            <div style={{ width: 16, height: 3, background: 'var(--route2)' }} /> R2 (Indiranagar 100ft)
          </div>
          <div className="legend-item">
            <div style={{ width: 16, height: 3, background: 'var(--route3)' }} /> R3 (Ulsoor)
          </div>
          <div className="legend-item" style={{ marginLeft: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFFFFF', border: '2px solid #2563EB' }} /> Stop (Normal)
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', border: '2px solid #b91c1c' }} /> Stop (Overloaded)
          </div>
        </div>
      </main>

      {/* ── Right Sidebar (Alerts & Fleet) ──────────────────── */}
      <aside className="sidebar right">
        {/* Tabs */}
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === 'alerts' ? 'active' : ''}`}
            onClick={() => setSidebarTab('alerts')}
          >
            ALERT QUEUE
            {activeAlerts.length > 0 && (
              <span className={`tab-badge ${tier1Count > 0 ? '' : 'amber'}`}>
                {activeAlerts.length}
              </span>
            )}
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'fleet' ? 'active' : ''}`}
            onClick={() => setSidebarTab('fleet')}
          >
            FLEET ROSTER
          </button>
        </div>

        {/* Content */}
        <div className="sidebar-content">
          {sidebarTab === 'alerts' && <AlertQueue />}
          {sidebarTab === 'fleet' && <FleetPanel />}
          {sidebarTab === 'routes' && <AlertQueue />} {/* Fallback if state has old tab */}
        </div>
      </aside>

      {/* ── Bottom Timeline Area ────────────────────────────── */}
      <section className="timeline-area" style={{ padding: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase' }}>
          Simulation Control Panel
        </div>
        <SimulationPanel />
      </section>

    </div>
  );
}

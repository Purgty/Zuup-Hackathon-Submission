import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';

// ─── Types ───────────────────────────────────────────────────
type ScenarioKey = 'END_TERMINUS' | 'START_TERMINUS' | 'OVERWHELMING' | 'MULTI_ROUTE' | 'CASCADE_PREVENTION' | 'CROSS_ROUTE_STEAL';

interface ScenarioConfig {
  key: ScenarioKey;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  expectedBehaviour: string;
}

const SCENARIOS: ScenarioConfig[] = [
  {
    key: 'END_TERMINUS',
    icon: '🟢',
    title: 'Surge at Route End',
    subtitle: '40 pax at Dairy Circle (R1)',
    color: '#10b981',
    expectedBehaviour: 'End-terminus reserve RSV-B deploys — shortest path to surge stop',
  },
  {
    key: 'START_TERMINUS',
    icon: '🔵',
    title: 'Surge at Route Start',
    subtitle: '40 pax at MG Road (R1)',
    color: '#3b82f6',
    expectedBehaviour: 'Start-terminus reserve RSV-A deploys — shortest path to surge stop',
  },
  {
    key: 'OVERWHELMING',
    icon: '🔴',
    title: 'Overwhelming Surge',
    subtitle: '80 pax now → 60 more in 8s (R1 end)',
    color: '#ef4444',
    expectedBehaviour: 'First wave uses nearest reserve → second wave triggers cross-route reallocation',
  },
  {
    key: 'MULTI_ROUTE',
    icon: '🟡',
    title: 'Multi-Route Overload',
    subtitle: 'Simultaneous surge on R1 + R2 at Dairy Circle',
    color: '#f59e0b',
    expectedBehaviour: 'R1 end-reserve AND R2 end-reserve both deploy in parallel',
  },
  {
    key: 'CASCADE_PREVENTION',
    icon: '🛡️',
    title: 'Cascade Prevention',
    subtitle: 'Reject steal due to latent crowd',
    color: '#ec4899', // pink
    expectedBehaviour: 'R3 rejected due to crowd ahead, R2 stolen instead',
  },
  {
    key: 'CROSS_ROUTE_STEAL',
    icon: '🚫',
    title: 'Reserves Broken',
    subtitle: 'Massive surge while reserves are dead',
    color: '#8b5cf6', // purple
    expectedBehaviour: 'System bypasses reserve tier and steals an active bus from a less crowded route',
  },
];

// ─── Helpers ─────────────────────────────────────────────────
async function callScenario(scenario: ScenarioKey): Promise<void> {
  await fetch('/api/operator/simulate/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
}

async function callSurge(stopId: string, routeId: string, count: number): Promise<void> {
  await fetch('/api/operator/simulate/surge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stopId, routeId, count }),
  });
}

// ─── Component ───────────────────────────────────────────────
export function SimulationPanel() {
  const { simulationLogs, stops, routes, setHoveredSurgeStopId } = useStore();
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Manual surge state
  const [isTriggering, setIsTriggering] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string>('');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [crowdSize, setCrowdSize] = useState<number>(30);

  // Scenario state
  const [runningScenario, setRunningScenario] = useState<ScenarioKey | null>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioConfig | null>(null);
  const [showScenarios, setShowScenarios] = useState(true);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [simulationLogs]);

  // Auto-select first stop
  useEffect(() => {
    const stopList = Object.values(stops);
    if (stopList.length > 0 && !selectedStopId) {
      const first = stopList[0];
      setSelectedStopId(first.id);
      setSelectedRouteId(first.routesServing[0] ?? '');
    }
  }, [stops]);

  // Stop hover handlers
  const handleStopHover = (id: string) => setHoveredSurgeStopId(id);
  const handleStopLeave = () => setHoveredSurgeStopId(null);
  const handleStopSelect = (id: string) => {
    setSelectedStopId(id);
    const stop = stops[id];
    if (stop) setSelectedRouteId(stop.routesServing[0] ?? '');
    setHoveredSurgeStopId(null);
  };

  const handleSurge = async () => {
    if (!selectedStopId || !selectedRouteId) return;
    setIsTriggering(true);
    try { await callSurge(selectedStopId, selectedRouteId, crowdSize); }
    catch (e) { console.error(e); }
    finally { setIsTriggering(false); }
  };

  const handleScenario = async (cfg: ScenarioConfig) => {
    if (runningScenario) return;
    setRunningScenario(cfg.key);
    setActiveScenario(cfg);
    try { await callScenario(cfg.key); }
    catch (e) { console.error(e); }
    // Keep "active" for 12s so the log fills with events before clearing
    setTimeout(() => {
      setRunningScenario(null);
      setActiveScenario(null);
    }, 12_000);
  };

  const stopOptions = Object.values(stops).map(s => ({
    stop: s,
    routeLabel: s.routesServing.map(rid => routes[rid]?.shortCode).filter(Boolean).join(', '),
  }));
  const selectedStop = stops[selectedStopId];
  const crowdOptions = [10, 20, 30, 50];

  return (
    <div style={{ display: 'flex', height: '100%', gap: '14px', alignItems: 'stretch' }}>

      {/* ── Demo Scenarios ─────────────────────────────────────── */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '6px', borderRight: '1px dashed var(--border)', paddingRight: '14px' }}>
        <button
          onClick={() => setShowScenarios(s => !s)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', background: 'none',
            border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)',
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}
        >
          <span>🎬 Demo Scenarios</span>
          <span style={{ opacity: 0.6 }}>{showScenarios ? '▲' : '▼'}</span>
        </button>

        {showScenarios && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
            {SCENARIOS.map(cfg => {
              const isRunning = runningScenario === cfg.key;
              return (
                <button
                  key={cfg.key}
                  onClick={() => handleScenario(cfg)}
                  disabled={!!runningScenario}
                  title={cfg.expectedBehaviour}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    padding: '7px 10px', borderRadius: '6px', cursor: runningScenario ? 'not-allowed' : 'pointer',
                    border: `1px solid ${isRunning ? cfg.color : 'var(--border)'}`,
                    background: isRunning ? `${cfg.color}18` : 'var(--surface)',
                    opacity: runningScenario && !isRunning ? 0.45 : 1,
                    transition: 'all 0.2s', minWidth: '200px', textAlign: 'left',
                    boxShadow: isRunning ? `0 0 8px 0 ${cfg.color}40` : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span>{cfg.icon}</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: isRunning ? cfg.color : 'var(--text-primary)' }}>
                      {isRunning ? '⏳ Running...' : cfg.title}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                    {cfg.subtitle}
                  </span>
                  {isRunning && (
                    <span style={{ fontSize: '10px', color: cfg.color, marginTop: '3px', lineHeight: '1.3', fontStyle: 'italic' }}>
                      ↳ {cfg.expectedBehaviour}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Active scenario explainer */}
        {activeScenario && (
          <div style={{
            marginTop: '4px', padding: '6px 10px', borderRadius: '5px',
            background: `${activeScenario.color}12`, border: `1px solid ${activeScenario.color}40`,
            fontSize: '10px', color: activeScenario.color, lineHeight: '1.5',
          }}>
            <strong>Expected:</strong><br />{activeScenario.expectedBehaviour}
          </div>
        )}
      </div>

      {/* ── Manual Stop Surge ──────────────────────────────────── */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '190px', borderRight: '1px dashed var(--border)', paddingRight: '14px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Manual Surge
        </div>

        {/* Stop picker */}
        <div style={{
          maxHeight: '75px', overflowY: 'auto', border: '1px solid var(--border)',
          borderRadius: '5px', background: 'var(--surface)',
        }}>
          {stopOptions.map(({ stop, routeLabel }) => (
            <div
              key={stop.id}
              onClick={() => handleStopSelect(stop.id)}
              onMouseEnter={() => handleStopHover(stop.id)}
              onMouseLeave={handleStopLeave}
              style={{
                padding: '4px 9px', cursor: 'pointer', fontSize: '11px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: selectedStopId === stop.id ? 'rgba(239,68,68,0.12)' : 'transparent',
                borderLeft: selectedStopId === stop.id ? '3px solid #ef4444' : '3px solid transparent',
              }}
            >
              <span style={{ color: selectedStopId === stop.id ? '#f87171' : 'var(--text-primary)' }}>
                {stop.name}
              </span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{routeLabel}</span>
            </div>
          ))}
        </div>

        {/* Crowd size */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {crowdOptions.map(n => (
            <button
              key={n}
              onClick={() => setCrowdSize(n)}
              style={{
                padding: '3px 8px', borderRadius: '4px', border: '1px solid',
                borderColor: crowdSize === n ? '#ef4444' : 'var(--border)',
                background: crowdSize === n ? 'rgba(239,68,68,0.12)' : 'var(--surface)',
                color: crowdSize === n ? '#f87171' : 'var(--text-muted)',
                fontSize: '11px', fontWeight: crowdSize === n ? 700 : 400, cursor: 'pointer',
              }}
            >{n}</button>
          ))}
        </div>

        <button
          className="btn btn-danger"
          onClick={handleSurge}
          disabled={isTriggering || !selectedStopId}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 700 }}
        >
          {isTriggering ? '⏳ INJECTING...' : '⚠️ INJECT CROWD'}
        </button>

        {selectedStop && (
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{selectedStop.name}</strong>
            <br />+{crowdSize} pax on {routes[selectedRouteId]?.shortCode ?? selectedRouteId}
          </div>
        )}
      </div>

      {/* ── Simulation Log ──────────────────────────────────────── */}
      <div
        ref={logContainerRef}
        style={{
          flex: 1, height: '82px', overflowY: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: '#10b981',
          background: '#020617', padding: '7px 11px', borderRadius: '4px',
          display: 'flex', flexDirection: 'column', gap: '2px',
        }}
      >
        {simulationLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>Awaiting simulation events...</div>
        ) : (
          simulationLogs.map((log, i) => (
            <div key={i}>
              <span style={{ color: '#64748b', marginRight: '7px' }}>[{log.time}]</span>
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

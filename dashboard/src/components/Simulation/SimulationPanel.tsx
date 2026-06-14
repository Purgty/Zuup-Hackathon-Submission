import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';

export function SimulationPanel() {
  const { simulationLogs } = useStore();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [simulationLogs]);

  const handleTriggerSurge = async () => {
    setIsTriggering(true);
    try {
      await fetch('/api/operator/simulate/surge', { method: 'POST' });
    } catch (e) {
      console.error('Failed to trigger surge', e);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="simulation-panel" style={{ display: 'flex', height: '100%', gap: '16px', alignItems: 'center' }}>
      <div style={{ flex: '0 0 auto', paddingRight: '16px', borderRight: '1px dashed var(--border)' }}>
        <button 
          className="btn btn-danger" 
          onClick={handleTriggerSurge}
          disabled={isTriggering}
          style={{ padding: '12px 24px', fontSize: '14px', fontWeight: 'bold' }}
        >
          {isTriggering ? '⏳ TRIGGERING...' : '⚠️ TRIGGER PASSENGER SURGE'}
        </button>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          Simulates 30+ passengers arriving at<br />Silk Board on R1.
        </div>
      </div>

      <div 
        ref={logContainerRef}
        style={{ 
          flex: '1', 
          height: '80px', 
          overflowY: 'auto', 
          fontFamily: 'var(--font-mono)', 
          fontSize: '12px',
          color: '#10b981',
          background: '#020617',
          padding: '8px 12px',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        {simulationLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>Awaiting simulation events...</div>
        ) : (
          simulationLogs.map((log, i) => (
            <div key={i}>
              <span style={{ color: '#64748b', marginRight: '8px' }}>[{log.time}]</span>
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

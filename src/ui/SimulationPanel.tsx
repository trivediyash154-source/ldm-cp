import { useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import { Icon } from './Icon';

/** Prominent label and controls shown on every page while simulation mode is selected. */
export function SimulationPanel() {
  const { services, setMode } = useApp();
  const sim = services.sim.session;
  const controls = useSyncExternalStore(sim.subscribe, sim.getControls);
  return (
    <section className="sim-panel" aria-label="Simulation mode">
      <div className="sim-banner">
        <span className="sim-tag">SIMULATION</span>
        <p>
          Everything on screen comes from a simulated board. Nothing here is a hardware reading, and none of it is
          saved to the live history.
        </p>
        <button className="btn btn-on-sim" onClick={() => setMode('live')}>
          Back to live hardware
        </button>
      </div>
      <div className="sim-controls">
        {controls.running ? (
          <button className="btn btn-sim-ghost" onClick={() => sim.stop()}>
            <Icon name="stop" /> Stop simulated board
          </button>
        ) : (
          <button className="btn btn-sim" onClick={() => sim.start(2)}>
            <Icon name="play" /> Start simulated board
          </button>
        )}
        <span className="sim-divider" aria-hidden="true" />
        <button className="btn btn-sim-ghost" disabled={!controls.running} onClick={() => sim.vehicleAtEntry()}>
          <Icon name="arrowIn" /> Vehicle at entry
        </button>
        <button className="btn btn-sim-ghost" disabled={!controls.running} onClick={() => sim.vehicleAtExit()}>
          <Icon name="arrowOut" /> Vehicle at exit
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={controls.autoTraffic}
            disabled={!controls.running}
            onChange={(e) => sim.setAutoTraffic(e.target.checked)}
          />
          <span>Random traffic</span>
        </label>
        <label className="toggle" title="Off reproduces the wiring guide, where D3 is not connected to the counter">
          <input type="checkbox" checked={controls.decrementWired} onChange={(e) => sim.setDecrementWired(e.target.checked)} />
          <span>Decrement path wired</span>
        </label>
        <span className="sim-divider" aria-hidden="true" />
        <span className="sim-faults-label">Inject fault</span>
        <button className="btn btn-sim-ghost btn-small" disabled={!controls.running} onClick={() => sim.injectGlitch()}>
          Q pins float (reads 7)
        </button>
        <button className="btn btn-sim-ghost btn-small" disabled={!controls.running} onClick={() => sim.injectStall()}>
          Telemetry stops
        </button>
        <button className="btn btn-sim-ghost btn-small" disabled={!controls.running} onClick={() => sim.injectGarbage()}>
          Corrupted line
        </button>
      </div>
    </section>
  );
}

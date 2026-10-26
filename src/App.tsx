import { useEffect, useState, type ReactNode } from 'react';
import { useApp, useStoreSelector } from './app/context';
import { AlertStrip } from './ui/AlertStrip';
import { ConnectControl } from './ui/ConnectControl';
import { Icon, type IconName } from './ui/Icon';
import { SimulationPanel } from './ui/SimulationPanel';
import { StatusPills } from './ui/StatusPills';
import { Diagnostics } from './views/Diagnostics';
import { FacilityView } from './views/FacilityView';
import { HardwareLab } from './views/HardwareLab';
import { Insights } from './views/Insights';
import { Overview } from './views/Overview';
import { Timeline } from './views/Timeline';

const ROUTES: Record<string, { label: string; title: string; subtitle: string; icon: IconName; view: () => ReactNode }> = {
  overview: { label: 'Overview', title: 'Overview', subtitle: 'Occupancy, gates and signal health at a glance', icon: 'overview', view: () => <Overview /> },
  facility: { label: 'Facility', title: 'Facility', subtitle: 'Five bays, two gates — driven by the counter', icon: 'facility', view: () => <FacilityView /> },
  lab: { label: 'Hardware Lab', title: 'Hardware Lab', subtitle: 'Arduino Uno, 74LS74 flip-flops and the serial path', icon: 'lab', view: () => <HardwareLab /> },
  timeline: { label: 'Timeline', title: 'Timeline', subtitle: 'Entries, exits and system events as they were identified', icon: 'timeline', view: () => <Timeline /> },
  insights: { label: 'Insights', title: 'Insights', subtitle: 'Analytics from recorded readings and events only', icon: 'insights', view: () => <Insights /> },
  diagnostics: { label: 'Diagnostics', title: 'Diagnostics', subtitle: 'Connection, data quality and the raw serial stream', icon: 'diagnostics', view: () => <Diagnostics /> },
};

function useRoute(): string {
  const read = () => {
    const key = window.location.hash.replace(/^#\/?/, '');
    return key in ROUTES ? key : 'overview';
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

function SourceSwitch() {
  const { mode, setMode, services } = useApp();
  const simRunning = useStoreSelector(services.sim.store, (s) => s.link.status === 'connected');
  return (
    <div className="source" role="radiogroup" aria-label="Data source">
      <button role="radio" aria-checked={mode === 'live'} className={mode === 'live' ? 'is-on' : ''} onClick={() => setMode('live')}>
        <span className="source-dot live" /> Live hardware
      </button>
      <button role="radio" aria-checked={mode === 'simulation'} className={mode === 'simulation' ? 'is-on is-sim' : ''} onClick={() => setMode('simulation')}>
        <span className={`source-dot sim ${simRunning ? 'running' : ''}`} /> Simulation
      </button>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const { mode } = useApp();
  const page = ROUTES[route];
  useEffect(() => {
    document.title = `${page.title}${mode === 'simulation' ? ' · SIMULATION' : ''} · Smart Parking`;
  }, [page, mode]);

  return (
    <div className={`shell ${mode === 'simulation' ? 'is-simulation' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30">
              <rect x="2" y="2" width="28" height="28" rx="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M11 23V9h6.2a4.3 4.3 0 010 8.6H11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-text">
            <span className="brand-name">Smart Parking</span>
            <span className="brand-sub">74LS74 · Arduino Uno</span>
          </span>
        </div>
        <nav className="nav" aria-label="Sections">
          {Object.entries(ROUTES).map(([key, r]) => (
            <a key={key} href={`#/${key}`} className={route === key ? 'is-active' : ''} aria-current={route === key ? 'page' : undefined} aria-label={r.label} title={r.label}>
              <Icon name={r.icon} />
              <span>{r.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail-foot">
          <p className="rail-label">Data source</p>
          <SourceSwitch />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{page.title}</h1>
            <p>{page.subtitle}</p>
          </div>
          <div className="topbar-status">
            <StatusPills />
            {mode === 'live' && <ConnectControl />}
          </div>
        </header>
        {mode === 'simulation' && <SimulationPanel />}
        <AlertStrip />
        <main id="main" tabIndex={-1}>
          {page.view()}
        </main>
        <footer className="foot">
          <span>
            {mode === 'live'
              ? "Occupancy comes only from the Q2 Q1 Q0 bits the Arduino reports. Nothing on this page is invented."
              : 'Simulation mode: every value on this page is simulated.'}
          </span>
          <span>{mode === 'live' ? 'Source: Arduino over Web Serial' : 'Source: simulated board — not hardware'}</span>
        </footer>
      </div>
    </div>
  );
}

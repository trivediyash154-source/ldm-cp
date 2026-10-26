import { useActive, useApp, useEngine } from '../app/context';
import { formatTime } from '../app/format';
import { BAUD_RATE } from '../config';
import { selectAdmission, selectCounterHealth, selectOccupancy, selectTelemetryQuality, protocolLabel } from '../core/selectors';
import type { GateState } from '../core/types';
import { FacilityStage } from '../facility/FacilityStage';
import { EventItem } from '../ui/EventItem';
import { Icon } from '../ui/Icon';
import { BinaryRegister, FreshnessLine, SlotMeter } from '../ui/Occupancy';
import { counterText, linkText, telemetryText } from '../ui/status';

function Hero() {
  const view = useEngine(selectOccupancy);
  const linkSince = useEngine((s) => s.link.since);
  const source = useEngine((s) => s.source);
  const { reading } = view;

  let headline: string;
  if (!reading) headline = source === 'live' ? 'No reading yet' : 'Simulated board not started';
  else if (view.validity === 'out-of-range') headline = `Counter reads ${reading.raw} — above capacity`;
  else if (view.available === 0) headline = 'Full · entry gate will refuse';
  else headline = `${view.available} ${view.available === 1 ? 'space' : 'spaces'} available`;

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">
          {source === 'live' ? 'Occupancy · read from the 74LS74 counter' : 'Occupancy · simulated counter'}
        </p>
        <div className="hero-figure" aria-live="polite">
          <span className={`hero-number ${view.validity === 'out-of-range' ? 'is-bad' : ''}`} id="hero-title">
            {view.occupancy ?? '—'}
          </span>
          <span className="hero-of">
            of {view.capacity}
            <br />
            spaces
          </span>
        </div>
        <p className={`hero-headline ${view.validity === 'out-of-range' ? 'is-bad' : ''}`}>{headline}</p>
        <SlotMeter view={view} />
        <dl className="hero-stats">
          <div>
            <dt>Utilization</dt>
            <dd>{view.utilization === null ? '—' : `${Math.round(view.utilization * 100)}%`}</dd>
          </div>
          <div>
            <dt>Raw counter</dt>
            <dd className="mono">{reading ? `${reading.raw} (${reading.bits.join('')}₂)` : '—'}</dd>
          </div>
        </dl>
        <FreshnessLine view={view} linkSince={linkSince} />
        <BinaryRegister reading={reading} />
      </div>
      <div className="hero-visual">
        <FacilityStage compact />
        <a className="hero-visual-link" href="#/facility">
          Open the facility <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}

function GateColumn({ side, gate, admits, protocol }: { side: 'entry' | 'exit'; gate: GateState; admits: boolean | null; protocol: string }) {
  const name = side === 'entry' ? 'Entry gate' : 'Exit gate';
  const rule = side === 'entry' ? 'Opens for 1.5 s when the entry IR sensor fires and count < 5.' : 'Opens for 1.5 s when the exit IR sensor fires and count > 0.';
  let state: string;
  if (gate.reported) state = gate.state === 'open' ? 'Open' : 'Closed';
  else state = protocol === 'v1' ? 'Not reported' : 'Unknown';
  return (
    <div className="gate">
      <div className="gate-head">
        <Icon name={side === 'entry' ? 'arrowIn' : 'arrowOut'} />
        <h3>{name}</h3>
        <span className={`gate-state gate-${gate.reported ? gate.state : 'unknown'}`}>{state}</span>
      </div>
      <p className="gate-source">
        {gate.reported
          ? `Commanded position reported by firmware v2${gate.at ? ` at ${formatTime(gate.at)}` : ''}. Servos have no position feedback.`
          : protocol === 'v1'
            ? 'Firmware v1 does not report servo commands; the gate is normally closed.'
            : 'No gate report received in this session.'}
      </p>
      <p className="gate-rule">{rule}</p>
      <p className={`gate-next ${admits === false ? 'is-refuse' : admits ? 'is-admit' : ''}`}>
        <span>Next vehicle</span>
        <strong>{admits === null ? 'Unknown — no live reading' : admits ? 'Will be let through' : side === 'entry' ? 'Will be refused' : 'Will be refused (count is 0)'}</strong>
      </p>
    </div>
  );
}

export function Overview() {
  const { mode } = useActive();
  const { services } = useApp();
  const gates = useEngine((s) => s.gates);
  const admission = useEngine(selectAdmission);
  const protocol = useEngine((s) => s.protocol);
  const link = useEngine((s) => s.link);
  const telemetry = useEngine(selectTelemetryQuality);
  const counter = useEngine(selectCounterHealth);
  const events = useEngine((s) => s.events);
  const portLabel = useEngine((s) => s.link.portLabel);
  const recent = events.slice(-6).reverse();
  const neverConnected = mode === 'live' && link.status !== 'connected' && events.length === 0;

  return (
    <div className="view view-overview">
      <Hero />

      {neverConnected && (
        <section className="onboarding" aria-labelledby="start-title">
          <h2 id="start-title">Connect the parking prototype</h2>
          <ol>
            <li>
              <strong>Plug the Uno in by USB</strong> and make sure <code>parking_counter_v1</code> or <code>_v2</code> is uploaded.
            </li>
            <li>
              <strong>Close the Arduino IDE Serial Monitor.</strong> Only one program can use the port at a time.
            </li>
            <li>
              <strong>Press Connect Arduino</strong> and choose the board's port. Opening the port restarts the Uno, so the first reading takes about 2 s.
            </li>
          </ol>
          {link.status !== 'unsupported' && (
            <button className="btn btn-primary" onClick={() => void services.live.session.connect(true)}>
              <Icon name="usb" /> Connect Arduino
            </button>
          )}
        </section>
      )}

      <section className="band" aria-label="Gates and health">
        <div className="band-col">
          <h2 className="section-title">Barrier gates</h2>
          <div className="gates">
            <GateColumn side="entry" gate={gates.entry} admits={admission.entry} protocol={protocol} />
            <GateColumn side="exit" gate={gates.exit} admits={admission.exit} protocol={protocol} />
          </div>
          <p className="footnote">“Next vehicle” applies the firmware's own rule to the latest reading. It is a prediction, not a measurement.</p>
        </div>
        <div className="band-col">
          <h2 className="section-title">Signal health</h2>
          <dl className="health">
            <div className={`health-row tone-${linkText[link.status].tone}`}>
              <dt>{mode === 'live' ? 'USB link' : 'Simulated link'}</dt>
              <dd>
                <strong>{linkText[link.status].label}</strong>
                <span>{link.status === 'connected' ? `${portLabel ?? 'Serial port'} · ${BAUD_RATE} baud` : mode === 'live' ? 'Web Serial, user-initiated' : 'Simulated board'}</span>
              </dd>
            </div>
            <div className={`health-row tone-${telemetryText[telemetry].tone}`}>
              <dt>Telemetry</dt>
              <dd>
                <strong>{telemetryText[telemetry].label}</strong>
                <span>{telemetryText[telemetry].explain}</span>
              </dd>
            </div>
            <div className={`health-row tone-${counterText[counter].tone}`}>
              <dt>Counter</dt>
              <dd>
                <strong>{counterText[counter].label}</strong>
                <span>{counterText[counter].explain}</span>
              </dd>
            </div>
            <div className="health-row tone-idle">
              <dt>Firmware</dt>
              <dd>
                <strong>{protocolLabel[protocol]}</strong>
                <span>{protocol === 'v1' ? 'Vehicle events are inferred from counter steps.' : protocol === 'v2' ? 'Vehicle events are reported and checked against the counter.' : 'Identified from the first lines received.'}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className="band-col">
          <div className="section-head">
            <h2 className="section-title">Recent activity</h2>
            <a href="#/timeline" className="link">
              Timeline →
            </a>
          </div>
          {recent.length === 0 ? (
            <p className="empty">No events yet. Events appear when the board connects and the counter changes.</p>
          ) : (
            <ul className="events events-compact">
              {recent.map((e) => (
                <EventItem key={e.id} event={e} compact />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

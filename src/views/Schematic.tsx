import { useEngine, useNow } from '../app/context';
import { selectTelemetryQuality } from '../core/selectors';
import type { ParkingEvent } from '../core/types';

const RECENT_MS = 4000;

function lastFirmwareEvent(events: readonly ParkingEvent[], kinds: string[]): ParkingEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) if (kinds.includes(events[i].kind) && events[i].basis !== 'observed') return events[i];
  return undefined;
}

/**
 * Block diagram of the prototype with live overlays. Only Q2–Q0 are measured
 * continuously; sensor, clock and servo activity are shown only when firmware
 * v2 reports it, and are otherwise labelled "not reported".
 */
export function Schematic() {
  const now = useNow(250);
  const latest = useEngine((s) => s.latest);
  const protocol = useEngine((s) => s.protocol);
  const gates = useEngine((s) => s.gates);
  const events = useEngine((s) => s.events);
  const link = useEngine((s) => s.link.status);
  const quality = useEngine(selectTelemetryQuality);
  const live = quality === 'live';
  const bits = live && latest ? latest.bits : null;
  const v2 = protocol === 'v2';
  const entryEvt = lastFirmwareEvent(events, ['entry', 'entry-denied']);
  const exitEvt = lastFirmwareEvent(events, ['exit', 'exit-denied']);
  const recent = (e?: ParkingEvent) => !!e && now - e.at < RECENT_MS;
  const entryHit = v2 && (gates.entry.state === 'open' || recent(entryEvt));
  const exitHit = v2 && (gates.exit.state === 'open' || recent(exitEvt));
  const upPulse = v2 && gates.entry.state === 'open';
  const downPulse = v2 && gates.exit.state === 'open';
  const status = (on: boolean, label: string) => (v2 ? (on ? label : 'idle') : 'not reported');

  const qPins = [
    { name: 'Q0', pin: 'D7', y: 300, chip: 0, bit: bits ? bits[2] : null },
    { name: 'Q1', pin: 'D8', y: 330, chip: 0, bit: bits ? bits[1] : null },
    { name: 'Q2', pin: 'D9', y: 360, chip: 1, bit: bits ? bits[0] : null },
  ];

  return (
    <svg className="schematic" viewBox="0 0 1120 540" role="img" aria-labelledby="schematic-title schematic-desc">
      <title id="schematic-title">Prototype block diagram</title>
      <desc id="schematic-desc">
        IR sensors feed Arduino pins D5 and D6. The Arduino pulses D2 to clock the 74LS74 counter and drives servos on D10
        and D11. The counter outputs Q0 to Q2 return to D7, D8 and D9. The Arduino sends telemetry over USB serial to this
        app.
      </desc>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="sch-arrowhead" />
        </marker>
      </defs>

      {/* Sensors */}
      <g className={`sch-node ${entryHit ? 'is-active' : ''}`}>
        <rect x="24" y="52" width="190" height="74" rx="12" />
        <text x="44" y="82" className="sch-title">Entry IR sensor</text>
        <text x="44" y="106" className="sch-sub">OUT active LOW · {status(entryHit, 'triggered')}</text>
      </g>
      <g className={`sch-node ${exitHit ? 'is-active' : ''}`}>
        <rect x="24" y="146" width="190" height="74" rx="12" />
        <text x="44" y="176" className="sch-title">Exit IR sensor</text>
        <text x="44" y="200" className="sch-sub">OUT active LOW · {status(exitHit, 'triggered')}</text>
      </g>
      <g className={`sch-node ${gates.entry.state === 'open' && gates.entry.reported ? 'is-active' : ''}`}>
        <rect x="24" y="330" width="190" height="74" rx="12" />
        <text x="44" y="360" className="sch-title">Entry servo (SG90)</text>
        <text x="44" y="384" className="sch-sub">{gates.entry.reported ? `commanded ${gates.entry.state}` : 'not reported'}</text>
      </g>
      <g className={`sch-node ${gates.exit.state === 'open' && gates.exit.reported ? 'is-active' : ''}`}>
        <rect x="24" y="424" width="190" height="74" rx="12" />
        <text x="44" y="454" className="sch-title">Exit servo (SG90)</text>
        <text x="44" y="478" className="sch-sub">{gates.exit.reported ? `commanded ${gates.exit.state}` : 'not reported'}</text>
      </g>

      {/* Sensor and servo wires */}
      <path d="M214 89 H330" className={`sch-wire ${entryHit ? 'is-active' : ''}`} markerEnd="url(#arrow)" />
      <path d="M214 183 H330" className={`sch-wire ${exitHit ? 'is-active' : ''}`} markerEnd="url(#arrow)" />
      <path d="M330 367 H218" className="sch-wire" markerEnd="url(#arrow)" />
      <path d="M330 461 H218" className="sch-wire" markerEnd="url(#arrow)" />

      {/* Arduino */}
      <g className="sch-mcu">
        <rect x="330" y="40" width="210" height="470" rx="18" />
        <text x="435" y="78" className="sch-title" textAnchor="middle">Arduino Uno</text>
        <text x="435" y="98" className="sch-sub" textAnchor="middle">ATmega328P · {protocol === 'unknown' ? 'firmware ?' : `firmware ${protocol}`}</text>
        {[
          ['D5', 89],
          ['D6', 183],
          ['D10', 367],
          ['D11', 461],
        ].map(([pin, y]) => (
          <text key={pin} x="344" y={(y as number) + 4} className="sch-pin">
            {pin}
          </text>
        ))}
        {[
          ['D2', 150],
          ['D3', 210],
          ['D7', 300],
          ['D8', 330],
          ['D9', 360],
        ].map(([pin, y]) => (
          <text key={pin} x="526" y={(y as number) + 4} className="sch-pin" textAnchor="end">
            {pin}
          </text>
        ))}
        <text x="435" y="496" className="sch-pin" textAnchor="middle">USB</text>
      </g>

      {/* Clock lines */}
      <path d="M540 150 H720" className={`sch-wire sch-clock ${upPulse ? 'is-active' : ''}`} markerEnd="url(#arrow)" />
      <text x="552" y="140" className="sch-label">CLK UP · {status(upPulse, 'pulsed')}</text>
      <path d="M540 210 H610" className={`sch-wire sch-unverified ${downPulse ? 'is-active' : ''}`} />
      <text x="552" y="234" className="sch-label sch-label-warn">
        D3 CLK DOWN · {downPulse ? 'pulsed' : v2 ? 'idle' : 'not reported'}
      </text>
      <text x="552" y="251" className="sch-label sch-label-warn">
        unwired in the guide
      </text>
      <circle cx="618" cy="210" r="7" className="sch-open" />

      {/* Counter */}
      <g className="sch-chip">
        <rect x="720" y="112" width="250" height="150" rx="14" />
        <text x="740" y="140" className="sch-title">74LS74 ×2 · counter</text>
        <text x="740" y="160" className="sch-sub">FF0 → Q0 · FF1 → Q1 · FF2 → Q2</text>
        <text x="740" y="196" className="sch-sub">Next state from</text>
        <text x="740" y="216" className="sch-sub">74LS86 XOR · 74LS08 AND · 74LS04 NOT</text>
        <text x="740" y="242" className="sch-sub">Clock: rising edge on D2</text>
      </g>

      {/* Q return lines */}
      {qPins.map((q) => (
        <g key={q.name} className={`sch-q ${q.bit === 1 ? 'is-high' : q.bit === 0 ? 'is-low' : 'is-none'}`}>
          <path d={`M${800 + (q.chip ? 60 : 0) + (q.name === 'Q1' ? 30 : 0)} 262 V${q.y} H540`} className="sch-wire" markerEnd="url(#arrow)" />
          <circle cx={600} cy={q.y} r="9" className="sch-led" />
          <text x={620} y={q.y + 5} className="sch-label">
            {q.name} = {q.bit ?? '–'}
          </text>
        </g>
      ))}
      <text x="600" y="392" className="sch-sub">{bits ? 'measured: latest telemetry frame' : 'no live reading'}</text>

      {/* USB to browser */}
      <path d="M435 510 V528 H980 V470" className={`sch-wire sch-usb ${live ? 'is-active' : ''}`} markerEnd="url(#arrow)" />
      <g className={`sch-node sch-app ${live ? 'is-active' : ''}`}>
        <rect x="880" y="330" width="216" height="140" rx="14" />
        <text x="900" y="360" className="sch-title">This app (browser)</text>
        <text x="900" y="384" className="sch-sub">Web Serial · 9600 baud · JSON lines</text>
        <text x="900" y="406" className="sch-sub">validate → occupancy → events</text>
        <text x="900" y="446" className="sch-sub">link: {link} · data: {quality}</text>
      </g>
    </svg>
  );
}

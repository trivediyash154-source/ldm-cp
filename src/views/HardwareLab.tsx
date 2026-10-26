import { useEngine } from '../app/context';
import { CAPACITY } from '../config';
import { protocolLabel, selectOccupancy } from '../core/selectors';
import { Icon } from '../ui/Icon';
import { BinaryRegister } from '../ui/Occupancy';
import { Schematic } from './Schematic';

const PIN_MAP = [
  { pin: 'D2', dir: 'Out', signal: 'Clock UP → 74LS74 #1 pins 3, 11; #2 pin 3', seen: 'v2: implied by entry events' },
  { pin: 'D3', dir: 'Out', signal: 'Clock DOWN → down-count logic', seen: 'v2: implied by exit events' },
  { pin: 'D5', dir: 'In', signal: 'Entry IR sensor OUT (LOW = vehicle)', seen: 'v2: entry / entry_denied events' },
  { pin: 'D6', dir: 'In', signal: 'Exit IR sensor OUT (LOW = vehicle)', seen: 'v2: exit / exit_denied events' },
  { pin: 'D7', dir: 'In', signal: 'Q0 ← 74LS74 #1 pin 5', seen: 'Every telemetry line ("q0")' },
  { pin: 'D8', dir: 'In', signal: 'Q1 ← 74LS74 #1 pin 9', seen: 'Every telemetry line ("q1")' },
  { pin: 'D9', dir: 'In', signal: 'Q2 ← 74LS74 #2 pin 5', seen: 'Every telemetry line ("q2")' },
  { pin: 'D10', dir: 'Out', signal: 'Entry servo signal (0° closed, 90° open)', seen: 'v2: commanded open/close' },
  { pin: 'D11', dir: 'Out', signal: 'Exit servo signal (0° closed, 90° open)', seen: 'v2: commanded open/close' },
];

const FINDINGS = [
  {
    severity: 'bad',
    title: 'D3 (clock down) does not reach the counter',
    body: 'The wiring guide sends D3 to an unspecified “down-steering network” (one inverter input, output unused). With that wiring an exit opens the gate but cannot lower the count, so the lot eventually reads full forever. Firmware v2 makes every such exit show up as a discrepancy.',
    fix: 'Make the counter an up/down counter (see docs/hardware-notes.md) or verify where D3 actually goes on your board.',
  },
  {
    severity: 'bad',
    title: '74LS08 pin 2 tied to the D2 clock',
    body: 'D1 = Q1 ⊕ (Q0 · CLK). Just before the rising edge CLK is LOW, so D1 = Q1 and FF1 never toggles: the count goes 0 → 1 → 0 → 1. The Counter self-check below shows this as Q1 never toggling.',
    fix: 'Tie 74LS08 pin 2 to +5 V (or feed Q0 straight into 74LS86 pin 2).',
  },
  {
    severity: 'warn',
    title: 'Firmware v1 re-adds the saved count on every restart',
    body: 'Opening the USB port restarts the Uno but not the breadboard. v1 then pulses D2 “saved count” more times, so 3 becomes 6. This is reproduced by the firmware-in-the-loop tests.',
    fix: 'Upload firmware/parking_counter_v2, which only pulses until the counter shows the saved value.',
  },
  {
    severity: 'warn',
    title: 'Counter reading 7 blocks the entry gate',
    body: 'If Q pins float or the Arduino and breadboard grounds are not joined, all three inputs read HIGH (count 7). The firmware refuses entry whenever count ≥ 5, which matches the “in-gate not working” symptom.',
    fix: 'Join Arduino GND to the breadboard GND rail and check the D7/D8/D9 wires.',
  },
  {
    severity: 'info',
    title: 'No reset line from the Arduino to CLR',
    body: 'CLR and PRE are pulled up, so the flip-flops power up in a random state and the Arduino cannot zero them.',
    fix: 'Optional: drive the CLR pins from a spare Arduino pin to allow a clean reset.',
  },
];

function CounterSelfCheck() {
  const steps = useEngine((s) => s.steps);
  const toggles = useEngine((s) => s.bitToggles);
  const total = steps.up + steps.down + steps.other;
  const hints: string[] = [];
  if (steps.up >= 2 && toggles[1] === 0) hints.push('Q1 has not toggled in any accepted step: consistent with the AND gate input tied to the clock.');
  if (steps.up >= 4 && steps.down === 0) hints.push('Only up-steps so far. If vehicles have left, the decrement path is not working.');
  if (steps.other > 0) hints.push(`${steps.other} step(s) moved the counter by more than 1, which a single clock pulse cannot do on a working counter.`);
  return (
    <div className="selfcheck">
      <h2 className="section-title">Counter self-check</h2>
      <p className="muted">Built from accepted counter changes since this page opened ({total} so far).</p>
      <dl className="kv kv-3">
        <div>
          <dt>Up-steps (+1)</dt>
          <dd>{steps.up}</dd>
        </div>
        <div>
          <dt>Down-steps (−1)</dt>
          <dd>{steps.down}</dd>
        </div>
        <div>
          <dt>Other jumps</dt>
          <dd>{steps.other}</dd>
        </div>
      </dl>
      <div className="toggles" role="table" aria-label="Bit toggles">
        {(['Q2', 'Q1', 'Q0'] as const).map((name, i) => (
          <div className="toggle-row" role="row" key={name}>
            <span role="cell" className="mono">
              {name}
            </span>
            <span role="cell" className="toggle-bar">
              <span style={{ width: `${total ? Math.min(100, (toggles[i] / Math.max(1, total)) * 100) : 0}%` }} />
            </span>
            <span role="cell" className="mono">
              {toggles[i]} toggles
            </span>
          </div>
        ))}
      </div>
      {hints.length > 0 ? (
        <ul className="hints">
          {hints.map((h) => (
            <li key={h}>
              <Icon name="alert" size={15} /> {h}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">A working counter toggles Q0 on every step, Q1 every second step and Q2 every fourth.</p>
      )}
    </div>
  );
}

export function HardwareLab() {
  const view = useEngine(selectOccupancy);
  const protocol = useEngine((s) => s.protocol);
  const boot = useEngine((s) => s.boot);
  const raw = view.reading?.raw ?? null;
  return (
    <div className="view view-lab">
      <section className="lab-intro">
        <p className="lead">
          How a vehicle becomes a number: the IR sensor tells the Arduino, the Arduino clocks the 74LS74 flip-flops, and
          the flip-flop outputs are read back and sent to this app. Only the three Q outputs are measured continuously.
          Everything else is shown only when firmware v2 reports it.
        </p>
      </section>

      <section className="schematic-wrap" aria-label="Live block diagram">
        <Schematic />
        <div className="legend-row">
          <span className="lg lg-measured">Measured (telemetry)</span>
          <span className="lg lg-reported">Reported by firmware v2</span>
          <span className="lg lg-unverified">Unverified / not wired in the guide</span>
        </div>
      </section>

      <section className="lab-grid">
        <div>
          <h2 className="section-title">Pin map</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Pin</th>
                <th scope="col">Dir</th>
                <th scope="col">Connected to</th>
                <th scope="col">Visible to the app</th>
              </tr>
            </thead>
            <tbody>
              {PIN_MAP.map((p) => (
                <tr key={p.pin}>
                  <td className="mono">{p.pin}</td>
                  <td>{p.dir}</td>
                  <td>{p.signal}</td>
                  <td>{p.seen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="section-title">From bits to occupancy</h2>
          <BinaryRegister reading={view.reading} tone="light" />
          <table className="table truth">
            <thead>
              <tr>
                <th scope="col">Q2 Q1 Q0</th>
                <th scope="col">Count</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }, (_, n) => (
                <tr key={n} className={`${n === raw ? 'is-current' : ''} ${n > CAPACITY ? 'is-invalid' : ''}`} aria-current={n === raw ? 'true' : undefined}>
                  <td className="mono">
                    {(n >> 2) & 1} {(n >> 1) & 1} {n & 1}
                  </td>
                  <td className="mono">{n}</td>
                  <td>{n > CAPACITY ? 'Invalid — above capacity' : n === CAPACITY ? 'Full · entry refused' : n === 0 ? 'Empty · exit refused' : `${CAPACITY - n} free`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lab-grid">
        <div>
          <h2 className="section-title">Signal path</h2>
          <ol className="path">
            <li>
              <strong>Sensor.</strong> A vehicle pulls the IR module's output LOW on D5 (entry) or D6 (exit).
            </li>
            <li>
              <strong>Firmware.</strong> On the falling edge, if the rule allows (entry: count &lt; 5, exit: count &gt; 0), the
              servo turns to 90°, a 15 ms pulse goes out on D2 or D3, the gate stays open 1.5 s and closes. loop() prints
              nothing during those ~1.8 s.
            </li>
            <li>
              <strong>Counter.</strong> On the rising edge of D2 the 74LS74s load the next state computed by the XOR/AND
              gates.
            </li>
            <li>
              <strong>Telemetry.</strong> Every ~100 ms the Arduino reads Q0–Q2 and prints{' '}
              <code>{'{"q2":0,"q1":1,"q0":1,"count":3}'}</code> at 9600 baud. Firmware v2 adds event lines.
            </li>
            <li>
              <strong>This app.</strong> Lines are validated (bits 0/1, count must equal the bits), a value is accepted
              after two identical frames, and occupancy is the accepted value when it is 0–5.
            </li>
          </ol>
        </div>
        <CounterSelfCheck />
      </section>

      <section className="findings" aria-labelledby="findings-title">
        <div className="section-head">
          <h2 className="section-title" id="findings-title">
            Wiring review
          </h2>
          <span className="muted">From the wiring guide used to build the prototype. Verify each point on your breadboard.</span>
        </div>
        <ul>
          {FINDINGS.map((f) => (
            <li key={f.title} className={`finding tone-${f.severity}`}>
              <Icon name={f.severity === 'info' ? 'info' : 'alert'} />
              <div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <p className="finding-fix">
                  <strong>Fix:</strong> {f.fix}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="lab-grid">
        <div>
          <h2 className="section-title">Firmware on the board</h2>
          <dl className="kv">
            <div>
              <dt>Protocol</dt>
              <dd>{protocolLabel[protocol]}</dd>
            </div>
            {boot && (
              <>
                <div>
                  <dt>Saved count (EEPROM)</dt>
                  <dd>{boot.saved}</dd>
                </div>
                <div>
                  <dt>Counter at startup</dt>
                  <dd>
                    {boot.start} → {boot.pulses} restore pulse{boot.pulses === 1 ? '' : 's'} → {boot.restored ? 'restored' : 'restore failed'}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
        <div>
          <h2 className="section-title">v1 or v2?</h2>
          <p>
            <strong>v1</strong> (<code>firmware/parking_counter_v1</code>) is the sketch the prototype was built with. The app
            works with it unchanged, but it cannot tell which sensor fired, so vehicle events are inferred.
          </p>
          <p>
            <strong>v2</strong> keeps the same pins, timings and telemetry line, fixes the restart bug and adds one JSON line
            per gate decision, so every entry and exit can be checked against the counter.
          </p>
        </div>
      </section>
    </div>
  );
}

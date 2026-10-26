# Smart Parking — live monitor for the Arduino + 74LS74 counter

A web app for the LDM smart-parking prototype: an Arduino Uno, two 74LS74 dual
D flip-flops with 74LS86/74LS08/74LS04 logic as a 3-bit counter, two IR
sensors and two SG90 barrier servos. The app reads the counter over USB with
Web Serial and shows occupancy, gate state, an interactive 3D facility, a
hardware lab view, an event timeline, analytics and diagnostics.

**The physical counter is the only source of occupancy.** The app never counts
on its own, never sends commands to the board, and labels everything it
infers. Simulation mode exists for demos, is clearly marked, and is kept
completely separate from live data.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

1. Upload `firmware/parking_counter_v2` (recommended) or keep
   `parking_counter_v1` — the app works with both. See [firmware/README.md](firmware/README.md).
2. Plug the Uno in by USB and **close the Arduino IDE Serial Monitor**.
3. Open the app in **Chrome, Edge or Opera on a desktop**, press
   **Connect Arduino** and pick the board's port. The Uno restarts when the
   port opens; the first reading appears after about 2 s.

## How the app talks to the Arduino

```
IR sensor ─► Arduino (D5/D6) ─► servo (D10/D11) + clock pulse (D2/D3) ─► 74LS74 counter
                                                                          │ Q0 Q1 Q2
                      browser ◄── USB serial, 9600 baud, JSON lines ◄── D7 D8 D9
```

- **Transport:** Web Serial (`navigator.serial`), opened only on a click, at
  9600 baud 8N1. One port at a time; every disconnect cancels the reader,
  releases its lock and closes the port, so the Arduino IDE can use it again.
  An unplugged board is detected and reconnected automatically when the same
  board is plugged back in. The app never writes to the port.
- **Protocol:** the firmware's own output, one JSON object per line. Every
  ~100 ms: `{"q2":0,"q1":1,"q0":1,"count":3}`. Firmware v2 adds boot,
  entry/exit, denied and gate-closed lines. Full description in
  [firmware/README.md](firmware/README.md).
- **Validation:** bits must be 0/1 and `count` must equal `4·q2 + 2·q1 + q0`.
  A new value is accepted only after two identical frames, so repeated frames
  never create events and one-frame glitches are ignored. Malformed lines are
  shown in the serial console and never update the display.
- **Occupancy** is the accepted counter value when it is 0–5. A reading of 6 or
  7 is shown as *out of range* with the raw value, never as occupancy.

### What is measured, reported and inferred

| Shown in the app | Where it comes from |
|---|---|
| Q2 Q1 Q0, raw count, occupancy | **Measured** — every telemetry line |
| Entry/exit events (v2) | **Reported** by the firmware, then **confirmed** when the counter moves by ±1, or flagged as a discrepancy when it does not |
| Entry/exit events (v1) | **Inferred** — a ±1 counter step right after a telemetry pause of gate-sequence length (the v1 firmware blocks ~1.8 s per gate sequence). Steps without that pause are logged as unexplained, never as vehicles |
| Gate open/closed | **Reported** commanded position (v2 only); servos have no position feedback. v1: *not reported* |
| "Next vehicle will be let through/refused" | The firmware's own rule (`count < 5`, `count > 0`) applied to the latest reading — a prediction |
| Which bay a car uses in 3D | A **model**: anonymous vehicles, lowest free bay on arrival, longest-parked leaves first. Only the number of occupied bays is real |

### Data states

The header shows three independent indicators:

- **USB** — connected / disconnected / unavailable in this browser.
- **Telemetry** — waiting, live, stale (no valid line for 4 s), invalid.
- **Counter** — consistent, out of range (6/7), discrepancy (an event and the
  counter disagree), unstable (values flicker).

When data is stale or the board is unplugged, the last value stays on screen
labelled *stale* or *last known · disconnected*.

## Firmware

`firmware/parking_counter_v1` is the original sketch, unchanged.
`firmware/parking_counter_v2` adds two small changes (restore fix, event
lines) and is recommended. The review of the wiring guide found problems that
the app will surface as discrepancies, including the D3 decrement path and the
AND gate tied to the clock. See [docs/hardware-notes.md](docs/hardware-notes.md).

## Simulation mode

Switch the data source to **Simulation** in the sidebar. A violet
**SIMULATION** banner appears on every page. The simulated board must be
started by hand; it emits the same lines with the same timing as firmware v2
and goes through the same validation. You can inject faults: Q pins floating
(count 7), telemetry stopping, a corrupted line, and the missing decrement
path. Simulation has its own state, never touches the live connection, and is
never saved.

## Tests

```bash
npm test               # unit + firmware-in-the-loop (≈40 s)
npm run typecheck
npm run build && npm run test:e2e   # browser check, needs Playwright + Chromium
```

- **Unit tests** (`test/unit`): parser, line framing, binary → decimal,
  repeated readings, entry/exit inference and confirmation, unexpected jumps,
  out-of-range values, stale and invalid data, browser stalls, disconnects and
  reconnects, capacity validation, simulation/live separation, bay allocation,
  analytics, storage, and the Web Serial transport against a fake port.
- **Firmware-in-the-loop** (`test/firmware`): the two sketches, compiled for
  the ATmega328P (`npm run firmware:build`), run in the avr8js emulator wired
  to a behavioural 74LS74 model. Their real serial output is fed through the
  app's parser and engine. This verifies protocol compatibility and timing
  against the actual firmware, and reproduces the wiring faults above.
- **Browser check** (`test/e2e`): the production build in headless Chromium
  with a scripted fake serial port — connect, entry, exit discrepancy, bad
  lines, count 7, unplug, simulation isolation, and phone-width layout.
  Screenshots go to `test/e2e/output/`.

None of these tests use the physical board. **The app has not yet been tested
against the real hardware.**

## Deployment

The app is a static site:

```bash
npm run build          # output in dist/
npm run preview        # serve dist/ at http://localhost:4173
```

`dist/` can be hosted on any HTTPS static host (Vercel, Netlify, GitHub
Pages); asset paths are relative. Web Serial needs a secure context
(`https://` or `http://localhost`) and a Chromium-based desktop browser
(Chrome, Edge or Opera; not Firefox or Safari, and not on iOS). The Arduino
must be plugged into **the computer running the browser** — a hosted page
cannot reach a board on another machine.

**Remote monitoring (not built):** run a small gateway on the computer next to
the Arduino that reads the port, validates lines with the same parser
(`src/protocol`), and forwards accepted readings and events over an
authenticated WebSocket or HTTPS endpoint to a hosted copy of the app. The
engine in `src/core` would run on the gateway, so remote viewers receive the
same validated state.

Live history (events and occupancy samples) is kept in the browser's
localStorage on that computer. Export it as CSV or JSON from the Timeline.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "The port is busy" | The Arduino IDE Serial Monitor/Plotter or another tab has the port open. Close it. |
| Connected, but "No telemetry yet" | The parking sketch is not uploaded, or a different baud rate is used. |
| Serial console shows plain text such as `ENTRY DETECTED!` | A test sketch is uploaded instead of the parking sketch. |
| Counter reads 7 and entries are refused | Q inputs floating or grounds not joined (hardware notes, finding 4). |
| Count jumps every time you connect | Firmware v1 restore bug — upload v2 (finding 3). |
| Exits never lower the count | D3 does not reach the counter logic (finding 2). |
| Count goes 0 → 1 → 0 on entries | 74LS08 pin 2 tied to the clock (finding 1). |
| Connect button disabled | Browser without Web Serial, or the page is not on https/localhost. |

## Project layout

```
firmware/                 Arduino sketches (v1 original, v2 recommended)
src/protocol/             line framing and message parsing
src/core/                 engine reducer, selectors, bay model, analytics, storage
src/serial/               Web Serial transport and session
src/simulation/           simulated firmware and session (separate store)
src/facility/             3D scene (React Three Fiber) and 2D fallback
src/views/, src/ui/       pages and shared components
test/unit, test/firmware, test/e2e
tools/firmware/build.sh   compiles the sketches for the emulator tests
docs/hardware-notes.md    wiring review and the optional up/down counter
```

import { BAUD_RATE, CAPACITY, HISTORY_LIMITS, TIMING } from '../config';
import { parseLine } from '../protocol/parser';
import type { Bit, BootMessage, FirmwareEventMessage, TelemetryFrame } from '../protocol/types';
import type {
  EngineAction,
  EngineState,
  EventBasis,
  EventKind,
  ParkingEvent,
  RawLineKind,
  Reading,
  Severity,
  Source,
} from './types';

/**
 * The engine turns timestamped serial lines and link changes into validated
 * occupancy, events and diagnostics. It is a pure reducer: the same actions
 * always give the same state, which is what the tests rely on.
 *
 * Ground rules:
 * - Occupancy only ever comes from the counter bits the Arduino reports.
 * - A value must repeat (TIMING.confirmSamples frames) before it is accepted,
 *   so repeated frames never create events and one-frame glitches are ignored.
 * - A vehicle event is only recorded when its cause can be established; any
 *   other change is logged as a counter observation, never as a vehicle.
 */

export interface EngineOptions {
  source: Source;
  capacity?: number;
  history?: { events: ParkingEvent[]; samples: EngineState['samples'] };
}

const describeBits = (bits: [Bit, Bit, Bit]) => bits.join('');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function createEngineState(options: EngineOptions): EngineState {
  const events = options.history?.events ?? [];
  return {
    source: options.source,
    capacity: options.capacity ?? CAPACITY,
    link: { status: 'disconnected', since: null, error: null, portLabel: null },
    session: emptySession(0, null),
    protocol: 'unknown',
    boot: null,
    latest: null,
    accepted: null,
    acceptedSession: 0,
    candidate: null,
    lastLineAt: null,
    lastFrameAt: null,
    gateWindow: null,
    pending: [],
    gates: {
      entry: { state: 'unknown', at: null, reported: false },
      exit: { state: 'unknown', at: null, reported: false },
    },
    invalidStreak: 0,
    lastInvalid: null,
    flickers: [],
    unstable: false,
    stale: false,
    discrepancy: null,
    page: { hidden: false, changedAt: 0 },
    events,
    samples: options.history?.samples ?? [],
    rawLog: [],
    totals: {
      frames: 0,
      invalid: 0,
      fragments: 0,
      overflows: 0,
      readErrors: 0,
      staleEpisodes: 0,
      flickers: 0,
      unexplainedChanges: 0,
      discrepancies: 0,
      outOfRange: 0,
      connections: 0,
    },
    steps: { up: 0, down: 0, other: 0 },
    bitToggles: [0, 0, 0],
    seq: events.length,
  };
}

function emptySession(id: number, connectedAt: number | null): EngineState['session'] {
  return {
    id,
    connectedAt,
    endedAt: null,
    firstFrameAt: null,
    lines: 0,
    frames: 0,
    invalid: 0,
    bytes: 0,
    maxGapMs: 0,
    gatePauses: 0,
    vehicleEvents: 0,
    waitingWarned: false,
  };
}

// ---------------------------------------------------------------------------
// Small mutation helpers. The reducer works on a shallow copy of the state and
// always replaces (never mutates) nested arrays and objects it changes.
// ---------------------------------------------------------------------------

interface EventInput {
  kind: EventKind;
  basis: EventBasis;
  severity: Severity;
  title: string;
  detail?: string;
  before?: number | null;
  after?: number | null;
  movement?: ParkingEvent['movement'];
}

function addEvent(s: EngineState, at: number, input: EventInput): void {
  s.seq += 1;
  const event: ParkingEvent = {
    id: `${s.source === 'live' ? 'L' : 'S'}${at.toString(36)}-${s.seq.toString(36)}`,
    at,
    source: s.source,
    session: s.session.id,
    kind: input.kind,
    basis: input.basis,
    severity: input.severity,
    before: input.before ?? null,
    after: input.after ?? null,
    title: input.title,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.movement ? { movement: input.movement } : {}),
  };
  const events = [...s.events, event];
  s.events = events.length > HISTORY_LIMITS.events ? events.slice(-HISTORY_LIMITS.events) : events;
}

function addSample(s: EngineState, at: number, raw: number | null): void {
  const occupancy = raw !== null && raw <= s.capacity ? raw : null;
  const samples = [...s.samples, { at, raw, occupancy }];
  s.samples = samples.length > HISTORY_LIMITS.samples ? samples.slice(-HISTORY_LIMITS.samples) : samples;
}

let rawLogId = 0;
function addRaw(s: EngineState, at: number, kind: RawLineKind, text: string, note?: string): void {
  rawLogId += 1;
  const entry = { id: rawLogId, at, kind, text, ...(note ? { note } : {}) };
  const log = [...s.rawLog, entry];
  s.rawLog = log.length > HISTORY_LIMITS.rawLog ? log.slice(-HISTORY_LIMITS.rawLog) : log;
}

function setDiscrepancy(s: EngineState, at: number, message: string): void {
  s.discrepancy = { at, message };
  s.totals = { ...s.totals, discrepancies: s.totals.discrepancies + 1 };
}

const inRange = (s: EngineState, raw: number) => raw >= 0 && raw <= s.capacity;
const hasCurrentReading = (s: EngineState) => s.accepted !== null && s.acceptedSession === s.session.id;

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'link':
      return onLink(state, action);
    case 'line':
      return onLine(state, action.text, action.at);
    case 'bytes':
      return { ...state, session: { ...state.session, bytes: state.session.bytes + action.count } };
    case 'overflow': {
      const s = { ...state };
      s.totals = { ...s.totals, overflows: s.totals.overflows + 1 };
      s.invalidStreak += 1;
      addRaw(s, action.at, 'overflow', `(${action.length} characters without a line break — discarded)`);
      return s;
    }
    case 'read-error': {
      const s = { ...state };
      s.totals = { ...s.totals, readErrors: s.totals.readErrors + 1 };
      addRaw(s, action.at, 'read-error', action.message);
      addEvent(s, action.at, {
        kind: 'telemetry',
        basis: 'observed',
        severity: 'warning',
        title: 'Serial read error',
        detail: `${action.message}. Some bytes may have been lost; reading continues.`,
      });
      return s;
    }
    case 'visibility':
      return { ...state, page: { hidden: action.hidden, changedAt: action.at } };
    case 'tick':
      return onTick(state, action.at);
    case 'acknowledge':
      return state.discrepancy ? { ...state, discrepancy: null } : state;
    case 'clear-history': {
      const s = { ...state, events: [], samples: [] };
      addEvent(s, action.at, { kind: 'link', basis: 'observed', severity: 'info', title: 'History cleared' });
      return s;
    }
  }
}

function onLink(state: EngineState, action: Extract<EngineAction, { type: 'link' }>): EngineState {
  const { status, at } = action;
  const s = { ...state };
  const previous = state.link.status;
  s.link = {
    status,
    since: at,
    error: action.error ?? null,
    portLabel: action.portLabel !== undefined ? action.portLabel : state.link.portLabel,
  };

  if (status === 'connected' && previous !== 'connected') {
    s.session = emptySession(at, at);
    s.protocol = 'unknown';
    s.boot = null;
    s.latest = null;
    s.candidate = null;
    s.lastLineAt = null;
    s.lastFrameAt = null;
    s.gateWindow = null;
    s.pending = [];
    s.invalidStreak = 0;
    s.lastInvalid = null;
    s.flickers = [];
    s.unstable = false;
    s.stale = false;
    s.gates = {
      entry: { state: 'unknown', at: null, reported: false },
      exit: { state: 'unknown', at: null, reported: false },
    };
    s.totals = { ...s.totals, connections: s.totals.connections + 1 };
    addEvent(s, at, {
      kind: 'link',
      basis: 'observed',
      severity: 'info',
      title: `Connected${s.link.portLabel ? ` to ${s.link.portLabel}` : ''} at ${BAUD_RATE} baud`,
      detail: 'Opening the port normally restarts the Uno, so the first reading takes about 2 seconds.',
    });
    return s;
  }

  if (status === 'disconnected' && (previous === 'connected' || previous === 'disconnecting')) {
    for (const p of s.pending) {
      addEvent(s, at, {
        kind: p.kind,
        basis: 'unconfirmed',
        severity: 'warning',
        before: p.before,
        title: `${p.kind === 'entry' ? 'Entry' : 'Exit'} reported but not verified`,
        detail: 'The connection ended before the counter could be checked.',
      });
    }
    s.pending = [];
    s.candidate = null;
    s.gateWindow = null;
    s.stale = false;
    s.session = { ...s.session, endedAt: at };
    s.gates = {
      entry: { ...s.gates.entry, state: 'unknown', reported: false },
      exit: { ...s.gates.exit, state: 'unknown', reported: false },
    };
    if (hasCurrentReading(s)) addSample(s, at, null);
    const lost = action.reason === 'lost';
    addEvent(s, at, {
      kind: 'link',
      basis: 'observed',
      severity: lost ? 'warning' : 'info',
      title: lost ? 'USB connection lost' : 'Disconnected',
      detail: lost
        ? 'The board stopped responding: cable unplugged, board reset by another program, or a USB error.'
        : undefined,
    });
    return s;
  }

  if (status === 'disconnected' && action.error) {
    addEvent(s, at, { kind: 'link', basis: 'observed', severity: 'error', title: 'Could not connect', detail: action.error });
  }
  return s;
}

function onLine(state: EngineState, text: string, at: number): EngineState {
  if (state.link.status !== 'connected') return state;
  const s = { ...state };
  const firstLine = s.session.lines === 0;
  const gap = s.lastLineAt === null ? null : at - s.lastLineAt;
  s.session = {
    ...s.session,
    lines: s.session.lines + 1,
    maxGapMs: gap !== null ? Math.max(s.session.maxGapMs, gap) : s.session.maxGapMs,
  };

  const parsed = parseLine(text);
  if (parsed.kind === 'invalid') {
    if (firstLine) {
      // The port may open mid-line when the board did not restart.
      s.totals = { ...s.totals, fragments: s.totals.fragments + 1 };
      addRaw(s, at, 'fragment', text, 'partial first line after connecting — ignored');
      s.lastLineAt = at;
      return s;
    }
    s.session = { ...s.session, invalid: s.session.invalid + 1 };
    s.totals = { ...s.totals, invalid: s.totals.invalid + 1 };
    s.invalidStreak += 1;
    s.lastInvalid = { at, reason: parsed.reason, text };
    addRaw(s, at, 'invalid', text, parsed.reason);
    if (s.invalidStreak === TIMING.invalidStreak) {
      addEvent(s, at, {
        kind: 'telemetry',
        basis: 'observed',
        severity: 'warning',
        title: 'Receiving unusable data',
        detail: `${TIMING.invalidStreak} lines in a row could not be used (${parsed.reason}). The display keeps the last valid reading. Check the baud rate (${BAUD_RATE}) and that the parking sketch is uploaded.`,
      });
    }
    s.lastLineAt = at;
    return s;
  }

  s.invalidStreak = 0;
  if (parsed.kind === 'boot') {
    addRaw(s, at, 'boot', text);
    onBoot(s, parsed.boot, at);
  } else if (parsed.kind === 'event') {
    addRaw(s, at, 'event', text);
    onFirmwareEvent(s, parsed.event, at);
  } else {
    addRaw(s, at, 'telemetry', text);
    onFrame(s, parsed.frame, at);
  }
  s.lastLineAt = at;
  return s;
}

function markV2(s: EngineState, at: number): void {
  if (s.protocol === 'v2') return;
  s.protocol = 'v2';
  s.gateWindow = null;
  addEvent(s, at, {
    kind: 'firmware',
    basis: 'observed',
    severity: 'info',
    title: 'Firmware v2 detected',
    detail: 'The board reports entry and exit decisions, so every vehicle event can be checked against the counter.',
  });
}

function onBoot(s: EngineState, boot: BootMessage, at: number): void {
  markV2(s, at);
  s.boot = boot;
  // setup() writes 0° (closed) to both servos before printing the boot line.
  s.gates = {
    entry: { state: 'closed', at, reported: true },
    exit: { state: 'closed', at, reported: true },
  };
  const restore =
    boot.pulses === 0
      ? `The counter already showed the saved value ${boot.saved}; no clock pulses were needed.`
      : `The counter showed ${boot.start}; ${plural(boot.pulses, 'clock pulse')} were sent to restore the saved value ${boot.saved}.`;
  addEvent(s, at, {
    kind: 'firmware',
    basis: 'reported',
    severity: boot.restored ? 'info' : 'warning',
    title: boot.restored ? 'Arduino started' : 'Arduino started — count restore failed',
    detail: boot.restored
      ? restore
      : `${restore} The counter still does not show ${boot.saved}, so it is not stepping through 0–7 normally. See the counter check in the Hardware Lab.`,
  });
  if (boot.cap !== s.capacity) {
    addEvent(s, at, {
      kind: 'firmware',
      basis: 'reported',
      severity: 'warning',
      title: 'Capacity mismatch',
      detail: `The firmware reports capacity ${boot.cap}; this app is configured for ${s.capacity}.`,
    });
  }
}

function onFirmwareEvent(s: EngineState, msg: FirmwareEventMessage, at: number): void {
  markV2(s, at);
  const { evt, before } = msg;
  switch (evt) {
    case 'entry':
    case 'exit': {
      const gate = evt === 'entry' ? 'entry' : 'exit';
      s.gates = { ...s.gates, [gate]: { state: 'open', at, reported: true } };
      const expected = evt === 'entry' ? before + 1 : before - 1;
      s.pending = [...s.pending, { kind: evt, before, expected, at, deadline: at + TIMING.expectationTimeoutMs }];
      break;
    }
    case 'entry_closed':
    case 'exit_closed': {
      const gate = evt === 'entry_closed' ? 'entry' : 'exit';
      s.gates = { ...s.gates, [gate]: { state: 'closed', at, reported: true } };
      break;
    }
    case 'entry_denied':
      addEvent(s, at, {
        kind: 'entry-denied',
        basis: 'reported',
        severity: 'notice',
        before,
        after: before,
        title: 'Entry refused — gate kept closed',
        detail:
          before > s.capacity
            ? `The entry sensor fired, but the counter reads ${before}, which is above the capacity of ${s.capacity}. The firmware refuses entry while count ≥ ${s.capacity}.`
            : `The entry sensor fired while the counter read ${before} (full).`,
      });
      break;
    case 'exit_denied':
      addEvent(s, at, {
        kind: 'exit-denied',
        basis: 'reported',
        severity: 'notice',
        before,
        after: before,
        title: 'Exit refused — gate kept closed',
        detail: 'The exit sensor fired while the counter read 0, so the firmware did not open the exit gate.',
      });
      break;
  }
}

function onFrame(s: EngineState, frame: TelemetryFrame, at: number): void {
  const bits: [Bit, Bit, Bit] = [frame.q2, frame.q1, frame.q0];
  const reading: Reading = { raw: frame.count, bits, at };
  const prevFrameAt = s.lastFrameAt;
  s.latest = reading;
  s.lastFrameAt = at;
  s.session = {
    ...s.session,
    frames: s.session.frames + 1,
    firstFrameAt: s.session.firstFrameAt ?? at,
  };
  s.totals = { ...s.totals, frames: s.totals.frames + 1 };
  if (s.protocol === 'unknown') s.protocol = 'v1';

  if (s.stale) {
    s.stale = false;
    addEvent(s, at, {
      kind: 'telemetry',
      basis: 'observed',
      severity: 'info',
      title: 'Telemetry resumed',
      detail: prevFrameAt ? `No valid data for ${seconds(at - prevFrameAt)}.` : undefined,
    });
  }

  // v1: the firmware prints nothing while a gate sequence runs (~1.77 s), so a
  // pause of that length right before a counter step is evidence that the
  // step came from a gate sequence rather than from noise.
  if (s.protocol !== 'v2' && prevFrameAt !== null && hasCurrentReading(s)) {
    const pause = at - prevFrameAt;
    const pageWasVisible = !s.page.hidden && s.page.changedAt <= prevFrameAt;
    if (pause >= TIMING.gateGapMs && pageWasVisible) {
      checkGateWindow(s, at, true);
      s.gateWindow = { pauseMs: pause, endedAt: at, resolved: false };
      s.session = { ...s.session, gatePauses: s.session.gatePauses + 1 };
    }
  }

  const current = hasCurrentReading(s) ? s.accepted : null;
  if (current && current.raw === reading.raw) {
    if (s.candidate) recordFlicker(s, at);
    s.candidate = null;
    return;
  }

  if (s.candidate && s.candidate.raw === reading.raw) {
    s.candidate = { ...s.candidate, samples: s.candidate.samples + 1 };
  } else {
    if (s.candidate) recordFlicker(s, at);
    const gw = s.gateWindow;
    s.candidate = {
      raw: reading.raw,
      bits,
      firstAt: at,
      samples: 1,
      gateLinked: !!gw && !gw.resolved && at - gw.endedAt <= TIMING.gateGapWindowMs,
    };
  }

  if (s.candidate.samples >= TIMING.confirmSamples) {
    const candidate = s.candidate;
    s.candidate = null;
    if (current) acceptChange(s, current, { raw: candidate.raw, bits: candidate.bits, at }, candidate.gateLinked);
    else acceptBaseline(s, { raw: candidate.raw, bits: candidate.bits, at });
  }
}

function recordFlicker(s: EngineState, at: number): void {
  s.flickers = [...s.flickers.filter((t) => at - t <= TIMING.flickerWindowMs), at];
  s.totals = { ...s.totals, flickers: s.totals.flickers + 1 };
  if (!s.unstable && s.flickers.length >= TIMING.flickerThreshold) {
    s.unstable = true;
    addEvent(s, at, {
      kind: 'counter',
      basis: 'observed',
      severity: 'warning',
      title: 'Counter readings are unstable',
      detail: `${s.flickers.length} one-off values in ${TIMING.flickerWindowMs / 1000} s were ignored. A Q output is probably floating: check the wires to D7/D8/D9 and the common ground between the Arduino and the breadboard.`,
    });
  }
}

function acceptBaseline(s: EngineState, reading: Reading): void {
  const previous = s.accepted;
  s.accepted = reading;
  s.acceptedSession = s.session.id;
  addSample(s, reading.at, reading.raw);

  const valid = inRange(s, reading.raw);
  addEvent(s, reading.at, {
    kind: 'counter',
    basis: 'observed',
    severity: valid ? 'info' : 'error',
    after: reading.raw,
    title: valid
      ? `First reading: ${plural(reading.raw, 'vehicle')}`
      : `First reading: counter shows ${reading.raw}, above capacity`,
    detail: `Q2 Q1 Q0 = ${describeBits(reading.bits)}.`,
  });
  if (!valid) outOfRange(s, reading);

  if (previous && previous.raw !== reading.raw) {
    s.totals = { ...s.totals, unexplainedChanges: s.totals.unexplainedChanges + 1 };
    const why =
      s.boot && s.boot.pulses > 0
        ? `The firmware sent ${plural(s.boot.pulses, 'restore pulse')} at startup.`
        : s.protocol === 'v2'
          ? 'The change happened while the app was not connected.'
          : 'The change happened while the app was not connected. Firmware v1 also adds its saved count to the counter every time the Uno restarts, and opening the port restarts it (see Hardware Lab).';
    addEvent(s, reading.at, {
      kind: 'counter',
      basis: 'observed',
      severity: 'warning',
      before: previous.raw,
      after: reading.raw,
      title: `Counter changed between sessions: ${previous.raw} → ${reading.raw}`,
      detail: `${why} No vehicle events were recorded for this change.`,
    });
  }

  // A v2 event can arrive before the first reading of a session.
  const match = s.pending.findIndex((p) => p.expected === reading.raw);
  if (match >= 0) confirmExpectation(s, match, reading.raw, reading.raw, reading.at);
}

function acceptChange(s: EngineState, from: Reading, to: Reading, gateLinked: boolean): void {
  s.accepted = to;
  s.acceptedSession = s.session.id;
  addSample(s, to.at, to.raw);
  const delta = to.raw - from.raw;
  s.steps = {
    up: s.steps.up + (delta === 1 ? 1 : 0),
    down: s.steps.down + (delta === -1 ? 1 : 0),
    other: s.steps.other + (Math.abs(delta) === 1 ? 0 : 1),
  };
  s.bitToggles = [
    s.bitToggles[0] + (from.bits[0] !== to.bits[0] ? 1 : 0),
    s.bitToggles[1] + (from.bits[1] !== to.bits[1] ? 1 : 0),
    s.bitToggles[2] + (from.bits[2] !== to.bits[2] ? 1 : 0),
  ];

  const enteringBadRange = !inRange(s, to.raw);
  if (s.protocol === 'v2') classifyV2(s, from.raw, to.raw, to.at);
  else classifyV1(s, from.raw, to.raw, to.at, gateLinked);

  if (enteringBadRange) outOfRange(s, to);
  else if (!inRange(s, from.raw)) {
    addEvent(s, to.at, {
      kind: 'counter',
      basis: 'observed',
      severity: 'notice',
      before: from.raw,
      after: to.raw,
      title: `Counter back in range: ${from.raw} → ${to.raw}`,
    });
  }
}

function outOfRange(s: EngineState, reading: Reading): void {
  s.totals = { ...s.totals, outOfRange: s.totals.outOfRange + 1 };
  const message = `Counter reads ${reading.raw} (Q2 Q1 Q0 = ${describeBits(reading.bits)}), above the capacity of ${s.capacity}. The firmware will refuse every entry while count ≥ ${s.capacity}.`;
  setDiscrepancy(s, reading.at, message);
  addEvent(s, reading.at, {
    kind: 'counter',
    basis: 'observed',
    severity: 'error',
    after: reading.raw,
    title: `Counter out of range: ${reading.raw}`,
    detail: `${message} All three bits reading 1 usually means the Q pins are not connected or the Arduino and breadboard grounds are not joined.`,
  });
}

function classifyV1(s: EngineState, from: number, to: number, at: number, gateLinked: boolean): void {
  const delta = to - from;
  const bothValid = inRange(s, from) && inRange(s, to);
  if (s.gateWindow && gateLinked) s.gateWindow = { ...s.gateWindow, resolved: true };

  if (bothValid && Math.abs(delta) === 1 && gateLinked) {
    const entry = delta === 1;
    s.session = { ...s.session, vehicleEvents: s.session.vehicleEvents + 1 };
    addEvent(s, at, {
      kind: entry ? 'entry' : 'exit',
      basis: 'inferred',
      severity: 'info',
      before: from,
      after: to,
      movement: entry ? 'arrive' : 'depart',
      title: entry ? 'Vehicle entered' : 'Vehicle left',
      detail: `Inferred: the counter stepped ${from} → ${to} right after a gate-length telemetry pause. Firmware v1 does not say which sensor fired, so the direction assumes the counter counts correctly.`,
    });
    return;
  }
  if (!bothValid) return; // out-of-range transitions are reported by the caller
  s.totals = { ...s.totals, unexplainedChanges: s.totals.unexplainedChanges + 1 };
  addEvent(s, at, {
    kind: 'counter',
    basis: 'observed',
    severity: 'warning',
    before: from,
    after: to,
    title: Math.abs(delta) === 1 ? `Counter changed ${from} → ${to} on its own` : `Unexpected counter jump ${from} → ${to}`,
    detail:
      Math.abs(delta) === 1
        ? 'No gate sequence preceded this step (the telemetry did not pause), so it was not caused by an entry or exit. Likely a glitch on the clock line. Not counted as a vehicle.'
        : `The counter moved by ${delta > 0 ? '+' : ''}${delta}; a single entry or exit moves it by 1. Not counted as a vehicle.`,
  });
}

function classifyV2(s: EngineState, from: number, to: number, at: number): void {
  const match = s.pending.findIndex((p) => p.expected === to);
  if (match >= 0) {
    confirmExpectation(s, match, from, to, at);
    return;
  }
  if (s.pending.length > 0) {
    const p = s.pending[0];
    s.pending = s.pending.slice(1);
    const label = p.kind === 'entry' ? 'Entry' : 'Exit';
    const message = `${label} reported, but the counter went ${from} → ${to} instead of ${p.before} → ${p.expected}.`;
    setDiscrepancy(s, at, message);
    addEvent(s, at, {
      kind: p.kind,
      basis: 'unconfirmed',
      severity: 'error',
      before: from,
      after: to,
      title: `${label} — counter disagrees`,
      detail: `${message} The vehicle passed the gate, but the hardware count is now wrong. See the counter check in the Hardware Lab.`,
    });
    return;
  }
  if (!inRange(s, from) || !inRange(s, to)) return;
  s.totals = { ...s.totals, unexplainedChanges: s.totals.unexplainedChanges + 1 };
  addEvent(s, at, {
    kind: 'counter',
    basis: 'observed',
    severity: 'warning',
    before: from,
    after: to,
    title: `Counter changed ${from} → ${to} without a gate event`,
    detail: 'The firmware reported no entry or exit, so this is not counted as a vehicle. Likely a glitch on the clock line.',
  });
}

function confirmExpectation(s: EngineState, index: number, from: number, to: number, at: number): void {
  const p = s.pending[index];
  s.pending = s.pending.filter((_, i) => i !== index);
  const entry = p.kind === 'entry';
  s.session = { ...s.session, vehicleEvents: s.session.vehicleEvents + 1 };
  addEvent(s, at, {
    kind: p.kind,
    basis: 'confirmed',
    severity: 'info',
    before: p.before,
    after: to,
    movement: from !== to ? (entry ? 'arrive' : 'depart') : undefined,
    title: entry ? 'Vehicle entered' : 'Vehicle left',
    detail: `The ${entry ? 'entry' : 'exit'} sensor fired, the gate opened, and the counter moved ${p.before} → ${to}.`,
  });
}

function checkGateWindow(s: EngineState, at: number, force: boolean): void {
  const gw = s.gateWindow;
  if (!gw || gw.resolved) return;
  if (!force && at - gw.endedAt <= TIMING.gateNoChangeMs) return;
  if (s.candidate?.gateLinked) return;
  s.gateWindow = { ...gw, resolved: true };
  const raw = s.accepted?.raw ?? null;
  addEvent(s, gw.endedAt, {
    kind: 'counter',
    basis: 'inferred',
    severity: 'warning',
    before: raw,
    after: raw,
    title: 'Gate sequence without a count change',
    detail: `Telemetry paused for ${seconds(gw.pauseMs)}, the length of the firmware's gate sequence, but the counter stayed at ${raw}. If a vehicle passed, the counter did not record it. For exits, check that D3 actually reaches the counter logic.`,
  });
}

function onTick(state: EngineState, at: number): EngineState {
  if (state.link.status !== 'connected') return state;
  let s: EngineState | null = null;
  const draft = () => (s ??= { ...state });

  if (!state.stale && state.lastFrameAt !== null && at - state.lastFrameAt > TIMING.staleAfterMs) {
    const d = draft();
    d.stale = true;
    d.totals = { ...d.totals, staleEpisodes: d.totals.staleEpisodes + 1 };
    addEvent(d, at, {
      kind: 'telemetry',
      basis: 'observed',
      severity: 'warning',
      title: 'Telemetry stale',
      detail: `No valid reading for ${seconds(at - state.lastFrameAt)}. The USB link is still open; the sketch may have stopped or the board is busy.`,
    });
  }

  const since = state.session.connectedAt ?? at;
  if (state.session.frames === 0 && !state.session.waitingWarned && at - since > 6000) {
    const d = draft();
    d.session = { ...d.session, waitingWarned: true };
    addEvent(d, at, {
      kind: 'telemetry',
      basis: 'observed',
      severity: 'warning',
      title: 'No telemetry yet',
      detail:
        state.session.lines === 0
          ? `Connected for 6 s without receiving anything. Check that the parking sketch is uploaded and running at ${BAUD_RATE} baud.`
          : 'Data is arriving but none of it is parking telemetry. Another sketch (for example a test sketch) may be uploaded.',
    });
  }

  const due = state.pending.filter((p) => at > p.deadline);
  if (due.length > 0) {
    const d = draft();
    d.pending = d.pending.filter((p) => at <= p.deadline);
    const current = hasCurrentReading(d) ? d.accepted!.raw : null;
    for (const p of due) {
      const label = p.kind === 'entry' ? 'Entry' : 'Exit';
      if (d.stale || current === null) {
        addEvent(d, at, {
          kind: p.kind,
          basis: 'unconfirmed',
          severity: 'warning',
          before: p.before,
          title: `${label} reported but not verified`,
          detail: 'Telemetry stopped before the counter could be checked.',
        });
        continue;
      }
      const message = `${label} reported (gate opened, ${p.kind === 'entry' ? 'D2' : 'D3'} pulsed), but the counter stayed at ${current}.`;
      setDiscrepancy(d, at, message);
      addEvent(d, at, {
        kind: p.kind,
        basis: 'unconfirmed',
        severity: 'error',
        before: p.before,
        after: current,
        title: `${label} not counted by the hardware`,
        detail:
          p.kind === 'exit'
            ? `${message} The decrement path from D3 is probably not connected to the flip-flop logic (see Hardware Lab).`
            : `${message} The clock pulse on D2 did not change the flip-flops.`,
      });
    }
  }

  if (state.gateWindow && !state.gateWindow.resolved && at - state.gateWindow.endedAt > TIMING.gateNoChangeMs) {
    checkGateWindow(draft(), at, false);
  }

  if (state.unstable) {
    const recent = state.flickers.filter((t) => at - t <= TIMING.flickerWindowMs);
    if (recent.length === 0) {
      const d = draft();
      d.unstable = false;
      d.flickers = [];
      addEvent(d, at, { kind: 'counter', basis: 'observed', severity: 'info', title: 'Counter readings stable again' });
    }
  }

  return s ?? state;
}

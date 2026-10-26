import type { Bit, BootMessage } from '../protocol/types';

/** Where a state container's data comes from. The two never share state. */
export type Source = 'live' | 'simulation';

export type LinkStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/**
 * What the connected firmware is known to send.
 * - unknown: nothing recognisable yet this session
 * - v1: telemetry only (the original sketch); vehicle events must be inferred
 * - v2: telemetry plus explicit boot/entry/exit lines
 */
export type ProtocolVersion = 'unknown' | 'v1' | 'v2';

/** A counter value accepted from telemetry. `bits` is [Q2, Q1, Q0]. */
export interface Reading {
  raw: number;
  bits: [Bit, Bit, Bit];
  at: number;
}

export type EventKind =
  | 'entry'
  | 'exit'
  | 'entry-denied'
  | 'exit-denied'
  | 'counter'
  | 'link'
  | 'firmware'
  | 'telemetry';

/**
 * How much the app knows about an event.
 * - confirmed: the firmware reported it AND the counter changed as expected (v2)
 * - inferred: deduced from a ±1 counter step right after a gate-length telemetry pause (v1)
 * - unconfirmed: the firmware reported it but the counter did not change as expected
 * - reported: the firmware reported it; no counter change is expected (denied entry/exit)
 * - observed: something the app saw directly (connection, readings, stream quality)
 */
export type EventBasis = 'confirmed' | 'inferred' | 'unconfirmed' | 'reported' | 'observed';

export type Severity = 'info' | 'notice' | 'warning' | 'error';

export interface ParkingEvent {
  id: string;
  at: number;
  source: Source;
  /** connectedAt of the serial session the event belongs to (0 = no session). */
  session: number;
  kind: EventKind;
  basis: EventBasis;
  severity: Severity;
  /** Counter values before/after, when known. */
  before: number | null;
  after: number | null;
  title: string;
  detail?: string;
  /**
   * Set only when a vehicle movement was identified AND the counter moved the
   * same way. The 3D facility animates a journey only for these.
   */
  movement?: 'arrive' | 'depart';
}

export interface OccupancySample {
  at: number;
  /** Raw counter value, or null for a gap (disconnected / no data). */
  raw: number | null;
  /** Validated occupancy (0..capacity), or null when raw is out of range or missing. */
  occupancy: number | null;
}

export type RawLineKind = 'telemetry' | 'event' | 'boot' | 'invalid' | 'fragment' | 'overflow' | 'read-error';

export interface RawLogEntry {
  id: number;
  at: number;
  kind: RawLineKind;
  text: string;
  note?: string;
}

export interface GateState {
  state: 'open' | 'closed' | 'unknown';
  at: number | null;
  /** Only v2 firmware reports gate commands; servos have no position feedback either way. */
  reported: boolean;
}

/** v2: an entry/exit the firmware reported, waiting for the counter to follow. */
export interface Expectation {
  kind: 'entry' | 'exit';
  before: number;
  expected: number;
  at: number;
  deadline: number;
}

/** v1: a telemetry pause long enough to be a gate sequence. */
export interface GateWindow {
  pauseMs: number;
  endedAt: number;
  resolved: boolean;
}

export interface SessionStats {
  /** connectedAt timestamp; 0 before the first connection. */
  id: number;
  connectedAt: number | null;
  endedAt: number | null;
  firstFrameAt: number | null;
  lines: number;
  frames: number;
  invalid: number;
  bytes: number;
  maxGapMs: number;
  gatePauses: number;
  vehicleEvents: number;
  waitingWarned: boolean;
}

export interface DiagnosticTotals {
  frames: number;
  invalid: number;
  fragments: number;
  overflows: number;
  readErrors: number;
  staleEpisodes: number;
  flickers: number;
  unexplainedChanges: number;
  discrepancies: number;
  outOfRange: number;
  connections: number;
}

export interface EngineState {
  source: Source;
  capacity: number;
  link: { status: LinkStatus; since: number | null; error: string | null; portLabel: string | null };
  session: SessionStats;
  protocol: ProtocolVersion;
  boot: BootMessage | null;
  /** Most recent valid telemetry frame of the current session. */
  latest: Reading | null;
  /** Debounced counter value. Kept after disconnect as the last known value. */
  accepted: Reading | null;
  /** Session id the accepted value was read in. */
  acceptedSession: number;
  candidate: { raw: number; bits: [Bit, Bit, Bit]; firstAt: number; samples: number; gateLinked: boolean } | null;
  lastLineAt: number | null;
  lastFrameAt: number | null;
  gateWindow: GateWindow | null;
  pending: Expectation[];
  gates: { entry: GateState; exit: GateState };
  invalidStreak: number;
  lastInvalid: { at: number; reason: string; text: string } | null;
  flickers: number[];
  unstable: boolean;
  stale: boolean;
  discrepancy: { at: number; message: string } | null;
  page: { hidden: boolean; changedAt: number };
  events: ParkingEvent[];
  samples: OccupancySample[];
  rawLog: RawLogEntry[];
  totals: DiagnosticTotals;
  /** Accepted counter steps, for the counter self-check in the Hardware Lab. */
  steps: { up: number; down: number; other: number };
  /** How often each bit flipped across accepted steps: [Q2, Q1, Q0]. */
  bitToggles: [number, number, number];
  seq: number;
}

export type EngineAction =
  | { type: 'link'; status: LinkStatus; at: number; error?: string | null; portLabel?: string | null; reason?: 'user' | 'lost' }
  | { type: 'line'; text: string; at: number }
  | { type: 'bytes'; count: number }
  | { type: 'overflow'; length: number; at: number }
  | { type: 'read-error'; message: string; at: number }
  | { type: 'visibility'; hidden: boolean; at: number }
  | { type: 'tick'; at: number }
  | { type: 'acknowledge' }
  | { type: 'clear-history'; at: number };

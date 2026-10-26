/**
 * Facts about the physical system and the firmware that the app relies on.
 * Every number here is taken from firmware/parking_counter_v1 (the sketch the
 * hardware runs) unless noted otherwise.
 */

/** Parking spaces in the prototype. The firmware refuses entry when count >= 5. */
export const CAPACITY = 5;

/** Serial.begin(9600) in setup(). */
export const BAUD_RATE = 9600;

/** Arduino Uno pin assignments, as wired. */
export const PINS = {
  clockUp: 'D2',
  clockDown: 'D3',
  entryIr: 'D5',
  exitIr: 'D6',
  q0: 'D7',
  q1: 'D8',
  q2: 'D9',
  entryServo: 'D10',
  exitServo: 'D11',
} as const;

export const TIMING = {
  /**
   * Normal telemetry period is ~100 ms: delay(100) per loop pass, while the
   * 33-byte line (~35 ms at 9600 baud) drains from the Arduino's transmit
   * buffer in the background. A gate sequence blocks loop() for ~1.77 s, and
   * an entry plus an exit handled in the same pass block it for ~3.5 s.
   * Anything longer than this means the stream has actually stopped.
   * (Timings measured by running the compiled sketch in an emulated
   * ATmega328P; see test/firmware.)
   */
  staleAfterMs: 4000,
  /** A pause at least this long between telemetry lines matches a gate sequence (v1 inference). */
  gateGapMs: 1200,
  /** After such a pause, a counter step must start within this window to be attributed to it. */
  gateGapWindowMs: 1000,
  /** If no counter step follows a gate-sequence pause within this time, flag it. */
  gateNoChangeMs: 1600,
  /** A new counter value must be seen in this many consecutive frames before it is accepted. */
  confirmSamples: 2,
  /** v2: how long after an entry/exit report the counter has to show the expected value. */
  expectationTimeoutMs: 4500,
  /** Consecutive unusable lines before the stream is called invalid. */
  invalidStreak: 3,
  /** Rejected one-off values within this window that mark the counter as unstable. */
  flickerWindowMs: 10_000,
  flickerThreshold: 3,
  /** How often the session re-evaluates time-based state. */
  tickMs: 250,
} as const;

/** Longest line the app will buffer. Real lines are < 80 characters. */
export const MAX_LINE_LENGTH = 512;

export const HISTORY_LIMITS = {
  events: 1500,
  samples: 6000,
  rawLog: 300,
} as const;

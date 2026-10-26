/** Shapes of the lines the parking firmware writes to the USB serial port. */

export type Bit = 0 | 1;

/**
 * Periodic telemetry (v1 and v2), printed every loop pass:
 *   {"q2":0,"q1":1,"q0":1,"count":3}
 * q2..q0 are digitalRead() values of D9, D8, D7 (the 74LS74 Q outputs).
 * count is computed by the firmware from those bits.
 */
export interface TelemetryFrame {
  q2: Bit;
  q1: Bit;
  q0: Bit;
  count: number;
}

/** v2 only: gate decisions, e.g. {"evt":"entry","before":2}. */
export type FirmwareEventName =
  | 'entry'
  | 'entry_closed'
  | 'entry_denied'
  | 'exit'
  | 'exit_closed'
  | 'exit_denied';

export interface FirmwareEventMessage {
  evt: FirmwareEventName;
  /** Counter value the firmware read at the start of the loop pass that handled the sensor. */
  before: number;
}

/** v2 only: printed once at the end of setup(). */
export interface BootMessage {
  boot: string;
  ver: number;
  cap: number;
  saved: number;
  start: number;
  pulses: number;
  restored: boolean;
}

export type ParsedLine =
  | { kind: 'telemetry'; frame: TelemetryFrame }
  | { kind: 'event'; event: FirmwareEventMessage }
  | { kind: 'boot'; boot: BootMessage }
  | { kind: 'invalid'; reason: string };

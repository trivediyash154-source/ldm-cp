import type {
  Bit,
  BootMessage,
  FirmwareEventMessage,
  FirmwareEventName,
  ParsedLine,
  TelemetryFrame,
} from './types';

const EVENT_NAMES: ReadonlySet<string> = new Set<FirmwareEventName>([
  'entry',
  'entry_closed',
  'entry_denied',
  'exit',
  'exit_closed',
  'exit_denied',
]);

type Json = Record<string, unknown>;

const isBit = (v: unknown): v is Bit => v === 0 || v === 1;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Count implied by the three flip-flop outputs: 4·Q2 + 2·Q1 + Q0. */
export function bitsToCount(q2: Bit, q1: Bit, q0: Bit): number {
  return q2 * 4 + q1 * 2 + q0;
}

function parseTelemetry(obj: Json): ParsedLine {
  const { q2, q1, q0, count } = obj;
  for (const [name, value] of [['q2', q2], ['q1', q1], ['q0', q0]] as const) {
    if (value === undefined) return { kind: 'invalid', reason: `missing "${name}"` };
    if (!isBit(value)) return { kind: 'invalid', reason: `"${name}" is ${JSON.stringify(value)}, expected 0 or 1` };
  }
  if (count === undefined) return { kind: 'invalid', reason: 'missing "count"' };
  if (!isInt(count) || count < 0 || count > 7) {
    return { kind: 'invalid', reason: `"count" is ${JSON.stringify(count)}, expected an integer 0–7` };
  }
  const fromBits = bitsToCount(q2 as Bit, q1 as Bit, q0 as Bit);
  if (fromBits !== count) {
    return { kind: 'invalid', reason: `"count" ${count} disagrees with bits ${q2}${q1}${q0} (= ${fromBits})` };
  }
  const frame: TelemetryFrame = { q2: q2 as Bit, q1: q1 as Bit, q0: q0 as Bit, count };
  return { kind: 'telemetry', frame };
}

function parseEvent(obj: Json): ParsedLine {
  const { evt, before } = obj;
  if (typeof evt !== 'string' || !EVENT_NAMES.has(evt)) {
    return { kind: 'invalid', reason: `unknown event ${JSON.stringify(evt)}` };
  }
  if (!isInt(before) || before < 0 || before > 7) {
    return { kind: 'invalid', reason: `event "before" is ${JSON.stringify(before)}, expected an integer 0–7` };
  }
  const event: FirmwareEventMessage = { evt: evt as FirmwareEventName, before };
  return { kind: 'event', event };
}

function parseBoot(obj: Json): ParsedLine {
  const { boot, ver, cap, saved, start, pulses, restored } = obj;
  if (typeof boot !== 'string') return { kind: 'invalid', reason: 'boot line without firmware name' };
  if (![ver, cap, saved, start, pulses].every(isInt) || typeof restored !== 'boolean') {
    return { kind: 'invalid', reason: 'boot line has missing or malformed fields' };
  }
  const message: BootMessage = {
    boot,
    ver: ver as number,
    cap: cap as number,
    saved: saved as number,
    start: start as number,
    pulses: pulses as number,
    restored,
  };
  return { kind: 'boot', boot: message };
}

/**
 * Parses one line from the firmware. Never throws: anything that is not a
 * well-formed message comes back as `invalid` with a human-readable reason.
 */
export function parseLine(line: string): ParsedLine {
  const text = line.trim();
  if (!text.startsWith('{')) {
    return { kind: 'invalid', reason: 'not a JSON object (is the parking sketch uploaded?)' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'malformed or truncated JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'invalid', reason: 'not a JSON object' };
  }
  const obj = value as Json;
  if ('evt' in obj) return parseEvent(obj);
  if ('boot' in obj) return parseBoot(obj);
  if ('q0' in obj || 'q1' in obj || 'q2' in obj || 'count' in obj) return parseTelemetry(obj);
  return { kind: 'invalid', reason: 'JSON object without telemetry or event fields' };
}

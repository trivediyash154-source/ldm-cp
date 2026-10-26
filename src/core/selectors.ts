import type { EngineState, Reading } from './types';
import { TIMING } from '../config';

/** Quality of the incoming data stream, independent of the counter's value. */
export type TelemetryQuality = 'unsupported' | 'offline' | 'connecting' | 'waiting' | 'live' | 'stale' | 'invalid';

/** Whether the counter value itself makes sense. */
export type CounterHealth = 'unknown' | 'ok' | 'out-of-range' | 'discrepancy' | 'unstable';

/** How current the displayed occupancy is. */
export type Freshness = 'live' | 'stale' | 'waiting' | 'offline' | 'none';

export function selectTelemetryQuality(s: EngineState): TelemetryQuality {
  if (s.link.status === 'unsupported') return 'unsupported';
  if (s.link.status === 'connecting') return 'connecting';
  if (s.link.status !== 'connected') return 'offline';
  if (s.invalidStreak >= TIMING.invalidStreak) return 'invalid';
  if (s.session.frames === 0) return 'waiting';
  if (s.stale) return 'stale';
  return 'live';
}

export function selectCounterHealth(s: EngineState): CounterHealth {
  if (!s.accepted) return 'unknown';
  if (s.accepted.raw > s.capacity) return 'out-of-range';
  if (s.discrepancy) return 'discrepancy';
  if (s.unstable) return 'unstable';
  return 'ok';
}

export interface OccupancyView {
  /** The accepted counter reading (possibly from an earlier session). */
  reading: Reading | null;
  /** Validated occupancy: the raw value when it is within 0..capacity, else null. */
  occupancy: number | null;
  available: number | null;
  utilization: number | null;
  capacity: number;
  validity: 'valid' | 'out-of-range' | 'none';
  freshness: Freshness;
}

export function selectOccupancy(s: EngineState): OccupancyView {
  const reading = s.accepted;
  const connected = s.link.status === 'connected';
  const current = reading !== null && s.acceptedSession === s.session.id;
  let freshness: Freshness;
  if (!reading) freshness = connected ? 'waiting' : 'none';
  else if (!connected) freshness = 'offline';
  else if (!current) freshness = 'waiting';
  else if (s.stale) freshness = 'stale';
  else freshness = 'live';

  const valid = reading !== null && reading.raw <= s.capacity;
  const occupancy = valid ? reading!.raw : null;
  return {
    reading,
    occupancy,
    available: occupancy === null ? null : s.capacity - occupancy,
    utilization: occupancy === null ? null : occupancy / s.capacity,
    capacity: s.capacity,
    validity: reading === null ? 'none' : valid ? 'valid' : 'out-of-range',
    freshness,
  };
}

/**
 * What the firmware will do at the next sensor trigger, applying its own rule
 * (entry needs count < 5, exit needs count > 0) to the latest accepted value.
 * This is a prediction, not a measurement.
 */
export function selectAdmission(s: EngineState): { entry: boolean | null; exit: boolean | null } {
  const view = selectOccupancy(s);
  if (!view.reading || view.freshness !== 'live') return { entry: null, exit: null };
  return { entry: view.reading.raw < s.capacity, exit: view.reading.raw > 0 };
}

export const protocolLabel: Record<EngineState['protocol'], string> = {
  unknown: 'Not identified yet',
  v1: 'v1 · telemetry only',
  v2: 'v2 · telemetry + gate events',
};

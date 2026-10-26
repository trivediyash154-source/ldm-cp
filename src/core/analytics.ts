import type { OccupancySample, ParkingEvent } from './types';

export interface AnalyticsSummary {
  /** First and last timestamps covered by records (null when there are none). */
  period: { from: number; to: number } | null;
  /** Time during which a valid occupancy was being received. */
  observedMs: number;
  entries: { total: number; confirmed: number; inferred: number; unconfirmed: number };
  exits: { total: number; confirmed: number; inferred: number; unconfirmed: number };
  denied: { entry: number; exit: number };
  peak: { occupancy: number; at: number } | null;
  /** Time-weighted average occupancy / capacity over observed time. */
  averageUtilization: number | null;
  /** Share of observed time with every bay taken. */
  fullShare: number | null;
  discrepancies: number;
  /** Entries per hour of day (0–23), confirmed + inferred only. */
  entriesByHour: number[];
}

function tally(events: readonly ParkingEvent[], kind: 'entry' | 'exit') {
  const of = events.filter((e) => e.kind === kind);
  return {
    total: of.length,
    confirmed: of.filter((e) => e.basis === 'confirmed').length,
    inferred: of.filter((e) => e.basis === 'inferred').length,
    unconfirmed: of.filter((e) => e.basis === 'unconfirmed').length,
  };
}

/**
 * Summarises recorded history. Occupancy is held constant between samples;
 * a sample with occupancy null ends an observed interval (disconnect or an
 * invalid reading), and the last sample is extended to `now` only while the
 * link is live.
 */
export function summarize(
  events: readonly ParkingEvent[],
  samples: readonly OccupancySample[],
  capacity: number,
  now: number,
  liveNow: boolean,
): AnalyticsSummary {
  let observedMs = 0;
  let weighted = 0;
  let fullMs = 0;
  let peak: AnalyticsSummary['peak'] = null;

  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    if (s.occupancy === null) continue;
    if (!peak || s.occupancy > peak.occupancy) peak = { occupancy: s.occupancy, at: s.at };
    const end = i + 1 < samples.length ? samples[i + 1].at : liveNow ? now : s.at;
    const span = Math.max(0, end - s.at);
    observedMs += span;
    weighted += span * s.occupancy;
    if (s.occupancy >= capacity) fullMs += span;
  }

  const entriesByHour = Array.from({ length: 24 }, () => 0);
  for (const e of events) {
    if (e.kind === 'entry' && (e.basis === 'confirmed' || e.basis === 'inferred')) {
      entriesByHour[new Date(e.at).getHours()] += 1;
    }
  }

  const stamps = [...events.map((e) => e.at), ...samples.map((s) => s.at)];
  return {
    period: stamps.length ? { from: Math.min(...stamps), to: Math.max(...stamps) } : null,
    observedMs,
    entries: tally(events, 'entry'),
    exits: tally(events, 'exit'),
    denied: {
      entry: events.filter((e) => e.kind === 'entry-denied').length,
      exit: events.filter((e) => e.kind === 'exit-denied').length,
    },
    peak,
    averageUtilization: observedMs > 0 ? weighted / observedMs / capacity : null,
    fullShare: observedMs > 0 ? fullMs / observedMs : null,
    discrepancies: events.filter((e) => e.basis === 'unconfirmed' || (e.kind === 'counter' && e.severity === 'error')).length,
    entriesByHour,
  };
}

import { HISTORY_LIMITS } from '../config';
import type { OccupancySample, ParkingEvent } from './types';

/**
 * Live history is kept in this browser's localStorage so analytics survive a
 * reload. Simulation history is never stored. Storage can be unavailable
 * (private windows, blocked site data); every access is guarded and the app
 * works without it.
 */

export const HISTORY_KEY = 'ldm-parking.live-history.v1';

export interface StoredHistory {
  version: 1;
  events: ParkingEvent[];
  samples: OccupancySample[];
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const isEvent = (e: unknown): e is ParkingEvent =>
  !!e && typeof e === 'object' && typeof (e as ParkingEvent).id === 'string' && typeof (e as ParkingEvent).at === 'number' && (e as ParkingEvent).source === 'live';

const isSample = (s: unknown): s is OccupancySample =>
  !!s && typeof s === 'object' && typeof (s as OccupancySample).at === 'number';

export function loadHistory(storage: StorageLike | null = defaultStorage()): StoredHistory {
  const empty: StoredHistory = { version: 1, events: [], samples: [] };
  if (!storage) return empty;
  try {
    const text = storage.getItem(HISTORY_KEY);
    if (!text) return empty;
    const data = JSON.parse(text) as Partial<StoredHistory>;
    if (data.version !== 1 || !Array.isArray(data.events) || !Array.isArray(data.samples)) return empty;
    return {
      version: 1,
      events: data.events.filter(isEvent).slice(-HISTORY_LIMITS.events),
      samples: data.samples.filter(isSample).slice(-HISTORY_LIMITS.samples),
    };
  } catch {
    return empty;
  }
}

export function saveHistory(
  events: readonly ParkingEvent[],
  samples: readonly OccupancySample[],
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  const live = events.filter((e) => e.source === 'live');
  const data: StoredHistory = { version: 1, events: live, samples: [...samples] };
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredHistory(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

export function eventsToCsv(events: readonly ParkingEvent[]): string {
  const header = ['time_iso', 'kind', 'basis', 'severity', 'before', 'after', 'title', 'detail'];
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = events.map((e) =>
    [
      new Date(e.at).toISOString(),
      e.kind,
      e.basis,
      e.severity,
      e.before ?? '',
      e.after ?? '',
      quote(e.title),
      quote(e.detail ?? ''),
    ].join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

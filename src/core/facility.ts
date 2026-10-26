import type { ParkingEvent } from './types';

/**
 * Virtual bay allocation for the 3D facility.
 *
 * The hardware counts vehicles; it does not know which bay a vehicle uses or
 * which vehicle leaves. The facility therefore uses anonymous virtual
 * vehicles and a fixed rule:
 *   - an arriving vehicle takes the lowest-numbered free bay;
 *   - a departing vehicle is the one that has been parked longest.
 * The number of occupied bays always equals the validated occupancy. When the
 * occupancy is unknown or invalid, the last layout is kept and the UI marks it
 * as not current.
 */

export interface Occupant {
  vehicleId: string;
  palette: number;
  parkedAt: number;
}

export interface Journey {
  id: string;
  vehicleId: string;
  palette: number;
  kind: 'arrive' | 'depart';
  bay: number;
  startedAt: number;
}

export interface FacilityState {
  bays: (Occupant | null)[];
  journeys: Journey[];
  /** Id of the last event already applied. */
  lastEventId: string | null;
  /** False until the first step; history present at that point is not replayed. */
  initialized: boolean;
  vehicleSeq: number;
}

export const JOURNEY_MS = { arrive: 7000, depart: 7500 } as const;
export const PALETTE_SIZE = 6;

export function createFacility(capacity: number): FacilityState {
  return { bays: Array.from({ length: capacity }, () => null), journeys: [], lastEventId: null, initialized: false, vehicleSeq: 0 };
}

const occupiedCount = (bays: (Occupant | null)[]) => bays.filter(Boolean).length;

function newVehicle(f: FacilityState, at: number): Occupant {
  f.vehicleSeq += 1;
  return { vehicleId: `v${f.vehicleSeq}`, palette: (f.vehicleSeq * 7 + 3) % PALETTE_SIZE, parkedAt: at };
}

function longestParked(bays: (Occupant | null)[]): number {
  let index = -1;
  for (let i = 0; i < bays.length; i += 1) {
    const o = bays[i];
    if (o && (index === -1 || o.parkedAt < bays[index]!.parkedAt)) index = i;
  }
  return index;
}

/**
 * Applies new events (in order) and then reconciles the bays with the
 * validated occupancy.
 *
 * @param events     all events of the source; only those after lastEventId are applied
 * @param occupancy  validated occupancy, or null when unknown/invalid
 * @param animate    false (e.g. reduced motion) skips journeys
 */
export function stepFacility(
  prev: FacilityState,
  events: readonly ParkingEvent[],
  occupancy: number | null,
  now: number,
  animate = true,
): FacilityState {
  const f: FacilityState = { ...prev, bays: [...prev.bays], journeys: prev.journeys.filter((j) => now - j.startedAt < JOURNEY_MS[j.kind]) };

  let start = 0;
  if (!prev.initialized) {
    // History recorded before the facility was shown is not replayed.
    start = events.length;
  } else if (prev.lastEventId !== null) {
    const idx = events.findIndex((e) => e.id === prev.lastEventId);
    // Not found: history was cleared or trimmed; nothing to replay.
    start = idx === -1 ? events.length : idx + 1;
  }
  for (let i = start; i < events.length; i += 1) {
    const e = events[i];
    if (!e.movement) continue;
    if (e.movement === 'arrive') {
      const bay = f.bays.findIndex((b) => b === null);
      if (bay === -1) continue;
      const vehicle = newVehicle(f, e.at);
      f.bays[bay] = vehicle;
      if (animate) f.journeys.push({ id: `j-${e.id}`, vehicleId: vehicle.vehicleId, palette: vehicle.palette, kind: 'arrive', bay, startedAt: now });
    } else {
      const bay = longestParked(f.bays);
      if (bay === -1) continue;
      const vehicle = f.bays[bay]!;
      f.bays[bay] = null;
      // A vehicle still arriving cannot also be shown departing.
      f.journeys = f.journeys.filter((j) => j.vehicleId !== vehicle.vehicleId);
      if (animate) f.journeys.push({ id: `j-${e.id}`, vehicleId: vehicle.vehicleId, palette: vehicle.palette, kind: 'depart', bay, startedAt: now });
    }
  }
  f.lastEventId = events.length > 0 ? events[events.length - 1].id : null;
  f.initialized = true;

  if (occupancy !== null) {
    const target = Math.max(0, Math.min(occupancy, f.bays.length));
    while (occupiedCount(f.bays) < target) {
      const bay = f.bays.findIndex((b) => b === null);
      f.bays[bay] = newVehicle(f, now);
    }
    while (occupiedCount(f.bays) > target) {
      // Remove the newest vehicle without a journey: the hardware changed
      // without an identified departure.
      let bay = -1;
      for (let i = 0; i < f.bays.length; i += 1) {
        const o = f.bays[i];
        if (o && (bay === -1 || o.parkedAt >= f.bays[bay]!.parkedAt)) bay = i;
      }
      const vehicle = f.bays[bay]!;
      f.bays[bay] = null;
      f.journeys = f.journeys.filter((j) => j.vehicleId !== vehicle.vehicleId);
    }
  }
  return f;
}

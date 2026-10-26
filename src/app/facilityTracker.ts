import { createFacility, stepFacility, type FacilityState } from '../core/facility';
import { selectOccupancy } from '../core/selectors';
import type { EngineStore } from '../core/store';

export interface FacilityTracker {
  getState(): FacilityState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function same(a: FacilityState, b: FacilityState): boolean {
  return (
    a.lastEventId === b.lastEventId &&
    a.bays.length === b.bays.length &&
    a.bays.every((o, i) => o?.vehicleId === b.bays[i]?.vehicleId) &&
    a.journeys.length === b.journeys.length &&
    a.journeys.every((j, i) => j.id === b.journeys[i].id)
  );
}

/**
 * Keeps one source's virtual bay layout in step with its engine store, so the
 * overview preview and the full facility view show the same allocation.
 */
export function createFacilityTracker(store: EngineStore): FacilityTracker {
  let state = createFacility(store.getState().capacity);
  const listeners = new Set<() => void>();
  const update = () => {
    const s = store.getState();
    const next = stepFacility(state, s.events, selectOccupancy(s).occupancy, Date.now(), !prefersReducedMotion());
    if (same(state, next)) {
      state = { ...next, journeys: state.journeys, bays: state.bays };
      return;
    }
    state = next;
    for (const l of listeners) l();
  };
  const unsubscribe = store.subscribe(update);
  const timer = setInterval(update, 1000);
  update();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      clearInterval(timer);
    },
  };
}

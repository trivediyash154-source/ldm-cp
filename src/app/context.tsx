import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { EngineStore } from '../core/store';
import type { EngineState, Source } from '../core/types';
import type { Services } from './services';
import type { FacilityTracker } from './facilityTracker';

interface AppContextValue {
  services: Services;
  mode: Source;
  setMode(mode: Source): void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ services, children }: { services: Services; children: ReactNode }) {
  // Always starts in live mode; simulation is never restored or switched on automatically.
  const [mode, setMode] = useState<Source>('live');
  return <AppContext.Provider value={{ services, mode, setMode }}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside AppProvider');
  return value;
}

/** The store and facility of the source being viewed. */
export function useActive(): { mode: Source; store: EngineStore; facility: FacilityTracker } {
  const { services, mode } = useApp();
  const pipe = mode === 'live' ? services.live : services.sim;
  return { mode, store: pipe.store, facility: pipe.facility };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Subscribes to a store through a selector. Results are cached per state and
 * compared shallowly, so components re-render only when what they read changes.
 */
export function useStoreSelector<T>(store: EngineStore, selector: (s: EngineState) => T): T {
  const cache = useRef<{ store: EngineStore; state: EngineState; value: T } | null>(null);
  const getSnapshot = () => {
    const state = store.getState();
    const c = cache.current;
    if (c && c.store === store && c.state === state) return c.value;
    const value = selector(state);
    if (c && c.store === store && shallowEqual(c.value, value)) {
      cache.current = { store, state, value: c.value };
      return c.value;
    }
    cache.current = { store, state, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Selector over the active source's store. */
export function useEngine<T>(selector: (s: EngineState) => T): T {
  const { store } = useActive();
  return useStoreSelector(store, selector);
}

export function useFacility(tracker: FacilityTracker) {
  return useSyncExternalStore(tracker.subscribe, tracker.getState, tracker.getState);
}

/** Current time, refreshed every `intervalMs`, for "x seconds ago" labels. */
export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

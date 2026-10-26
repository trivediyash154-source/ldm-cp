import { saveHistory } from '../core/persistence';
import type { EngineStore } from '../core/store';

/** Saves the live store's events and samples to localStorage, at most once per second. */
export function persistLiveHistory(store: EngineStore, delayMs = 1000): () => void {
  let events = store.getState().events;
  let samples = store.getState().samples;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const s = store.getState();
    saveHistory(s.events, s.samples);
  };
  const unsubscribe = store.subscribe(() => {
    const s = store.getState();
    if (s.events === events && s.samples === samples) return;
    events = s.events;
    samples = s.samples;
    timer ??= setTimeout(flush, delayMs);
  });
  const onUnload = () => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onUnload);
  return () => {
    unsubscribe();
    onUnload();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onUnload);
  };
}

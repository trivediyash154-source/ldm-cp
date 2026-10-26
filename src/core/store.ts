import { createEngineState, engineReducer, type EngineOptions } from './engine';
import type { EngineAction, EngineState } from './types';

export interface EngineStore {
  getState(): EngineState;
  dispatch(action: EngineAction): void;
  subscribe(listener: () => void): () => void;
}

/** A minimal observable container around the engine reducer. */
export function createEngineStore(options: EngineOptions): EngineStore {
  let state = createEngineState(options);
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = engineReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

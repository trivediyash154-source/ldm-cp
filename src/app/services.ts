import { loadHistory } from '../core/persistence';
import { createEngineStore, type EngineStore } from '../core/store';
import { persistLiveHistory } from '../serial/persistLive';
import { SerialSession } from '../serial/session';
import { WebSerialTransport } from '../serial/webSerialTransport';
import { SimulationSession } from '../simulation/simulationSession';
import { createFacilityTracker, type FacilityTracker } from './facilityTracker';

export interface Services {
  live: { store: EngineStore; session: SerialSession; facility: FacilityTracker };
  sim: { store: EngineStore; session: SimulationSession; facility: FacilityTracker };
  dispose(): void;
}

/**
 * Two completely separate pipelines. The live one reads the Arduino over Web
 * Serial and persists its history; the simulation one has its own store and
 * is never persisted. Nothing connects them.
 */
export function createServices(): Services {
  const liveStore = createEngineStore({ source: 'live', history: loadHistory() });
  const liveSession = new SerialSession(liveStore, (callbacks) => new WebSerialTransport(callbacks));
  const stopPersisting = persistLiveHistory(liveStore);

  const simStore = createEngineStore({ source: 'simulation' });
  const simSession = new SimulationSession(simStore);

  const live = { store: liveStore, session: liveSession, facility: createFacilityTracker(liveStore) };
  const sim = { store: simStore, session: simSession, facility: createFacilityTracker(simStore) };
  return {
    live,
    sim,
    dispose() {
      stopPersisting();
      live.facility.dispose();
      sim.facility.dispose();
      liveSession.dispose();
      simSession.dispose();
    },
  };
}

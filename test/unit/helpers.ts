import { createEngineState, engineReducer } from '../../src/core/engine';
import type { EngineAction, EngineState, Source } from '../../src/core/types';

/** Telemetry line exactly as the firmware prints it. */
export function telemetry(raw: number): string {
  const q2 = (raw >> 2) & 1;
  const q1 = (raw >> 1) & 1;
  const q0 = raw & 1;
  return `{"q2":${q2},"q1":${q1},"q0":${q0},"count":${raw}}`;
}

export const PERIOD = 100; // ms between telemetry lines (measured on the emulated Uno)
export const GATE_PAUSE = 1765 + 100; // gate sequence + one normal period

/** Drives the reducer with a clock, like the serial session does. */
export class Bench {
  state: EngineState;
  now = 1_000_000;

  constructor(source: Source = 'live') {
    this.state = createEngineState({ source });
  }

  dispatch(action: EngineAction): this {
    this.state = engineReducer(this.state, action);
    return this;
  }

  connect(): this {
    return this.dispatch({ type: 'link', status: 'connected', at: this.now, portLabel: 'Test port' });
  }

  disconnect(reason: 'user' | 'lost' = 'user'): this {
    return this.dispatch({ type: 'link', status: 'disconnected', at: this.now, reason });
  }

  line(text: string, afterMs = PERIOD): this {
    this.now += afterMs;
    this.dispatch({ type: 'line', text, at: this.now });
    return this.dispatch({ type: 'tick', at: this.now });
  }

  frames(raw: number, count: number, period = PERIOD): this {
    for (let i = 0; i < count; i += 1) this.line(telemetry(raw), period);
    return this;
  }

  wait(ms: number): this {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = Math.min(end, this.now + 250);
      this.dispatch({ type: 'tick', at: this.now });
    }
    return this;
  }

  /** v1 gate sequence: telemetry pauses, the next frame still shows the old value, then the new one. */
  v1GateSequence(before: number, after: number): this {
    this.line(telemetry(before), GATE_PAUSE);
    return this.frames(after, 3);
  }

  /** v2 gate sequence for an entry or exit. */
  v2GateSequence(kind: 'entry' | 'exit', before: number, after: number): this {
    this.line(`{"evt":"${kind}","before":${before}}`, 20);
    this.line(`{"evt":"${kind}_closed","before":${before}}`, 1515);
    this.line(telemetry(before), 250);
    return this.frames(after, 3);
  }

  get events() {
    return this.state.events;
  }

  vehicleEvents() {
    return this.state.events.filter((e) => e.kind === 'entry' || e.kind === 'exit');
  }
}

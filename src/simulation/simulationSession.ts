import { TIMING } from '../config';
import type { EngineStore } from '../core/store';
import { SimulatedFirmware } from './simulatedFirmware';

export interface SimulationControls {
  running: boolean;
  autoTraffic: boolean;
  decrementWired: boolean;
}

/**
 * Drives the simulation store from a SimulatedFirmware. It has its own store,
 * its own clock loop and never touches the live store or the serial port.
 * Lines go through the same engine as live data, so validation, events and
 * diagnostics behave identically, but every event is tagged `simulation`.
 */
export class SimulationSession {
  private firmware: SimulatedFirmware | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private trafficAt = 0;
  private readonly listeners = new Set<() => void>();
  private controls: SimulationControls = { running: false, autoTraffic: false, decrementWired: true };

  constructor(
    readonly store: EngineStore,
    private readonly clock: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  getControls(): SimulationControls {
    return this.controls;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<SimulationControls>): void {
    this.controls = { ...this.controls, ...patch };
    for (const l of this.listeners) l();
  }

  start(initialCount = 2, intervalMs = 50): void {
    if (this.controls.running) return;
    const now = this.clock();
    this.firmware = new SimulatedFirmware(now, initialCount);
    this.firmware.faults.decrementWired = this.controls.decrementWired;
    this.store.dispatch({ type: 'link', status: 'connected', at: now, portLabel: 'Simulated Arduino Uno' });
    this.update({ running: true });
    if (intervalMs > 0) this.timer = setInterval(() => this.step(), intervalMs);
  }

  /** Advances the simulated firmware to the current clock. Called by the timer, or by tests. */
  step(): void {
    const fw = this.firmware;
    if (!fw) return;
    const now = this.clock();
    if (this.controls.autoTraffic && now >= this.trafficAt) {
      this.trafficAt = now + 5000 + this.random() * 9000;
      const arrive = fw.counter === 0 || (fw.counter < 5 && this.random() < 0.6);
      if (arrive) fw.triggerEntry();
      else fw.triggerExit();
    }
    for (const text of fw.advance(now)) this.store.dispatch({ type: 'line', text, at: now });
    this.store.dispatch({ type: 'tick', at: now });
  }

  stop(reason: 'user' | 'lost' = 'user'): void {
    if (!this.controls.running) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.firmware = null;
    this.store.dispatch({ type: 'link', status: 'disconnected', at: this.clock(), reason });
    this.update({ running: false, autoTraffic: false });
  }

  vehicleAtEntry(): void {
    this.firmware?.triggerEntry();
  }

  vehicleAtExit(): void {
    this.firmware?.triggerExit();
  }

  setAutoTraffic(on: boolean): void {
    this.trafficAt = this.clock() + 1500;
    this.update({ autoTraffic: on });
  }

  setDecrementWired(on: boolean): void {
    if (this.firmware) this.firmware.faults.decrementWired = on;
    this.update({ decrementWired: on });
  }

  injectGlitch(): void {
    this.firmware?.glitch(this.clock());
  }

  injectStall(): void {
    this.firmware?.stall(this.clock(), TIMING.staleAfterMs + 3000);
  }

  injectGarbage(): void {
    this.firmware?.garble();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

import { existsSync } from 'node:fs';
import { EEPROMMemoryBackend } from 'avr8js';
import { createEngineState, engineReducer } from '../../src/core/engine';
import type { EngineState } from '../../src/core/types';
import { LineFramer } from '../../src/protocol/framer';
import { Counter74LS74, EmulatedUno, loadHex, type CounterOptions } from './emulatedUno';

export const HEX = {
  v1: 'test/fixtures/firmware/parking_counter_v1.hex',
  v2: 'test/fixtures/firmware/parking_counter_v2.hex',
} as const;

export const firmwareBuilt = existsSync(HEX.v1) && existsSync(HEX.v2);

/** Optiboot waits ~1 s after the reset caused by opening the port before starting the sketch. */
const BOOTLOADER_MS = 1000;

/**
 * Connects an emulated Uno to the website's engine the way the browser does:
 * opening the port resets the board, bytes go through the line framer and are
 * timestamped on arrival, and the engine ticks while time passes.
 */
export class Rig {
  state: EngineState = createEngineState({ source: 'live' });
  uno: EmulatedUno;
  readonly counter: Counter74LS74;
  readonly eeprom = new EEPROMMemoryBackend(1024);
  private readonly program: Uint16Array;
  private framer = new LineFramer();
  private consumed = 0;
  /** Wall-clock (ms) at which the current Uno started running its sketch. */
  private start = 1_800_000_000_000;
  private wall = this.start;

  constructor(firmware: keyof typeof HEX, counter: CounterOptions, initialCount = 0, savedCount = initialCount) {
    this.program = loadHex(HEX[firmware]);
    this.counter = new Counter74LS74(counter, initialCount);
    this.eeprom.memory[0] = savedCount;
    this.uno = new EmulatedUno(this.program, this.counter, this.eeprom);
    this.connect();
  }

  private dispatch(action: Parameters<typeof engineReducer>[1]): void {
    this.state = engineReducer(this.state, action);
  }

  /** Browser opens the port; the Uno resets and runs setup() after the bootloader. */
  private connect(): void {
    this.dispatch({ type: 'link', status: 'connected', at: this.wall, portLabel: 'Emulated Uno' });
    this.wall += BOOTLOADER_MS;
    this.start = this.wall;
  }

  /** Close and reopen the port: the flip-flops keep their state, the Uno restarts. */
  reconnect(offlineMs = 3000): this {
    this.dispatch({ type: 'link', status: 'disconnected', at: this.wall, reason: 'user' });
    this.wall += offlineMs;
    this.uno = new EmulatedUno(this.program, this.counter, this.eeprom);
    this.framer = new LineFramer();
    this.consumed = 0;
    this.connect();
    return this;
  }

  /** Runs the emulated board for `ms`, delivering its serial output to the engine as it appears. */
  run(ms: number): this {
    const end = this.uno.timeMs + ms;
    while (this.uno.timeMs < end) {
      this.uno.run(Math.min(50, end - this.uno.timeMs));
      this.wall = this.start + this.uno.timeMs;
      this.deliver();
      this.dispatch({ type: 'tick', at: this.wall });
    }
    return this;
  }

  private deliver(): void {
    const lines = this.uno.lines;
    for (; this.consumed < lines.length; this.consumed += 1) {
      const line = lines[this.consumed];
      for (const item of this.framer.push(`${line.text}\r\n`)) {
        if (item.kind === 'line') this.dispatch({ type: 'line', text: item.text, at: this.start + line.at });
      }
    }
  }

  vehicle(gate: 'entry' | 'exit'): this {
    const sensor = gate === 'entry' ? (b: boolean) => this.uno.setEntrySensor(b) : (b: boolean) => this.uno.setExitSensor(b);
    sensor(true);
    this.run(300);
    sensor(false);
    return this.run(2700);
  }

  get lines(): string[] {
    return this.uno.lines.map((l) => l.text);
  }

  get vehicleEvents() {
    return this.state.events.filter((e) => e.kind === 'entry' || e.kind === 'exit');
  }
}

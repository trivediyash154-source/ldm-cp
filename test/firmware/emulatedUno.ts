import { readFileSync } from 'node:fs';
import {
  AVREEPROM,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  EEPROMMemoryBackend,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';

const F_CPU = 16_000_000;
const CYCLES_PER_MS = F_CPU / 1000;

export function loadHex(path: string): Uint16Array {
  const flash = new Uint8Array(0x8000);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith(':')) continue;
    const bytes = line.slice(1).trim();
    const count = parseInt(bytes.slice(0, 2), 16);
    const address = parseInt(bytes.slice(2, 6), 16);
    const type = parseInt(bytes.slice(6, 8), 16);
    if (type !== 0) continue;
    for (let i = 0; i < count; i += 1) flash[address + i] = parseInt(bytes.slice(8 + i * 2, 10 + i * 2), 16);
  }
  return new Uint16Array(flash.buffer);
}

/**
 * Behavioural model of the counter on the breadboard: two 74LS74s holding
 * Q0..Q2, next-state logic from the 74LS86/74LS08 as described in the wiring
 * guide. D inputs are sampled just before the rising clock edge, as in the
 * real chips (20 ns setup time vs. ~10-20 ns per gate delay).
 */
export interface CounterOptions {
  /**
   * 74LS08 pin 2 (AND gate 1, input B).
   * - 'clock': tied to D2 as in the wiring guide. Just before the rising edge
   *   it is LOW, so the AND output is 0 and Q1 can never toggle.
   * - 'high': tied to +5V, giving a proper up-counter (D1 = Q1 xor Q0).
   */
  andGateB: 'clock' | 'high';
  /** D3 drives nothing in the wiring guide; 'decrements' models a working down path. */
  d3: 'unconnected' | 'decrements';
  /** Q outputs not reaching the Arduino (or no common ground): all inputs read HIGH. */
  floating?: boolean;
}

export class Counter74LS74 {
  bits = { q0: 0, q1: 0, q2: 0 };
  readonly history: number[] = [];

  constructor(
    public options: CounterOptions,
    initial = 0,
  ) {
    this.set(initial);
  }

  get value(): number {
    return this.bits.q2 * 4 + this.bits.q1 * 2 + this.bits.q0;
  }

  set(value: number): void {
    this.bits = { q0: value & 1, q1: (value >> 1) & 1, q2: (value >> 2) & 1 };
  }

  clockUp(): void {
    const { q0, q1, q2 } = this.bits;
    const and1 = this.options.andGateB === 'clock' ? 0 : q0;
    this.bits = { q0: q0 ^ 1, q1: q1 ^ and1, q2: q2 ^ (q0 & q1) };
    this.history.push(this.value);
  }

  clockDown(): void {
    if (this.options.d3 !== 'decrements') return;
    this.set((this.value + 7) % 8);
    this.history.push(this.value);
  }
}

export interface SerialLine {
  /** Milliseconds of emulated time since this Uno started. */
  at: number;
  text: string;
}

/**
 * An ATmega328P at 16 MHz running a compiled sketch, wired like the parking
 * prototype: D2/D3 clock outputs to the counter, counter Q outputs to
 * D7/D8/D9, IR sensors (active LOW) on D5/D6.
 */
export class EmulatedUno {
  readonly cpu: CPU;
  private readonly portB: AVRIOPort;
  private readonly portD: AVRIOPort;
  readonly lines: SerialLine[] = [];
  private partial = '';
  private lastPortD = 0;

  constructor(
    program: Uint16Array,
    readonly counter: Counter74LS74,
    readonly eeprom = new EEPROMMemoryBackend(1024),
  ) {
    this.cpu = new CPU(program);
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    new AVREEPROM(this.cpu, this.eeprom);
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);
    const usart = new AVRUSART(this.cpu, usart0Config, F_CPU);
    usart.onByteTransmit = (byte) => {
      const ch = String.fromCharCode(byte);
      if (ch === '\n') {
        this.lines.push({ at: this.timeMs, text: this.partial.replace(/\r$/, '') });
        this.partial = '';
      } else {
        this.partial += ch;
      }
    };
    this.portD.addListener((value) => {
      const rising = value & ~this.lastPortD;
      this.lastPortD = value;
      if (rising & (1 << 2)) this.counter.clockUp();
      if (rising & (1 << 3)) this.counter.clockDown();
      this.driveCounterOutputs();
    });
    this.setEntrySensor(false);
    this.setExitSensor(false);
    this.driveCounterOutputs();
  }

  get timeMs(): number {
    return this.cpu.cycles / CYCLES_PER_MS;
  }

  private driveCounterOutputs(): void {
    const floating = this.counter.options.floating === true;
    const { q0, q1, q2 } = this.counter.bits;
    this.portD.setPin(7, floating || q0 === 1);
    this.portB.setPin(0, floating || q1 === 1);
    this.portB.setPin(1, floating || q2 === 1);
  }

  /** IR sensor modules pull their output LOW while an object is in front of them. */
  setEntrySensor(blocked: boolean): void {
    this.portD.setPin(5, !blocked);
  }

  setExitSensor(blocked: boolean): void {
    this.portD.setPin(6, !blocked);
  }

  run(ms: number): void {
    const target = this.cpu.cycles + ms * CYCLES_PER_MS;
    while (this.cpu.cycles < target) {
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
    this.driveCounterOutputs();
  }

  /** A vehicle passes the sensor: blocked long enough for one loop pass to see it. */
  vehicleAt(gate: 'entry' | 'exit', holdMs = 300): void {
    const set = gate === 'entry' ? (b: boolean) => this.setEntrySensor(b) : (b: boolean) => this.setExitSensor(b);
    set(true);
    this.run(holdMs);
    set(false);
  }
}

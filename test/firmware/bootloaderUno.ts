import { readFileSync } from 'node:fs';
import { AVRIOPort, AVRTimer, AVRUSART, CPU, avrInstruction, portBConfig, timer1Config, usart0Config } from 'avr8js';
import { parseIntelHex } from '../../src/firmware/intelHex';
import type { ByteLink } from '../../src/firmware/stk500';

const F_CPU = 16_000_000;
const CYCLES_PER_MS = F_CPU / 1000;
const SPMCSR = 0x57;
const MCUSR = 0x54;
const UCSR0A = 0xc0;
const PAGE_WORDS = 64; // 128-byte pages

/**
 * An ATmega328P that has just been reset into the Arduino Uno bootloader
 * (Optiboot, test/fixtures/optiboot_atmega328.hex from the Arduino AVR core).
 * avr8js does not implement SPM, so it is emulated here: page buffer fill,
 * page erase (sets 0xFF), and page write (can only clear bits, like real flash).
 */
export class BootloaderUno {
  readonly cpu: CPU;
  readonly usart: AVRUSART;
  readonly tx: number[] = [];
  private readonly rx: number[] = [];
  private readonly pageBuffer = new Uint16Array(PAGE_WORDS).fill(0xffff);

  constructor(app?: Uint8Array) {
    const flash = new Uint8Array(0x8000).fill(0xff);
    if (app) flash.set(app);
    const boot = parseIntelHex(readFileSync('test/fixtures/optiboot_atmega328.hex', 'utf8')).data;
    // The file also has a stray record past the end of flash (0x8010); clip it.
    flash.set(boot.subarray(0x7e00, 0x8000), 0x7e00);
    this.cpu = new CPU(new Uint16Array(flash.buffer));
    new AVRTimer(this.cpu, timer1Config);
    new AVRIOPort(this.cpu, portBConfig);
    this.usart = new AVRUSART(this.cpu, usart0Config, F_CPU);
    this.usart.onByteTransmit = (b) => this.tx.push(b);
    // Fuses BOOTRST + BOOTSZ=256 words: execution starts at the bootloader.
    this.cpu.pc = 0x7e00 >> 1;
    // An external reset (DTR pulse); otherwise Optiboot jumps straight to the app.
    this.cpu.data[MCUSR] = 0x02;
  }

  get timeMs(): number {
    return this.cpu.cycles / CYCLES_PER_MS;
  }

  /** Flash contents as bytes. */
  get flash(): Uint8Array {
    return this.cpu.progBytes;
  }

  send(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i += 1) this.rx.push(bytes[i]);
  }

  private spm(): void {
    const { cpu } = this;
    const mode = cpu.data[SPMCSR] & 0x1f;
    const z = cpu.data[30] | (cpu.data[31] << 8);
    const pageBase = (z >> 1) & ~(PAGE_WORDS - 1);
    if (mode === 0x01) {
      this.pageBuffer[(z >> 1) & (PAGE_WORDS - 1)] = cpu.data[0] | (cpu.data[1] << 8);
    } else if (mode === 0x03) {
      cpu.progMem.fill(0xffff, pageBase, pageBase + PAGE_WORDS);
    } else if (mode === 0x05) {
      for (let i = 0; i < PAGE_WORDS; i += 1) cpu.progMem[pageBase + i] &= this.pageBuffer[i];
      this.pageBuffer.fill(0xffff);
    }
    // 0x11 (RWW section read enable) needs no action here.
    cpu.data[SPMCSR] &= ~0x01;
    cpu.pc += 1;
    cpu.cycles += 2;
  }

  run(ms: number): void {
    const { cpu } = this;
    const target = cpu.cycles + ms * CYCLES_PER_MS;
    while (cpu.cycles < target) {
      if (this.rx.length > 0 && !this.usart.rxBusy && !(cpu.data[UCSR0A] & 0x80)) {
        if (this.usart.writeByte(this.rx[0])) this.rx.shift();
      }
      if (cpu.progMem[cpu.pc] === 0x95e8) {
        this.spm();
      } else {
        avrInstruction(cpu);
      }
      cpu.tick();
    }
  }
}

/** ByteLink over the emulated board, advancing emulated time while waiting. */
export class EmulatorLink implements ByteLink {
  constructor(private readonly uno: BootloaderUno) {}

  async write(bytes: Uint8Array): Promise<void> {
    this.uno.send(bytes);
  }

  async read(count: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = this.uno.timeMs + timeoutMs;
    while (this.uno.tx.length < count && this.uno.timeMs < deadline) this.uno.run(0.5);
    if (this.uno.tx.length < count) throw new Error('timeout');
    return Uint8Array.from(this.uno.tx.splice(0, count));
  }

  discardInput(): void {
    this.uno.tx.length = 0;
  }

  async delay(ms: number): Promise<void> {
    this.uno.run(ms);
  }
}

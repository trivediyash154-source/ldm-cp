import { CAPACITY } from '../config';

/**
 * A behavioural model of firmware/parking_counter_v2 plus an ideal counter,
 * used only by simulation mode. It produces the same serial lines with the
 * same timing as the real sketch (delay(100) loop, ~36 ms per printed line,
 * 15 ms clock pulse + 1500 ms gate hold + 250 ms debounce per gate sequence).
 */

export interface SimulatedFaults {
  /** When false, exit pulses on D3 do not change the counter (as in the wiring guide). */
  decrementWired: boolean;
}

interface ScheduledLine {
  at: number;
  text: string;
}

const PRINT_MS = 36;
const LOOP_DELAY_MS = 100;
const BOOT_MS = 1800;

export class SimulatedFirmware {
  /** State of the emulated 74LS74 flip-flops (0–7). */
  counter: number;
  faults: SimulatedFaults = { decrementWired: true };
  private nextLoopAt: number;
  private outbox: ScheduledLine[] = [];
  private entryPending = false;
  private exitPending = false;
  private glitchUntil = 0;
  private stallUntil = 0;
  private garbleNext = false;

  constructor(now: number, initialCount = 0) {
    this.counter = initialCount;
    // Opening the port resets the Uno: bootloader, then setup() prints the boot line.
    this.nextLoopAt = now + BOOT_MS;
    this.outbox.push({
      at: now + BOOT_MS - 5,
      text: `{"boot":"ldm-parking","ver":2,"cap":${CAPACITY},"saved":${initialCount},"start":${initialCount},"pulses":0,"restored":true}`,
    });
  }

  triggerEntry(): void {
    this.entryPending = true;
  }

  triggerExit(): void {
    this.exitPending = true;
  }

  /** Q outputs read as all-high for a while, like a floating or ungrounded connection. */
  glitch(now: number, ms = 3000): void {
    this.glitchUntil = now + ms;
  }

  /** The sketch stops printing (e.g. stuck), to demonstrate stale telemetry. */
  stall(now: number, ms = 6000): void {
    this.stallUntil = now + ms;
  }

  garble(): void {
    this.garbleNext = true;
  }

  private read(now: number): number {
    return now < this.glitchUntil ? 7 : this.counter;
  }

  /** Runs loop() passes up to `now` and returns the lines printed by then. */
  advance(now: number): string[] {
    while (this.nextLoopAt <= now) this.loopPass(this.nextLoopAt);
    const due = this.outbox.filter((l) => l.at <= now).sort((a, b) => a.at - b.at);
    this.outbox = this.outbox.filter((l) => l.at > now);
    return due.map((l) => l.text);
  }

  private loopPass(t: number): void {
    if (t < this.stallUntil) {
      this.nextLoopAt = this.stallUntil;
      return;
    }
    const count = this.read(t);
    let clock = t;
    const event = (name: string) => `{"evt":"${name}","before":${count}}`;

    if (this.entryPending) {
      this.entryPending = false;
      if (count < CAPACITY) {
        this.counter = (this.counter + 1) % 8;
        this.outbox.push({ at: clock + 15 + PRINT_MS, text: event('entry') });
        clock += 15 + PRINT_MS + 1500;
        this.outbox.push({ at: clock + PRINT_MS, text: event('entry_closed') });
        clock += PRINT_MS;
      } else {
        this.outbox.push({ at: clock + PRINT_MS, text: event('entry_denied') });
        clock += PRINT_MS;
      }
      clock += 250;
    }
    if (this.exitPending) {
      this.exitPending = false;
      if (count > 0) {
        if (this.faults.decrementWired) this.counter = (this.counter + 7) % 8;
        this.outbox.push({ at: clock + 15 + PRINT_MS, text: event('exit') });
        clock += 15 + PRINT_MS + 1500;
        this.outbox.push({ at: clock + PRINT_MS, text: event('exit_closed') });
        clock += PRINT_MS;
      } else {
        this.outbox.push({ at: clock + PRINT_MS, text: event('exit_denied') });
        clock += PRINT_MS;
      }
      clock += 250;
    }

    const q2 = (count >> 2) & 1;
    const q1 = (count >> 1) & 1;
    const q0 = count & 1;
    let text = `{"q2":${q2},"q1":${q1},"q0":${q0},"count":${count}}`;
    if (this.garbleNext) {
      this.garbleNext = false;
      text = text.slice(0, 11) + 'ÿ' + text.slice(14);
    }
    clock += PRINT_MS;
    this.outbox.push({ at: clock, text });
    this.nextLoopAt = clock + LOOP_DELAY_MS;
  }
}

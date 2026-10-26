import { describe, expect, it } from 'vitest';
import { parseLine } from '../../src/protocol/parser';
import { selectOccupancy, selectTelemetryQuality } from '../../src/core/selectors';
import { firmwareBuilt, Rig } from './rig';

/**
 * These tests run firmware/parking_counter_v1 — the sketch on the hardware
 * today — compiled for the ATmega328P, in an emulator, and feed its serial
 * output into the website's engine. The 74LS74 counter is a behavioural
 * model, so these prove protocol compatibility and timing, not the
 * physical wiring.
 *
 * v1's setup() pulses the clock `saved` times, which only lands on the saved
 * value when the flip-flops start at 0 (a cold power-up). The rigs below
 * start that way: Rig('v1', wiring, flipFlops = 0, saved = n).
 */
describe.skipIf(!firmwareBuilt)('firmware v1 in the loop', () => {
  it('prints only valid telemetry, about every 100 ms', () => {
    const rig = new Rig('v1', { andGateB: 'high', d3: 'unconnected' }, 0, 2).run(2000);
    expect(rig.lines.length).toBeGreaterThan(15);
    for (const line of rig.lines) expect(parseLine(line).kind).toBe('telemetry');
    const times = rig.uno.lines.map((l) => l.at);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.min(...gaps)).toBeGreaterThan(95);
    expect(Math.max(...gaps)).toBeLessThan(110);
    expect(selectTelemetryQuality(rig.state)).toBe('live');
    expect(selectOccupancy(rig.state).occupancy).toBe(2);
    expect(rig.state.protocol).toBe('v1');
  });

  it('entry with a working up-counter: the website infers the entry', () => {
    const rig = new Rig('v1', { andGateB: 'high', d3: 'unconnected' }, 0, 1).run(1000).vehicle('entry');
    expect(rig.counter.value).toBe(2);
    expect(rig.vehicleEvents).toEqual([expect.objectContaining({ kind: 'entry', basis: 'inferred', before: 1, after: 2 })]);
    expect(selectOccupancy(rig.state).occupancy).toBe(2);
    expect(rig.state.session.gatePauses).toBe(1);
  });

  it('exit with D3 unconnected: the counter cannot decrement and the website flags it', () => {
    const rig = new Rig('v1', { andGateB: 'high', d3: 'unconnected' }, 0, 3).run(1000).vehicle('exit').run(1500);
    expect(rig.counter.value).toBe(3);
    expect(rig.vehicleEvents).toHaveLength(0);
    expect(rig.state.events.some((e) => e.title === 'Gate sequence without a count change')).toBe(true);
    expect(selectOccupancy(rig.state).occupancy).toBe(3);
  });

  it('reopening the port adds the saved count again (v1 restore bug)', () => {
    // Cold power-up: flip-flops at 0, EEPROM holds 3, setup() pulses 3 times.
    const rig = new Rig('v1', { andGateB: 'high', d3: 'unconnected' }, 0, 3).run(1500);
    expect(rig.counter.value).toBe(3);
    expect(selectOccupancy(rig.state).occupancy).toBe(3);
    // The browser reopens the port: the Uno resets, the breadboard keeps 3,
    // and setup() pulses 3 more times.
    rig.reconnect().run(1500);
    expect(rig.counter.value).toBe(6);
    expect(rig.state.events.some((e) => e.title === 'Counter changed between sessions: 3 → 6')).toBe(true);
    expect(selectOccupancy(rig.state).validity).toBe('out-of-range');
    expect(rig.vehicleEvents).toHaveLength(0);
    // loop() then saves 6; on the next reset setup() rejects it (> 5) and
    // writes 0, so the counter stays at 6 and every entry is refused.
    rig.reconnect().run(1500);
    expect(rig.counter.value).toBe(6);
    expect(rig.eeprom.memory[0]).toBe(6);
  });
});

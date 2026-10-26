import { describe, expect, it } from 'vitest';
import { parseLine } from '../../src/protocol/parser';
import { selectCounterHealth, selectOccupancy } from '../../src/core/selectors';
import { firmwareBuilt, Rig } from './rig';

/** firmware/parking_counter_v2 compiled and emulated; see v1.test.ts. */
describe.skipIf(!firmwareBuilt)('firmware v2 in the loop', () => {
  it('announces itself and keeps the count across a port reopen', () => {
    const rig = new Rig('v2', { andGateB: 'high', d3: 'unconnected' }, 3).run(1500);
    expect(rig.lines[0]).toBe('{"boot":"ldm-parking","ver":2,"cap":5,"saved":3,"start":3,"pulses":0,"restored":true}');
    for (const line of rig.lines) expect(parseLine(line).kind).not.toBe('invalid');
    expect(rig.state.protocol).toBe('v2');
    rig.reconnect().run(1500);
    expect(rig.counter.value).toBe(3);
    expect(selectOccupancy(rig.state).occupancy).toBe(3);
    expect(rig.state.events.some((e) => e.title.startsWith('Counter changed between sessions'))).toBe(false);
  });

  it('restores the saved count from a random power-up state', () => {
    const rig = new Rig('v2', { andGateB: 'high', d3: 'unconnected' }, 5, 2).run(1500);
    expect(rig.state.boot).toMatchObject({ saved: 2, start: 5, pulses: 5, restored: true });
    expect(rig.counter.value).toBe(2);
    expect(selectOccupancy(rig.state).occupancy).toBe(2);
  });

  it('confirms an entry against the counter', () => {
    const rig = new Rig('v2', { andGateB: 'high', d3: 'unconnected' }, 1).run(1000).vehicle('entry');
    expect(rig.lines).toContain('{"evt":"entry","before":1}');
    expect(rig.lines).toContain('{"evt":"entry_closed","before":1}');
    expect(rig.vehicleEvents).toEqual([expect.objectContaining({ kind: 'entry', basis: 'confirmed', before: 1, after: 2, movement: 'arrive' })]);
    expect(rig.state.gates.entry).toMatchObject({ state: 'closed', reported: true });
  });

  it('flags an exit the hardware did not count (D3 unconnected)', () => {
    const rig = new Rig('v2', { andGateB: 'high', d3: 'unconnected' }, 3).run(1000).vehicle('exit').run(3000);
    expect(rig.vehicleEvents).toEqual([expect.objectContaining({ kind: 'exit', basis: 'unconfirmed', before: 3, after: 3 })]);
    expect(selectCounterHealth(rig.state)).toBe('discrepancy');
  });

  it('confirms exits once the decrement path works', () => {
    const rig = new Rig('v2', { andGateB: 'high', d3: 'decrements' }, 3).run(1000).vehicle('exit');
    expect(rig.vehicleEvents).toEqual([expect.objectContaining({ kind: 'exit', basis: 'confirmed', before: 3, after: 2, movement: 'depart' })]);
  });
});

import { describe, expect, it } from 'vitest';
import { selectAdmission, selectCounterHealth, selectOccupancy } from '../../src/core/selectors';
import { firmwareBuilt, Rig } from './rig';

/** Wiring faults from the wiring guide, reproduced against the compiled firmware. */
describe.skipIf(!firmwareBuilt)('wiring faults in the loop', () => {
  it('floating Q inputs read 7, so the entry gate never opens', () => {
    // Matches the reported symptom: count stuck at 7 and the in-gate "not working".
    const rig = new Rig('v2', { andGateB: 'high', d3: 'unconnected', floating: true }, 0).run(1000);
    expect(selectOccupancy(rig.state).reading?.raw).toBe(7);
    expect(selectOccupancy(rig.state).occupancy).toBeNull();
    expect(selectCounterHealth(rig.state)).toBe('out-of-range');
    expect(selectAdmission(rig.state).entry).toBe(false);
    rig.vehicle('entry');
    expect(rig.lines).toContain('{"evt":"entry_denied","before":7}');
    expect(rig.state.events.some((e) => e.kind === 'entry-denied')).toBe(true);
    expect(rig.vehicleEvents).toHaveLength(0);
  });

  it('AND gate tied to the clock: Q1 never toggles, and v2 reports the wrong count', () => {
    const rig = new Rig('v2', { andGateB: 'clock', d3: 'unconnected' }, 0).run(1000);
    rig.vehicle('entry').vehicle('entry');
    expect(rig.counter.history).toEqual([1, 0]);
    expect(rig.vehicleEvents.map((e) => [e.basis, e.before, e.after])).toEqual([
      ['confirmed', 0, 1],
      ['unconfirmed', 1, 0],
    ]);
    expect(rig.state.bitToggles[1]).toBe(0);
    expect(rig.state.discrepancy?.message).toMatch(/1 → 0 instead of 1 → 2/);
  });

  it('AND gate tied to the clock under v1: an entry can look like an exit', () => {
    // Firmware v1 does not say which sensor fired, so a counter that steps
    // the wrong way is indistinguishable from an exit. This is why the app
    // labels v1 events "inferred" and recommends v2.
    const rig = new Rig('v1', { andGateB: 'clock', d3: 'unconnected' }, 0).run(1000);
    rig.vehicle('entry').vehicle('entry');
    expect(rig.vehicleEvents.map((e) => [e.kind, e.basis])).toEqual([
      ['entry', 'inferred'],
      ['exit', 'inferred'],
    ]);
  });
});

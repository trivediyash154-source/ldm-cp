import { describe, expect, it } from 'vitest';
import { selectAdmission, selectCounterHealth, selectOccupancy, selectTelemetryQuality } from '../../src/core/selectors';
import { Bench, GATE_PAUSE, telemetry } from './helpers';

describe('baseline and repeated readings', () => {
  it('waits for a confirmed reading after connecting', () => {
    const b = new Bench().connect();
    expect(selectTelemetryQuality(b.state)).toBe('waiting');
    expect(selectOccupancy(b.state).freshness).toBe('waiting');
    b.frames(3, 1);
    expect(selectOccupancy(b.state).reading).toBeNull();
    b.frames(3, 1);
    const view = selectOccupancy(b.state);
    expect(view.occupancy).toBe(3);
    expect(view.available).toBe(2);
    expect(view.utilization).toBeCloseTo(0.6);
    expect(view.freshness).toBe('live');
    expect(selectTelemetryQuality(b.state)).toBe('live');
    expect(b.state.accepted?.bits).toEqual([0, 1, 1]);
  });

  it('never creates events from repeated identical frames', () => {
    const b = new Bench().connect().frames(2, 500);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(b.events.filter((e) => e.kind === 'counter')).toHaveLength(1); // the first reading only
    expect(b.state.samples).toHaveLength(1);
  });

  it('ignores a one-frame glitch', () => {
    const b = new Bench().connect().frames(2, 5);
    b.frames(7, 1).frames(2, 5);
    expect(selectOccupancy(b.state).occupancy).toBe(2);
    expect(b.events.filter((e) => e.severity === 'error')).toHaveLength(0);
    expect(b.state.totals.flickers).toBe(1);
  });

  it('flags unstable readings after repeated glitches, then recovers', () => {
    const b = new Bench().connect().frames(2, 3);
    for (let i = 0; i < 3; i += 1) b.frames(6, 1).frames(2, 2);
    expect(b.state.unstable).toBe(true);
    expect(selectCounterHealth(b.state)).toBe('unstable');
    b.frames(2, 100); // >10 s of clean readings
    expect(b.state.unstable).toBe(false);
  });
});

describe('firmware v1 (telemetry only)', () => {
  it('infers an entry from a +1 step that follows a gate-length pause', () => {
    const b = new Bench().connect().frames(1, 5).v1GateSequence(1, 2);
    const [entry] = b.vehicleEvents();
    expect(entry).toMatchObject({ kind: 'entry', basis: 'inferred', before: 1, after: 2, movement: 'arrive' });
    expect(selectOccupancy(b.state).occupancy).toBe(2);
  });

  it('infers an exit from a -1 step that follows a gate-length pause', () => {
    const b = new Bench().connect().frames(3, 5).v1GateSequence(3, 2);
    expect(b.vehicleEvents()).toEqual([expect.objectContaining({ kind: 'exit', basis: 'inferred', before: 3, after: 2, movement: 'depart' })]);
  });

  it('does not invent a vehicle for a ±1 step without a gate pause', () => {
    const b = new Bench().connect().frames(1, 5).frames(2, 3);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(b.events.at(-1)).toMatchObject({ kind: 'counter', severity: 'warning', before: 1, after: 2 });
    expect(selectOccupancy(b.state).occupancy).toBe(2); // the hardware value is still shown
  });

  it('reports unexpected jumps without vehicle events', () => {
    const b = new Bench().connect().frames(1, 5).v1GateSequence(1, 4);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(b.events.at(-1)?.title).toMatch(/Unexpected counter jump 1 → 4/);
  });

  it('flags a gate sequence that did not change the counter', () => {
    const b = new Bench().connect().frames(3, 5);
    b.line(telemetry(3), GATE_PAUSE).frames(3, 15);
    const warning = b.events.find((e) => e.title === 'Gate sequence without a count change');
    expect(warning).toMatchObject({ basis: 'inferred', before: 3, after: 3 });
    expect(b.vehicleEvents()).toHaveLength(0);
  });

  it('does not treat pauses while the page was hidden as gate evidence', () => {
    const b = new Bench().connect().frames(1, 5);
    b.dispatch({ type: 'visibility', hidden: true, at: b.now + 10 });
    b.line(telemetry(1), GATE_PAUSE);
    b.dispatch({ type: 'visibility', hidden: false, at: b.now });
    b.frames(2, 3);
    expect(b.vehicleEvents()).toHaveLength(0);
  });
});

describe('capacity validation', () => {
  it('treats 6 and 7 as out-of-range, never as occupancy', () => {
    const b = new Bench().connect().frames(7, 3);
    const view = selectOccupancy(b.state);
    expect(view.validity).toBe('out-of-range');
    expect(view.occupancy).toBeNull();
    expect(view.available).toBeNull();
    expect(view.reading?.raw).toBe(7);
    expect(selectCounterHealth(b.state)).toBe('out-of-range');
    expect(b.state.discrepancy?.message).toMatch(/Counter reads 7/);
    expect(selectAdmission(b.state)).toEqual({ entry: false, exit: true });
  });

  it('reports a return to the valid range without inventing vehicles', () => {
    const b = new Bench().connect().frames(7, 3).v1GateSequence(7, 6).frames(3, 3);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(b.events.some((e) => e.title === 'Counter back in range: 6 → 3')).toBe(true);
    expect(selectOccupancy(b.state).occupancy).toBe(3);
  });

  it('never accepts a step from 5 to 6 as an entry', () => {
    const b = new Bench().connect().frames(5, 3).v1GateSequence(5, 6);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(selectOccupancy(b.state).occupancy).toBeNull();
  });
});

describe('invalid and stale telemetry', () => {
  it('ignores a partial first line after connecting', () => {
    const b = new Bench().connect().line('nt":3}').frames(3, 2);
    expect(b.state.totals.fragments).toBe(1);
    expect(b.state.session.invalid).toBe(0);
    expect(selectOccupancy(b.state).occupancy).toBe(3);
  });

  it('keeps the last valid reading when malformed lines arrive', () => {
    const b = new Bench().connect().frames(2, 3);
    b.line('{"q2":0,"q1":1,"q0":1,"count":4}').line('garbage').line('{"q2":9}');
    expect(selectTelemetryQuality(b.state)).toBe('invalid');
    expect(selectOccupancy(b.state).occupancy).toBe(2);
    expect(b.events.some((e) => e.title === 'Receiving unusable data')).toBe(true);
    b.frames(2, 1);
    expect(selectTelemetryQuality(b.state)).toBe('live');
  });

  it('marks telemetry stale after 4 s of silence and records the recovery', () => {
    const b = new Bench().connect().frames(2, 3).wait(3500);
    expect(selectTelemetryQuality(b.state)).toBe('live');
    b.wait(1000);
    expect(selectTelemetryQuality(b.state)).toBe('stale');
    expect(selectOccupancy(b.state).freshness).toBe('stale');
    expect(selectAdmission(b.state)).toEqual({ entry: null, exit: null });
    b.frames(2, 1);
    expect(selectTelemetryQuality(b.state)).toBe('live');
    expect(b.events.filter((e) => e.title === 'Telemetry stale')).toHaveLength(1);
    expect(b.events.filter((e) => e.title === 'Telemetry resumed')).toHaveLength(1);
  });

  it('does not call a normal gate sequence stale', () => {
    const b = new Bench().connect().frames(1, 3).v1GateSequence(1, 2);
    expect(b.state.totals.staleEpisodes).toBe(0);
  });

  it('warns when connected but nothing usable arrives', () => {
    const b = new Bench().connect().line('--- TESTING IN-GATE SERVO & IR SENSOR ---').line('Sensor Clear (Idle)').wait(6500);
    expect(b.events.some((e) => e.title === 'No telemetry yet')).toBe(true);
    expect(selectOccupancy(b.state).reading).toBeNull();
  });
});

describe('disconnects and reconnects', () => {
  it('shows the last value as offline after a disconnect', () => {
    const b = new Bench().connect().frames(4, 3).disconnect('lost');
    expect(selectTelemetryQuality(b.state)).toBe('offline');
    const view = selectOccupancy(b.state);
    expect(view.freshness).toBe('offline');
    expect(view.occupancy).toBe(4);
    expect(b.events.at(-1)).toMatchObject({ kind: 'link', title: 'USB connection lost' });
    expect(b.state.samples.at(-1)).toMatchObject({ raw: null, occupancy: null });
  });

  it('ignores lines that arrive while disconnected', () => {
    const b = new Bench().connect().frames(4, 3).disconnect();
    const before = b.state;
    b.dispatch({ type: 'line', text: telemetry(1), at: b.now + 1 });
    expect(b.state.accepted).toBe(before.accepted);
  });

  it('establishes a new baseline on reconnect without inventing vehicle events', () => {
    const b = new Bench().connect().frames(2, 3).disconnect();
    b.now += 10_000;
    b.connect();
    expect(selectOccupancy(b.state).freshness).toBe('waiting');
    b.frames(4, 3);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(b.events.some((e) => e.title === 'Counter changed between sessions: 2 → 4')).toBe(true);
    expect(selectOccupancy(b.state).occupancy).toBe(4);
  });

  it('does not infer events across the reconnect gap', () => {
    const b = new Bench().connect().frames(2, 3).disconnect();
    b.now += 1500;
    b.connect().frames(3, 3);
    expect(b.vehicleEvents()).toHaveLength(0);
  });
});

describe('firmware v2 (gate events)', () => {
  it('detects v2 from the boot line and records the restore', () => {
    const b = new Bench().connect();
    b.line('{"boot":"ldm-parking","ver":2,"cap":5,"saved":3,"start":3,"pulses":0,"restored":true}', 2000);
    expect(b.state.protocol).toBe('v2');
    expect(b.state.gates.entry).toMatchObject({ state: 'closed', reported: true });
    expect(b.events.at(-1)?.title).toBe('Arduino started');
  });

  it('warns when the restore failed', () => {
    const b = new Bench().connect();
    b.line('{"boot":"ldm-parking","ver":2,"cap":5,"saved":3,"start":1,"pulses":8,"restored":false}', 2000);
    expect(b.events.at(-1)).toMatchObject({ severity: 'warning', title: 'Arduino started — count restore failed' });
  });

  it('confirms an entry when the counter follows', () => {
    const b = new Bench().connect().frames(2, 3).v2GateSequence('entry', 2, 3);
    expect(b.vehicleEvents()).toEqual([expect.objectContaining({ kind: 'entry', basis: 'confirmed', before: 2, after: 3, movement: 'arrive' })]);
    expect(b.state.pending).toHaveLength(0);
    expect(b.state.gates.entry.state).toBe('closed');
    expect(b.state.discrepancy).toBeNull();
  });

  it('shows the entry gate open between the event and the close report', () => {
    const b = new Bench().connect().frames(2, 3);
    b.line('{"evt":"entry","before":2}', 20);
    expect(b.state.gates.entry).toMatchObject({ state: 'open', reported: true });
  });

  it('flags an exit the counter did not record (decrement path not wired)', () => {
    const b = new Bench().connect().frames(3, 3).v2GateSequence('exit', 3, 3).frames(3, 40);
    const exit = b.vehicleEvents()[0];
    expect(exit).toMatchObject({ kind: 'exit', basis: 'unconfirmed', severity: 'error', before: 3, after: 3 });
    expect(exit.movement).toBeUndefined();
    expect(exit.detail).toMatch(/D3/);
    expect(selectCounterHealth(b.state)).toBe('discrepancy');
    expect(selectOccupancy(b.state).occupancy).toBe(3);
    b.dispatch({ type: 'acknowledge' });
    expect(selectCounterHealth(b.state)).toBe('ok');
  });

  it('flags an entry that moved the counter the wrong way', () => {
    const b = new Bench().connect().frames(1, 3).v2GateSequence('entry', 1, 0);
    const entry = b.vehicleEvents()[0];
    expect(entry).toMatchObject({ kind: 'entry', basis: 'unconfirmed', before: 1, after: 0 });
    expect(entry.movement).toBeUndefined();
    expect(b.state.discrepancy?.message).toMatch(/1 → 0 instead of 1 → 2/);
  });

  it('records denied entries without touching occupancy', () => {
    const b = new Bench().connect().frames(5, 3);
    b.line('{"evt":"entry_denied","before":5}', 20).frames(5, 3);
    expect(b.events.at(-1)?.kind).not.toBe('entry');
    expect(b.events.some((e) => e.kind === 'entry-denied' && e.basis === 'reported')).toBe(true);
    expect(b.vehicleEvents()).toHaveLength(0);
  });

  it('does not count a change without a reported event as a vehicle', () => {
    const b = new Bench().connect().frames(2, 3);
    b.line('{"evt":"entry_denied","before":2}', 20); // switches to v2
    b.frames(3, 3);
    expect(b.vehicleEvents()).toHaveLength(0);
    expect(b.events.at(-1)?.title).toMatch(/without a gate event/);
  });

  it('handles an entry and an exit back to back', () => {
    const b = new Bench().connect().frames(2, 3).v2GateSequence('entry', 2, 3).v2GateSequence('exit', 3, 2);
    expect(b.vehicleEvents().map((e) => [e.kind, e.basis])).toEqual([
      ['entry', 'confirmed'],
      ['exit', 'confirmed'],
    ]);
  });

  it('marks pending events unverified when the link drops', () => {
    const b = new Bench().connect().frames(2, 3);
    b.line('{"evt":"entry","before":2}', 20).disconnect('lost');
    expect(b.vehicleEvents()).toEqual([expect.objectContaining({ kind: 'entry', basis: 'unconfirmed', severity: 'warning' })]);
  });
});

describe('sources stay separate', () => {
  it('tags events with their source', () => {
    const sim = new Bench('simulation').connect().frames(1, 3);
    expect(sim.events.every((e) => e.source === 'simulation')).toBe(true);
    expect(sim.events.every((e) => e.id.startsWith('S'))).toBe(true);
  });
});

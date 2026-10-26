import { describe, expect, it } from 'vitest';
import { summarize } from '../../src/core/analytics';
import { createFacility, stepFacility } from '../../src/core/facility';
import { eventsToCsv, HISTORY_KEY, loadHistory, saveHistory } from '../../src/core/persistence';
import type { ParkingEvent } from '../../src/core/types';
import { Bench } from './helpers';

const occupied = (bays: ReturnType<typeof createFacility>['bays']) => bays.map((b) => (b ? 1 : 0)).join('');

describe('facility bay model', () => {
  it('fills bays to the initial occupancy without animating history', () => {
    const b = new Bench().connect().frames(3, 3);
    const f = stepFacility(createFacility(5), b.events, 3, b.now);
    expect(occupied(f.bays)).toBe('11100');
    expect(f.journeys).toHaveLength(0);
  });

  it('animates an identified arrival into the lowest free bay', () => {
    const b = new Bench().connect().frames(2, 3);
    let f = stepFacility(createFacility(5), b.events, 2, b.now);
    b.v1GateSequence(2, 3);
    f = stepFacility(f, b.events, 3, b.now);
    expect(occupied(f.bays)).toBe('11100');
    expect(f.journeys).toEqual([expect.objectContaining({ kind: 'arrive', bay: 2 })]);
  });

  it('releases the longest-parked vehicle on an identified departure', () => {
    const b = new Bench().connect().frames(1, 3);
    let f = stepFacility(createFacility(5), b.events, 1, b.now);
    b.v1GateSequence(1, 2);
    f = stepFacility(f, b.events, 2, b.now);
    b.v1GateSequence(2, 1);
    f = stepFacility(f, b.events, 1, b.now);
    expect(occupied(f.bays)).toBe('01000');
    expect(f.journeys.at(-1)).toMatchObject({ kind: 'depart', bay: 0 });
  });

  it('follows unexplained counter changes without journeys', () => {
    const b = new Bench().connect().frames(1, 3);
    let f = stepFacility(createFacility(5), b.events, 1, b.now);
    b.frames(4, 3); // jump without a gate pause
    f = stepFacility(f, b.events, 4, b.now);
    expect(occupied(f.bays)).toBe('11110');
    expect(f.journeys).toHaveLength(0);
  });

  it('keeps the last layout when occupancy is unknown', () => {
    const b = new Bench().connect().frames(2, 3);
    let f = stepFacility(createFacility(5), b.events, 2, b.now);
    b.frames(7, 3);
    f = stepFacility(f, b.events, null, b.now);
    expect(occupied(f.bays)).toBe('11000');
  });

  it('skips journeys when animation is off', () => {
    const b = new Bench().connect().frames(2, 3);
    let f = stepFacility(createFacility(5), b.events, 2, b.now);
    b.v1GateSequence(2, 3);
    f = stepFacility(f, b.events, 3, b.now, false);
    expect(f.journeys).toHaveLength(0);
    expect(occupied(f.bays)).toBe('11100');
  });

  it('expires finished journeys', () => {
    const b = new Bench().connect().frames(2, 3);
    let f = stepFacility(createFacility(5), b.events, 2, b.now);
    b.v1GateSequence(2, 3);
    f = stepFacility(f, b.events, 3, b.now);
    f = stepFacility(f, b.events, 3, b.now + 60_000);
    expect(f.journeys).toHaveLength(0);
  });
});

describe('analytics', () => {
  it('summarises recorded events and time-weighted occupancy', () => {
    const b = new Bench().connect().frames(1, 3);
    b.wait(10_000).v1GateSequence(1, 2).wait(10_000).v1GateSequence(2, 1);
    const s = summarize(b.events, b.state.samples, 5, b.now, true);
    expect(s.entries).toEqual({ total: 1, confirmed: 0, inferred: 1, unconfirmed: 0 });
    expect(s.exits.total).toBe(1);
    expect(s.peak?.occupancy).toBe(2);
    expect(s.observedMs).toBe(b.now - b.state.samples[0].at);
    expect(s.averageUtilization).toBeGreaterThan(0.2);
    expect(s.averageUtilization).toBeLessThan(0.4);
    expect(s.entriesByHour.reduce((a, n) => a + n, 0)).toBe(1);
  });

  it('excludes disconnected time from observed time', () => {
    const b = new Bench().connect().frames(2, 3).wait(5000).disconnect();
    const end = b.now;
    b.now += 60_000;
    const s = summarize(b.events, b.state.samples, 5, b.now, false);
    expect(s.observedMs).toBeLessThanOrEqual(end - b.state.samples[0].at);
  });

  it('returns empty figures without history', () => {
    const s = summarize([], [], 5, Date.now(), false);
    expect(s.period).toBeNull();
    expect(s.averageUtilization).toBeNull();
    expect(s.peak).toBeNull();
  });
});

describe('persistence', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      data,
    };
  };

  it('round-trips live history', () => {
    const store = memory();
    const b = new Bench().connect().frames(2, 3);
    expect(saveHistory(b.events, b.state.samples, store)).toBe(true);
    const loaded = loadHistory(store);
    expect(loaded.events).toEqual(b.events);
    expect(loaded.samples).toEqual(b.state.samples);
  });

  it('never stores simulation events', () => {
    const store = memory();
    const sim = new Bench('simulation').connect().frames(2, 3);
    saveHistory(sim.events, [], store);
    expect(loadHistory(store).events).toHaveLength(0);
  });

  it('survives corrupt or blocked storage', () => {
    const store = memory();
    store.data.set(HISTORY_KEY, '{not json');
    expect(loadHistory(store).events).toEqual([]);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
    };
    expect(loadHistory(blocked).events).toEqual([]);
    expect(saveHistory([], [], blocked)).toBe(false);
    expect(loadHistory(null).events).toEqual([]);
  });

  it('exports CSV with quoted text', () => {
    const e: ParkingEvent = {
      id: 'x',
      at: Date.UTC(2026, 9, 26, 12),
      source: 'live',
      session: 1,
      kind: 'entry',
      basis: 'confirmed',
      severity: 'info',
      before: 1,
      after: 2,
      title: 'Vehicle "entered"',
    };
    expect(eventsToCsv([e]).split('\n')[1]).toBe('2026-10-26T12:00:00.000Z,entry,confirmed,info,1,2,"Vehicle ""entered""",""');
  });
});

import { describe, expect, it } from 'vitest';
import { selectOccupancy } from '../../src/core/selectors';
import { createEngineStore } from '../../src/core/store';
import { SimulatedFirmware } from '../../src/simulation/simulatedFirmware';
import { SimulationSession } from '../../src/simulation/simulationSession';
import { parseLine } from '../../src/protocol/parser';

function setup() {
  let now = 5_000_000;
  const live = createEngineStore({ source: 'live' });
  const simStore = createEngineStore({ source: 'simulation' });
  const sim = new SimulationSession(simStore, () => now, () => 0.3);
  const run = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now += 50;
      sim.step();
    }
  };
  return { live, simStore, sim, run };
}

describe('SimulatedFirmware', () => {
  it('prints only lines the real protocol allows', () => {
    const fw = new SimulatedFirmware(0, 1);
    fw.triggerEntry();
    const lines = fw.advance(6000);
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) expect(parseLine(line).kind).not.toBe('invalid');
    expect(lines[0]).toMatch(/"boot":"ldm-parking"/);
  });

  it('pauses telemetry for the length of a gate sequence', () => {
    const fw = new SimulatedFirmware(0, 1);
    const times: number[] = [];
    for (let t = 0; t < 7000; t += 10) {
      if (t === 3000) fw.triggerEntry();
      if (fw.advance(t).some((l) => l.includes('"q2"'))) times.push(t);
    }
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.max(...gaps)).toBeGreaterThan(1700);
  });
});

describe('SimulationSession', () => {
  it('does nothing until explicitly started', () => {
    const { simStore, sim, run } = setup();
    run(5000);
    expect(simStore.getState().link.status).toBe('disconnected');
    expect(simStore.getState().events).toHaveLength(0);
    expect(sim.getControls().running).toBe(false);
  });

  it('runs entries through the same engine and confirms them', () => {
    const { simStore, sim, run } = setup();
    sim.start(2, 0);
    run(2500);
    expect(selectOccupancy(simStore.getState()).occupancy).toBe(2);
    sim.vehicleAtEntry();
    run(3000);
    const s = simStore.getState();
    expect(selectOccupancy(s).occupancy).toBe(3);
    expect(s.events.filter((e) => e.kind === 'entry')).toEqual([expect.objectContaining({ basis: 'confirmed', source: 'simulation' })]);
  });

  it('demonstrates the missing decrement path as a discrepancy', () => {
    const { simStore, sim, run } = setup();
    sim.setDecrementWired(false);
    sim.start(3, 0);
    run(2500);
    sim.vehicleAtExit();
    run(6000);
    const exit = simStore.getState().events.find((e) => e.kind === 'exit');
    expect(exit).toMatchObject({ basis: 'unconfirmed', severity: 'error' });
    expect(selectOccupancy(simStore.getState()).occupancy).toBe(3);
  });

  it('never touches the live store', () => {
    const { live, sim, run } = setup();
    const before = live.getState();
    sim.start(2, 0);
    sim.setAutoTraffic(true);
    run(60_000);
    sim.injectGlitch();
    run(5000);
    sim.stop();
    expect(live.getState()).toBe(before);
  });

  it('shows stale and invalid telemetry on demand', () => {
    const { simStore, sim, run } = setup();
    sim.start(1, 0);
    run(2500);
    sim.injectStall();
    run(5000);
    expect(simStore.getState().stale).toBe(true);
    run(4000);
    expect(simStore.getState().stale).toBe(false);
    sim.injectGarbage();
    run(500);
    expect(simStore.getState().session.invalid).toBe(1);
  });

  it('stops cleanly and marks the link disconnected', () => {
    const { simStore, sim, run } = setup();
    sim.start(1, 0);
    run(2500);
    sim.stop();
    expect(simStore.getState().link.status).toBe('disconnected');
    expect(selectOccupancy(simStore.getState()).freshness).toBe('offline');
  });
});

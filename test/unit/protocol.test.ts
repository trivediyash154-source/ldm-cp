import { describe, expect, it } from 'vitest';
import { LineFramer } from '../../src/protocol/framer';
import { bitsToCount, parseLine } from '../../src/protocol/parser';

describe('LineFramer', () => {
  it('reassembles lines split across chunks', () => {
    const f = new LineFramer();
    expect(f.push('{"q2":0,"q1"')).toEqual([]);
    expect(f.push(':1,"q0":1,"cou')).toEqual([]);
    expect(f.push('nt":3}\r\n{"q2"')).toEqual([{ kind: 'line', text: '{"q2":0,"q1":1,"q0":1,"count":3}' }]);
    expect(f.pending).toBe('{"q2"');
  });

  it('returns several lines from one chunk and strips CR', () => {
    const f = new LineFramer();
    const out = f.push('a\r\nb\n\r\nc\r\n');
    expect(out).toEqual([
      { kind: 'line', text: 'a' },
      { kind: 'line', text: 'b' },
      { kind: 'line', text: 'c' },
    ]);
  });

  it('discards an over-long line and resynchronises at the next newline', () => {
    const f = new LineFramer(16);
    expect(f.push('x'.repeat(20))).toEqual([{ kind: 'overflow', length: 20 }]);
    expect(f.push('yyyy\nok\n')).toEqual([{ kind: 'line', text: 'ok' }]);
  });

  it('reset drops partial data', () => {
    const f = new LineFramer();
    f.push('{"q2":');
    f.reset();
    expect(f.push('1}\n')).toEqual([{ kind: 'line', text: '1}' }]);
  });
});

describe('parseLine', () => {
  it('accepts every telemetry line the firmware can print', () => {
    for (let raw = 0; raw < 8; raw += 1) {
      const q2 = (raw >> 2) & 1;
      const q1 = (raw >> 1) & 1;
      const q0 = raw & 1;
      const line = `{"q2":${q2},"q1":${q1},"q0":${q0},"count":${raw}}`;
      expect(parseLine(line)).toEqual({ kind: 'telemetry', frame: { q2, q1, q0, count: raw } });
    }
  });

  it('converts bits to decimal as 4·Q2 + 2·Q1 + Q0', () => {
    expect(bitsToCount(0, 0, 0)).toBe(0);
    expect(bitsToCount(0, 1, 1)).toBe(3);
    expect(bitsToCount(1, 0, 1)).toBe(5);
    expect(bitsToCount(1, 1, 1)).toBe(7);
  });

  it('rejects a count that disagrees with the bits', () => {
    const r = parseLine('{"q2":0,"q1":1,"q0":1,"count":4}');
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.reason).toMatch(/disagrees/);
  });

  it.each([
    ['{"q2":2,"q1":0,"q0":0,"count":0}', /q2/],
    ['{"q2":"1","q1":0,"q0":0,"count":4}', /q2/],
    ['{"q2":0,"q1":0.5,"q0":0,"count":0}', /q1/],
    ['{"q2":0,"q1":0,"count":0}', /missing "q0"/],
    ['{"q2":0,"q1":0,"q0":0}', /missing "count"/],
    ['{"q2":0,"q1":0,"q0":0,"count":-1}', /count/],
    ['{"q2":0,"q1":1,"q0":', /malformed/],
    ['ENTRY DETECTED! Opening Gate...', /not a JSON object/],
    ['[1,2,3]', /not a JSON object/],
    ['{"hello":1}', /without telemetry/],
    ['{"evt":"teleport","before":1}', /unknown event/],
    ['{"evt":"entry"}', /before/],
  ])('rejects %s', (line, reason) => {
    const r = parseLine(line);
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.reason).toMatch(reason);
  });

  it('parses v2 event and boot lines', () => {
    expect(parseLine('{"evt":"entry","before":2}')).toEqual({ kind: 'event', event: { evt: 'entry', before: 2 } });
    expect(parseLine('{"evt":"exit_denied","before":0}')).toEqual({ kind: 'event', event: { evt: 'exit_denied', before: 0 } });
    expect(parseLine('{"boot":"ldm-parking","ver":2,"cap":5,"saved":3,"start":3,"pulses":0,"restored":true}')).toEqual({
      kind: 'boot',
      boot: { boot: 'ldm-parking', ver: 2, cap: 5, saved: 3, start: 3, pulses: 0, restored: true },
    });
  });

  it('tolerates whitespace and extra fields', () => {
    expect(parseLine('  { "q2": 0, "q1": 0, "q0": 1, "count": 1, "extra": true }  ').kind).toBe('telemetry');
  });
});

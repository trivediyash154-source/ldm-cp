import { describe, expect, it } from 'vitest';

/**
 * Next-state equations proposed in docs/hardware-notes.md for an up/down
 * counter built from parts already on the board (the two 74LS74s, all four
 * gates of the 74LS86 and one 74LS08 gate). DOWN is a level on D3 that is
 * held steady around the D2 clock pulse.
 *
 *   A  = Q0 ⊕ DOWN          (74LS86 gate 1)
 *   B  = Q1 ⊕ DOWN          (74LS86 gate 2)
 *   D0 = ¬Q0                (Q0-bar, already wired)
 *   D1 = Q1 ⊕ A             (74LS86 gate 3)
 *   D2 = Q2 ⊕ (A · B)       (74LS08 gate 1 → 74LS86 gate 4)
 *
 * This checks the logic only, not the breadboard.
 */
function next(value: number, down: 0 | 1): number {
  const q0 = value & 1;
  const q1 = (value >> 1) & 1;
  const q2 = (value >> 2) & 1;
  const a = q0 ^ down;
  const b = q1 ^ down;
  const d0 = q0 ^ 1;
  const d1 = q1 ^ a;
  const d2 = q2 ^ (a & b);
  return d2 * 4 + d1 * 2 + d0;
}

/** The guide's wiring: AND gate 1 input B on the clock, so it is 0 at the rising edge. */
function nextGuide(value: number): number {
  const q0 = value & 1;
  const q1 = (value >> 1) & 1;
  const q2 = (value >> 2) & 1;
  return (q2 ^ (q0 & q1)) * 4 + (q1 ^ 0) * 2 + (q0 ^ 1);
}

describe('proposed up/down counter logic', () => {
  it('counts up through every state with DOWN = 0', () => {
    for (let v = 0; v < 8; v += 1) expect(next(v, 0)).toBe((v + 1) % 8);
  });

  it('counts down through every state with DOWN = 1', () => {
    for (let v = 0; v < 8; v += 1) expect(next(v, 1)).toBe((v + 7) % 8);
  });
});

describe('wiring guide as written', () => {
  it('never changes Q1, so it is not a counter (3 even jumps to 6)', () => {
    for (let v = 0; v < 8; v += 1) expect((nextGuide(v) >> 1) & 1).toBe((v >> 1) & 1);
    expect([0, 1, 2, 3].map(nextGuide)).toEqual([1, 0, 3, 6]);
  });
});

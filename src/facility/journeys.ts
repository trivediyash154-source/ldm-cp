import { CatmullRomCurve3, Vector3 } from 'three';
import { JOURNEY_MS } from '../core/facility';
import { AISLE_Z, BAY_Z, bayX, ENTRY_X, EXIT_X } from './geometry';

/** Vehicle paths for the 3D facility (three.js curves; only loaded with the 3D view). */

const v = (x: number, z: number) => new Vector3(x, 0, z);
const curve = (points: Vector3[]) => new CatmullRomCurve3(points, false, 'centripetal', 0.5);

export interface Segment {
  curve: CatmullRomCurve3;
  from: number; // ms into the journey
  to: number;
  reverse?: boolean;
}

export interface JourneyPlan {
  segments: Segment[];
  duration: number;
  /** When the gate arm should be up (ms into the journey). */
  gate: { side: 'entry' | 'exit'; from: number; to: number };
  /** When the IR sensor beam is shown as broken. */
  sensor: { from: number; to: number };
}

export function arrivalPlan(bay: number, capacity: number): JourneyPlan {
  const x = bayX(bay, capacity);
  return {
    duration: JOURNEY_MS.arrive,
    segments: [
      { curve: curve([v(ENTRY_X, 18), v(ENTRY_X, 12), v(ENTRY_X, 7.6)]), from: 0, to: 1800 },
      {
        curve: curve([
          v(ENTRY_X, 7.6),
          v(ENTRY_X, 3),
          v(ENTRY_X + 0.2, 0.2),
          v(ENTRY_X + 1.4, AISLE_Z),
          v(x - 2.3, AISLE_Z - 0.1),
          v(x - 0.5, -3.1),
          v(x, -4.6),
          v(x, BAY_Z),
        ]),
        from: 2700,
        to: JOURNEY_MS.arrive,
      },
    ],
    gate: { side: 'entry', from: 1500, to: 4300 },
    sensor: { from: 1300, to: 3000 },
  };
}

export function departurePlan(bay: number, capacity: number): JourneyPlan {
  const x = bayX(bay, capacity);
  return {
    duration: JOURNEY_MS.depart,
    segments: [
      { curve: curve([v(x, BAY_Z), v(x, -4.6), v(x - 0.5, -3.0), v(x - 1.9, AISLE_Z - 0.2)]), from: 0, to: 1800, reverse: true },
      {
        curve: curve([
          v(x - 1.9, AISLE_Z - 0.2),
          v(x - 0.2, AISLE_Z + 0.1),
          v(EXIT_X - 1.6, AISLE_Z + 0.1),
          v(EXIT_X - 0.1, 0.2),
          v(EXIT_X, 3.4),
        ]),
        from: 1800,
        to: 4500,
      },
      { curve: curve([v(EXIT_X, 3.4), v(EXIT_X, 9), v(EXIT_X, 18)]), from: 5200, to: JOURNEY_MS.depart },
    ],
    gate: { side: 'exit', from: 4300, to: JOURNEY_MS.depart },
    sensor: { from: 3900, to: 5400 },
  };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Position and heading of a vehicle `elapsed` ms into a journey, or null when hidden. */
export function samplePlan(plan: JourneyPlan, elapsed: number): { position: Vector3; heading: number } | null {
  if (elapsed < 0 || elapsed > plan.duration) return null;
  let segment = plan.segments[0];
  let t = 0;
  for (const s of plan.segments) {
    if (elapsed >= s.from) {
      segment = s;
      t = Math.min(1, (elapsed - s.from) / (s.to - s.from));
    }
  }
  const eased = easeInOut(t);
  const position = segment.curve.getPointAt(eased);
  const tangent = segment.curve.getTangentAt(Math.min(0.999, Math.max(0.001, eased)));
  const dir = segment.reverse ? tangent.multiplyScalar(-1) : tangent;
  return { position, heading: Math.atan2(dir.x, dir.z) };
}

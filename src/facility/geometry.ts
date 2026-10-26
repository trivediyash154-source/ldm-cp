/**
 * Site plan in metres. x runs east, z runs south (toward the street), y is up.
 * Five bays along the north edge, an east-bound aisle in front of them, the
 * entry lane in the west and the exit lane in the east, both gated at the
 * lot boundary (z = GATE_Z).
 */
export const BAY_WIDTH = 2.9;
export const BAY_DEPTH = 5.2;
export const BAY_Z = -6.7; // parked car centre
export const BAY_MOUTH_Z = -4.05;
export const AISLE_Z = -1.8;
export const GATE_Z = 5.5;
export const ENTRY_X = -10.5;
export const EXIT_X = 10.5;
export const LANE_WIDTH = 3.4;
export const LOT = { minX: -13.2, maxX: 13.2, minZ: -10, maxZ: GATE_Z };
export const STREET_Z = 11.5;

export const bayX = (i: number, capacity: number) => (i - (capacity - 1) / 2) * BAY_WIDTH;

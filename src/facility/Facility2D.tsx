import type { FacilityState } from '../core/facility';
import type { GateState } from '../core/types';
import { BAY_DEPTH, BAY_MOUTH_Z, BAY_WIDTH, bayX, ENTRY_X, EXIT_X, GATE_Z, LANE_WIDTH, LOT, STREET_Z } from './geometry';
import { CAR_PALETTE } from './palette';

/**
 * Top-down plan used when WebGL is unavailable (or chosen). Same layout and
 * same bay allocation as the 3D view, without vehicle journeys.
 */
export function Facility2D({
  facility,
  capacity,
  known,
  gates,
}: {
  facility: FacilityState;
  capacity: number;
  known: boolean;
  gates: { entry: GateState; exit: GateState };
}) {
  const minX = LOT.minX - 2;
  const width = LOT.maxX - LOT.minX + 4;
  const minZ = LOT.minZ - 1;
  const height = STREET_Z + 3 - minZ;
  const gateArm = (side: 'entry' | 'exit') => {
    const laneX = side === 'entry' ? ENTRY_X : EXIT_X;
    const dir = side === 'entry' ? 1 : -1;
    const x0 = laneX - dir * (LANE_WIDTH / 2 + 0.35);
    const open = gates[side].state === 'open';
    return (
      <g key={side}>
        <rect x={x0 - 0.25} y={GATE_Z - 0.25} width={0.5} height={0.5} className="plan-post" />
        <line
          x1={x0}
          y1={GATE_Z}
          x2={open ? x0 + dir * 0.6 : x0 + dir * 3.6}
          y2={open ? GATE_Z - 0.6 : GATE_Z}
          className="plan-arm"
        />
      </g>
    );
  };
  return (
    <svg className="plan" viewBox={`${minX} ${minZ} ${width} ${height}`} role="img" aria-label={`Site plan: ${facility.bays.filter(Boolean).length} of ${capacity} bays shown occupied`}>
      <rect x={minX} y={minZ} width={width} height={height} className="plan-ground" />
      <rect x={minX} y={STREET_Z - 2.3} width={width} height={4.6} className="plan-street" />
      <rect x={LOT.minX} y={LOT.minZ} width={LOT.maxX - LOT.minX} height={LOT.maxZ - LOT.minZ} className="plan-lot" rx={0.4} />
      <rect x={ENTRY_X - LANE_WIDTH / 2} y={GATE_Z} width={LANE_WIDTH} height={STREET_Z - GATE_Z} className="plan-lot" />
      <rect x={EXIT_X - LANE_WIDTH / 2} y={GATE_Z} width={LANE_WIDTH} height={STREET_Z - GATE_Z} className="plan-lot" />
      <rect x={-6.6} y={2.05} width={13.2} height={3.4} className="plan-island" rx={0.5} />
      <text x={0} y={3.95} className="plan-caption">Control</text>
      <text x={ENTRY_X} y={STREET_Z - 2.8} className="plan-caption">IN ↑</text>
      <text x={EXIT_X} y={STREET_Z - 2.8} className="plan-caption">OUT ↓</text>
      {Array.from({ length: capacity }, (_, i) => {
        const x = bayX(i, capacity);
        const occupant = facility.bays[i];
        const state = !known ? 'unknown' : occupant ? 'taken' : 'free';
        return (
          <g key={i}>
            <rect x={x - BAY_WIDTH / 2} y={BAY_MOUTH_Z - BAY_DEPTH} width={BAY_WIDTH} height={BAY_DEPTH} className={`plan-bay plan-bay-${state}`} />
            {occupant && (
              <rect
                x={x - 0.9}
                y={BAY_MOUTH_Z - BAY_DEPTH + 0.55}
                width={1.8}
                height={4.1}
                rx={0.45}
                fill={CAR_PALETTE[occupant.palette % CAR_PALETTE.length]}
                className="plan-car"
              />
            )}
            <text x={x} y={BAY_MOUTH_Z + 1.1} className="plan-label">
              {i + 1}
            </text>
          </g>
        );
      })}
      {gateArm('entry')}
      {gateArm('exit')}
    </svg>
  );
}

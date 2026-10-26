import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, Color, MeshStandardMaterial, Shape, SRGBColorSpace, type Group, type Mesh } from 'three';
import type { FacilityState, Journey } from '../core/facility';
import type { GateState } from '../core/types';
import { Car } from './Car';
import { AISLE_Z, BAY_DEPTH, BAY_MOUTH_Z, BAY_WIDTH, BAY_Z, bayX, ENTRY_X, EXIT_X, GATE_Z, LANE_WIDTH, LOT, STREET_Z } from './geometry';
import { arrivalPlan, departurePlan, samplePlan, type JourneyPlan } from './journeys';

const mat = {
  ground: new MeshStandardMaterial({ color: '#0d1d36', roughness: 1 }),
  asphalt: new MeshStandardMaterial({ color: '#22365a', roughness: 0.9 }),
  street: new MeshStandardMaterial({ color: '#162640', roughness: 0.95 }),
  paint: new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.6, emissive: '#efe6d2', emissiveIntensity: 0.08 }),
  curb: new MeshStandardMaterial({ color: '#cfc5ae', roughness: 0.8 }),
  lawn: new MeshStandardMaterial({ color: '#17604a', roughness: 0.95 }),
  shrub: new MeshStandardMaterial({ color: '#1f7a58', roughness: 0.9 }),
  trunk: new MeshStandardMaterial({ color: '#4a3a2b', roughness: 0.9 }),
  pole: new MeshStandardMaterial({ color: '#2a3d5c', metalness: 0.5, roughness: 0.4 }),
  lamp: new MeshStandardMaterial({ color: '#ffe0a8', emissive: '#ffcf7a', emissiveIntensity: 2.2 }),
  booth: new MeshStandardMaterial({ color: '#e9e1cf', roughness: 0.55 }),
  boothGlass: new MeshStandardMaterial({ color: '#7fd6cf', metalness: 0.2, roughness: 0.1, emissive: '#2ab3a8', emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }),
  armWhite: new MeshStandardMaterial({ color: '#f4efe3', roughness: 0.5 }),
  armAmber: new MeshStandardMaterial({ color: '#e3972b', roughness: 0.45, emissive: '#e3972b', emissiveIntensity: 0.15 }),
  post: new MeshStandardMaterial({ color: '#13294d', metalness: 0.3, roughness: 0.5 }),
};

const FREE = new Color('#129a63');
const TAKEN = new Color('#e5a33a');
const UNKNOWN = new Color('#5b6880');

function Box({ args, position, material, receive = true }: { args: [number, number, number]; position: [number, number, number]; material: MeshStandardMaterial; receive?: boolean }) {
  return (
    <mesh position={position} material={material} receiveShadow={receive}>
      <boxGeometry args={args} />
    </mesh>
  );
}

function Arrow({ x, z, rotation }: { x: number; z: number; rotation: number }) {
  const shape = useMemo(() => {
    const s = new Shape();
    s.moveTo(-0.22, -0.9);
    s.lineTo(0.22, -0.9);
    s.lineTo(0.22, 0.1);
    s.lineTo(0.55, 0.1);
    s.lineTo(0, 0.9);
    s.lineTo(-0.55, 0.1);
    s.lineTo(-0.22, 0.1);
    s.closePath();
    return s;
  }, []);
  return (
    <mesh position={[x, 0.025, z]} rotation={[-Math.PI / 2, 0, rotation]} material={mat.paint}>
      <shapeGeometry args={[shape]} />
    </mesh>
  );
}

function Tree({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.6, 0]} material={mat.trunk} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 1.2, 8]} />
      </mesh>
      <mesh position={[0, 1.65, 0]} material={mat.shrub} castShadow>
        <icosahedronGeometry args={[0.85, 1]} />
      </mesh>
    </group>
  );
}

function LampPost({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 2.4, 0]} material={mat.pole}>
        <cylinderGeometry args={[0.06, 0.09, 4.8, 10]} />
      </mesh>
      <mesh position={[0, 4.85, 0]} material={mat.lamp}>
        <boxGeometry args={[0.6, 0.12, 0.3]} />
      </mesh>
      <pointLight position={[0, 4.6, 0]} color="#ffd59a" intensity={18} distance={13} decay={1.6} />
    </group>
  );
}

function Site() {
  const lotW = LOT.maxX - LOT.minX;
  const lotD = LOT.maxZ - LOT.minZ;
  const bayEdges = useMemo(() => Array.from({ length: 6 }, (_, i) => (i - 2.5) * BAY_WIDTH), []);
  return (
    <group>
      <Box args={[90, 0.1, 70]} position={[0, -0.06, 4]} material={mat.ground} />
      <Box args={[lotW, 0.04, lotD]} position={[(LOT.minX + LOT.maxX) / 2, 0, (LOT.minZ + LOT.maxZ) / 2]} material={mat.asphalt} />
      <Box args={[90, 0.03, 4.6]} position={[0, 0, STREET_Z]} material={mat.street} />
      {/* access lanes between the gates and the street */}
      <Box args={[LANE_WIDTH, 0.035, STREET_Z - GATE_Z]} position={[ENTRY_X, 0.002, (STREET_Z + GATE_Z) / 2]} material={mat.asphalt} />
      <Box args={[LANE_WIDTH, 0.035, STREET_Z - GATE_Z]} position={[EXIT_X, 0.002, (STREET_Z + GATE_Z) / 2]} material={mat.asphalt} />
      {/* street centre line */}
      {Array.from({ length: 14 }, (_, i) => (
        <Box key={i} args={[1.6, 0.01, 0.12]} position={[-26 + i * 4, 0.02, STREET_Z]} material={mat.paint} receive={false} />
      ))}
      {/* north wall and boundary curbs */}
      <Box args={[lotW, 0.9, 0.3]} position={[0, 0.45, LOT.minZ - 0.15]} material={mat.curb} />
      <Box args={[0.3, 0.25, lotD]} position={[LOT.minX - 0.15, 0.12, (LOT.minZ + LOT.maxZ) / 2]} material={mat.curb} />
      <Box args={[0.3, 0.25, lotD]} position={[LOT.maxX + 0.15, 0.12, (LOT.minZ + LOT.maxZ) / 2]} material={mat.curb} />
      {/* bay markings */}
      {bayEdges.map((x) => (
        <Box key={x} args={[0.12, 0.01, BAY_DEPTH]} position={[x, 0.025, (LOT.minZ + 0.6 + BAY_MOUTH_Z) / 2 + 0.3]} material={mat.paint} receive={false} />
      ))}
      <Box args={[BAY_WIDTH * 5, 0.01, 0.12]} position={[0, 0.025, LOT.minZ + 0.95]} material={mat.paint} receive={false} />
      {/* lane edges */}
      <Box args={[0.1, 0.01, 6.2]} position={[ENTRY_X + LANE_WIDTH / 2 + 0.05, 0.025, 2.3]} material={mat.paint} receive={false} />
      <Box args={[0.1, 0.01, 6.2]} position={[EXIT_X - LANE_WIDTH / 2 - 0.05, 0.025, 2.3]} material={mat.paint} receive={false} />
      {/* direction arrows */}
      <Arrow x={ENTRY_X} z={8.6} rotation={0} />
      <Arrow x={ENTRY_X} z={2.6} rotation={0} />
      <Arrow x={-4.2} z={AISLE_Z} rotation={-Math.PI / 2} />
      <Arrow x={4.2} z={AISLE_Z} rotation={-Math.PI / 2} />
      <Arrow x={EXIT_X} z={2.6} rotation={Math.PI} />
      <Arrow x={EXIT_X} z={8.6} rotation={Math.PI} />
      {/* central island with the control pavilion */}
      <Box args={[13.2, 0.22, 3.4]} position={[0, 0.11, 3.75]} material={mat.curb} />
      <Box args={[12.8, 0.26, 3.0]} position={[0, 0.13, 3.75]} material={mat.lawn} />
      <group position={[0, 0.26, 3.75]}>
        <Box args={[3.2, 1.6, 1.8]} position={[0, 0.8, 0]} material={mat.booth} />
        <Box args={[3.0, 0.9, 1.84]} position={[0, 1.0, 0]} material={mat.boothGlass} receive={false} />
        <Box args={[3.6, 0.12, 2.2]} position={[0, 1.66, 0]} material={mat.post} />
      </group>
      <Tree x={-4.8} z={3.6} />
      <Tree x={-3.2} z={4.2} s={0.8} />
      <Tree x={3.4} z={3.5} s={0.9} />
      <Tree x={5.0} z={4.1} />
      <Tree x={-16} z={-6} s={1.3} />
      <Tree x={-17} z={-1} s={1.1} />
      <Tree x={16.5} z={-5} s={1.25} />
      <Tree x={17} z={0.5} s={1} />
      <LampPost x={LOT.minX + 0.6} z={-3} />
      <LampPost x={LOT.maxX - 0.6} z={-3} />
      <LampPost x={0} z={LOT.minZ + 0.4} />
    </group>
  );
}

function Bay({ index, capacity, occupied, known, labels }: { index: number; capacity: number; occupied: boolean; known: boolean; labels: boolean }) {
  const x = bayX(index, capacity);
  const color = !known ? UNKNOWN : occupied ? TAKEN : FREE;
  const strip = useMemo(() => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, toneMapped: false }), [color]);
  return (
    <group>
      <mesh position={[x, 0.04, BAY_MOUTH_Z + 0.15]} material={strip}>
        <boxGeometry args={[BAY_WIDTH - 0.6, 0.05, 0.22]} />
      </mesh>
      <mesh position={[x, 1.0, LOT.minZ + 0.05]} material={strip}>
        <boxGeometry args={[0.5, 0.08, 0.06]} />
      </mesh>
      {labels && <BayLabel x={x} title={`BAY ${index + 1}`} status={!known ? '—' : occupied ? 'Occupied' : 'Free'} tone={!known ? '#9fb2cf' : occupied ? '#f5c878' : '#7fe0b2'} />}
    </group>
  );
}

/** Bay caption drawn into a texture, so labels live inside the WebGL scene. */
function BayLabel({ x, title, status, tone }: { x: number; title: string; status: string; tone: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 112;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(5, 15, 34, 0.82)';
      ctx.beginPath();
      ctx.roundRect(4, 4, 248, 104, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(239, 233, 220, 0.7)';
      ctx.font = '600 24px Manrope Variable, Manrope, system-ui, sans-serif';
      ctx.fillText(title, 128, 44);
      ctx.fillStyle = tone;
      ctx.font = '700 34px Manrope Variable, Manrope, system-ui, sans-serif';
      ctx.fillText(status, 128, 86);
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [title, status, tone]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={[x, 1.5, BAY_MOUTH_Z + 1.3]} scale={[2.75, 1.2, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

interface GateDemand {
  entry: boolean;
  exit: boolean;
  entrySensor: boolean;
  exitSensor: boolean;
}

function Gate({ side, reported, demand }: { side: 'entry' | 'exit'; reported: GateState; demand: React.RefObject<GateDemand> }) {
  const arm = useRef<Group>(null);
  const beam = useRef<Mesh>(null);
  const laneX = side === 'entry' ? ENTRY_X : EXIT_X;
  const dir = side === 'entry' ? 1 : -1;
  const postX = laneX - dir * (LANE_WIDTH / 2 + 0.35);
  const sensorZ = side === 'entry' ? GATE_Z + 1.6 : GATE_Z - 1.9;
  const beamMat = useMemo(() => new MeshStandardMaterial({ color: '#ff4a3a', emissive: '#ff2a1a', emissiveIntensity: 2, transparent: true, opacity: 0.25, toneMapped: false }), []);
  useFrame((_, delta) => {
    const d = demand.current;
    const open = reported.state === 'open' || (side === 'entry' ? d?.entry : d?.exit);
    const target = open ? 1.38 : 0;
    if (arm.current) {
      const current = arm.current.rotation.z * dir;
      const next = current + (target - current) * Math.min(1, delta * 3.2);
      arm.current.rotation.z = next * dir;
    }
    const broken = side === 'entry' ? d?.entrySensor : d?.exitSensor;
    beamMat.opacity = broken ? 0.95 : 0.22;
    if (beam.current) beam.current.scale.y = broken ? 1.8 : 1;
  });
  return (
    <group>
      <mesh position={[postX, 0.6, GATE_Z]} material={mat.post} castShadow>
        <boxGeometry args={[0.42, 1.2, 0.42]} />
      </mesh>
      <mesh position={[postX, 1.22, GATE_Z]} material={mat.armAmber}>
        <boxGeometry args={[0.46, 0.06, 0.46]} />
      </mesh>
      <group ref={arm} position={[postX, 1.05, GATE_Z]}>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} position={[dir * (0.3 + i * 0.5), 0, 0]} material={i % 2 === 0 ? mat.armAmber : mat.armWhite} castShadow>
            <boxGeometry args={[0.5, 0.12, 0.1]} />
          </mesh>
        ))}
      </group>
      {/* IR sensor pair and beam */}
      <mesh position={[laneX - LANE_WIDTH / 2 - 0.2, 0.35, sensorZ]} material={mat.post}>
        <boxGeometry args={[0.16, 0.7, 0.16]} />
      </mesh>
      <mesh position={[laneX + LANE_WIDTH / 2 + 0.2, 0.35, sensorZ]} material={mat.post}>
        <boxGeometry args={[0.16, 0.7, 0.16]} />
      </mesh>
      <mesh ref={beam} position={[laneX, 0.5, sensorZ]} material={beamMat}>
        <boxGeometry args={[LANE_WIDTH + 0.3, 0.03, 0.03]} />
      </mesh>
    </group>
  );
}

function ParkedCar({ x, palette }: { x: number; palette: number }) {
  return (
    <group position={[x, 0, BAY_Z]} rotation={[0, Math.PI, 0]}>
      <Car palette={palette} />
    </group>
  );
}

function MovingCar({ journey, plan }: { journey: Journey; plan: JourneyPlan }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    // An arriving car holds its parked pose until the journey is retired and
    // the parked car takes its place; a departing car disappears off-site.
    const elapsed = Date.now() - journey.startedAt;
    const sample = samplePlan(plan, journey.kind === 'arrive' ? Math.min(elapsed, plan.duration) : elapsed);
    g.visible = sample !== null;
    if (sample) {
      g.position.copy(sample.position);
      g.rotation.y = sample.heading;
    }
  });
  return <Car ref={ref} palette={journey.palette} />;
}

export interface FacilitySceneProps {
  facility: FacilityState;
  capacity: number;
  /** False when the counter value is unknown or out of range; bays turn grey. */
  known: boolean;
  gates: { entry: GateState; exit: GateState };
  labels: boolean;
}

export function FacilityScene({ facility, capacity, known, gates, labels }: FacilitySceneProps) {
  const demand = useRef<GateDemand>({ entry: false, exit: false, entrySensor: false, exitSensor: false });
  const plans = useMemo(
    () =>
      facility.journeys.map((j) => ({
        journey: j,
        plan: j.kind === 'arrive' ? arrivalPlan(j.bay, capacity) : departurePlan(j.bay, capacity),
      })),
    [facility.journeys, capacity],
  );
  const arriving = useMemo(() => new Set(facility.journeys.filter((j) => j.kind === 'arrive').map((j) => j.vehicleId)), [facility.journeys]);

  useFrame(() => {
    const now = Date.now();
    const d = { entry: false, exit: false, entrySensor: false, exitSensor: false };
    for (const { journey, plan } of plans) {
      const t = now - journey.startedAt;
      if (t >= plan.gate.from && t <= plan.gate.to) d[plan.gate.side] = true;
      if (t >= plan.sensor.from && t <= plan.sensor.to) d[plan.gate.side === 'entry' ? 'entrySensor' : 'exitSensor'] = true;
    }
    demand.current = d;
  });

  return (
    <group>
      <Site />
      {Array.from({ length: capacity }, (_, i) => (
        <Bay key={i} index={i} capacity={capacity} occupied={!!facility.bays[i]} known={known} labels={labels} />
      ))}
      <Gate side="entry" reported={gates.entry} demand={demand} />
      <Gate side="exit" reported={gates.exit} demand={demand} />
      {facility.bays.map((o, i) =>
        o && !arriving.has(o.vehicleId) ? <ParkedCar key={o.vehicleId} x={bayX(i, capacity)} palette={o.palette} /> : null,
      )}
      {plans.map(({ journey, plan }) => (
        <MovingCar key={journey.id} journey={journey} plan={plan} />
      ))}
    </group>
  );
}

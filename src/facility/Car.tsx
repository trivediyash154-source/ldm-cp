import { RoundedBox } from '@react-three/drei';
import { forwardRef, useMemo } from 'react';
import { MeshStandardMaterial, type Group } from 'three';
import { CAR_PALETTE } from './palette';

const glass = new MeshStandardMaterial({ color: '#0b1a30', metalness: 0.6, roughness: 0.12 });
const tyre = new MeshStandardMaterial({ color: '#111821', roughness: 0.85 });
const rim = new MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.7, roughness: 0.35 });
const headlight = new MeshStandardMaterial({ color: '#fff4d8', emissive: '#fff1cc', emissiveIntensity: 1.6 });
const taillight = new MeshStandardMaterial({ color: '#ff5a40', emissive: '#ff3b26', emissiveIntensity: 1.2 });

const WHEELS: [number, number][] = [
  [0.84, 1.32],
  [-0.84, 1.32],
  [0.84, -1.3],
  [-0.84, -1.3],
];

/** An anonymous low-poly hatchback, ~4.1 m long, nose toward +z. */
export const Car = forwardRef<Group, { palette: number; opacity?: number }>(function Car({ palette }, ref) {
  const paint = useMemo(
    () => new MeshStandardMaterial({ color: CAR_PALETTE[palette % CAR_PALETTE.length], metalness: 0.35, roughness: 0.38 }),
    [palette],
  );
  return (
    <group ref={ref}>
      <RoundedBox args={[1.78, 0.62, 4.08]} radius={0.2} smoothness={3} position={[0, 0.62, 0]} material={paint} castShadow />
      <RoundedBox args={[1.56, 0.5, 2.2]} radius={0.2} smoothness={3} position={[0, 1.12, -0.25]} material={glass} castShadow />
      <mesh position={[0, 1.38, -0.25]} material={paint} castShadow>
        <boxGeometry args={[1.4, 0.06, 1.9]} />
      </mesh>
      {WHEELS.map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0.36, z]} rotation={[0, 0, Math.PI / 2]}>
          <mesh material={tyre}>
            <cylinderGeometry args={[0.36, 0.36, 0.26, 18]} />
          </mesh>
          <mesh material={rim} position={[0, x > 0 ? 0.135 : -0.135, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 12]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0.58, 0.72, 2.04]} material={headlight}>
        <boxGeometry args={[0.38, 0.12, 0.04]} />
      </mesh>
      <mesh position={[-0.58, 0.72, 2.04]} material={headlight}>
        <boxGeometry args={[0.38, 0.12, 0.04]} />
      </mesh>
      <mesh position={[0.6, 0.78, -2.04]} material={taillight}>
        <boxGeometry args={[0.34, 0.1, 0.04]} />
      </mesh>
      <mesh position={[-0.6, 0.78, -2.04]} material={taillight}>
        <boxGeometry args={[0.34, 0.1, 0.04]} />
      </mesh>
    </group>
  );
});

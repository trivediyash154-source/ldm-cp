import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { FacilityScene, type FacilitySceneProps } from './FacilityScene';

export interface Facility3DHandle {
  resetCamera(): void;
}

/** The interactive WebGL facility. Loaded lazily; see FacilityStage for the fallback. */
const Facility3D = forwardRef<Facility3DHandle, FacilitySceneProps & { compact: boolean }>(function Facility3D(
  { compact, ...scene },
  ref,
) {
  const controls = useRef<OrbitControlsImpl>(null);
  useImperativeHandle(ref, () => ({
    resetCamera: () => controls.current?.reset(),
  }));
  useEffect(() => {
    // Remember the initial view so "reset camera" returns to it.
    const id = requestAnimationFrame(() => controls.current?.saveState());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: compact ? [0, 17, 19.5] : [5, 17.5, 21.5], fov: compact ? 40 : 42, near: 0.5, far: 200 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      aria-label="3D view of the parking facility"
      role="img"
    >
      <color attach="background" args={['#0a1a33']} />
      <fog attach="fog" args={['#0a1a33', 38, 80]} />
      <hemisphereLight args={['#cdeee9', '#13294d', 1.05]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        position={[-14, 22, 12]}
        intensity={2.1}
        color="#ffe9c9"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[16, 10, -10]} intensity={0.45} color="#7fd6cf" />
      <FacilityScene {...scene} />
      <OrbitControls
        ref={controls}
        target={[0, 0, -1.2]}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        enableZoom={!compact}
        minDistance={14}
        maxDistance={58}
        minPolarAngle={0.25}
        maxPolarAngle={1.32}
      />
    </Canvas>
  );
});

export default Facility3D;

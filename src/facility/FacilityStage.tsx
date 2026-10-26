import { Component, lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { useActive, useEngine, useFacility } from '../app/context';
import { selectOccupancy } from '../core/selectors';
import { Icon } from '../ui/Icon';
import type { Facility3DHandle } from './Facility3D';
import { Facility2D } from './Facility2D';

const Facility3D = lazy(() => import('./Facility3D'));

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

class WebGLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const STATE_NOTE: Record<string, string> = {
  stale: 'Telemetry is stale — showing the last accepted state.',
  offline: 'Disconnected — showing the last known state.',
  waiting: 'Waiting for the first reading of this session.',
  none: 'No reading yet — connect the Arduino to populate the bays.',
};

/**
 * The facility, in 3D when WebGL works and as a 2D plan otherwise. The bays
 * always reflect the validated occupancy of the active source.
 */
export function FacilityStage({ compact = false }: { compact?: boolean }) {
  const { facility: tracker } = useActive();
  const facility = useFacility(tracker);
  const view = useEngine(selectOccupancy);
  const gates = useEngine((s) => s.gates);
  const [mode, setMode] = useState<'3d' | '2d'>(() => (webglAvailable() ? '3d' : '2d'));
  const canvas = useRef<Facility3DHandle>(null);
  const known = view.validity === 'valid';
  const props = { facility, capacity: view.capacity, known, gates };
  const plan = <Facility2D {...props} />;

  const note =
    view.validity === 'out-of-range'
      ? `Counter reads ${view.reading?.raw} — not a valid occupancy. Bays keep the last valid layout.`
      : STATE_NOTE[view.freshness];

  return (
    <div className={`stage ${compact ? 'stage-compact' : 'stage-full'} ${view.freshness !== 'live' || !known ? 'stage-dim' : ''}`}>
      <div className="stage-canvas">
        {mode === '3d' ? (
          <WebGLBoundary fallback={plan}>
            <Suspense fallback={plan}>
              <Facility3D ref={canvas} compact={compact} labels={!compact} {...props} />
            </Suspense>
          </WebGLBoundary>
        ) : (
          plan
        )}
      </div>
      {note && (
        <p className="stage-note" role="note">
          <Icon name="info" size={15} /> {note}
        </p>
      )}
      <div className="stage-tools">
        <div className="stage-legend" aria-hidden="true">
          <span className="legend-free">Free</span>
          <span className="legend-taken">Occupied</span>
        </div>
        {!compact && mode === '3d' && (
          <button className="btn btn-glass btn-small" onClick={() => canvas.current?.resetCamera()}>
            <Icon name="camera" size={15} /> Reset view
          </button>
        )}
        {!compact && (
          <button
            className="btn btn-glass btn-small"
            onClick={() => setMode(mode === '3d' ? '2d' : '3d')}
            disabled={mode === '2d' && !webglAvailable()}
            title={mode === '2d' && !webglAvailable() ? 'WebGL is not available in this browser' : undefined}
          >
            <Icon name="layers" size={15} /> {mode === '3d' ? '2D plan' : '3D view'}
          </button>
        )}
      </div>
    </div>
  );
}

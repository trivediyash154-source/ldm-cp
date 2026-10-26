import { useEngine } from '../app/context';
import { selectOccupancy } from '../core/selectors';
import { FacilityStage } from '../facility/FacilityStage';
import { FreshnessLine } from '../ui/Occupancy';

export function FacilityView() {
  const view = useEngine(selectOccupancy);
  const protocol = useEngine((s) => s.protocol);
  return (
    <div className="view view-facility">
      <div className="facility-head">
        <div>
          <p className="eyebrow eyebrow-dark">
            {view.occupancy === null ? 'Occupancy unknown' : `${view.occupancy} of ${view.capacity} bays occupied`}
          </p>
          <FreshnessLine view={view} />
        </div>
        <p className="facility-hint">Drag to orbit · scroll to zoom</p>
      </div>
      <FacilityStage />
      <section className="prose-grid" aria-label="How the facility view works">
        <div>
          <h2 className="section-title">What is real here</h2>
          <p>
            The <strong>number of occupied bays</strong> always equals the counter value the Arduino reports, validated
            against the capacity of {view.capacity}. When the reading is stale, disconnected or out of range, the scene
            dims and says so instead of guessing.
          </p>
        </div>
        <div>
          <h2 className="section-title">What is a model</h2>
          <p>
            The hardware counts vehicles; it does not know <em>which</em> bay a car uses or which car leaves. Vehicles are
            anonymous. An arrival takes the lowest-numbered free bay, and a departure releases the vehicle parked longest.
          </p>
        </div>
        <div>
          <h2 className="section-title">When cars move</h2>
          <p>
            A car drives in or out only for an identified event —{' '}
            {protocol === 'v2' ? 'reported by firmware v2 and confirmed by the counter' : 'with firmware v1, a ±1 counter step right after a gate-length pause in the telemetry'}
            . The animation starts when the event is identified, about 2 s after the physical gate opened. Unexplained
            counter changes update the bays without a journey.
          </p>
        </div>
      </section>
    </div>
  );
}

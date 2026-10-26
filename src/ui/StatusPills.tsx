import { useEngine } from '../app/context';
import { selectCounterHealth, selectTelemetryQuality } from '../core/selectors';
import { counterText, linkText, telemetryText, type Tone } from './status';

export function Pill({ label, value, tone, title }: { label: string; value: string; tone: Tone; title?: string }) {
  return (
    <span className={`pill tone-${tone}`} title={title}>
      <span className="pill-dot" aria-hidden="true" />
      <span className="pill-label">{label}</span>
      <span className="pill-value">{value}</span>
    </span>
  );
}

/** Three independent indicators: the USB link, the data stream, and the counter value. */
export function StatusPills() {
  const link = useEngine((s) => s.link.status);
  const telemetry = useEngine(selectTelemetryQuality);
  const counter = useEngine(selectCounterHealth);
  const source = useEngine((s) => s.source);
  return (
    <div className="pills" role="status" aria-live="polite">
      <Pill label={source === 'live' ? 'USB' : 'Sim link'} value={linkText[link].label} tone={source === 'simulation' && link === 'connected' ? 'sim' : linkText[link].tone} />
      <Pill label="Telemetry" value={telemetryText[telemetry].label} tone={telemetryText[telemetry].tone} title={telemetryText[telemetry].explain} />
      <Pill label="Counter" value={counterText[counter].label} tone={counterText[counter].tone} title={counterText[counter].explain} />
    </div>
  );
}

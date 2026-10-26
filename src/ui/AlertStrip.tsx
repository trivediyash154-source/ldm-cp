import { useActive, useEngine } from '../app/context';
import { formatTime } from '../app/format';
import { selectTelemetryQuality } from '../core/selectors';
import { Icon } from './Icon';

/** Conditions that need attention, shown above every view. */
export function AlertStrip() {
  const { store } = useActive();
  const link = useEngine((s) => s.link);
  const discrepancy = useEngine((s) => s.discrepancy);
  const quality = useEngine(selectTelemetryQuality);
  const lastInvalid = useEngine((s) => s.lastInvalid);
  const source = useEngine((s) => s.source);

  const alerts = [];
  if (source === 'live' && link.status === 'unsupported') {
    alerts.push(
      <div className="alert tone-bad" key="unsupported">
        <Icon name="ban" />
        <div>
          <strong>Live hardware is unavailable in this browser.</strong> {link.error} Simulation mode still works.
        </div>
      </div>,
    );
  } else if (source === 'live' && link.status === 'disconnected' && link.error) {
    alerts.push(
      <div className="alert tone-warn" key="error">
        <Icon name="alert" />
        <div>
          <strong>Could not connect.</strong> {link.error}
        </div>
      </div>,
    );
  }
  if (discrepancy) {
    alerts.push(
      <div className="alert tone-bad" key="discrepancy">
        <Icon name="alert" />
        <div>
          <strong>Counter discrepancy · {formatTime(discrepancy.at)}.</strong> {discrepancy.message} The display shows
          the hardware value as reported; it has not been corrected.
        </div>
        <button className="btn btn-small btn-quiet" onClick={() => store.dispatch({ type: 'acknowledge' })}>
          Acknowledge
        </button>
      </div>,
    );
  }
  if (quality === 'invalid' && lastInvalid) {
    alerts.push(
      <div className="alert tone-warn" key="invalid">
        <Icon name="alert" />
        <div>
          <strong>Unusable data.</strong> Last line: <code>{lastInvalid.text.slice(0, 80)}</code> — {lastInvalid.reason}.
        </div>
      </div>,
    );
  }
  if (alerts.length === 0) return null;
  return <div className="alerts">{alerts}</div>;
}

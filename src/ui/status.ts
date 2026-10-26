import type { CounterHealth, Freshness, TelemetryQuality } from '../core/selectors';
import type { LinkStatus } from '../core/types';

export type Tone = 'ok' | 'live' | 'warn' | 'bad' | 'idle' | 'sim';

export const linkText: Record<LinkStatus, { label: string; tone: Tone }> = {
  unsupported: { label: 'Unavailable', tone: 'bad' },
  disconnected: { label: 'Disconnected', tone: 'idle' },
  connecting: { label: 'Connecting…', tone: 'warn' },
  connected: { label: 'Connected', tone: 'ok' },
  disconnecting: { label: 'Disconnecting…', tone: 'warn' },
};

export const telemetryText: Record<TelemetryQuality, { label: string; tone: Tone; explain: string }> = {
  unsupported: { label: 'Unavailable', tone: 'bad', explain: 'This browser cannot open serial ports.' },
  offline: { label: 'No link', tone: 'idle', explain: 'No serial connection, so no data is arriving.' },
  connecting: { label: 'Opening port', tone: 'warn', explain: 'Waiting for the browser to open the port.' },
  waiting: { label: 'Waiting', tone: 'warn', explain: 'Connected; waiting for the first valid telemetry line (the Uno restarts when the port opens).' },
  live: { label: 'Live', tone: 'live', explain: 'Valid telemetry is arriving about every 100 ms.' },
  stale: { label: 'Stale', tone: 'warn', explain: 'The port is open but no valid line has arrived for over 4 s.' },
  invalid: { label: 'Invalid', tone: 'bad', explain: 'Recent lines could not be parsed as parking telemetry.' },
};

export const counterText: Record<CounterHealth, { label: string; tone: Tone; explain: string }> = {
  unknown: { label: 'No reading', tone: 'idle', explain: 'No counter value has been accepted yet.' },
  ok: { label: 'Consistent', tone: 'ok', explain: 'The counter value is within 0–5 and agrees with the events seen.' },
  'out-of-range': { label: 'Out of range', tone: 'bad', explain: 'The counter shows 6 or 7, which cannot be a valid occupancy for 5 spaces.' },
  discrepancy: { label: 'Discrepancy', tone: 'bad', explain: 'A gate event and the counter disagree. See the alert for details.' },
  unstable: { label: 'Unstable', tone: 'warn', explain: 'Readings flicker between values, which points to a loose or floating Q wire.' },
};

export const freshnessText: Record<Freshness, { label: string; tone: Tone }> = {
  live: { label: 'Live', tone: 'live' },
  stale: { label: 'Stale', tone: 'warn' },
  waiting: { label: 'Waiting for data', tone: 'warn' },
  offline: { label: 'Last known · disconnected', tone: 'idle' },
  none: { label: 'No reading', tone: 'idle' },
};

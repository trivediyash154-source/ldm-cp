import { formatTime } from '../app/format';
import type { EventBasis, EventKind, ParkingEvent } from '../core/types';
import { Icon, type IconName } from './Icon';

const KIND_ICON: Record<EventKind, IconName> = {
  entry: 'arrowIn',
  exit: 'arrowOut',
  'entry-denied': 'ban',
  'exit-denied': 'ban',
  counter: 'counter',
  link: 'usb',
  firmware: 'chip',
  telemetry: 'diagnostics',
};

export const BASIS_LABEL: Record<EventBasis, { label: string; explain: string }> = {
  confirmed: { label: 'Confirmed', explain: 'Reported by the firmware and matched by the counter.' },
  inferred: { label: 'Inferred', explain: 'Deduced from a ±1 counter step right after a gate-length telemetry pause (firmware v1).' },
  unconfirmed: { label: 'Not matched', explain: 'Reported by the firmware, but the counter did not change as expected.' },
  reported: { label: 'Reported', explain: 'Reported by the firmware; the counter is not expected to change.' },
  observed: { label: 'Observed', explain: 'Seen directly by the app.' },
};

export function BasisBadge({ basis }: { basis: EventBasis }) {
  return (
    <span className={`basis basis-${basis}`} title={BASIS_LABEL[basis].explain}>
      {BASIS_LABEL[basis].label}
    </span>
  );
}

export function EventItem({ event, compact = false }: { event: ParkingEvent; compact?: boolean }) {
  const change =
    event.before !== null && event.after !== null && event.before !== event.after
      ? `${event.before} → ${event.after}`
      : event.after !== null && event.before === null
        ? `= ${event.after}`
        : null;
  return (
    <li className={`event sev-${event.severity} kind-${event.kind}`}>
      <span className="event-icon" aria-hidden="true">
        <Icon name={KIND_ICON[event.kind]} size={16} />
      </span>
      <div className="event-body">
        <div className="event-head">
          <span className="event-title">{event.title}</span>
          {(event.kind === 'entry' || event.kind === 'exit' || event.basis !== 'observed') && <BasisBadge basis={event.basis} />}
        </div>
        {!compact && event.detail && <p className="event-detail">{event.detail}</p>}
      </div>
      <div className="event-meta">
        <time dateTime={new Date(event.at).toISOString()}>{formatTime(event.at)}</time>
        {change && <span className="event-change">{change}</span>}
      </div>
    </li>
  );
}

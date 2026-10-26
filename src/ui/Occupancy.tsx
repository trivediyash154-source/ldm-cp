import { useNow } from '../app/context';
import { formatAge, formatTime } from '../app/format';
import type { OccupancyView } from '../core/selectors';
import type { Reading } from '../core/types';
import { freshnessText } from './status';

const BIT_META = [
  { name: 'Q2', pin: 'D9', weight: 4, chip: '74LS74 #2 · pin 5' },
  { name: 'Q1', pin: 'D8', weight: 2, chip: '74LS74 #1 · pin 9' },
  { name: 'Q0', pin: 'D7', weight: 1, chip: '74LS74 #1 · pin 5' },
] as const;

/** The three flip-flop outputs exactly as the Arduino read them, and their decimal value. */
export function BinaryRegister({ reading, tone = 'dark' }: { reading: Reading | null; tone?: 'dark' | 'light' }) {
  return (
    <figure className={`register register-${tone}`} aria-label="Counter flip-flop outputs">
      <div className="register-cells">
        {BIT_META.map((meta, i) => {
          const bit = reading ? reading.bits[i] : null;
          return (
            <div key={meta.name} className={`bit ${bit === 1 ? 'bit-on' : bit === 0 ? 'bit-off' : 'bit-none'}`} title={meta.chip}>
              <span className="bit-name">{meta.name}</span>
              <span className="bit-led" aria-hidden="true" />
              <span className="bit-value">{bit ?? '–'}</span>
              <span className="bit-pin">
                {meta.pin} · ×{meta.weight}
              </span>
            </div>
          );
        })}
      </div>
      <figcaption className="register-formula">
        {reading ? (
          <>
            4·{reading.bits[0]} + 2·{reading.bits[1]} + 1·{reading.bits[2]} = <strong>{reading.raw}</strong>
          </>
        ) : (
          'No reading'
        )}
      </figcaption>
    </figure>
  );
}

/** One segment per parking space; filled segments are occupied. */
export function SlotMeter({ view }: { view: OccupancyView }) {
  const occupied = view.occupancy ?? 0;
  return (
    <div
      className={`slots ${view.validity !== 'valid' ? 'slots-unknown' : ''}`}
      role="img"
      aria-label={view.occupancy === null ? 'Occupancy unknown' : `${occupied} of ${view.capacity} spaces occupied`}
    >
      {Array.from({ length: view.capacity }, (_, i) => (
        <span key={i} className={`slot ${view.validity === 'valid' && i < occupied ? 'slot-taken' : 'slot-free'}`} />
      ))}
    </div>
  );
}

/** Source and age of the displayed reading. */
export function FreshnessLine({ view, linkSince }: { view: OccupancyView; linkSince?: number | null }) {
  const now = useNow(500);
  const meta = freshnessText[view.freshness];
  let detail = '';
  if (view.reading) {
    if (view.freshness === 'live') detail = `accepted ${formatAge(now - view.reading.at)}`;
    else if (view.freshness === 'stale') detail = `last valid reading ${formatAge(now - view.reading.at)}`;
    else if (view.freshness === 'offline') detail = `read at ${formatTime(view.reading.at)}`;
    else if (view.freshness === 'waiting') detail = `previous session's value from ${formatTime(view.reading.at)}`;
  } else if (view.freshness === 'waiting' && linkSince) {
    detail = `port open for ${Math.max(0, Math.round((now - linkSince) / 1000))} s`;
  }
  return (
    <p className={`freshness tone-${meta.tone}`}>
      <span className="freshness-dot" aria-hidden="true" />
      <span>{meta.label}</span>
      {detail && <span className="freshness-detail">· {detail}</span>}
    </p>
  );
}

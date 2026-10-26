import { useMemo, useState } from 'react';
import { useActive, useEngine, useNow } from '../app/context';
import { formatDateTime, formatDuration, formatPercent, formatTime } from '../app/format';
import { summarize } from '../core/analytics';
import type { OccupancySample } from '../core/types';
import { ColumnChart, OccupancyChart } from '../ui/charts';

const PERIODS = {
  hour: { label: 'Last hour', ms: 3_600_000 },
  day: { label: 'Last 24 hours', ms: 86_400_000 },
  week: { label: 'Last 7 days', ms: 7 * 86_400_000 },
  all: { label: 'All recorded', ms: Infinity },
} as const;
type PeriodKey = keyof typeof PERIODS;

/** Samples inside the window, with the value in force at the window start carried in. */
function clipSamples(samples: OccupancySample[], from: number): OccupancySample[] {
  const inside = samples.filter((s) => s.at >= from);
  const before = samples.filter((s) => s.at < from).at(-1);
  return before ? [{ ...before, at: from }, ...inside] : inside;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {note && <span className="stat-note">{note}</span>}
      </dd>
    </div>
  );
}

export function Insights() {
  const { mode } = useActive();
  const events = useEngine((s) => s.events);
  const samples = useEngine((s) => s.samples);
  const capacity = useEngine((s) => s.capacity);
  const liveNow = useEngine((s) => s.link.status === 'connected' && !s.stale && s.acceptedSession === s.session.id);
  const now = useNow(5000);
  const [period, setPeriod] = useState<PeriodKey>('day');
  const [table, setTable] = useState(false);

  const firstAt = samples[0]?.at ?? events[0]?.at ?? now;
  const from = Number.isFinite(PERIODS[period].ms) ? now - PERIODS[period].ms : firstAt;
  const windowed = useMemo(() => {
    const ev = events.filter((e) => e.at >= from);
    const sm = clipSamples(samples, from);
    return { events: ev, samples: sm, summary: summarize(ev, sm, capacity, now, liveNow) };
  }, [events, samples, from, capacity, now, liveNow]);
  const { summary } = windowed;
  // The chart starts where recorded data starts, so a short session is not squeezed against the right edge.
  const firstInWindow = Math.min(windowed.samples[0]?.at ?? now, windowed.events[0]?.at ?? now);
  const chartFrom = Math.min(Math.max(from, firstInWindow), now - 60_000);
  const hourLabels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  const hasData = windowed.samples.length > 0 || windowed.events.length > 0;

  return (
    <div className="view view-insights">
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Reporting period">
          {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
            <button key={key} className={`chip ${period === key ? 'is-on' : ''}`} aria-pressed={period === key} onClick={() => setPeriod(key)}>
              {PERIODS[key].label}
            </button>
          ))}
        </div>
        <p className="muted toolbar-note">
          {mode === 'live' ? 'Recorded live history in this browser' : 'Simulation session only'} · {formatDateTime(from)} – {formatTime(now)}
        </p>
      </div>

      {!hasData ? (
        <div className="empty-block">
          <p>No recorded history in this period. Analytics are built only from readings and events actually received.</p>
        </div>
      ) : (
        <>
          <dl className="stats">
            <Stat label="Entries" value={String(summary.entries.total)} note={`${summary.entries.confirmed} confirmed · ${summary.entries.inferred} inferred${summary.entries.unconfirmed ? ` · ${summary.entries.unconfirmed} not matched` : ''}`} />
            <Stat label="Exits" value={String(summary.exits.total)} note={`${summary.exits.confirmed} confirmed · ${summary.exits.inferred} inferred${summary.exits.unconfirmed ? ` · ${summary.exits.unconfirmed} not matched` : ''}`} />
            <Stat label="Refused at the gate" value={String(summary.denied.entry + summary.denied.exit)} note={`${summary.denied.entry} entry · ${summary.denied.exit} exit (v2 only)`} />
            <Stat label="Peak occupancy" value={summary.peak ? `${summary.peak.occupancy} / ${capacity}` : '—'} note={summary.peak ? `first at ${formatDateTime(summary.peak.at)}` : undefined} />
            <Stat label="Average utilization" value={formatPercent(summary.averageUtilization)} note="time-weighted, observed time only" />
            <Stat label="Time full" value={formatPercent(summary.fullShare)} note="share of observed time" />
            <Stat label="Observed time" value={formatDuration(summary.observedMs)} note="with a valid reading" />
            <Stat label="Discrepancies" value={String(summary.discrepancies)} note="counter vs. events / out-of-range" />
          </dl>

          <section className="chart-block" aria-labelledby="occ-title">
            <div className="section-head">
              <h2 className="section-title" id="occ-title">
                Occupancy over time
              </h2>
              <button className="btn btn-quiet btn-small" onClick={() => setTable(!table)} aria-expanded={table}>
                {table ? 'Hide table' : 'Show as table'}
              </button>
            </div>
            <p className="muted">
              Counter value accepted from telemetry, {formatDateTime(chartFrom)} – {formatTime(now)}. Breaks mark time without a valid reading.
            </p>
            <OccupancyChart samples={windowed.samples} from={chartFrom} to={now} capacity={capacity} />
            {table && (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Occupancy</th>
                      <th scope="col">Raw counter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windowed.samples.slice(-200).reverse().map((s) => (
                      <tr key={`${s.at}-${s.raw}`}>
                        <td>{formatDateTime(s.at)}</td>
                        <td>{s.occupancy ?? '—'}</td>
                        <td className="mono">{s.raw ?? 'no data'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="chart-block" aria-labelledby="hour-title">
            <h2 className="section-title" id="hour-title">
              Entries by hour of day
            </h2>
            <p className="muted">Confirmed and inferred entries in the selected period.</p>
            <ColumnChart values={summary.entriesByHour} labels={hourLabels} label="Entries by hour of day" />
            <details className="table-details">
              <summary>Show as table</summary>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Hour</th>
                    <th scope="col">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.entriesByHour.map((v, h) => (
                    <tr key={h}>
                      <td>{hourLabels[h]}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        </>
      )}
    </div>
  );
}

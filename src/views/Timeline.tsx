import { useMemo, useState } from 'react';
import { useActive, useEngine } from '../app/context';
import { formatDate } from '../app/format';
import { clearStoredHistory, eventsToCsv } from '../core/persistence';
import type { ParkingEvent } from '../core/types';
import { EventItem } from '../ui/EventItem';
import { Icon } from '../ui/Icon';

const FILTERS = {
  all: { label: 'All', test: () => true },
  vehicles: { label: 'Vehicles', test: (e: ParkingEvent) => e.kind === 'entry' || e.kind === 'exit' },
  refused: { label: 'Refused', test: (e: ParkingEvent) => e.kind === 'entry-denied' || e.kind === 'exit-denied' },
  problems: { label: 'Problems', test: (e: ParkingEvent) => e.severity === 'warning' || e.severity === 'error' },
  system: { label: 'Connection & data', test: (e: ParkingEvent) => e.kind === 'link' || e.kind === 'telemetry' || e.kind === 'firmware' || e.kind === 'counter' },
} as const;

type FilterKey = keyof typeof FILTERS;

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Timeline() {
  const { mode, store } = useActive();
  const events = useEngine((s) => s.events);
  const protocol = useEngine((s) => s.protocol);
  const [filter, setFilter] = useState<FilterKey>('all');

  const groups = useMemo(() => {
    const list = events.filter(FILTERS[filter].test).slice().sort((a, b) => b.at - a.at);
    const byDay = new Map<string, ParkingEvent[]>();
    for (const e of list) {
      const key = formatDate(e.at);
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
    return [...byDay.entries()];
  }, [events, filter]);

  const clear = () => {
    const what = mode === 'live' ? 'the live event history stored in this browser' : 'the simulation history';
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    if (mode === 'live') clearStoredHistory();
    store.dispatch({ type: 'clear-history', at: Date.now() });
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return (
    <div className="view view-timeline">
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter events">
          {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
            <button key={key} className={`chip ${filter === key ? 'is-on' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {FILTERS[key].label}
              <span className="chip-count">{events.filter(FILTERS[key].test).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-quiet btn-small" disabled={events.length === 0} onClick={() => download(`parking-events-${mode}-${stamp}.csv`, 'text/csv', eventsToCsv(events))}>
            <Icon name="download" size={15} /> CSV
          </button>
          <button className="btn btn-quiet btn-small" disabled={events.length === 0} onClick={() => download(`parking-events-${mode}-${stamp}.json`, 'application/json', JSON.stringify(events, null, 2))}>
            <Icon name="download" size={15} /> JSON
          </button>
          <button className="btn btn-quiet btn-small btn-danger" disabled={events.length === 0} onClick={clear}>
            <Icon name="trash" size={15} /> Clear
          </button>
        </div>
      </div>

      <p className="muted timeline-note">
        {mode === 'live'
          ? 'Live history is kept in this browser only (localStorage). '
          : 'Simulation history exists only until the page is closed. '}
        {protocol === 'v1' && 'Firmware v1 does not report gate events, so vehicle entries and exits are inferred from the counter. '}
        Repeated identical readings never create events.
      </p>

      {groups.length === 0 ? (
        <div className="empty-block">
          <Icon name="timeline" size={28} />
          <p>{events.length === 0 ? 'No events recorded yet.' : 'No events match this filter.'}</p>
        </div>
      ) : (
        groups.map(([day, list]) => (
          <section key={day} className="day">
            <h2 className="day-title">{day}</h2>
            <ul className="events">
              {list.map((e) => (
                <EventItem key={e.id} event={e} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

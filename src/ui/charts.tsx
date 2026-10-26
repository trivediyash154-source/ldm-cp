import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { formatDateTime, formatTime } from '../app/format';
import type { OccupancySample } from '../core/types';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function Tooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div className="tooltip" style={{ left, top: y }} role="presentation">
      {children}
    </div>
  );
}

/**
 * Occupancy over time as a step line (the counter holds its value between
 * changes). Gaps (disconnected, invalid readings) break the line.
 */
export function OccupancyChart({ samples, from, to, capacity }: { samples: OccupancySample[]; from: number; to: number; capacity: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 30, left: 34 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const span = Math.max(1, to - from);
  const x = (t: number) => pad.left + ((t - from) / span) * w;
  const y = (v: number) => pad.top + h - (v / capacity) * h;

  // Build step segments; a null occupancy ends a segment.
  const segments: { points: [number, number][] }[] = [];
  let current: [number, number][] | null = null;
  samples.forEach((s, i) => {
    const end = i + 1 < samples.length ? samples[i + 1].at : to;
    if (s.occupancy === null) {
      current = null;
      return;
    }
    if (!current) {
      current = [];
      segments.push({ points: current });
    }
    const x0 = x(Math.max(s.at, from));
    const x1 = x(Math.min(end, to));
    current.push([x0, y(s.occupancy)], [x1, y(s.occupancy)]);
  });

  const ticks = Array.from({ length: capacity + 1 }, (_, v) => v);
  const timeTicks = Array.from({ length: 5 }, (_, i) => from + (span * i) / 4);
  const valueAt = (t: number) => {
    let found: OccupancySample | null = null;
    for (const s of samples) if (s.at <= t) found = s;
    return found;
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = from + ((e.clientX - box.left) / box.width) * span;
    setHover(Math.min(to, Math.max(from, t)));
  };
  const hovered = hover !== null ? valueAt(hover) : null;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Occupancy over time">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.left - 10} y={y(v) + 4} className="axis" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {timeTicks.map((t, i) => (
          <text key={t} x={x(t)} y={height - 8} className="axis" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>
            {span > 86_400_000 ? formatDateTime(t) : formatTime(t)}
          </text>
        ))}
        {segments.map((seg, i) => {
          const d = seg.points.map(([px, py], j) => `${j === 0 ? 'M' : 'L'}${px},${py}`).join(' ');
          const first = seg.points[0];
          const last = seg.points[seg.points.length - 1];
          return (
            <g key={i}>
              <path d={`${d} L${last[0]},${y(0)} L${first[0]},${y(0)} Z`} className="area" />
              <path d={d} className="line" />
            </g>
          );
        })}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} className="crosshair" />
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} y={pad.top} width={width}>
          <strong>{hovered?.occupancy ?? '—'}</strong>
          <span>{hovered ? (hovered.occupancy === null ? (hovered.raw === null ? 'no data' : `invalid (raw ${hovered.raw})`) : `of ${capacity} occupied`) : 'no data'}</span>
          <span className="tooltip-time">{formatDateTime(hover)}</span>
        </Tooltip>
      )}
    </div>
  );
}

/** Column chart; one bar per category, value on hover and in the table view. */
export function ColumnChart({ values, labels, label }: { values: number[]; labels: string[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 200;
  const pad = { top: 14, right: 8, bottom: 28, left: 30 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...values);
  const niceMax = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const band = w / values.length;
  const barW = Math.min(24, band - 2);
  const y = (v: number) => pad.top + h - (v / niceMax) * h;
  const ticks = niceMax <= 4 ? Array.from({ length: niceMax + 1 }, (_, i) => i) : [0, niceMax / 2, niceMax];

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.left - 8} y={y(v) + 4} className="axis" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = pad.left + band * i + band / 2;
          const top = y(v);
          const barH = pad.top + h - top;
          const r = Math.min(4, barH);
          return (
            <g key={i}>
              {v > 0 && (
                <path
                  className={`bar ${hover === i ? 'is-hover' : ''}`}
                  d={`M${cx - barW / 2},${pad.top + h} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${pad.top + h} Z`}
                />
              )}
              {i % 3 === 0 && (
                <text x={cx} y={height - 8} className="axis" textAnchor="middle">
                  {labels[i]}
                </text>
              )}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={h}
                fill="transparent"
                tabIndex={0}
                aria-label={`${labels[i]}: ${v}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip x={pad.left + band * hover + band / 2} y={y(values[hover]) - 8} width={width}>
          <strong>{values[hover]}</strong>
          <span>{labels[hover]}</span>
        </Tooltip>
      )}
    </div>
  );
}

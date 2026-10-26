const PATHS: Record<string, string> = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  facility: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  lab: 'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2zM9.5 9.5h5v5h-5z',
  timeline: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  diagnostics: 'M3 12h4l3-8 4 16 3-8h4',
  usb: 'M12 3v13M12 3l-2.5 3M12 3l2.5 3M8 10v2.5l4 2M16 8.5v2l-4 2.5M12 16a2 2 0 100 4 2 2 0 000-4z',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5',
  unplug: 'M4 4l16 16M9 3v5M15 3v5M7 8h10v3a5 5 0 01-1.2 3.3M12 16v5',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  arrowIn: 'M12 4v12M6 10l6 6 6-6M5 20h14',
  arrowOut: 'M12 20V8M6 14l6-6 6 6M5 4h14',
  ban: 'M5.6 5.6l12.8 12.8M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 16v-4M12 8h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chip: 'M8 8h8v8H8zM5 10h3M5 14h3M16 10h3M16 14h3M10 5v3M14 5v3M10 16v3M14 16v3',
  counter: 'M4 6h16M4 12h16M4 18h16M8 3v18',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  camera: 'M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM12 17a4 4 0 100-8 4 4 0 000 8z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pause: 'M8 5v14M16 5v14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  gate: 'M4 20V9M4 11h16M8 11l2-2M12 11l2-2M16 11l2-2',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  close: 'M6 6l12 12M18 6L6 18',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-9V3M7.5 15h9',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

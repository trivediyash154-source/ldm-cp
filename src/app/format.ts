const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatTime = (at: number) => timeFormat.format(at);
export const formatDate = (at: number) => dateFormat.format(at);
export const formatDateTime = (at: number) => dateTimeFormat.format(at);

export function formatAge(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s ago`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export const formatPercent = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export const bitsLabel = (bits: readonly number[]) => bits.join('');

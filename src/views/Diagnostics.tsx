import { useEffect, useRef, useState } from 'react';
import { useActive, useEngine, useNow } from '../app/context';
import { formatAge, formatDuration, formatTime } from '../app/format';
import { BAUD_RATE, TIMING } from '../config';
import { protocolLabel, selectCounterHealth, selectTelemetryQuality } from '../core/selectors';
import type { EngineState, RawLogEntry } from '../core/types';
import { Icon } from '../ui/Icon';
import { counterText, linkText, telemetryText } from '../ui/status';

function Row({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}

function suggestions(s: EngineState, quality: ReturnType<typeof selectTelemetryQuality>): string[] {
  const out: string[] = [];
  if (s.source === 'live' && s.link.status === 'disconnected' && s.link.error && /busy/i.test(s.link.error)) {
    out.push('Close the Arduino IDE Serial Monitor and Serial Plotter, then connect again. Only one program can open the port.');
  }
  if (quality === 'waiting' && s.session.lines === 0 && s.link.status === 'connected') {
    out.push(`Nothing received yet. Check that the parking sketch is uploaded (Tools → Port in the Arduino IDE) and runs at ${BAUD_RATE} baud.`);
  }
  if (s.lastInvalid && /JSON object/.test(s.lastInvalid.reason)) {
    out.push('Plain-text lines are arriving: a different sketch (for example the servo/IR test sketch) is probably uploaded. Upload parking_counter_v1 or v2.');
  }
  if (s.accepted && s.accepted.raw === 7) {
    out.push('All three Q inputs read HIGH. Join Arduino GND to the breadboard GND rail and check the wires from 74LS74 pins 5/9 (IC #1) and pin 5 (IC #2) to D7/D8/D9.');
  }
  if (s.unstable) out.push('Readings flicker. A Q wire is loose or an input floats; reseat the jumpers to D7, D8 and D9.');
  if (s.totals.discrepancies > 0 && s.events.some((e) => e.kind === 'exit' && e.basis === 'unconfirmed')) {
    out.push('Exits do not lower the counter. The D3 clock-down line does not reach the flip-flop logic (see Hardware Lab → Wiring review).');
  }
  if (s.protocol === 'v1' && s.totals.unexplainedChanges > 0) {
    out.push('The counter changed without a gate sequence. Long or loose clock wires can pick up glitches; keep the D2 wire short.');
  }
  return out;
}

const KIND_LABEL: Record<RawLogEntry['kind'], string> = {
  telemetry: 'telemetry',
  event: 'event',
  boot: 'boot',
  invalid: 'invalid',
  fragment: 'fragment',
  overflow: 'overflow',
  'read-error': 'error',
};

function Console() {
  const log = useEngine((s) => s.rawLog);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<RawLogEntry[]>([]);
  const [hideTelemetry, setHideTelemetry] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = (paused ? frozen : log).filter((l) => !hideTelemetry || l.kind !== 'telemetry').slice(-200);
  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, paused]);
  const copy = () => void navigator.clipboard?.writeText(shown.map((l) => `${new Date(l.at).toISOString()}  ${l.text}`).join('\n'));

  return (
    <section className="console-block" aria-labelledby="console-title">
      <div className="section-head">
        <h2 className="section-title" id="console-title">
          Serial console
        </h2>
        <div className="toolbar-actions">
          <label className="toggle toggle-light">
            <input type="checkbox" checked={hideTelemetry} onChange={(e) => setHideTelemetry(e.target.checked)} />
            <span>Hide telemetry lines</span>
          </label>
          <button
            className="btn btn-quiet btn-small"
            onClick={() => {
              setFrozen(log);
              setPaused(!paused);
            }}
          >
            <Icon name={paused ? 'play' : 'pause'} size={14} /> {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn btn-quiet btn-small" onClick={copy}>
            <Icon name="copy" size={14} /> Copy
          </button>
        </div>
      </div>
      <p className="muted">
        Exactly what arrived on the port (last 200 lines). Use this instead of the Arduino Serial Monitor, which cannot
        share the port with the browser.
      </p>
      <div className="console" ref={box} role="log" aria-live="off" tabIndex={0}>
        {shown.length === 0 ? (
          <p className="console-empty">No data received.</p>
        ) : (
          shown.map((l) => (
            <div key={l.id} className={`console-line k-${l.kind}`}>
              <time>{formatTime(l.at)}</time>
              <span className="console-kind">{KIND_LABEL[l.kind]}</span>
              <code>{l.text}</code>
              {l.note && <span className="console-note">{l.note}</span>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function Diagnostics() {
  const { mode } = useActive();
  const s = useEngine((st) => st);
  const quality = selectTelemetryQuality(s);
  const counter = selectCounterHealth(s);
  const now = useNow(500);
  const session = s.session;
  const connected = s.link.status === 'connected';
  const duration = session.connectedAt ? (connected ? now : (session.endedAt ?? now)) - session.connectedAt : 0;
  // Frames per second over the last 5 s of arrivals (gate sequences pause it briefly).
  const recentFrames = connected ? s.rawLog.filter((l) => l.kind === 'telemetry' && now - l.at <= 5000).length : 0;
  const rate = recentFrames / 5;
  const tips = suggestions(s, quality);

  return (
    <div className="view view-diagnostics">
      <section className="diag-grid">
        <div className={`diag tone-${linkText[s.link.status].tone}`}>
          <h2>
            <Icon name="usb" /> {mode === 'live' ? 'USB link' : 'Simulated link'}
          </h2>
          <p className="diag-state">{linkText[s.link.status].label}</p>
          <dl className="kv">
            <Row label="Port" value={s.link.portLabel ?? '—'} />
            <Row label="Settings" value={`${BAUD_RATE} baud · 8N1`} mono />
            <Row label="Session" value={session.connectedAt ? `${formatTime(session.connectedAt)} · ${formatDuration(duration)}` : '—'} />
            <Row label="Connections since page load" value={s.totals.connections} />
            <Row label="Bytes this session" value={session.bytes.toLocaleString()} />
            {s.link.error && <Row label="Last error" value={s.link.error} />}
          </dl>
        </div>
        <div className={`diag tone-${telemetryText[quality].tone}`}>
          <h2>
            <Icon name="diagnostics" /> Telemetry
          </h2>
          <p className="diag-state">{telemetryText[quality].label}</p>
          <dl className="kv">
            <Row label="Firmware" value={protocolLabel[s.protocol]} />
            <Row label="Last valid frame" value={s.lastFrameAt ? formatAge(now - s.lastFrameAt) : '—'} />
            <Row label="Frame rate (last 5 s)" value={connected && session.frames > 0 ? `${rate.toFixed(1)} / s (expected ≈ 10)` : '—'} />
            <Row label="Browser stalls" value={s.totals.hostStalls} />
            <Row label="Frames · invalid lines" value={`${session.frames} · ${session.invalid}`} />
            <Row label="Longest pause" value={session.maxGapMs ? formatDuration(session.maxGapMs) : '—'} />
            <Row label="Gate-length pauses" value={session.gatePauses} />
            <Row label="Stale episodes" value={s.totals.staleEpisodes} />
            <Row label="Fragments · overflows · read errors" value={`${s.totals.fragments} · ${s.totals.overflows} · ${s.totals.readErrors}`} />
            {s.lastInvalid && <Row label="Last invalid" value={`${s.lastInvalid.reason} (${formatTime(s.lastInvalid.at)})`} />}
          </dl>
        </div>
        <div className={`diag tone-${counterText[counter].tone}`}>
          <h2>
            <Icon name="counter" /> Counter
          </h2>
          <p className="diag-state">{counterText[counter].label}</p>
          <dl className="kv">
            <Row label="Accepted value" value={s.accepted ? `${s.accepted.raw} (${s.accepted.bits.join('')}₂)` : '—'} mono />
            <Row label="Latest frame" value={s.latest ? `${s.latest.raw} (${s.latest.bits.join('')}₂)` : '—'} mono />
            <Row label="Candidate" value={s.candidate ? `${s.candidate.raw} seen ${s.candidate.samples}/${TIMING.confirmSamples}` : 'none'} />
            <Row label="Out-of-range readings" value={s.totals.outOfRange} />
            <Row label="Ignored one-off values" value={s.totals.flickers} />
            <Row label="Unexplained changes" value={s.totals.unexplainedChanges} />
            <Row label="Discrepancies" value={s.totals.discrepancies} />
            <Row label="Pending v2 checks" value={s.pending.length} />
          </dl>
          {s.discrepancy && (
            <div className="diag-alert">
              <p>{s.discrepancy.message}</p>
              <ActiveAck />
            </div>
          )}
        </div>
      </section>

      <section className="tips" aria-labelledby="tips-title">
        <h2 className="section-title" id="tips-title">
          What to check
        </h2>
        {tips.length === 0 ? (
          <p className="muted">Nothing specific right now. Suggestions appear here when the data points to a likely cause.</p>
        ) : (
          <ul>
            {tips.map((t) => (
              <li key={t}>
                <Icon name="alert" size={15} /> {t}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Console />
    </div>
  );
}

function ActiveAck() {
  const { store } = useActive();
  return (
    <button className="btn btn-quiet btn-small" onClick={() => store.dispatch({ type: 'acknowledge' })}>
      Acknowledge
    </button>
  );
}

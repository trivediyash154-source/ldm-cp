import { useState } from 'react';
import { useApp, useStoreSelector } from '../app/context';
import { parseIntelHex } from '../firmware/intelHex';
import { installFirmware } from '../firmware/installer';
import { UploadError, type UploadProgress } from '../firmware/stk500';
import firmwareHex from '../../firmware/build/parking_counter_v2.hex?raw';
import { Icon } from '../ui/Icon';

const FIRMWARE_KB = (parseIntelHex(firmwareHex).data.length / 1024).toFixed(1);

type InstallState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: UploadProgress | null }
  | { phase: 'done'; bytes: number }
  | { phase: 'failed'; message: string };

function progressValue(state: InstallState): number {
  if (state.phase === 'done') return 1;
  if (state.phase !== 'running') return 0;
  const p = state.progress;
  if (!p) return 0;
  if (p.stage === 'sync' || p.stage === 'signature') return 0.03;
  if (p.stage === 'write') return 0.05 + p.fraction * 0.6;
  if (p.stage === 'verify') return 0.65 + p.fraction * 0.35;
  return 1;
}

export function Setup() {
  const { services, setMode } = useApp();
  const { store, session } = services.live;
  const link = useStoreSelector(store, (s) => s.link);
  const protocol = useStoreSelector(store, (s) => s.protocol);
  const [state, setState] = useState<InstallState>({ phase: 'idle' });
  const [log, setLog] = useState<string[]>([]);
  const serial = typeof navigator !== 'undefined' ? navigator.serial : undefined;
  const supported = !!serial && window.isSecureContext;
  const connected = link.status === 'connected';

  const install = async () => {
    if (!serial) return;
    setLog([]);
    setState({ phase: 'running', progress: null });
    const append = (line: string) => setLog((l) => [...l, line]);
    try {
      if (connected) {
        append('Closing the live connection so the installer can use the port…');
        await session.disconnect();
      }
      const result = await installFirmware({
        serial,
        hexText: firmwareHex,
        pick: !connected,
        onProgress: (progress) => setState({ phase: 'running', progress }),
        onLog: append,
      });
      append('Done. The Uno restarted with the new firmware.');
      setState({ phase: 'done', bytes: result.bytes });
    } catch (e) {
      const message = e instanceof UploadError || e instanceof Error ? e.message : String(e);
      append(`Stopped: ${message}`);
      setState({ phase: 'failed', message });
    }
  };

  const running = state.phase === 'running';
  const percent = Math.round(progressValue(state) * 100);
  return (
    <div className="view view-setup">
      <p className="lead">
        Three steps from a USB cable to a live dashboard. Everything here runs in this browser; nothing is installed on the
        computer.
      </p>

      <ol className="steps">
        <li className={`step ${state.phase === 'done' || protocol === 'v2' ? 'is-done' : ''}`}>
          <div className="step-head">
            <span className="step-num">1</span>
            <div>
              <h2>Install the parking firmware on the Uno</h2>
              <p className="muted">
                Uploads <code>parking_counter_v2</code> ({FIRMWARE_KB} kB) through the
                Uno's bootloader, then reads every page back to verify it. Same pins and behaviour as your sketch, plus the
                restart fix and gate-event reporting.
              </p>
            </div>
          </div>
          {!supported ? (
            <p className="note tone-bad">Open this page in Chrome, Edge or Opera on a computer to install firmware.</p>
          ) : (
            <>
              <ul className="checklist">
                <li>Plug the Uno into this computer with its USB cable.</li>
                <li>Close the Arduino IDE (its Serial Monitor would keep the port busy).</li>
              </ul>
              <div className="step-actions">
                <button className="btn btn-primary" onClick={() => void install()} disabled={running}>
                  <Icon name="download" /> {running ? 'Installing…' : state.phase === 'done' ? 'Install again' : 'Install firmware'}
                </button>
                {connected && !running && <span className="muted">The live connection will be closed during the upload.</span>}
              </div>
              {(running || state.phase !== 'idle') && (
                <div className="install">
                  <div className="install-bar" role="progressbar" aria-label="Firmware upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <span className={state.phase === 'failed' ? 'is-failed' : ''} style={{ width: `${state.phase === 'failed' ? 100 : percent}%` }} />
                  </div>
                  <p className="install-status" aria-live="polite">
                    {running ? (state.progress?.message ?? 'Choose the Arduino in the browser dialog…') : state.phase === 'done' ? 'Firmware installed and verified.' : state.phase === 'failed' ? state.message : ''}
                  </p>
                  {log.length > 0 && (
                    <pre className="install-log">
                      {log.map((l) => `› ${l}`).join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </li>

        <li className={`step ${connected ? 'is-done' : ''}`}>
          <div className="step-head">
            <span className="step-num">2</span>
            <div>
              <h2>Connect the dashboard</h2>
              <p className="muted">Opens the port at 9600 baud and starts reading the counter. The Uno restarts and the first reading appears after about 2 s.</p>
            </div>
          </div>
          <div className="step-actions">
            {connected ? (
              <a className="btn btn-quiet" href="#/overview">
                <Icon name="overview" /> Connected — open the overview
              </a>
            ) : (
              <button className="btn btn-primary" disabled={!supported || running} onClick={() => void session.connect(state.phase !== 'done')}>
                <Icon name="usb" /> Connect Arduino
              </button>
            )}
          </div>
        </li>

        <li className="step">
          <div className="step-head">
            <span className="step-num">3</span>
            <div>
              <h2>Check the counter wiring</h2>
              <p className="muted">
                Trigger the entry sensor a few times. The Hardware Lab's counter self-check shows whether each flip-flop
                toggles, and the wiring review lists the fixes for the problems found in the wiring guide (Q1 stuck, exits
                not counted, count stuck at 7).
              </p>
            </div>
          </div>
          <div className="step-actions">
            <a className="btn btn-quiet" href="#/lab">
              <Icon name="lab" /> Open the Hardware Lab
            </a>
            <button className="btn btn-quiet" onClick={() => setMode('simulation')}>
              <Icon name="flask" /> No board here? Try the simulation
            </button>
          </div>
        </li>
      </ol>

      <details className="fallback">
        <summary>Prefer the Arduino IDE?</summary>
        <p>
          Open <code>firmware/parking_counter_v2/parking_counter_v2.ino</code> from the project repository, choose{' '}
          <strong>Tools → Board → Arduino Uno</strong> and the right port, and click Upload. Close the Serial Monitor
          before connecting this dashboard.
        </p>
      </details>
    </div>
  );
}

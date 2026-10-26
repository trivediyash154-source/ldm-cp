import { TIMING } from '../config';
import type { EngineStore } from '../core/store';
import { LineFramer } from '../protocol/framer';
import type { SerialTransport, TransportCallbacks } from './transport';

export type TransportFactory = (callbacks: TransportCallbacks) => SerialTransport;

export interface SessionOptions {
  clock?: () => number;
  /** Set false in tests that drive ticks themselves. */
  autoTick?: boolean;
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null;
}

/**
 * Connects one serial transport to one engine store: frames the incoming
 * text into lines, timestamps them on arrival and forwards link changes.
 * The session never writes to the serial port.
 */
export class SerialSession {
  readonly transport: SerialTransport;
  private readonly framer = new LineFramer();
  private readonly clock: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly doc: SessionOptions['document'];

  constructor(
    private readonly store: EngineStore,
    createTransport: TransportFactory,
    options: SessionOptions = {},
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.doc = options.document !== undefined ? options.document : typeof document !== 'undefined' ? document : null;
    this.transport = createTransport({
      onStatus: (status, detail) => {
        if (status === 'connected' || status === 'disconnected') this.framer.reset();
        this.store.dispatch({
          type: 'link',
          status,
          at: this.clock(),
          error: detail?.error ?? null,
          reason: detail?.reason,
          ...(detail?.portLabel !== undefined ? { portLabel: detail.portLabel } : {}),
        });
      },
      onData: (text, bytes) => this.receive(text, bytes),
      onReadError: (message) => this.store.dispatch({ type: 'read-error', message, at: this.clock() }),
    });
    if (!this.transport.supported) {
      this.store.dispatch({ type: 'link', status: 'unsupported', at: this.clock(), error: this.transport.unsupportedReason });
    }
    if (options.autoTick !== false) {
      this.timer = setInterval(() => this.store.dispatch({ type: 'tick', at: this.clock() }), TIMING.tickMs);
    }
    this.doc?.addEventListener('visibilitychange', this.onVisibility);
    this.onVisibility();
  }

  receive(text: string, bytes = text.length): void {
    const at = this.clock();
    this.store.dispatch({ type: 'bytes', count: bytes });
    for (const item of this.framer.push(text)) {
      if (item.kind === 'line') this.store.dispatch({ type: 'line', text: item.text, at });
      else this.store.dispatch({ type: 'overflow', length: item.length, at });
    }
  }

  connect(pick = true): Promise<void> {
    return this.transport.connect({ pick });
  }

  disconnect(): Promise<void> {
    return this.transport.disconnect();
  }

  private readonly onVisibility = () => {
    if (!this.doc) return;
    this.store.dispatch({ type: 'visibility', hidden: this.doc.visibilityState === 'hidden', at: this.clock() });
  };

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
    this.transport.dispose();
  }
}

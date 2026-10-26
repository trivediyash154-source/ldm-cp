/** The interface the session uses to talk to a serial device. */

export type TransportStatus = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

export interface StatusDetail {
  /** Human-readable reason when a connection attempt failed. */
  error?: string;
  /** Why a connection ended: the user asked, or the device went away. */
  reason?: 'user' | 'lost';
  portLabel?: string;
}

export interface TransportCallbacks {
  onStatus(status: TransportStatus, detail?: StatusDetail): void;
  /** Decoded text and the number of raw bytes it came from. */
  onData(text: string, bytes: number): void;
  /** A recoverable read error (framing, parity, buffer overrun, break). */
  onReadError(message: string): void;
}

export interface SerialTransport {
  readonly supported: boolean;
  /** Why the transport cannot be used here, or null. */
  readonly unsupportedReason: string | null;
  /** pick: show the browser's port chooser; otherwise reuse a port granted earlier. */
  connect(options: { pick: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  /** A previously granted port is available for reconnecting without the chooser. */
  hasKnownPort(): Promise<boolean>;
  dispose(): void;
}

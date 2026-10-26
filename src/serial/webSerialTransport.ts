import { BAUD_RATE } from '../config';
import type { SerialTransport, TransportCallbacks } from './transport';

const USB_VENDORS: Record<number, string> = {
  0x2341: 'Arduino',
  0x2a03: 'Arduino',
  0x1a86: 'CH340 USB-serial (Uno clone)',
  0x0403: 'FTDI USB-serial',
  0x10c4: 'CP210x USB-serial',
};

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

export function describePort(info: SerialPortInfo): string {
  if (info.usbVendorId === undefined) return 'Serial port';
  const vendor = USB_VENDORS[info.usbVendorId] ?? 'USB serial device';
  const id = `${hex4(info.usbVendorId)}:${info.usbProductId !== undefined ? hex4(info.usbProductId) : '????'}`;
  return `${vendor} (${id})`;
}

/** Turns Web Serial exceptions into instructions a person can act on. */
export function describeSerialError(error: unknown, phase: 'request' | 'open' | 'read'): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (phase === 'request' && name === 'NotFoundError') return 'No port was selected.';
  if (name === 'SecurityError') {
    return 'The browser blocked access to serial ports. Open the app from https:// or http://localhost, and check that serial access is not disabled in site settings.';
  }
  if (phase === 'open' && name === 'InvalidStateError') {
    return 'This port is already open in this browser. Close other tabs of the dashboard and try again.';
  }
  if (phase === 'open' && (name === 'NetworkError' || /failed to open/i.test(message))) {
    return 'The port is busy. Close the Arduino IDE Serial Monitor/Plotter (or any other program using the port), make sure no upload is running, then connect again.';
  }
  if (name === 'NetworkError' || /device has been lost/i.test(message)) {
    return 'The device was disconnected.';
  }
  return message || 'Unknown serial error.';
}

const sameDevice = (a: SerialPortInfo | null, b: SerialPortInfo) =>
  !!a && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId;

/**
 * Web Serial implementation. One port at a time; every exit path cancels the
 * reader, releases its lock and closes the port, so the port can be reopened
 * (by this page or by the Arduino IDE) afterwards.
 */
export class WebSerialTransport implements SerialTransport {
  readonly supported: boolean;
  readonly unsupportedReason: string | null;

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private keepReading = false;
  private readLoop: Promise<void> | null = null;
  private busy = false;
  private lastInfo: SerialPortInfo | null = null;
  /** Reconnect automatically when the same board is plugged back in after being lost. */
  private autoReconnect = false;

  constructor(
    private readonly callbacks: TransportCallbacks,
    private readonly serial: Serial | undefined = typeof navigator !== 'undefined' ? navigator.serial : undefined,
    secureContext: boolean = typeof window !== 'undefined' ? window.isSecureContext : true,
  ) {
    if (!secureContext) {
      this.supported = false;
      this.unsupportedReason = 'Web Serial needs a secure page. Open the app from http://localhost or an https:// address.';
    } else if (!this.serial) {
      this.supported = false;
      this.unsupportedReason =
        'This browser does not support Web Serial. Use a current desktop version of Chrome, Edge or Opera to connect to the Arduino.';
    } else {
      this.supported = true;
      this.unsupportedReason = null;
      this.serial.addEventListener('connect', this.onDeviceConnected);
    }
  }

  async hasKnownPort(): Promise<boolean> {
    if (!this.serial) return false;
    try {
      return (await this.serial.getPorts()).length > 0;
    } catch {
      return false;
    }
  }

  async connect({ pick }: { pick: boolean }): Promise<void> {
    if (!this.serial || this.port || this.busy) return;
    this.busy = true;
    this.autoReconnect = false;
    let port: SerialPort | undefined;
    try {
      if (pick) {
        try {
          port = await this.serial.requestPort();
        } catch (error) {
          // A dismissed chooser is not an error worth shouting about.
          const text = describeSerialError(error, 'request');
          this.callbacks.onStatus('disconnected', text === 'No port was selected.' ? {} : { error: text });
          return;
        }
      } else {
        const ports = await this.serial.getPorts();
        port = ports.find((p) => sameDevice(this.lastInfo, p.getInfo())) ?? ports[0];
        if (!port) {
          this.callbacks.onStatus('disconnected', { error: 'No previously used port is available. Choose the port again.' });
          return;
        }
      }
      await this.open(port);
    } finally {
      this.busy = false;
    }
  }

  private async open(port: SerialPort): Promise<void> {
    const info = port.getInfo();
    const portLabel = describePort(info);
    this.callbacks.onStatus('connecting', { portLabel });
    try {
      await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    } catch (error) {
      this.callbacks.onStatus('disconnected', { error: describeSerialError(error, 'open'), portLabel });
      return;
    }
    this.port = port;
    this.lastInfo = info;
    port.addEventListener('disconnect', this.onPortDisconnected);
    this.keepReading = true;
    this.callbacks.onStatus('connected', { portLabel });
    this.readLoop = this.read(port);
  }

  private async read(port: SerialPort): Promise<void> {
    const decoder = new TextDecoder();
    while (this.keepReading && port.readable) {
      const reader = port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            const text = decoder.decode(value, { stream: true });
            this.callbacks.onData(text, value.length);
          }
        }
      } catch (error) {
        // Framing/parity/overrun/break errors leave port.readable usable and the
        // loop continues with a fresh reader. Losing the device makes readable null.
        if (this.keepReading && port.readable) this.callbacks.onReadError(describeSerialError(error, 'read'));
      } finally {
        reader.releaseLock();
        this.reader = null;
      }
    }
    if (this.keepReading) {
      // The stream ended without disconnect() being called: the device is gone.
      await this.teardown('lost');
    }
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    await this.teardown('user');
  }

  private async teardown(reason: 'user' | 'lost'): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.port = null;
    this.keepReading = false;
    port.removeEventListener('disconnect', this.onPortDisconnected);
    if (reason === 'user') this.callbacks.onStatus('disconnecting');
    try {
      await this.reader?.cancel();
    } catch {
      // The stream may already be errored; the lock is released in the read loop.
    }
    if (this.readLoop && reason === 'user') await this.readLoop.catch(() => undefined);
    this.readLoop = null;
    try {
      await port.close();
    } catch {
      // Closing a lost device can fail; nothing else to release.
    }
    this.autoReconnect = reason === 'lost';
    this.callbacks.onStatus('disconnected', { reason });
  }

  private readonly onPortDisconnected = () => {
    void this.teardown('lost');
  };

  private readonly onDeviceConnected = (event: Event) => {
    const port = event.target as SerialPort | null;
    if (!this.autoReconnect || this.port || this.busy || !port || !sameDevice(this.lastInfo, port.getInfo())) return;
    this.autoReconnect = false;
    this.busy = true;
    void this.open(port).finally(() => {
      this.busy = false;
    });
  };

  dispose(): void {
    this.serial?.removeEventListener('connect', this.onDeviceConnected);
    void this.disconnect();
  }
}

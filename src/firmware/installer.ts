import { parseIntelHex } from './intelHex';
import { uploadImage, UploadError, type ByteLink, type UploadProgress } from './stk500';

/** STK500 byte transport over a Web Serial port. */
class WebSerialByteLink implements ByteLink {
  private buffer: number[] = [];
  private notify: (() => void) | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly loop: Promise<void>;

  constructor(private readonly port: SerialPort) {
    this.writer = port.writable!.getWriter();
    this.loop = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    while (this.port.readable) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          if (value) {
            for (const b of value) this.buffer.push(b);
            this.notify?.();
          }
        }
      } catch {
        // Framing errors while the baud rate settles are expected; keep reading.
      } finally {
        reader.releaseLock();
        this.reader = null;
      }
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    await this.writer.write(bytes);
  }

  read(count: number, timeoutMs: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const done = () => {
        if (this.buffer.length < count) return false;
        clearTimeout(timer);
        this.notify = null;
        resolve(Uint8Array.from(this.buffer.splice(0, count)));
        return true;
      };
      const timer = setTimeout(() => {
        this.notify = null;
        reject(new Error('timeout'));
      }, timeoutMs);
      if (!done()) this.notify = () => void done();
    });
  }

  discardInput(): void {
    this.buffer = [];
  }

  delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Pulse DTR/RTS: the Uno's auto-reset capacitor turns it into a reset, which starts the bootloader. */
  async resetBoard(): Promise<void> {
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await this.delay(120);
    await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
    await this.delay(40);
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel();
    } catch {
      // already closed
    }
    await this.loop.catch(() => undefined);
    this.writer.releaseLock();
    await this.port.close().catch(() => undefined);
  }
}

export interface InstallOptions {
  serial: Serial;
  hexText: string;
  /** Show the browser's port chooser (true) or reuse the port granted earlier (false). */
  pick: boolean;
  onProgress(p: UploadProgress): void;
  onLog(line: string): void;
}

/** Uno R3 Optiboot runs at 115200; older Uno/Duemilanove bootloaders at 57600. */
const BAUD_RATES = [115200, 57600];

/**
 * Installs a firmware image on an Arduino Uno over Web Serial: chooses the
 * port, resets the board into its bootloader, uploads and verifies.
 * The port must not be open elsewhere (the live connection or the Arduino IDE).
 */
export async function installFirmware(options: InstallOptions): Promise<{ bytes: number; baud: number }> {
  const { serial, onLog } = options;
  const image = parseIntelHex(options.hexText).data;
  let port: SerialPort | undefined;
  if (options.pick) {
    try {
      port = await serial.requestPort();
    } catch {
      throw new UploadError('No port was selected.', 'sync');
    }
  } else {
    port = (await serial.getPorts())[0];
    if (!port) throw new UploadError('No previously used port is available. Choose the port again.', 'sync');
  }

  let lastError: unknown = null;
  for (const baud of BAUD_RATES) {
    onLog(`Opening the port at ${baud} baud and resetting the board…`);
    try {
      await port.open({ baudRate: baud, bufferSize: 4096 });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      throw new UploadError(
        name === 'InvalidStateError'
          ? 'The port is already open. Disconnect the live connection first.'
          : 'The port is busy. Close the Arduino IDE Serial Monitor (or any program using the port) and try again.',
        'sync',
      );
    }
    const link = new WebSerialByteLink(port);
    try {
      await link.resetBoard();
      const result = await uploadImage(link, image, (p) => {
        options.onProgress(p);
        if (p.stage === 'sync' || p.stage === 'signature') onLog(p.message);
      });
      onLog(`Wrote and verified ${result.bytes} bytes (${result.pages} pages) on the ${result.signature === '1e950f' ? 'ATmega328P' : 'ATmega328'}.`);
      return { bytes: result.bytes, baud };
    } catch (e) {
      lastError = e;
      if (!(e instanceof UploadError) || e.stage !== 'sync') throw e;
      onLog(`No answer from the bootloader at ${baud} baud.`);
    } finally {
      await link.close();
    }
  }
  throw lastError instanceof UploadError
    ? new UploadError(
        'The board did not answer its bootloader. Check that it is an Arduino Uno, try another USB cable or port, or press the reset button on the Uno right after clicking Install.',
        'sync',
      )
    : lastError;
}

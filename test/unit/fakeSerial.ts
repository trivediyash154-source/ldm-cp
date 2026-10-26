/**
 * An in-memory stand-in for navigator.serial that follows the Web Serial
 * rules the transport depends on: open() fails on an open port, close()
 * fails while a reader holds the lock, and losing the device errors the
 * stream and fires 'disconnect'.
 */
export class FakePort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null;
  opened = false;
  openCount = 0;
  closeErrors = 0;
  openError: DOMException | null = null;
  baudRate: number | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(private readonly info: SerialPortInfo = { usbVendorId: 0x2341, usbProductId: 0x0043 }) {
    super();
  }

  getInfo(): SerialPortInfo {
    return this.info;
  }

  async open(options: SerialOptions): Promise<void> {
    if (this.openError) throw this.openError;
    if (this.opened) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.opened = true;
    this.openCount += 1;
    this.baudRate = options.baudRate;
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
  }

  emit(text: string): void {
    this.controller?.enqueue(new TextEncoder().encode(text));
  }

  emitBytes(bytes: Uint8Array): void {
    this.controller?.enqueue(bytes);
  }

  /** Unplug the board. */
  lose(): void {
    this.controller?.error(new DOMException('The device has been lost.', 'NetworkError'));
    this.readable = null;
    this.dispatchEvent(new Event('disconnect'));
  }

  async close(): Promise<void> {
    if (this.readable?.locked) {
      this.closeErrors += 1;
      throw new DOMException('Cannot close a locked stream', 'InvalidStateError');
    }
    this.opened = false;
    this.readable = null;
    this.controller = null;
  }
}

export class FakeSerial extends EventTarget {
  ports: FakePort[] = [];
  /** Port returned by the chooser; null simulates the user dismissing it. */
  chooserResult: FakePort | null = null;

  async requestPort(): Promise<FakePort> {
    if (!this.chooserResult) throw new DOMException('No port selected by the user.', 'NotFoundError');
    if (!this.ports.includes(this.chooserResult)) this.ports.push(this.chooserResult);
    return this.chooserResult;
  }

  async getPorts(): Promise<FakePort[]> {
    return this.ports;
  }

  /** Plug a granted board back in. */
  plugIn(port: FakePort): void {
    const event = new Event('connect');
    Object.defineProperty(event, 'target', { value: port });
    this.dispatchEvent(event);
  }
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

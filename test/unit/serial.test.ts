import { describe, expect, it } from 'vitest';
import { selectOccupancy, selectTelemetryQuality } from '../../src/core/selectors';
import { createEngineStore } from '../../src/core/store';
import { SerialSession } from '../../src/serial/session';
import type { StatusDetail, TransportStatus } from '../../src/serial/transport';
import { describePort, WebSerialTransport } from '../../src/serial/webSerialTransport';
import { FakePort, FakeSerial, flush } from './fakeSerial';
import { telemetry } from './helpers';

function setup() {
  const serial = new FakeSerial();
  const port = new FakePort();
  serial.chooserResult = port;
  let now = 1_000_000;
  const store = createEngineStore({ source: 'live' });
  const session = new SerialSession(
    store,
    (callbacks) => new WebSerialTransport(callbacks, serial as unknown as Serial, true),
    { clock: () => now, autoTick: false, document: null },
  );
  const advance = (ms: number) => {
    now += ms;
    store.dispatch({ type: 'tick', at: now });
  };
  return { serial, port, store, session, advance };
}

describe('WebSerialTransport', () => {
  it('reports why it cannot run', () => {
    const cb = { onStatus: () => {}, onData: () => {}, onReadError: () => {} };
    expect(new WebSerialTransport(cb, undefined, true).unsupportedReason).toMatch(/Chrome, Edge or Opera/);
    expect(new WebSerialTransport(cb, new FakeSerial() as unknown as Serial, false).unsupportedReason).toMatch(/secure/);
  });

  it('opens at 9600 baud and labels the board', async () => {
    const { port, session, store } = setup();
    await session.connect();
    expect(port.baudRate).toBe(9600);
    expect(store.getState().link).toMatchObject({ status: 'connected', portLabel: 'Arduino (2341:0043)' });
    expect(describePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 })).toBe('CH340 USB-serial (Uno clone) (1a86:7523)');
  });

  it('streams fragmented telemetry into the engine', async () => {
    const { port, session, store, advance } = setup();
    await session.connect();
    const line = `${telemetry(3)}\r\n`;
    for (let i = 0; i < 3; i += 1) {
      advance(68);
      port.emit(line.slice(0, 10));
      await flush();
      advance(68);
      port.emit(line.slice(10));
      await flush();
    }
    expect(selectOccupancy(store.getState()).occupancy).toBe(3);
    expect(store.getState().session.bytes).toBe(line.length * 3);
  });

  it('decodes multi-byte characters split across reads', async () => {
    const { port, session, store } = setup();
    await session.connect();
    const bytes = new TextEncoder().encode('{"x":"é"}\n');
    port.emitBytes(bytes.slice(0, 7));
    port.emitBytes(bytes.slice(7));
    await flush();
    expect(store.getState().rawLog.at(-1)?.text).toBe('{"x":"é"}');
  });

  it('releases the reader lock and closes the port on disconnect', async () => {
    const { port, session, store } = setup();
    await session.connect();
    await session.disconnect();
    expect(port.opened).toBe(false);
    expect(port.closeErrors).toBe(0);
    expect(store.getState().link.status).toBe('disconnected');
    // The port can be opened again (by this page or by the Arduino IDE).
    await session.connect();
    expect(port.openCount).toBe(2);
    expect(store.getState().link.status).toBe('connected');
  });

  it('never opens the same port twice', async () => {
    const { port, session } = setup();
    await Promise.all([session.connect(), session.connect()]);
    await session.connect();
    expect(port.openCount).toBe(1);
  });

  it('explains a busy port (Serial Monitor open)', async () => {
    const { port, session, store } = setup();
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    await session.connect();
    expect(store.getState().link.status).toBe('disconnected');
    expect(store.getState().link.error).toMatch(/Serial Monitor/);
    expect(store.getState().events.at(-1)).toMatchObject({ severity: 'error', title: 'Could not connect' });
  });

  it('treats a dismissed chooser as a non-event', async () => {
    const { serial, session, store } = setup();
    serial.chooserResult = null;
    await session.connect();
    expect(store.getState().link.error).toBeNull();
    expect(store.getState().events).toHaveLength(0);
  });

  it('detects an unplugged board and reconnects when it returns', async () => {
    const { serial, port, session, store } = setup();
    await session.connect();
    port.emit(`${telemetry(2)}\n${telemetry(2)}\n`);
    await flush();
    port.lose();
    await flush();
    await flush();
    const s = store.getState();
    expect(s.link.status).toBe('disconnected');
    expect(selectTelemetryQuality(s)).toBe('offline');
    expect(s.events.some((e) => e.title === 'USB connection lost')).toBe(true);
    expect(selectOccupancy(s).freshness).toBe('offline');

    serial.plugIn(port);
    await flush();
    await flush();
    expect(store.getState().link.status).toBe('connected');
    expect(port.openCount).toBe(2);
  });

  it('does not auto-reconnect after the user disconnects', async () => {
    const { serial, port, session, store } = setup();
    await session.connect();
    await session.disconnect();
    serial.plugIn(port);
    await flush();
    expect(store.getState().link.status).toBe('disconnected');
    expect(port.openCount).toBe(1);
  });

  it('reconnects to a previously granted port without the chooser', async () => {
    const { serial, port, session } = setup();
    await session.connect();
    await session.disconnect();
    serial.chooserResult = null;
    expect(await session.transport.hasKnownPort()).toBe(true);
    await session.connect(false);
    expect(port.openCount).toBe(2);
  });

  it('reports statuses in order', async () => {
    const statuses: TransportStatus[] = [];
    const serial = new FakeSerial();
    serial.chooserResult = new FakePort();
    const t = new WebSerialTransport(
      { onStatus: (s: TransportStatus, _d?: StatusDetail) => statuses.push(s), onData: () => {}, onReadError: () => {} },
      serial as unknown as Serial,
      true,
    );
    await t.connect({ pick: true });
    await t.disconnect();
    expect(statuses).toEqual(['connecting', 'connected', 'disconnecting', 'disconnected']);
  });
});

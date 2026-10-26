// Injected into the page by the e2e runner, before the app loads.
// Replaces navigator.serial with a stand-in port that streams the same lines
// as firmware/parking_counter_v2 (telemetry every 100 ms, gate sequences that
// pause telemetry ~1.8 s). It is TEST CODE ONLY and never ships with the app.
(() => {
  const enc = new TextEncoder();
  const state = {
    count: 2,
    decrementWired: true,
    floating: false,
    busyUntil: 0,
    timer: null,
    controller: null,
    port: null,
  };

  class FakePort extends EventTarget {
    constructor() {
      super();
      this.readable = null;
      this.writable = null;
      this.opened = false;
    }
    getInfo() {
      return { usbVendorId: 0x2341, usbProductId: 0x0043 };
    }
    async open(options) {
      if (this.opened) throw new DOMException('The port is already open.', 'InvalidStateError');
      if (options.baudRate !== 9600) throw new Error('unexpected baud ' + options.baudRate);
      this.opened = true;
      this.readable = new ReadableStream({
        start: (c) => {
          state.controller = c;
        },
        cancel: () => {
          state.controller = null;
        },
      });
      // The Uno restarts when the port opens; setup() prints the boot line.
      setTimeout(() => {
        send(`{"boot":"ldm-parking","ver":2,"cap":5,"saved":${state.count},"start":${state.count},"pulses":0,"restored":true}`);
        state.timer = setInterval(tick, 100);
      }, 1200);
    }
    async close() {
      if (this.readable && this.readable.locked) throw new DOMException('locked', 'InvalidStateError');
      clearInterval(state.timer);
      this.opened = false;
      this.readable = null;
    }
  }

  function send(line) {
    try {
      state.controller?.enqueue(enc.encode(line + '\r\n'));
    } catch {
      /* stream closed */
    }
  }
  function value() {
    return state.floating ? 7 : state.count;
  }
  function tick() {
    if (Date.now() < state.busyUntil) return;
    const c = value();
    send(`{"q2":${(c >> 2) & 1},"q1":${(c >> 1) & 1},"q0":${c & 1},"count":${c}}`);
  }
  function gate(kind) {
    const before = value();
    const allowed = kind === 'entry' ? before < 5 : before > 0;
    if (!allowed) {
      send(`{"evt":"${kind}_denied","before":${before}}`);
      state.busyUntil = Date.now() + 250;
      return;
    }
    state.busyUntil = Date.now() + 1800;
    if (kind === 'entry') state.count = (state.count + 1) % 8;
    else if (state.decrementWired) state.count = (state.count + 7) % 8;
    send(`{"evt":"${kind}","before":${before}}`);
    setTimeout(() => send(`{"evt":"${kind}_closed","before":${before}}`), 1550);
    setTimeout(() => {
      send(`{"q2":${(before >> 2) & 1},"q1":${(before >> 1) & 1},"q0":${before & 1},"count":${before}}`);
    }, 1790);
  }

  const port = new FakePort();
  state.port = port;
  const serial = new EventTarget();
  serial.requestPort = async () => port;
  serial.getPorts = async () => [port];
  Object.defineProperty(Navigator.prototype, 'serial', { get: () => serial, configurable: true });

  window.__arduino = {
    entry: () => gate('entry'),
    exit: () => gate('exit'),
    setDecrementWired: (on) => {
      state.decrementWired = on;
    },
    setFloating: (on) => {
      state.floating = on;
    },
    garbage: (text) => send(text),
    unplug: () => {
      clearInterval(state.timer);
      try {
        state.controller?.error(new DOMException('The device has been lost.', 'NetworkError'));
      } catch {
        /* already closed */
      }
      port.readable = null;
      port.opened = false;
      port.dispatchEvent(new Event('disconnect'));
    },
  };
})();

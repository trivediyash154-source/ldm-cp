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

  // Bootloader side (port opened at 115200): a minimal Optiboot-like STK500 responder.
  const boot = { flash: new Uint8Array(0x8000).fill(0xff), address: 0, rx: [], written: 0, signals: [] };
  function reply(bytes) {
    try {
      state.controller?.enqueue(Uint8Array.from(bytes));
    } catch {
      /* closed */
    }
  }
  function stk500(bytes) {
    boot.rx.push(...bytes);
    for (;;) {
      const r = boot.rx;
      if (r.length === 0) return;
      const need = { 0x30: 2, 0x75: 2, 0x50: 2, 0x51: 2, 0x55: 4, 0x74: 5 }[r[0]] ?? (r[0] === 0x64 && r.length >= 3 ? 5 + ((r[1] << 8) | r[2]) : r[0] === 0x64 ? Infinity : 1);
      if (r.length < need) return;
      const cmd = r.splice(0, need);
      if (cmd[cmd.length - 1] !== 0x20) continue;
      if (cmd[0] === 0x75) reply([0x14, 0x1e, 0x95, 0x0f, 0x10]);
      else if (cmd[0] === 0x55) {
        boot.address = ((cmd[2] << 8) | cmd[1]) * 2;
        reply([0x14, 0x10]);
      } else if (cmd[0] === 0x64) {
        const n = (cmd[1] << 8) | cmd[2];
        boot.flash.set(cmd.slice(4, 4 + n), boot.address);
        boot.written += n;
        reply([0x14, 0x10]);
      } else if (cmd[0] === 0x74) {
        const n = (cmd[1] << 8) | cmd[2];
        reply([0x14, ...boot.flash.slice(boot.address, boot.address + n), 0x10]);
      } else if (cmd[0] === 0x51) {
        reply([0x14, 0x10]);
        state.flashedV2 = true;
      } else reply([0x14, 0x10]);
    }
  }

  class FakePort extends EventTarget {
    constructor() {
      super();
      this.readable = null;
      this.writable = null;
      this.opened = false;
      this.baud = 0;
    }
    async setSignals(signals) {
      boot.signals.push(signals);
    }
    getInfo() {
      return { usbVendorId: 0x2341, usbProductId: 0x0043 };
    }
    async open(options) {
      if (this.opened) throw new DOMException('The port is already open.', 'InvalidStateError');
      this.opened = true;
      this.baud = options.baudRate;
      this.readable = new ReadableStream({
        start: (c) => {
          state.controller = c;
        },
        cancel: () => {
          state.controller = null;
        },
      });
      if (options.baudRate === 115200) {
        boot.rx = [];
        this.writable = new WritableStream({ write: (chunk) => stk500(Array.from(chunk)) });
        return;
      }
      if (options.baudRate !== 9600) throw new Error('unexpected baud ' + options.baudRate);
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
      this.writable = null;
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
    bootloader: () => ({ written: boot.written, flashedV2: !!state.flashedV2, resets: boot.signals.length }),
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

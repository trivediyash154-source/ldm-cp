# Firmware

Two Arduino Uno sketches. Both use the same pins, timings, gate rules and
telemetry line, and the web app works with either.

| Sketch | What it is |
|---|---|
| `parking_counter_v1/` | The sketch the prototype was built with, **unchanged**. |
| `parking_counter_v2/` | v1 plus two small, marked (`// v2`) changes. Recommended. |

## Serial protocol (9600 baud, 8N1, one JSON object per line, `\r\n`)

Both versions print a telemetry line on every `loop()` pass, about every
100 ms:

```json
{"q2":0,"q1":1,"q0":1,"count":3}
```

`q2 q1 q0` are `digitalRead()` of D9, D8, D7 (the 74LS74 Q outputs) and
`count = 4·q2 + 2·q1 + q0`. During a gate sequence `loop()` is blocked for
about 1.8 s and nothing is printed.

v2 adds these lines. v1 tooling that only reads telemetry ignores nothing it
needs:

```json
{"boot":"ldm-parking","ver":2,"cap":5,"saved":3,"start":3,"pulses":0,"restored":true}
{"evt":"entry","before":2}          entry sensor fired, gate opened, D2 pulsed
{"evt":"entry_closed","before":2}   entry gate commanded closed (1.5 s later)
{"evt":"entry_denied","before":5}   entry sensor fired, count >= 5, gate kept closed
{"evt":"exit","before":3}           exit sensor fired, gate opened, D3 pulsed
{"evt":"exit_closed","before":3}
{"evt":"exit_denied","before":0}    exit sensor fired, count == 0, gate kept closed
```

`before` is the count read at the start of the `loop()` pass that handled the
sensor.

## Why v2 changes anything

1. **Restart bug.** v1's `setup()` pulses the counter `savedCount` times on
   top of whatever the flip-flops hold. Opening the USB port restarts the Uno
   but not the breadboard, so every browser connection adds the saved count
   again (3 → 6). v2 pulses only until the counter shows the saved value. See
   `docs/hardware-notes.md` finding 3.
2. **Verifiable events.** v1 does not say which sensor fired, so the app can
   only infer entries and exits from counter steps, and cannot tell an exit
   that the counter missed from no exit at all. v2's event lines let the app
   check every entry and exit against the counter.

Nothing else changed: same pins, same `delay()`s, same `count < 5` /
`count > 0` rules, same telemetry line.

## Uploading

Open the sketch folder in the Arduino IDE, choose **Tools → Board → Arduino
Uno** and the right **Port**, and upload. Close the Serial Monitor before
connecting the web app — only one program can use the port.

## Compile check

`npm run firmware:build` (Linux, needs `gcc-avr avr-libc arduino-core-avr`)
compiles both sketches with the Arduino AVR core 1.8.6 and the Servo library
1.2.2, and writes the `.hex` files used by the firmware-in-the-loop tests in
`test/firmware/`. Those tests run the compiled sketches in an emulated
ATmega328P (avr8js) wired to a behavioural model of the 74LS74 counter.

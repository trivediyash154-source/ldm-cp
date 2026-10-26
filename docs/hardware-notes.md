# Hardware notes

These notes review the wiring guide the prototype was built from (the
conversation in the project notes) against the firmware. They are based on that
guide, **not on an inspection of your breadboard** — check each point on the
board itself. Where a claim is backed by a test, the test is named.

## Pin map (unchanged)

| Arduino pin | Function | Direction |
|---|---|---|
| D2 | Clock UP → 74LS74 #1 pins 3 and 11, 74LS74 #2 pin 3 | out |
| D3 | Clock DOWN → "down-steering logic" | out |
| D5 | Entry IR sensor OUT (LOW = vehicle) | in |
| D6 | Exit IR sensor OUT (LOW = vehicle) | in |
| D7 | Q0 ← 74LS74 #1 pin 5 | in |
| D8 | Q1 ← 74LS74 #1 pin 9 | in |
| D9 | Q2 ← 74LS74 #2 pin 5 | in |
| D10 | Entry servo signal | out |
| D11 | Exit servo signal | out |

## Findings

### 1. 74LS08 pin 2 is tied to the clock, so Q1 never toggles

The guide connects AND gate 1 (74LS08 pins 1, 2 → 3) to Q0 and to D2, and
feeds its output into XOR gate 1, so `D1 = Q1 ⊕ (Q0 · CLK)`. A 74LS74 samples
D on the **rising** edge; just before that edge CLK is still LOW, so `D1 = Q1`
and flip-flop 1 never changes. The counter then runs 0 → 1 → 0 → 1, and from 3
an entry jumps to 6.

- Logic check: `test/unit/updown-logic.test.ts` ("wiring guide as written").
- With the compiled firmware: `test/firmware/faults.test.ts`.
- In the app: Hardware Lab → *Counter self-check* shows Q1 with 0 toggles.

**Fix (up-counting only):** move the wire on 74LS08 pin 2 from D2 to **+5 V**.
`D1` becomes `Q1 ⊕ Q0` and the counter counts up correctly.

### 2. D3 (clock down) does not reach the counter

The guide sends D3 to an unspecified "down-steering network" (an inverter
input whose output goes nowhere). With that wiring the exit gate opens but the
count never goes down, so after five entries the lot reads full forever.

- With the compiled firmware: `test/firmware/v1.test.ts` and `v2.test.ts`
  ("exit … D3 unconnected").
- In the app: with firmware v2 every such exit is shown as
  *Exit not counted by the hardware*; with v1 the app reports
  *Gate sequence without a count change*.

**Fix:** turn the counter into an up/down counter (below), or confirm where D3
actually goes on your board.

### 3. Firmware v1 adds the saved count again on every restart

`setup()` pulses D2 `savedCount` times. That only works when the flip-flops
start at 0. Opening the USB port (the browser, the Serial Monitor, an upload)
restarts the Uno **but not the breadboard**, so the flip-flops still hold the
count and get `savedCount` extra pulses: 3 becomes 6. Then loop() saves 6, the
next restart rejects it (> 5), writes 0, and the counter stays at 6.

- Reproduced with the compiled v1 sketch: `test/firmware/v1.test.ts`
  ("reopening the port adds the saved count again").

**Fix:** upload `firmware/parking_counter_v2`. It pulses only until the
counter shows the saved value (0 pulses after a USB restart).

### 4. A counter reading of 7 blocks the entry gate

If the Q wires are loose, or the Arduino GND is not joined to the breadboard
GND rail, D7–D9 read HIGH and the count is 7. The firmware refuses entry when
`count >= 5`, which matches the "in-gate IR sensor and servo not working"
symptom. The app shows this as *Counter out of range* and predicts that the
entry gate will refuse.

- `test/firmware/faults.test.ts` ("floating Q inputs read 7").

**Fix:** join the grounds; check 74LS74 #1 pins 5 and 9 and 74LS74 #2 pin 5
to D7, D8 and D9.

### 5. No reset line

CLR and PRE are pulled up, so the flip-flops start in a random state and the
Arduino cannot zero them. v2's restore copes with that; a spare Arduino pin
driving the CLR pins (active LOW) would allow a clean reset.

## Optional: up/down counter from the parts on the board

This replaces the guide's next-state logic. It uses the two 74LS74s, **all four
gates of the 74LS86** and **one gate of the 74LS08**. D2 stays the only clock;
D3 becomes a **direction level** (HIGH = count down) that the firmware holds
around the D2 pulse.

```
A  = Q0 ⊕ DOWN            D0 = Q0-bar   (unchanged: 74LS74 #1 pin 6 → pin 2)
B  = Q1 ⊕ DOWN            D1 = Q1 ⊕ A
                          D2 = Q2 ⊕ (A · B)
```

The equations are checked exhaustively for all 8 states in both directions by
`test/unit/updown-logic.test.ts`. They have **not** been built or measured.

| Gate | Inputs | Output goes to |
|---|---|---|
| 74LS86 gate 1 (pins 1, 2 → 3) | pin 1 ← Q0 (74LS74 #1 pin 5), pin 2 ← D3 | A |
| 74LS86 gate 2 (pins 4, 5 → 6) | pin 4 ← Q1 (74LS74 #1 pin 9), pin 5 ← D3 | B |
| 74LS86 gate 3 (pins 9, 10 → 8) | pin 9 ← Q1, pin 10 ← A (pin 3) | 74LS74 #1 pin 12 (2D) |
| 74LS08 gate 1 (pins 1, 2 → 3) | pin 1 ← A (74LS86 pin 3), pin 2 ← B (74LS86 pin 6) | 74LS86 pin 13 |
| 74LS86 gate 4 (pins 12, 13 → 11) | pin 12 ← Q2 (74LS74 #2 pin 5), pin 13 ← 74LS08 pin 3 | 74LS74 #2 pin 2 (1D) |

Remove the old D2 → 74LS08 pin 2 and D3 → 74LS04 wires. Tie the unused
74LS08 and 74LS04 inputs to GND. The clock wiring (D2 → 74LS74 #1 pins 3, 11
and #2 pin 3) stays as it is.

This wiring needs one firmware change: the exit must set the direction before
clocking with D2, instead of pulsing D3. In the exit branch of
`parking_counter_v2`, replace the D3 pulse with:

```cpp
      digitalWrite(CLK_DN_PIN, HIGH);   // DOWN level for the next-state logic
      delayMicroseconds(5);             // let the XOR/AND outputs settle
      digitalWrite(CLK_UP_PIN, HIGH);   // the one clock line
      delay(15);
      digitalWrite(CLK_UP_PIN, LOW);
      digitalWrite(CLK_DN_PIN, LOW);
```

Do not make this firmware change without the rewiring: on the guide's wiring
it would make every exit **increment** the counter.

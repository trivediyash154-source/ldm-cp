#include <Servo.h>
#include <EEPROM.h>

// v2 = parking_counter_v1 plus two small changes, each marked "v2:".
//   1. Startup restore pulses the counter only until it shows the saved count.
//      v1 pulsed savedCount times on top of whatever the flip-flops already
//      held, and the Uno resets every time a program opens the USB port.
//   2. Extra JSON lines report startup, gate decisions and gate closing.
//      The periodic telemetry line is unchanged, so v1 tooling still works.
// Pins, timings, gate rules and the counter wiring are the same as v1.

// Sensor & Logic Read Pins
const int ENTRY_IR_PIN = 5;
const int EXIT_IR_PIN  = 6;
const int Q0_PIN       = 7;  // Reads 74LS74 Q0
const int Q1_PIN       = 8;  // Reads 74LS74 Q1
const int Q2_PIN       = 9;  // Reads 74LS74 Q2

// Clock & Dual Servo Output Pins
const int CLK_UP_PIN    = 2;
const int CLK_DN_PIN    = 3;
const int IN_SERVO_PIN  = 10;
const int OUT_SERVO_PIN = 11;

Servo inGateServo;
Servo outGateServo;

bool lastEntryState = HIGH;
bool lastExitState  = HIGH;

const int EEPROM_ADDR = 0; // Session storage byte address

// v2: read the three flip-flop outputs as one number (same formula as loop()).
int readCount() {
  int q0 = digitalRead(Q0_PIN);
  int q1 = digitalRead(Q1_PIN);
  int q2 = digitalRead(Q2_PIN);
  return (q2 << 2) | (q1 << 1) | q0;
}

// v2: one JSON line per gate decision, e.g. {"evt":"entry","before":2}.
// "before" is the count read at the top of the loop pass that handled it.
void reportEvent(const char *name, int before) {
  Serial.print("{\"evt\":\"");
  Serial.print(name);
  Serial.print("\",\"before\":");
  Serial.print(before);
  Serial.println("}");
}

void setup() {
  Serial.begin(9600);

  pinMode(ENTRY_IR_PIN, INPUT);
  pinMode(EXIT_IR_PIN, INPUT);
  pinMode(Q0_PIN, INPUT);
  pinMode(Q1_PIN, INPUT);
  pinMode(Q2_PIN, INPUT);

  pinMode(CLK_UP_PIN, OUTPUT);
  pinMode(CLK_DN_PIN, OUTPUT);
  digitalWrite(CLK_UP_PIN, LOW);
  digitalWrite(CLK_DN_PIN, LOW);

  inGateServo.attach(IN_SERVO_PIN);
  outGateServo.attach(OUT_SERVO_PIN);

  // Set initial barrier gate positions (0 degrees = Closed)
  inGateServo.write(0);
  outGateServo.write(0);

  // Restore previous session hardware count into 74LS74 ICs
  int savedCount = EEPROM.read(EEPROM_ADDR);
  if (savedCount > 5 || savedCount < 0) {
    savedCount = 0;
    EEPROM.write(EEPROM_ADDR, 0);
  }

  // v2: pulse only until the flip-flops show the saved count. After a USB
  // reset the breadboard stays powered, so usually no pulse is needed. A
  // working 3-bit counter reaches any value in at most 7 pulses.
  int startCount = readCount();
  int pulses = 0;
  while (readCount() != savedCount && pulses < 8) {
    digitalWrite(CLK_UP_PIN, HIGH);
    delay(15);
    digitalWrite(CLK_UP_PIN, LOW);
    delay(15);
    pulses++;
  }

  // v2: announce the firmware and the restore result.
  Serial.print("{\"boot\":\"ldm-parking\",\"ver\":2,\"cap\":5,\"saved\":");
  Serial.print(savedCount);
  Serial.print(",\"start\":");
  Serial.print(startCount);
  Serial.print(",\"pulses\":");
  Serial.print(pulses);
  Serial.print(",\"restored\":");
  Serial.print(readCount() == savedCount ? "true" : "false");
  Serial.println("}");
}

void loop() {
  bool entryState = digitalRead(ENTRY_IR_PIN);
  bool exitState  = digitalRead(EXIT_IR_PIN);

  // 1. Read binary bits directly from physical 74LS74 output pins
  int q0 = digitalRead(Q0_PIN);
  int q1 = digitalRead(Q1_PIN);
  int q2 = digitalRead(Q2_PIN);
  int count = (q2 << 2) | (q1 << 1) | q0;

  // 2. Save state to non-volatile EEPROM whenever count changes
  int lastSaved = EEPROM.read(EEPROM_ADDR);
  if (count != lastSaved) {
    EEPROM.write(EEPROM_ADDR, count);
  }

  // 3. Entry Barrier Handling (In-Gate Servo)
  if (lastEntryState == HIGH && entryState == LOW) {
    if (count < 5) {
      inGateServo.write(90);  // Open Entry Gate
      digitalWrite(CLK_UP_PIN, HIGH);
      delay(15);
      digitalWrite(CLK_UP_PIN, LOW);
      reportEvent("entry", count);         // v2
      delay(1500);            // Allow vehicle to enter
      inGateServo.write(0);   // Close Entry Gate
      reportEvent("entry_closed", count);  // v2
    } else {
      reportEvent("entry_denied", count);  // v2
    }
    delay(250); // Debounce
  }
  lastEntryState = entryState;

  // 4. Exit Barrier Handling (Out-Gate Servo)
  if (lastExitState == HIGH && exitState == LOW) {
    if (count > 0) {
      outGateServo.write(90); // Open Exit Gate
      digitalWrite(CLK_DN_PIN, HIGH);
      delay(15);
      digitalWrite(CLK_DN_PIN, LOW);
      reportEvent("exit", count);          // v2
      delay(1500);            // Allow vehicle to exit
      outGateServo.write(0);  // Close Exit Gate
      reportEvent("exit_closed", count);   // v2
    } else {
      reportEvent("exit_denied", count);   // v2
    }
    delay(250); // Debounce
  }
  lastExitState = exitState;

  // 5. Stream JSON payload to Laptop Dashboard over USB Serial
  Serial.print("{\"q2\":");
  Serial.print(q2);
  Serial.print(",\"q1\":");
  Serial.print(q1);
  Serial.print(",\"q0\":");
  Serial.print(q0);
  Serial.print(",\"count\":");
  Serial.print(count);
  Serial.println("}");

  delay(100);
}

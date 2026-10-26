#include <Servo.h>
#include <EEPROM.h>

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

  // Re-hydrate the physical 74LS74 flip-flops
  for (int i = 0; i < savedCount; i++) {
    digitalWrite(CLK_UP_PIN, HIGH);
    delay(15);
    digitalWrite(CLK_UP_PIN, LOW);
    delay(15);
  }
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
      delay(1500);            // Allow vehicle to enter
      inGateServo.write(0);   // Close Entry Gate
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
      delay(1500);            // Allow vehicle to exit
      outGateServo.write(0);  // Close Exit Gate
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

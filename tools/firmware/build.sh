#!/usr/bin/env bash
# Compiles firmware/parking_counter_v1 and _v2 for the Arduino Uno (ATmega328P,
# 16 MHz) the same way the Arduino IDE does, and writes Intel HEX files to
# firmware/build/. The web app bundles the v2 file for its installer, and the
# firmware-in-the-loop tests run both in an emulated ATmega328P.
#
# Requirements (Debian/Ubuntu):
#   sudo apt-get install gcc-avr avr-libc arduino-core-avr
# The Servo library (not packaged by Debian) is downloaded once, pinned to a
# release tag, into tools/firmware/.cache/.
#
# Override the core location with ARDUINO_AVR=/path/to/hardware/arduino/avr.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARDUINO_AVR="${ARDUINO_AVR:-/usr/share/arduino/hardware/arduino/avr}"
SERVO_TAG="1.2.2"
CACHE="$ROOT/tools/firmware/.cache"
SERVO_DIR="$CACHE/Servo-$SERVO_TAG"
OUT_DIR="$ROOT/firmware/build"
BUILD="$CACHE/build"

command -v avr-gcc >/dev/null || { echo "avr-gcc not found (apt-get install gcc-avr avr-libc)"; exit 1; }
[ -d "$ARDUINO_AVR/cores/arduino" ] || { echo "Arduino AVR core not found at $ARDUINO_AVR (apt-get install arduino-core-avr)"; exit 1; }

if [ ! -f "$SERVO_DIR/src/avr/Servo.cpp" ]; then
  mkdir -p "$SERVO_DIR/src/avr"
  base="https://raw.githubusercontent.com/arduino-libraries/Servo/$SERVO_TAG"
  for f in src/Servo.h src/avr/Servo.cpp src/avr/ServoTimers.h; do
    curl -fsSL "$base/$f" -o "$SERVO_DIR/$f"
  done
fi

MCU_FLAGS=(-mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR)
INCLUDES=(-I"$ARDUINO_AVR/cores/arduino" -I"$ARDUINO_AVR/variants/standard"
          -I"$ARDUINO_AVR/libraries/EEPROM/src" -I"$SERVO_DIR/src")
CFLAGS=(-Os -w -ffunction-sections -fdata-sections -flto -fno-fat-lto-objects)
CXXFLAGS=("${CFLAGS[@]}" -std=gnu++11 -fpermissive -fno-exceptions -fno-threadsafe-statics)

rm -rf "$BUILD" && mkdir -p "$BUILD/core" "$OUT_DIR"

# Arduino core + Servo, compiled once and shared by both sketches.
for src in "$ARDUINO_AVR"/cores/arduino/*.c; do
  avr-gcc -c "${CFLAGS[@]}" -std=gnu11 "${MCU_FLAGS[@]}" "${INCLUDES[@]}" "$src" -o "$BUILD/core/$(basename "$src").o"
done
for src in "$ARDUINO_AVR"/cores/arduino/*.cpp "$SERVO_DIR/src/avr/Servo.cpp"; do
  avr-g++ -c "${CXXFLAGS[@]}" "${MCU_FLAGS[@]}" "${INCLUDES[@]}" "$src" -o "$BUILD/core/$(basename "$src").o"
done
for src in "$ARDUINO_AVR"/cores/arduino/*.S; do
  avr-gcc -c -x assembler-with-cpp "${MCU_FLAGS[@]}" "${INCLUDES[@]}" "$src" -o "$BUILD/core/$(basename "$src").o"
done

for sketch in parking_counter_v1 parking_counter_v2; do
  ino="$ROOT/firmware/$sketch/$sketch.ino"
  cpp="$BUILD/$sketch.cpp"
  # The IDE prepends Arduino.h; both sketches define helpers before use, so no
  # generated prototypes are needed.
  { echo '#include <Arduino.h>'; echo "#line 1 \"$sketch.ino\""; cat "$ino"; } > "$cpp"
  avr-g++ -c "${CXXFLAGS[@]}" -Wall "${MCU_FLAGS[@]}" "${INCLUDES[@]}" "$cpp" -o "$BUILD/$sketch.o"
  avr-gcc -Os -flto -fuse-linker-plugin -Wl,--gc-sections -mmcu=atmega328p \
    "$BUILD/$sketch.o" "$BUILD"/core/*.o -lm -o "$BUILD/$sketch.elf"
  avr-objcopy -O ihex -R .eeprom "$BUILD/$sketch.elf" "$OUT_DIR/$sketch.hex"
  echo "== $sketch"
  avr-size --mcu=atmega328p -C "$BUILD/$sketch.elf" | grep -E "Program|Data"
done

/** A program image decoded from an Intel HEX file. */
export interface FlashImage {
  /** Bytes from address 0 up to the last programmed byte; gaps are 0xFF. */
  data: Uint8Array;
}

/**
 * Parses the Intel HEX files avr-objcopy produces (data, EOF and extended
 * address records) and checks every record's checksum.
 */
export function parseIntelHex(text: string): FlashImage {
  const bytes = new Map<number, number>();
  let base = 0;
  let end = 0;
  let sawEof = false;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n].trim();
    if (!line) continue;
    if (!line.startsWith(':') || line.length < 11 || line.length % 2 === 0) throw new Error(`HEX line ${n + 1}: malformed record`);
    const raw = line.slice(1).match(/../g)!.map((h) => {
      const v = Number.parseInt(h, 16);
      if (Number.isNaN(v)) throw new Error(`HEX line ${n + 1}: not hexadecimal`);
      return v;
    });
    const count = raw[0];
    if (raw.length !== count + 5) throw new Error(`HEX line ${n + 1}: length does not match byte count`);
    if (raw.reduce((a, b) => a + b, 0) % 256 !== 0) throw new Error(`HEX line ${n + 1}: checksum error`);
    const address = (raw[1] << 8) | raw[2];
    const type = raw[3];
    const payload = raw.slice(4, 4 + count);
    if (type === 0x00) {
      payload.forEach((b, i) => bytes.set(base + address + i, b));
      end = Math.max(end, base + address + count);
    } else if (type === 0x01) {
      sawEof = true;
      break;
    } else if (type === 0x02) {
      base = ((payload[0] << 8) | payload[1]) << 4;
    } else if (type === 0x04) {
      base = ((payload[0] << 8) | payload[1]) << 16;
    }
  }
  if (!sawEof) throw new Error('HEX file has no end-of-file record (truncated?)');
  const data = new Uint8Array(end).fill(0xff);
  for (const [addr, b] of bytes) data[addr] = b;
  return { data };
}

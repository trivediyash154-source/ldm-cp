import { MAX_LINE_LENGTH } from '../config';

export type FramedLine =
  | { kind: 'line'; text: string }
  | { kind: 'overflow'; length: number };

/**
 * Splits a stream of decoded text chunks into newline-terminated lines.
 * Serial reads return arbitrary slices, so a line can arrive across several
 * chunks and one chunk can hold several lines. Println() ends lines with \r\n.
 */
export class LineFramer {
  private buffer = '';
  /** True after an overflow until the end of that over-long line. */
  private discarding = false;

  constructor(private readonly maxLength = MAX_LINE_LENGTH) {}

  push(chunk: string): FramedLine[] {
    const out: FramedLine[] = [];
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const raw = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (this.discarding) {
        this.discarding = false;
      } else if (text.length > this.maxLength) {
        out.push({ kind: 'overflow', length: text.length });
      } else if (text.trim().length > 0) {
        out.push({ kind: 'line', text });
      }
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLength) {
      if (!this.discarding) out.push({ kind: 'overflow', length: this.buffer.length });
      this.discarding = true;
      this.buffer = '';
    }
    return out;
  }

  /** Bytes waiting for a newline; dropped when the connection ends. */
  get pending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = '';
    this.discarding = false;
  }
}

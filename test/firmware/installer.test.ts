import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIntelHex } from '../../src/firmware/intelHex';
import { uploadImage, UploadError, type ByteLink, type UploadProgress } from '../../src/firmware/stk500';
import { BootloaderUno, EmulatorLink } from './bootloaderUno';
import { Counter74LS74, EmulatedUno } from './emulatedUno';
import { firmwareBuilt, HEX } from './rig';

const image = (path: string) => parseIntelHex(readFileSync(path, 'utf8')).data;

/**
 * The browser installer's STK500 code against the real Arduino Uno bootloader
 * (Optiboot) running in an emulated ATmega328P.
 */
describe.skipIf(!firmwareBuilt)('firmware installer against the Uno bootloader', () => {
  it('replaces v1 with v2, verifies it, and the board then runs v2', async () => {
    const v1 = image(HEX.v1);
    const v2 = image(HEX.v2);
    const uno = new BootloaderUno(v1);
    const stages: string[] = [];
    const result = await uploadImage(new EmulatorLink(uno), v2, (p: UploadProgress) => {
      if (stages.at(-1) !== p.stage) stages.push(p.stage);
    });
    expect(result.signature).toBe('1e950f');
    expect(result.pages).toBe(Math.ceil(v2.length / 128));
    expect(stages).toEqual(['sync', 'signature', 'write', 'verify', 'done']);
    expect(Array.from(uno.flash.subarray(0, v2.length))).toEqual(Array.from(v2));

    // Power the board up from the flashed image: it must print the v2 boot line.
    const program = new Uint16Array(uno.flash.slice().buffer);
    const board = new EmulatedUno(program, new Counter74LS74({ andGateB: 'high', d3: 'unconnected' }, 0));
    board.run(300);
    expect(board.lines[0]?.text).toMatch(/^\{"boot":"ldm-parking","ver":2,/);
    expect(board.lines.slice(1).every((l) => l.text.startsWith('{"q2"'))).toBe(true);
  });

  it('reports a board that never answers', async () => {
    const silent: ByteLink = {
      write: async () => {},
      read: async () => {
        throw new Error('timeout');
      },
      discardInput: () => {},
      delay: async () => {},
    };
    await expect(uploadImage(silent, image(HEX.v2))).rejects.toMatchObject({ stage: 'sync' });
    await expect(uploadImage(silent, image(HEX.v2))).rejects.toBeInstanceOf(UploadError);
  });
});

describe('Intel HEX parser', () => {
  it('reads the compiled firmware and rejects damaged files', () => {
    const text = readFileSync(HEX.v2, 'utf8');
    const data = parseIntelHex(text).data;
    expect(data.length).toBeGreaterThan(4000);
    expect(data.length).toBeLessThan(0x7e00);
    const damaged = text.replace(/^(:10000000)(..)/m, (_m, a, b) => a + (b === '00' ? '01' : '00'));
    expect(() => parseIntelHex(damaged)).toThrow(/checksum/);
    expect(() => parseIntelHex(text.split('\n').slice(0, 5).join('\n'))).toThrow(/end-of-file/);
  });
});

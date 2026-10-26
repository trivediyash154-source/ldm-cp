/**
 * Uploads a program to an Arduino Uno through its Optiboot bootloader, using
 * the STK500 v1 commands that avrdude uses for `-c arduino`.
 *
 * The transport is abstract so the same code runs over Web Serial in the
 * browser and against an emulated ATmega328P running the real Optiboot
 * binary in the tests.
 */

export interface ByteLink {
  write(bytes: Uint8Array): Promise<void>;
  /** Resolves with exactly `count` bytes, or rejects after `timeoutMs`. */
  read(count: number, timeoutMs: number): Promise<Uint8Array>;
  /** Drops any received bytes not read yet. */
  discardInput(): void;
  delay(ms: number): Promise<void>;
}

const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
} as const;

export const ATMEGA328P = {
  name: 'ATmega328P',
  signatures: ['1e950f', '1e9514'], // 328P and 328
  pageSize: 128,
  /** Application space below the 512-byte Optiboot section. */
  appBytes: 0x7e00,
};

export type UploadStage = 'sync' | 'signature' | 'write' | 'verify' | 'done';

export interface UploadProgress {
  stage: UploadStage;
  /** 0..1 within the write and verify stages. */
  fraction: number;
  message: string;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly stage: UploadStage,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function command(link: ByteLink, bytes: number[], replyData = 0, timeoutMs = 400): Promise<Uint8Array> {
  await link.write(Uint8Array.from([...bytes, STK.CRC_EOP]));
  const reply = await link.read(replyData + 2, timeoutMs);
  if (reply[0] !== STK.INSYNC || reply[reply.length - 1] !== STK.OK) {
    throw new Error(`unexpected reply ${hex(reply)}`);
  }
  return reply.slice(1, 1 + replyData);
}

/** Repeats GET_SYNC until the bootloader answers (it only listens for ~1 s after reset). */
export async function sync(link: ByteLink, attempts = 12): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    link.discardInput();
    try {
      await command(link, [STK.GET_SYNC], 0, 150);
      // Drain duplicate answers to earlier attempts before the real session starts.
      await link.delay(30);
      link.discardInput();
      return;
    } catch {
      await link.delay(50);
    }
  }
  throw new UploadError('The board did not answer the bootloader.', 'sync');
}

export async function readSignature(link: ByteLink): Promise<string> {
  return hex(await command(link, [STK.READ_SIGN], 3));
}

async function loadAddress(link: ByteLink, byteAddress: number): Promise<void> {
  const word = byteAddress >> 1;
  await command(link, [STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff]);
}

/**
 * Programs `image` (from address 0) and reads every page back to verify it.
 * The caller resets the board into the bootloader before calling this.
 */
export async function uploadImage(
  link: ByteLink,
  image: Uint8Array,
  onProgress: (p: UploadProgress) => void = () => {},
): Promise<{ bytes: number; pages: number; signature: string }> {
  const chip = ATMEGA328P;
  if (image.length === 0) throw new UploadError('The firmware image is empty.', 'write');
  if (image.length > chip.appBytes) throw new UploadError('The firmware is too large for the ATmega328P.', 'write');

  onProgress({ stage: 'sync', fraction: 0, message: 'Waiting for the bootloader…' });
  await sync(link);

  onProgress({ stage: 'signature', fraction: 0, message: 'Checking the microcontroller…' });
  let signature: string;
  try {
    signature = await readSignature(link);
  } catch (e) {
    throw new UploadError(`Could not read the chip signature (${(e as Error).message}).`, 'signature');
  }
  if (!chip.signatures.includes(signature)) {
    throw new UploadError(`This is not an ATmega328P (signature ${signature}). Is the board an Arduino Uno?`, 'signature');
  }
  await command(link, [STK.ENTER_PROGMODE]);

  const pageCount = Math.ceil(image.length / chip.pageSize);
  const page = (i: number) => {
    const out = new Uint8Array(chip.pageSize).fill(0xff);
    out.set(image.subarray(i * chip.pageSize, (i + 1) * chip.pageSize));
    return out;
  };

  for (let i = 0; i < pageCount; i += 1) {
    try {
      await loadAddress(link, i * chip.pageSize);
      await command(link, [STK.PROG_PAGE, 0, chip.pageSize, 0x46, ...page(i)], 0, 600);
    } catch (e) {
      throw new UploadError(`Writing page ${i + 1}/${pageCount} failed (${(e as Error).message}).`, 'write');
    }
    onProgress({ stage: 'write', fraction: (i + 1) / pageCount, message: `Writing ${i + 1}/${pageCount}` });
  }

  for (let i = 0; i < pageCount; i += 1) {
    let read: Uint8Array;
    try {
      await loadAddress(link, i * chip.pageSize);
      read = await command(link, [STK.READ_PAGE, 0, chip.pageSize, 0x46], chip.pageSize, 600);
    } catch (e) {
      throw new UploadError(`Reading back page ${i + 1}/${pageCount} failed (${(e as Error).message}).`, 'verify');
    }
    const expected = page(i);
    const bad = expected.findIndex((b, j) => read[j] !== b);
    if (bad !== -1) {
      throw new UploadError(`Verification failed at address 0x${(i * chip.pageSize + bad).toString(16)}.`, 'verify');
    }
    onProgress({ stage: 'verify', fraction: (i + 1) / pageCount, message: `Verifying ${i + 1}/${pageCount}` });
  }

  // Optiboot starts the new program right after this.
  await command(link, [STK.LEAVE_PROGMODE]);
  onProgress({ stage: 'done', fraction: 1, message: 'Firmware installed and verified.' });
  return { bytes: image.length, pages: pageCount, signature };
}

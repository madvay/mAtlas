const MAX_VAR_UINT = 0x0fff_ffff;

export class UrlTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlTokenError';
  }
}

export class ByteWriter {
  private readonly bytes: number[] = [];

  writeByte(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
      throw new UrlTokenError(`Cannot encode byte ${String(value)}.`);
    }
    this.bytes.push(value);
  }

  writeVarUint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VAR_UINT) {
      throw new UrlTokenError(`Cannot encode unsigned integer ${String(value)}.`);
    }
    let remaining = value;
    do {
      const next = remaining & 0x7f;
      remaining = Math.floor(remaining / 128);
      this.writeByte(remaining ? next | 0x80 : next);
    } while (remaining);
  }

  writeBytes(values: Uint8Array): void {
    for (const value of values) this.writeByte(value);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class ByteReader {
  private offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly end = bytes.length
  ) {}

  get remaining(): number {
    return this.end - this.offset;
  }

  readByte(label: string): number {
    if (this.offset >= this.end) throw new UrlTokenError(`Truncated URL token while reading ${label}.`);
    return this.bytes[this.offset++] ?? 0;
  }

  readVarUint(label: string): number {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.readByte(label);
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (value > MAX_VAR_UINT) throw new UrlTokenError(`${label} exceeds the supported range.`);
        return value;
      }
      multiplier *= 128;
    }
    throw new UrlTokenError(`${label} uses an invalid variable-length integer.`);
  }

  readBytes(length: number, label: string): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new UrlTokenError(`Truncated URL token while reading ${label}.`);
    }
    const start = this.offset;
    this.offset += length;
    return this.bytes.subarray(start, this.offset);
  }
}

export function bitsetByteLength(slotCount: number): number {
  return Math.ceil(slotCount / 8);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(token: string): Uint8Array {
  if (!token || !/^[A-Za-z0-9_-]+$/u.test(token)) throw new UrlTokenError('URL token is not valid unpadded Base64URL.');
  const remainder = token.length % 4;
  if (remainder === 1) throw new UrlTokenError('URL token has an invalid Base64URL length.');
  const padded = `${token.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - remainder) % 4)}`;
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new UrlTokenError('URL token is not valid Base64URL.');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

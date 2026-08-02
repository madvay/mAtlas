import { deflateRawSync } from 'node:zlib';

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const CRC_TABLE = (() => {
  const values = new Uint32Array(256);
  for (let index = 0; index < values.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xEDB88320 : 0);
    values[index] = value >>> 0;
  }
  return values;
})();

function crc32(bytes) {
  let value = 0xFFFFFFFF;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xFF] ?? 0) ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function uint16(value) {
  const bytes = Buffer.allocUnsafe(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
}

function uint32(value) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32LE(value >>> 0, 0);
  return bytes;
}

function normalizedPath(pathname) {
  const path = String(pathname).replaceAll('\\', '/').replace(/^\/+/, '');
  if (!path || path.endsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid ZIP entry path: ${pathname}`);
  }
  return path;
}

/** Creates a deterministic UTF-8 ZIP archive with fixed timestamps. */
export function createZipArchive(entries) {
  const sorted = [...entries]
    .map((entry) => ({ pathname: normalizedPath(entry.pathname), bytes: Buffer.from(entry.bytes) }))
    .sort((left, right) => left.pathname.localeCompare(right.pathname));
  const localFiles = [];
  const centralFiles = [];
  let localOffset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.pathname, 'utf8');
    const compressed = deflateRawSync(entry.bytes, { level: 9 });
    const useCompressed = compressed.byteLength < entry.bytes.byteLength;
    const payload = useCompressed ? compressed : entry.bytes;
    const method = useCompressed ? 8 : 0;
    const checksum = crc32(entry.bytes);
    const flags = 0x0800;
    const localHeader = Buffer.concat([
      uint32(0x04034B50), uint16(20), uint16(flags), uint16(method), uint16(DOS_TIME), uint16(DOS_DATE),
      uint32(checksum), uint32(payload.byteLength), uint32(entry.bytes.byteLength), uint16(name.byteLength), uint16(0), name
    ]);
    const centralHeader = Buffer.concat([
      uint32(0x02014B50), uint16(0x0314), uint16(20), uint16(flags), uint16(method), uint16(DOS_TIME), uint16(DOS_DATE),
      uint32(checksum), uint32(payload.byteLength), uint32(entry.bytes.byteLength), uint16(name.byteLength), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0o100644 << 16), uint32(localOffset), name
    ]);
    localFiles.push(localHeader, payload);
    centralFiles.push(centralHeader);
    localOffset += localHeader.byteLength + payload.byteLength;
  }
  const centralDirectory = Buffer.concat(centralFiles);
  const end = Buffer.concat([
    uint32(0x06054B50), uint16(0), uint16(0), uint16(sorted.length), uint16(sorted.length),
    uint32(centralDirectory.byteLength), uint32(localOffset), uint16(0)
  ]);
  return Buffer.concat([...localFiles, centralDirectory, end]);
}

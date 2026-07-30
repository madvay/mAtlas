import type { AppState, ShareCodecConfig, ShareCodecSlot, UrlUiState } from '../types.js';
import {
  base64UrlToBytes,
  bitsetByteLength,
  ByteReader,
  ByteWriter,
  bytesToBase64Url,
  UrlTokenError
} from './binary-token.js';

export { UrlTokenError as FilterTokenError } from './binary-token.js';

function slotId(slot: ShareCodecSlot | undefined): string | null {
  return slot && typeof slot.id === 'string' ? slot.id : null;
}

function encodeBitset(slots: readonly ShareCodecSlot[], selected: ReadonlySet<string>): Uint8Array {
  const bytes = new Uint8Array(bitsetByteLength(slots.length));
  const known = new Set<string>();
  slots.forEach((slot, index) => {
    const id = slotId(slot);
    if (!id) return;
    known.add(id);
    if (selected.has(id)) bytes[Math.floor(index / 8)]! |= 1 << (index % 8);
  });
  for (const id of selected) {
    if (!known.has(id)) throw new UrlTokenError(`Filter codec has no slot for identifier "${id}".`);
  }
  return bytes;
}

function decodeBitset(
  bytes: Uint8Array,
  encodedSlotCount: number,
  slots: readonly ShareCodecSlot[]
): string[] {
  const result: string[] = [];
  const knownCount = Math.min(encodedSlotCount, slots.length);
  for (let index = 0; index < knownCount; index += 1) {
    const id = slotId(slots[index]);
    if (id && ((bytes[Math.floor(index / 8)] ?? 0) & (1 << (index % 8))) !== 0) result.push(id);
  }
  return result;
}

function readBitset(reader: ByteReader, slotCount: number, label: string): Uint8Array {
  return reader.readBytes(bitsetByteLength(slotCount), label);
}

const FILTER_EXTENSION_PROHIBITED_DOMAINS = 1;

function encodeFilterExtensions(state: AppState, codec: ShareCodecConfig): Uint8Array {
  const prohibitedDomains = state.prohibitedDomains ?? new Set<string>();
  if (prohibitedDomains.size === 0) return new Uint8Array();
  const payload = new ByteWriter();
  payload.writeVarUint(codec.domains.length);
  payload.writeBytes(encodeBitset(codec.domains, prohibitedDomains));
  const payloadBytes = payload.toUint8Array();

  const extensions = new ByteWriter();
  extensions.writeVarUint(FILTER_EXTENSION_PROHIBITED_DOMAINS);
  extensions.writeVarUint(payloadBytes.length);
  extensions.writeBytes(payloadBytes);
  return extensions.toUint8Array();
}

function decodeFilterExtensions(bytes: Uint8Array, codec: ShareCodecConfig): Pick<UrlUiState, 'prohibitedDomains'> {
  const reader = new ByteReader(bytes);
  let prohibitedDomains: string[] | undefined;
  while (reader.remaining > 0) {
    const tag = reader.readVarUint('filter extension tag');
    const length = reader.readVarUint(`filter extension ${tag} length`);
    const payloadBytes = reader.readBytes(length, `filter extension ${tag}`);
    if (tag !== FILTER_EXTENSION_PROHIBITED_DOMAINS) continue;
    const payload = new ByteReader(payloadBytes);
    const domainCount = payload.readVarUint('prohibited-domain slot count');
    const domainBits = readBitset(payload, domainCount, 'prohibited domains');
    if (payload.remaining !== 0) throw new UrlTokenError('Prohibited-domain filter extension contains trailing data.');
    prohibitedDomains = decodeBitset(domainBits, domainCount, codec.domains);
  }
  return prohibitedDomains === undefined ? {} : { prohibitedDomains };
}

export function encodeFilterToken(state: AppState, codec: ShareCodecConfig): string {
  const writer = new ByteWriter();
  writer.writeByte(codec.formatVersion);
  writer.writeVarUint(codec.fields.length);
  writer.writeVarUint(codec.domains.length);
  writer.writeVarUint(codec.edgeTypes.length);
  writer.writeBytes(encodeBitset(codec.fields, state.selectedFields));
  writer.writeBytes(encodeBitset(codec.domains, state.selectedDomains));
  writer.writeBytes(encodeBitset(codec.edgeTypes, state.selectedEdgeTypes));
  writer.writeBytes(encodeBitset(codec.fields, state.excludedFields));
  writer.writeBytes(encodeBitset(codec.domains, state.excludedDomains));

  // Length-delimited TLV extension block. Older format-1 decoders safely skip
  // it; newer decoders can append independently tagged records without moving
  // any of the permanent field/domain/edge bitset slots above.
  const extensions = encodeFilterExtensions(state, codec);
  writer.writeVarUint(extensions.length);
  writer.writeBytes(extensions);
  return bytesToBase64Url(writer.toUint8Array());
}

export function decodeFilterToken(token: string, codec: ShareCodecConfig): UrlUiState {
  const reader = new ByteReader(base64UrlToBytes(token));
  const formatVersion = reader.readByte('filter format version');
  if (formatVersion !== codec.formatVersion) {
    throw new UrlTokenError(`Unsupported filter token format version ${formatVersion}; this atlas supports version ${codec.formatVersion}.`);
  }

  const fieldCount = reader.readVarUint('field slot count');
  const domainCount = reader.readVarUint('domain slot count');
  const edgeTypeCount = reader.readVarUint('edge-type slot count');
  const selectedFields = readBitset(reader, fieldCount, 'selected fields');
  const selectedDomains = readBitset(reader, domainCount, 'selected domains');
  const selectedEdgeTypes = readBitset(reader, edgeTypeCount, 'selected edge types');
  const excludedFields = readBitset(reader, fieldCount, 'excluded fields');
  const excludedDomains = readBitset(reader, domainCount, 'excluded domains');

  const extensionLength = reader.readVarUint('filter extension block length');
  const extensions = decodeFilterExtensions(reader.readBytes(extensionLength, 'filter extension block'), codec);
  if (reader.remaining !== 0) throw new UrlTokenError('Filter token contains trailing data.');

  return {
    fields: decodeBitset(selectedFields, fieldCount, codec.fields),
    domains: decodeBitset(selectedDomains, domainCount, codec.domains),
    edgeTypes: decodeBitset(selectedEdgeTypes, edgeTypeCount, codec.edgeTypes),
    excludedFields: decodeBitset(excludedFields, fieldCount, codec.fields),
    excludedDomains: decodeBitset(excludedDomains, domainCount, codec.domains),
    ...extensions
  };
}

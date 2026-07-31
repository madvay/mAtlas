import type { AppState, CrossFieldVisibility, LayoutName, UrlUiState } from '../types.js';
import {
  base64UrlToBytes,
  bitsetByteLength,
  ByteReader,
  ByteWriter,
  bytesToBase64Url,
  UrlTokenError
} from './binary-token.js';

export { UrlTokenError as DisplayTokenError } from './binary-token.js';

export type DisplayCodecSlot =
  | { readonly id: string; readonly retired?: never }
  | { readonly id?: never; readonly retired: string };

export type DisplayCodecEnumSetting =
  | { readonly id: string; readonly retired?: never; readonly values: readonly DisplayCodecSlot[] }
  | { readonly id?: never; readonly retired: string; readonly values: readonly DisplayCodecSlot[] };

export interface DisplayTokenCodec {
  readonly formatVersion: number;
  readonly booleans: readonly DisplayCodecSlot[];
  readonly enums: readonly DisplayCodecEnumSetting[];
}

// APPEND-ONLY DISPLAY WIRE REGISTRY.
//
// These indexes are permanent wire identifiers for `disp=`. Never reorder or
// delete a slot. Retire one in place by changing `{ id: 'old' }` to
// `{ retired: 'old' }`. Add Boolean settings, enum settings, and enum values
// only at the end of their corresponding arrays. Increment formatVersion only
// for a genuinely incompatible binary-format change, not for appended slots.
export const DISPLAY_TOKEN_CODEC: DisplayTokenCodec = Object.freeze({
  formatVersion: 1,
  booleans: Object.freeze([
    Object.freeze({ id: 'showPrimaryOnly' }),
    Object.freeze({ id: 'hideIsolates' }),
    Object.freeze({ id: 'edgeLabels' }),
    Object.freeze({ id: 'junctions' }),
    Object.freeze({ id: 'edgeZoomActivation' }),
    Object.freeze({ id: 'hidePrerequisites' })
  ]),
  enums: Object.freeze([
    Object.freeze({
      id: 'crossFieldVisibility',
      values: Object.freeze([
        Object.freeze({ id: 'contextual' }),
        Object.freeze({ id: 'all' }),
        Object.freeze({ id: 'hidden' })
      ])
    }),
    Object.freeze({
      id: 'layout',
      values: Object.freeze([
        Object.freeze({ id: 'atlas' }),
        Object.freeze({ id: 'breadthfirst' }),
        Object.freeze({ id: 'domains' }),
        Object.freeze({ id: 'fields' })
      ])
    })
  ])
});

function slotId(slot: DisplayCodecSlot | DisplayCodecEnumSetting | undefined): string | null {
  return slot && typeof slot.id === 'string' ? slot.id : null;
}

function slotName(slot: DisplayCodecSlot | undefined): string | undefined {
  if (!slot) return undefined;
  return 'id' in slot ? slot.id : slot.retired;
}

function stateBooleanValue(state: AppState, id: string): boolean | undefined {
  switch (id) {
    case 'showPrimaryOnly': return state.showPrimaryOnly;
    case 'hideIsolates': return state.hideIsolates;
    case 'edgeLabels': return state.showEdgeLabels;
    case 'junctions': return state.showJunctions;
    case 'edgeZoomActivation': return state.edgeZoomActivation;
    case 'hidePrerequisites': return state.hidePrerequisites;
    default: return undefined;
  }
}

function stateEnumValue(state: AppState, id: string): string | undefined {
  switch (id) {
    case 'crossFieldVisibility': return state.crossFieldVisibility;
    case 'layout': return state.layout;
    default: return undefined;
  }
}

function applyBoolean(result: UrlUiState, id: string, value: boolean): void {
  switch (id) {
    case 'showPrimaryOnly': result.showPrimaryOnly = value; break;
    case 'hideIsolates': result.hideIsolates = value; break;
    case 'edgeLabels': result.edgeLabels = value; break;
    case 'junctions': result.junctions = value; break;
    case 'edgeZoomActivation': result.edgeZoomActivation = value; break;
    case 'hidePrerequisites': result.hidePrerequisites = value; break;
    default: break;
  }
}

function applyEnum(result: UrlUiState, id: string, value: string): void {
  switch (id) {
    case 'crossFieldVisibility':
      if (value === 'contextual' || value === 'all' || value === 'hidden') {
        result.crossFieldVisibility = value as CrossFieldVisibility;
      }
      break;
    case 'layout':
      if (value === 'atlas' || value === 'breadthfirst' || value === 'domains' || value === 'fields') result.layout = value as LayoutName;
      break;
    default:
      break;
  }
}

export type DisplayTokenValues = Readonly<Record<string, boolean | string>>;

export function encodeDisplayTokenValues(
  values: DisplayTokenValues,
  codec: DisplayTokenCodec = DISPLAY_TOKEN_CODEC
): string {
  const writer = new ByteWriter();
  writer.writeByte(codec.formatVersion);
  writer.writeVarUint(codec.booleans.length);
  writer.writeVarUint(codec.enums.length);

  const booleans = new Uint8Array(bitsetByteLength(codec.booleans.length));
  codec.booleans.forEach((slot, index) => {
    const id = slotId(slot);
    if (!id) return;
    const value = values[id];
    if (value !== undefined && typeof value !== 'boolean') {
      throw new UrlTokenError(`Display setting "${id}" must be Boolean.`);
    }
    if (value === true) booleans[Math.floor(index / 8)]! |= 1 << (index % 8);
  });
  writer.writeBytes(booleans);

  for (const setting of codec.enums) {
    const settingId = slotId(setting);
    if (!settingId) {
      writer.writeVarUint(0);
      continue;
    }
    const value = values[settingId];
    if (typeof value !== 'string') throw new UrlTokenError(`Display enum "${settingId}" has no string value.`);
    const valueIndex = setting.values.findIndex((slot) => slotId(slot) === value);
    if (valueIndex < 0) throw new UrlTokenError(`Display enum ${settingId} has no slot for value "${value}".`);
    writer.writeVarUint(valueIndex);
  }

  // Reserved length-delimited extension block, independently versioned from
  // the filter codec and safely skipped by current format-1 decoders.
  writer.writeVarUint(0);
  return bytesToBase64Url(writer.toUint8Array());
}

export function decodeDisplayTokenValues(
  token: string,
  codec: DisplayTokenCodec = DISPLAY_TOKEN_CODEC
): Record<string, boolean | string> {
  const reader = new ByteReader(base64UrlToBytes(token));
  const formatVersion = reader.readByte('display format version');
  if (formatVersion !== codec.formatVersion) {
    throw new UrlTokenError(`Unsupported display token format version ${formatVersion}; this atlas supports version ${codec.formatVersion}.`);
  }

  const booleanCount = reader.readVarUint('Boolean-setting slot count');
  const enumCount = reader.readVarUint('enum-setting slot count');
  const booleans = reader.readBytes(bitsetByteLength(booleanCount), 'Boolean settings');
  const result: Record<string, boolean | string> = {};

  const knownBooleanCount = Math.min(booleanCount, codec.booleans.length);
  for (let index = 0; index < knownBooleanCount; index += 1) {
    const id = slotId(codec.booleans[index]);
    if (id) result[id] = ((booleans[Math.floor(index / 8)] ?? 0) & (1 << (index % 8))) !== 0;
  }

  for (let index = 0; index < enumCount; index += 1) {
    const valueIndex = reader.readVarUint(`enum value ${index}`);
    const setting = codec.enums[index];
    const settingId = slotId(setting);
    const valueName = slotName(setting?.values[valueIndex]);
    if (settingId && valueName) result[settingId] = valueName;
  }

  const extensionLength = reader.readVarUint('display extension block length');
  reader.readBytes(extensionLength, 'display extension block');
  if (reader.remaining !== 0) throw new UrlTokenError('Display token contains trailing data.');
  return result;
}

export function encodeDisplayToken(state: AppState): string {
  const values: Record<string, boolean | string> = {};
  for (const slot of DISPLAY_TOKEN_CODEC.booleans) {
    const id = slotId(slot);
    if (!id) continue;
    const value = stateBooleanValue(state, id);
    if (value === undefined) throw new UrlTokenError(`Display Boolean registry contains unsupported active setting "${id}".`);
    values[id] = value;
  }
  for (const setting of DISPLAY_TOKEN_CODEC.enums) {
    const settingId = slotId(setting);
    if (!settingId) continue;
    const value = stateEnumValue(state, settingId);
    if (value === undefined) throw new UrlTokenError(`Display enum registry contains unsupported active setting "${settingId}".`);
    values[settingId] = value;
  }
  return encodeDisplayTokenValues(values);
}

export function decodeDisplayToken(token: string): UrlUiState {
  const values = decodeDisplayTokenValues(token);
  const result: UrlUiState = {};
  for (const [id, value] of Object.entries(values)) {
    if (typeof value === 'boolean') applyBoolean(result, id, value);
    else applyEnum(result, id, value);
  }
  return result;
}

import { isObject } from '../validation-helpers.mjs';

export const name = 'share-codec';

const SUPPORTED_FORMAT_VERSION = 1;

function validateSlots(errors, value, path) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an append-only sequence of codec slots.`);
    return [];
  }
  const activeIds = [];
  const allNames = new Set();
  for (const [index, slot] of value.entries()) {
    const slotPath = `${path}[${index}]`;
    if (!isObject(slot)) {
      errors.push(`${slotPath} must be an object containing exactly one of id or retired.`);
      continue;
    }
    const keys = Object.keys(slot);
    const hasId = typeof slot.id === 'string' && slot.id.length > 0;
    const hasRetired = typeof slot.retired === 'string' && slot.retired.length > 0;
    if (keys.some((key) => key !== 'id' && key !== 'retired') || hasId === hasRetired || keys.length !== 1) {
      errors.push(`${slotPath} must contain exactly one non-empty string property: id or retired.`);
      continue;
    }
    const slotName = hasId ? slot.id : slot.retired;
    if (allNames.has(slotName)) errors.push(`${path} repeats codec slot name "${slotName}".`);
    allNames.add(slotName);
    if (hasId) activeIds.push(slotName);
  }
  return activeIds;
}

function requireExactActiveIds(errors, actualIds, expectedIds, path) {
  const actualCounts = new Map();
  for (const id of actualIds) actualCounts.set(id, (actualCounts.get(id) ?? 0) + 1);
  for (const id of expectedIds) {
    const count = actualCounts.get(id) ?? 0;
    if (count !== 1) errors.push(`${path} must contain active id "${id}" exactly once (found ${count}).`);
  }
  const expected = new Set(expectedIds);
  for (const id of actualCounts.keys()) if (!expected.has(id)) errors.push(`${path} contains unknown active id "${id}".`);
}

export function validate(context) {
  const { shareCodec, fieldIds, domainIds, edgeTypeIds } = context;
  const errors = [];
  if (!isObject(shareCodec)) return ['share codec must be an object.'];
  const allowedKeys = new Set(['formatVersion', 'fields', 'domains', 'edgeTypes']);
  for (const key of Object.keys(shareCodec)) if (!allowedKeys.has(key)) errors.push(`shareCodec has unknown property "${key}".`);
  if (shareCodec.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    errors.push(`shareCodec.formatVersion must be ${SUPPORTED_FORMAT_VERSION}.`);
  }

  const codecFieldIds = validateSlots(errors, shareCodec.fields, 'shareCodec.fields');
  const codecDomainIds = validateSlots(errors, shareCodec.domains, 'shareCodec.domains');
  const codecEdgeTypeIds = validateSlots(errors, shareCodec.edgeTypes, 'shareCodec.edgeTypes');
  requireExactActiveIds(errors, codecFieldIds, fieldIds, 'shareCodec.fields');
  requireExactActiveIds(errors, codecDomainIds, domainIds, 'shareCodec.domains');
  requireExactActiveIds(errors, codecEdgeTypeIds, edgeTypeIds, 'shareCodec.edgeTypes');
  return errors;
}

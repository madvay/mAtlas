import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlToBytes } from '../../.test-build/state/binary-token.js';
import {
  decodeDisplayToken,
  decodeDisplayTokenValues,
  DISPLAY_TOKEN_CODEC,
  DisplayTokenError,
  encodeDisplayToken,
  encodeDisplayTokenValues
} from '../../.test-build/state/display-token.js';

function state(overrides = {}) {
  return {
    selectedFields: new Set(['math']),
    selectedDomains: new Set(['logic']),
    selectedEdgeTypes: new Set(['implies']),
    excludedFields: new Set(),
    excludedDomains: new Set(),
    crossFieldVisibility: 'hidden',
    showPrimaryOnly: true,
    hideIsolates: true,
    showEdgeLabels: false,
    showJunctions: true,
    edgeZoomActivation: false,
    hidePrerequisites: true,
    neighborhoodActive: false,
    neighborhoodElementId: null,
    layout: 'breadthfirst',
    searchQuery: '',
    filtersOpen: false,
    detailsOpen: false,
    ...overrides
  };
}

const values = {
  showPrimaryOnly: true,
  hideIsolates: true,
  edgeLabels: false,
  junctions: true,
  edgeZoomActivation: false,
  hidePrerequisites: true,
  crossFieldVisibility: 'hidden',
  layout: 'breadthfirst'
};

test('display tokens round-trip only software-defined flags and enums', () => {
  const token = encodeDisplayToken(state());
  assert.equal(token, 'AQYCKwIBAA', 'format-1 display wire indexes are stable');
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeDisplayToken(token), {
    crossFieldVisibility: 'hidden',
    showPrimaryOnly: true,
    hideIsolates: true,
    edgeLabels: false,
    junctions: true,
    edgeZoomActivation: false,
    hidePrerequisites: true,
    layout: 'breadthfirst'
  });
  assert.equal(base64UrlToBytes(token).length, 7, 'the display fixture contains no checksum bytes');
});

test('display encoding is deterministic and independently versioned', () => {
  assert.equal(encodeDisplayToken(state()), encodeDisplayToken(state()));
  assert.throws(
    () => decodeDisplayTokenValues(encodeDisplayToken(state()), { ...DISPLAY_TOKEN_CODEC, formatVersion: 2 }),
    /Unsupported display token format version/
  );
});

test('an extended display registry decodes older tokens without assigning appended defaults', () => {
  const extended = {
    ...DISPLAY_TOKEN_CODEC,
    booleans: [
      ...DISPLAY_TOKEN_CODEC.booleans,
      { id: 'futureBooleanA' },
      { id: 'futureBooleanB' },
      { id: 'futureBooleanC' }
    ],
    enums: [
      ...DISPLAY_TOKEN_CODEC.enums,
      { id: 'futureEnum', values: [{ id: 'first' }, { id: 'second' }] }
    ]
  };
  const decoded = decodeDisplayTokenValues(encodeDisplayTokenValues(values), extended);
  assert.equal(decoded.layout, 'breadthfirst');
  assert.equal('futureBooleanA' in decoded, false);
  assert.equal('futureEnum' in decoded, false);
});

test('older display decoders ignore appended settings and enum values', () => {
  const extended = {
    ...DISPLAY_TOKEN_CODEC,
    booleans: [...DISPLAY_TOKEN_CODEC.booleans, { id: 'futureBoolean' }],
    enums: [
      DISPLAY_TOKEN_CODEC.enums[0],
      { id: 'layout', values: [...DISPLAY_TOKEN_CODEC.enums[1].values, { id: 'future-layout' }] },
      { id: 'futureEnum', values: [{ id: 'first' }, { id: 'second' }] }
    ]
  };
  const token = encodeDisplayTokenValues({
    ...values,
    futureBoolean: true,
    layout: 'future-layout',
    futureEnum: 'second'
  }, extended);
  const decoded = decodeDisplayTokenValues(token);
  assert.equal(decoded.crossFieldVisibility, 'hidden');
  assert.equal(decoded.layout, undefined);
  assert.equal('futureBoolean' in decoded, false);
  assert.equal('futureEnum' in decoded, false);
});


test('retired display slots remain encoded in place and decode inertly', () => {
  const withRetired = {
    ...DISPLAY_TOKEN_CODEC,
    booleans: [...DISPLAY_TOKEN_CODEC.booleans, { retired: 'oldBoolean' }],
    enums: [
      ...DISPLAY_TOKEN_CODEC.enums,
      { retired: 'oldEnum', values: [{ retired: 'oldValue' }] }
    ]
  };
  const token = encodeDisplayTokenValues(values, withRetired);
  const decoded = decodeDisplayTokenValues(token, withRetired);
  assert.equal(decoded.layout, 'breadthfirst');
  assert.equal('oldBoolean' in decoded, false);
  assert.equal('oldEnum' in decoded, false);
});

test('display alphabet and structural errors are explicit', () => {
  const token = encodeDisplayToken(state());
  assert.throws(() => decodeDisplayToken('not valid!'), DisplayTokenError);
  assert.throws(() => decodeDisplayToken(token.slice(0, -2)), /Truncated|extension/);
  assert.throws(() => decodeDisplayToken(`${token}AA`), /trailing data|extension/);
  assert.throws(() => encodeDisplayTokenValues({ ...values, layout: 'missing' }), /no slot/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlToBytes, bitsetByteLength, ByteReader } from '../../.test-build/state/binary-token.js';
import { decodeFilterToken, encodeFilterToken, FilterTokenError } from '../../.test-build/state/filter-token.js';

const slot = (id) => ({ id });
const codec = {
  formatVersion: 1,
  fields: ['math', 'physics'].map(slot),
  domains: ['set-theory', 'logic', 'mechanics'].map(slot),
  edgeTypes: ['add-data', 'impose-axiom', 'verified-by'].map(slot)
};

function state(overrides = {}) {
  return {
    selectedFields: new Set(['math']),
    selectedDomains: new Set(['set-theory', 'logic']),
    selectedEdgeTypes: new Set(['add-data', 'impose-axiom']),
    excludedFields: new Set(['physics']),
    excludedDomains: new Set(['mechanics']),
    prohibitedDomains: new Set(),
    crossFieldVisibility: 'all',
    showPrimaryOnly: false,
    hideIsolates: true,
    showEdgeLabels: true,
    showJunctions: true,
    edgeZoomActivation: true,
    hidePrerequisites: false,
    neighborhoodActive: false,
    neighborhoodElementId: null,
    layout: 'breadthfirst',
    searchQuery: '',
    filtersOpen: false,
    detailsOpen: false,
    ...overrides
  };
}

test('filter tokens round-trip only catalog-backed selection state', () => {
  const token = encodeFilterToken(state(), codec);
  assert.equal(token, 'AQIDAwEDAwIEAA', 'format-1 filter wire indexes are stable');
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeFilterToken(token, codec), {
    fields: ['math'],
    domains: ['set-theory', 'logic'],
    edgeTypes: ['add-data', 'impose-axiom'],
    excludedFields: ['physics'],
    excludedDomains: ['mechanics']
  });
  assert.equal(base64UrlToBytes(token).length, 10, 'the filter fixture contains no checksum bytes');
});

test('prohibited domains use the skippable format-1 extension block', () => {
  const token = encodeFilterToken(state({
    excludedDomains: new Set(),
    prohibitedDomains: new Set(['mechanics'])
  }), codec);
  assert.deepEqual(decodeFilterToken(token, codec).prohibitedDomains, ['mechanics']);

  const reader = new ByteReader(base64UrlToBytes(token));
  assert.equal(reader.readByte('version'), 1);
  const fieldCount = reader.readVarUint('fields');
  const domainCount = reader.readVarUint('domains');
  const edgeTypeCount = reader.readVarUint('edges');
  reader.readBytes(bitsetByteLength(fieldCount), 'selected fields');
  reader.readBytes(bitsetByteLength(domainCount), 'selected domains');
  reader.readBytes(bitsetByteLength(edgeTypeCount), 'selected edges');
  reader.readBytes(bitsetByteLength(fieldCount), 'excluded fields');
  reader.readBytes(bitsetByteLength(domainCount), 'excluded domains');
  const extensionLength = reader.readVarUint('extension length');
  assert.ok(extensionLength > 0);
  reader.readBytes(extensionLength, 'extension');
  assert.equal(reader.remaining, 0, 'an older format-1 decoder can skip the extension wholesale');
});

test('filter encoding is deterministic and follows codec order rather than Set insertion order', () => {
  const first = encodeFilterToken(state(), codec);
  const second = encodeFilterToken(state({
    selectedDomains: new Set(['logic', 'set-theory']),
    selectedEdgeTypes: new Set(['impose-axiom', 'add-data'])
  }), codec);
  assert.equal(second, first);
});

test('empty filter selections remain explicit instead of falling back to defaults', () => {
  const decoded = decodeFilterToken(encodeFilterToken(state({
    selectedFields: new Set(),
    selectedDomains: new Set(),
    selectedEdgeTypes: new Set(),
    excludedFields: new Set(),
    excludedDomains: new Set()
  }), codec), codec);
  assert.deepEqual(decoded.fields, []);
  assert.deepEqual(decoded.domains, []);
  assert.deepEqual(decoded.edgeTypes, []);
  assert.deepEqual(decoded.excludedFields, []);
  assert.deepEqual(decoded.excludedDomains, []);
});

test('append-only catalog slots preserve older filter tokens', () => {
  const token = encodeFilterToken(state(), codec);
  const extended = {
    ...codec,
    fields: [...codec.fields, slot('future-field')],
    domains: [...codec.domains, slot('future-domain')],
    edgeTypes: [...codec.edgeTypes, slot('future-edge')]
  };
  const decoded = decodeFilterToken(token, extended);
  assert.deepEqual(decoded.fields, ['math']);
  assert.deepEqual(decoded.domains, ['set-theory', 'logic']);
  assert.deepEqual(decoded.edgeTypes, ['add-data', 'impose-axiom']);
});

test('filter alphabet, structure, version, and catalog coverage errors are explicit', () => {
  const token = encodeFilterToken(state(), codec);
  assert.throws(() => decodeFilterToken('not valid!', codec), FilterTokenError);
  assert.throws(() => decodeFilterToken(token.slice(0, -2), codec), /Truncated|extension/);
  assert.throws(() => decodeFilterToken(`${token}AA`, codec), /trailing data|extension/);
  assert.throws(() => decodeFilterToken(token, { ...codec, formatVersion: 2 }), /Unsupported filter token format version/);
  assert.throws(() => encodeFilterToken(state({ selectedFields: new Set(['missing']) }), codec), /no slot/);
});

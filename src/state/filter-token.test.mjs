import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlToBytes } from '../../.test-build/state/binary-token.js';
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

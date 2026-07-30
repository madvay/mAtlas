import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './share-codec.mjs';

const slot = (id) => ({ id });
function context(overrides = {}) {
  return {
    fieldIds: new Set(['math', 'physics']),
    domainIds: new Set(['logic', 'mechanics']),
    edgeTypeIds: new Set(['builds', 'verifies']),
    shareCodec: {
      formatVersion: 1,
      fields: ['math', 'physics'].map(slot),
      domains: ['logic', 'mechanics'].map(slot),
      edgeTypes: ['builds', 'verifies'].map(slot)
    },
    ...overrides
  };
}

test('share codec validation requires every live taxonomy and edge-type id exactly once', () => {
  assert.deepEqual(validate(context()), []);
  const broken = context();
  broken.shareCodec.fields = [{ id: 'math' }, { id: 'math' }, { id: 'unknown' }];
  broken.shareCodec.domains = [{ id: 'logic' }];
  broken.shareCodec.edgeTypes = [{ id: 'builds' }, { retired: 'old-edge' }];
  const errors = validate(broken).join('\n');
  assert.match(errors, /repeats codec slot name "math"/);
  assert.match(errors, /active id "physics" exactly once \(found 0\)/);
  assert.match(errors, /unknown active id "unknown"/);
  assert.match(errors, /active id "mechanics" exactly once \(found 0\)/);
  assert.match(errors, /active id "verifies" exactly once \(found 0\)/);
});

test('retired slots preserve positions without counting as live identifiers', () => {
  const value = context();
  value.shareCodec.fields.splice(1, 0, { retired: 'obsolete-field' });
  assert.deepEqual(validate(value), []);
});

test('display registries are forbidden in content and malformed slots are rejected', () => {
  const value = context();
  value.shareCodec.booleans = [{ id: 'edgeLabels' }];
  value.shareCodec.enums = [{ id: 'layout', values: [{ id: 'atlas' }] }];
  value.shareCodec.domains.push({ id: 'bad', retired: 'also-bad' });
  const errors = validate(value).join('\n');
  assert.match(errors, /unknown property "booleans"/);
  assert.match(errors, /unknown property "enums"/);
  assert.match(errors, /exactly one non-empty string property: id or retired/);
});

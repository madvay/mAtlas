import test from 'node:test';
import assert from 'node:assert/strict';
import { copyConnectionQueryState, readConnectionQueryState, writeConnectionQueryState } from '../../.test-build/state/connection-state.js';

const known = new Set(['a', 'b']);

test('connection query state round-trips with compact defaults', () => {
  const params = new URLSearchParams('unrelated=1');
  writeConnectionQueryState(params, { sourceId: 'a', targetId: 'b', direction: 'either', pathIndex: 0 });
  assert.equal(params.toString(), 'unrelated=1&connectFrom=a&connectTo=b');
  assert.deepEqual(readConnectionQueryState(params, known), {
    sourceId: 'a', targetId: 'b', direction: 'either', pathIndex: 0
  });
});

test('invalid endpoints are ignored and connection parameters can be copied', () => {
  assert.equal(readConnectionQueryState(new URLSearchParams('connectFrom=a&connectTo=x'), known), null);
  assert.equal(readConnectionQueryState(new URLSearchParams('connectFrom=a&connectTo=a'), known), null);
  const target = new URLSearchParams();
  copyConnectionQueryState(new URLSearchParams('connectFrom=a&connectTo=b&connectDir=forward&connectPath=2'), target);
  assert.equal(target.toString(), 'connectFrom=a&connectTo=b&connectDir=forward&connectPath=2');
});

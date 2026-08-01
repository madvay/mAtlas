import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSpatialItemIndex } from '../../.test-build/ui/graph-accessibility-controller.js';

const items = [
  { id: 'center', x: 0, y: 0 },
  { id: 'left', x: -10, y: 1 },
  { id: 'right', x: 10, y: 1 },
  { id: 'up', x: 1, y: -10 },
  { id: 'down', x: 1, y: 10 }
];

test('spatial graph navigation chooses the nearest item in each direction', () => {
  assert.equal(nextSpatialItemIndex(items, 0, 'left'), 1);
  assert.equal(nextSpatialItemIndex(items, 0, 'right'), 2);
  assert.equal(nextSpatialItemIndex(items, 0, 'up'), 3);
  assert.equal(nextSpatialItemIndex(items, 0, 'down'), 4);
});

test('spatial graph navigation remains stable for a single item', () => {
  assert.equal(nextSpatialItemIndex([items[0]], 0, 'right'), 0);
});

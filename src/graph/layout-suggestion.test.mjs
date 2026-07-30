import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLayoutWouldHelp } from '../../.test-build/graph/layout-suggestion.js';

test('suggests Compact for a wide sparse layered graph', () => {
  assert.equal(compactLayoutWouldHelp({
    width: 7200,
    height: 3600,
    nodeCount: 48,
    levelCounts: [4, 6, 5, 8, 7, 6, 5, 7]
  }), true);
});

test('does not suggest Compact for dense, small, or tall graphs', () => {
  assert.equal(compactLayoutWouldHelp({ width: 2500, height: 1500, nodeCount: 48, levelCounts: [12, 12, 12, 12] }), false);
  assert.equal(compactLayoutWouldHelp({ width: 5000, height: 4000, nodeCount: 48, levelCounts: [6, 6, 6, 6, 6, 6, 6, 6] }), false);
  assert.equal(compactLayoutWouldHelp({ width: 5000, height: 2000, nodeCount: 10, levelCounts: [3, 3, 4] }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { findConnectionPaths } from '../../.test-build/graph/connection-path.js';

const edge = (id, source, target) => ({ id, source, target, type: 'relation', label: id, detail: id, citations: [] });
const nodes = new Set(['a', 'b', 'c', 'd', 'e']);

test('finds deterministic shortest simple paths', () => {
  const paths = findConnectionPaths({
    sourceId: 'a', targetId: 'd', nodeIds: nodes,
    edges: [edge('z', 'a', 'c'), edge('b', 'c', 'd'), edge('a', 'a', 'b'), edge('c', 'b', 'd')]
  });
  assert.deepEqual(paths.map((path) => path.nodeIds), [
    ['a', 'b', 'd'],
    ['a', 'c', 'd']
  ]);
});

test('either-direction traversal records when a relation is followed backwards', () => {
  const [path] = findConnectionPaths({
    sourceId: 'a', targetId: 'c', nodeIds: nodes,
    edges: [edge('ba', 'b', 'a'), edge('bc', 'b', 'c')],
    direction: 'either'
  });
  assert.deepEqual(path.nodeIds, ['a', 'b', 'c']);
  assert.deepEqual(path.steps.map((step) => step.followsArrow), [false, true]);
});

test('forward traversal follows edge assertions only in their authored direction', () => {
  assert.deepEqual(findConnectionPaths({
    sourceId: 'a', targetId: 'c', nodeIds: nodes,
    edges: [edge('ba', 'b', 'a'), edge('bc', 'b', 'c')],
    direction: 'forward'
  }), []);
});

test('respects admissible nodes and maximum depth', () => {
  assert.deepEqual(findConnectionPaths({
    sourceId: 'a', targetId: 'd', nodeIds: new Set(['a', 'b', 'd']),
    edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd')]
  }), []);
  assert.deepEqual(findConnectionPaths({
    sourceId: 'a', targetId: 'd', nodeIds: nodes,
    edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd')],
    maxDepth: 2
  }), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrerequisiteAdjacency, prerequisiteClosure, prerequisiteClosureNodeIds } from '../../.test-build/model/prerequisite-closure.js';

const edgeTypes = {
  incoming: { prerequisiteTraversal: 'incoming' },
  outgoing: { prerequisiteTraversal: 'outgoing' },
  both: { prerequisiteTraversal: 'both' },
  none: { prerequisiteTraversal: 'none' }
};

const edges = [
  { id: 'a-to-b', source: 'a', target: 'b', type: 'incoming' },
  { id: 'b-to-c', source: 'b', target: 'c', type: 'outgoing' },
  { id: 'c-to-d', source: 'c', target: 'd', type: 'both' },
  { id: 'd-to-e', source: 'd', target: 'e', type: 'none' }
];

test('prerequisite closure follows the edge-type traversal declaration', () => {
  const adjacency = buildPrerequisiteAdjacency(edges, edgeTypes);
  const closure = prerequisiteClosure(['b'], adjacency, () => true);
  assert.deepEqual([...closure.nodeIds].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...closure.edgeIds].sort(), ['a-to-b', 'b-to-c', 'c-to-d']);
  assert.deepEqual([...prerequisiteClosureNodeIds(['a'], adjacency, () => true)], ['a']);
  assert.deepEqual([...prerequisiteClosureNodeIds(['d'], adjacency, () => true)].sort(), ['c', 'd']);
  assert.deepEqual([...prerequisiteClosureNodeIds(['e'], adjacency, () => true)], ['e']);
});

test('prerequisite closure applies edge and node predicates in one traversal implementation', () => {
  const adjacency = buildPrerequisiteAdjacency(edges, edgeTypes);
  assert.deepEqual(
    [...prerequisiteClosureNodeIds(['b'], adjacency, (edge) => edge.id !== 'b-to-c')].sort(),
    ['a', 'b']
  );
  const nodeFiltered = prerequisiteClosure(['b'], adjacency, () => true, (nodeId) => nodeId !== 'c');
  assert.deepEqual([...nodeFiltered.nodeIds].sort(), ['a', 'b']);
  assert.deepEqual([...nodeFiltered.edgeIds], ['a-to-b']);
});

test('prerequisite adjacency rejects missing traversal metadata', () => {
  assert.throws(
    () => buildPrerequisiteAdjacency([{ id: 'bad', source: 'a', target: 'b', type: 'missing' }], {}),
    /must define prerequisiteTraversal/
  );
});

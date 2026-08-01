import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoredLevelErrors,
  computeMinimumLevels,
  computeMonotonicLevels,
  forcingChain
} from './level-model.mjs';

function graph(nodes, edges, edgeTypes = {
  structural: { enforcePredecessorLevel: 'incoming' },
  ignored: {}
}) {
  return {
    fields: {
      mathematics: {},
      physics: {},
      chemistry: {}
    },
    domains: {
      math: { field: 'mathematics' },
      physics: { field: 'physics' },
      chemistry: { field: 'chemistry' }
    },
    edgeTypes,
    levelPolicy: {
      globalMinimum: { level: 0, nodeIds: ['set'] },
      primaryFieldMinima: {
        physics: { level: 1, nodeIds: ['physical_system', 'physical_theory'] },
        chemistry: { level: 5, nodeIds: ['chemical_matter'] }
      }
    },
    nodes,
    edges
  };
}

const nodes = [
  { id: 'set', primaryField: 'mathematics', primaryDomain: 'math', level: 0 },
  { id: 'math_child', primaryField: 'mathematics', primaryDomain: 'math', level: 4 },
  { id: 'math_grandchild', primaryField: 'mathematics', primaryDomain: 'math', level: 2 },
  { id: 'physical_system', primaryField: 'physics', primaryDomain: 'physics', level: 1 },
  { id: 'physical_theory', primaryField: 'physics', primaryDomain: 'physics', level: 1 },
  { id: 'physics_child', primaryField: 'physics', primaryDomain: 'physics', level: 8 },
  { id: 'chemical_matter', primaryField: 'chemistry', primaryDomain: 'chemistry', level: 5 },
  { id: 'chemistry_child', primaryField: 'chemistry', primaryDomain: 'chemistry', level: 6 }
];

const edges = [
  { id: 'set-child', source: 'set', target: 'math_child', type: 'structural' },
  { id: 'child-grandchild', source: 'math_child', target: 'math_grandchild', type: 'structural' },
  { id: 'physics-child', source: 'physical_system', target: 'physics_child', type: 'structural' },
  { id: 'chemistry-child', source: 'chemical_matter', target: 'chemistry_child', type: 'structural' },
  { id: 'ignored', source: 'math_grandchild', target: 'set', type: 'ignored' }
];

test('minimum levels are the strict predecessor ranks above editorial minima', () => {
  const levels = computeMinimumLevels(graph(nodes, edges));
  assert.deepEqual(Object.fromEntries(levels), {
    chemical_matter: 5,
    chemistry_child: 6,
    math_child: 1,
    math_grandchild: 2,
    physical_system: 1,
    physical_theory: 1,
    physics_child: 2,
    set: 0
  });
});

test('monotonic projection preserves editorial slack and raises only violations', () => {
  const projection = computeMonotonicLevels(graph(nodes, edges));
  assert.deepEqual(Object.fromEntries(projection.levels), {
    chemical_matter: 5,
    chemistry_child: 6,
    math_child: 4,
    math_grandchild: 5,
    physical_system: 1,
    physical_theory: 1,
    physics_child: 8,
    set: 0
  });
  assert.deepEqual(forcingChain(projection, 'math_grandchild').map((step) => step.kind === 'edge' ? step.edge.id : step.kind), ['child-grandchild']);
});

test('outgoing enforcement reverses the declared edge for level precedence', () => {
  const reverseNodes = [
    ...nodes,
    { id: 'general_model', primaryField: 'mathematics', primaryDomain: 'math', level: 2 },
    { id: 'limiting_model', primaryField: 'mathematics', primaryDomain: 'math', level: 6 }
  ];
  const reverseEdges = [
    ...edges,
    { id: 'reverse-level', source: 'general_model', target: 'limiting_model', type: 'reverse' }
  ];
  const projection = computeMonotonicLevels(graph(reverseNodes, reverseEdges, {
    structural: { enforcePredecessorLevel: 'incoming' },
    reverse: { enforcePredecessorLevel: 'outgoing' },
    ignored: { enforcePredecessorLevel: 'none' }
  }));
  assert.equal(projection.levels.get('general_model'), 7);
  assert.deepEqual(forcingChain(projection, 'general_model'), [{
    kind: 'edge',
    edge: reverseEdges.at(-1),
    direction: 'outgoing',
    predecessorId: 'limiting_model',
    successorId: 'general_model',
    predecessorLevel: 6,
    successorLevel: 7
  }]);
});

test('missing, none, and empty enforcement values impose no level relation', () => {
  for (const value of [undefined, 'none', '', null]) {
    const edgeTypes = {
      structural: { enforcePredecessorLevel: 'incoming' },
      ignored: value === undefined ? {} : { enforcePredecessorLevel: value }
    };
    const projection = computeMonotonicLevels(graph(nodes, edges, edgeTypes));
    assert.equal(projection.levels.get('set'), 0);
  }
});

test('configured predecessor cycles are rejected', () => {
  const cyclic = graph(nodes, [...edges, { id: 'cycle', source: 'math_grandchild', target: 'set', type: 'structural' }]);
  assert.throws(() => computeMonotonicLevels(cyclic), /cycle detected: set -> math_child -> math_grandchild -> set/);
});

test('authored validation permits slack but reports strict predecessor violations', () => {
  const errors = authoredLevelErrors(graph(nodes, edges));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Node math_grandchild has level 2/);
  assert.match(errors[0], /must be at least 5/);
  assert.match(errors[0], /levels:fix/);
});

test('a hard anchor below its fixed level is raised without lowering other authored levels', () => {
  const low = structuredClone(nodes);
  low.find((node) => node.id === 'physical_system').level = 0;
  const projection = computeMonotonicLevels(graph(low, edges));
  assert.equal(projection.levels.get('physical_system'), 1);
  assert.equal(projection.levels.get('physics_child'), 8);
  assert.deepEqual(forcingChain(projection, 'physical_system'), [
    { kind: 'floor', nodeId: 'physical_system', reason: 'physics minimum', level: 1 }
  ]);
});

test('hard editorial anchors cannot drift', () => {
  const drifted = structuredClone(nodes);
  drifted.find((node) => node.id === 'set').level = 1;
  assert.deepEqual(authoredLevelErrors(graph(drifted, edges)), [
    'Level anchor set must remain exactly 0; found 1. Lowering anchors requires an explicit editorial edit.'
  ]);
});

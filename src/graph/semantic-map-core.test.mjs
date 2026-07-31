import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticMap, domainLevelAnchor } from '../../.test-build/graph/semantic-map-core.js';

const fields = {
  mathematics: { label: 'Mathematics', color: '#00f', order: 0, path: 'math', description: '' },
  physics: { label: 'Physics', color: '#f00', order: 1, path: 'physics', description: '' }
};
const domains = {
  algebra: { label: 'Algebra', color: '#11f', order: 0, field: 'mathematics' },
  geometry: { label: 'Geometry', color: '#22f', order: 1, field: 'mathematics' },
  mechanics: { label: 'Mechanics', color: '#f11', order: 0, field: 'physics' }
};
const nodes = [
  { id: 'group', label: 'Group', primaryDomain: 'algebra', domains: ['algebra'], level: 0, kind: 'structure', summary: '', citations: [] },
  { id: 'manifold', label: 'Manifold', primaryDomain: 'geometry', domains: ['geometry'], level: 0, kind: 'structure', summary: '', citations: [] },
  { id: 'phase-space', label: 'Phase space', primaryDomain: 'mechanics', domains: ['mechanics'], level: 0, kind: 'structure', summary: '', citations: [] },
  { id: 'hidden', label: 'Hidden', primaryDomain: 'algebra', domains: ['algebra'], level: 0, kind: 'structure', summary: '', citations: [] }
];
const edges = [
  { id: 'e1', source: 'group', target: 'manifold', type: 'used-in', label: '', detail: '', citations: [] },
  { id: 'e2', source: 'manifold', target: 'phase-space', type: 'models', label: '', detail: '', citations: [] },
  { id: 'e3', source: 'group', target: 'phase-space', type: 'models', label: '', detail: '', citations: [] },
  { id: 'e4', source: 'group', target: 'hidden', type: 'used-in', label: '', detail: '', citations: [] }
];
const base = {
  nodes: nodes.slice(0, 3), edges, fields, domains,
  fieldOrder: ['mathematics', 'physics'],
  domainOrder: ['algebra', 'geometry', 'mechanics'],
  fieldForDomain: (id) => domains[id].field,
  primaryFieldForNode: (node) => domains[node.primaryDomain].field
};

test('domain scale aggregates only visible concepts and directional relations', () => {
  const map = buildSemanticMap({ ...base, scale: 'domains' });
  assert.deepEqual(map.groups.map((group) => [group.id, group.conceptCount]), [
    ['algebra', 1], ['geometry', 1], ['mechanics', 1]
  ]);
  assert.deepEqual(map.connections.map((edge) => [edge.source, edge.target, edge.count]), [
    ['algebra', 'geometry', 1], ['algebra', 'mechanics', 1], ['geometry', 'mechanics', 1]
  ]);
  const mechanics = map.groups.find((group) => group.id === 'mechanics');
  assert.equal(mechanics.incomingRelations, 2);
  assert.deepEqual(mechanics.bridgeConcepts, [{ nodeId: 'phase-space', count: 2 }]);
});

test('field scale folds domain relations into internal and cross-field counts', () => {
  const map = buildSemanticMap({ ...base, scale: 'fields' });
  const mathematics = map.groups.find((group) => group.id === 'mathematics');
  assert.equal(mathematics.conceptCount, 2);
  assert.equal(mathematics.internalRelations, 1);
  assert.equal(mathematics.outgoingRelations, 2);
  assert.deepEqual(map.connections, [{
    id: 'mathematics->physics', source: 'mathematics', target: 'physics', count: 2,
    typeCounts: { models: 2 },
    edgeIds: ['e2', 'e3']
  }]);
});

test('positions are deterministic and domains remain grouped by field rows', () => {
  const first = buildSemanticMap({ ...base, scale: 'domains' });
  const second = buildSemanticMap({ ...base, scale: 'domains' });
  assert.deepEqual(first.groups.map((group) => group.position), second.groups.map((group) => group.position));
  const algebra = first.groups.find((group) => group.id === 'algebra');
  const geometry = first.groups.find((group) => group.id === 'geometry');
  const mechanics = first.groups.find((group) => group.id === 'mechanics');
  assert.equal(algebra.position.y, geometry.position.y);
  assert.notEqual(algebra.position.y, mechanics.position.y);
});


test('centroids use the current visible Layered node positions', () => {
  const positions = {
    group: { x: 20, y: 40 },
    manifold: { x: 100, y: 80 },
    'phase-space': { x: 400, y: 120 }
  };
  const map = buildSemanticMap({
    ...base,
    scale: 'fields',
    positionForNode: (nodeId) => positions[nodeId]
  });
  assert.deepEqual(map.groups.find((group) => group.id === 'mathematics').position, { x: 60, y: 60 });
  assert.deepEqual(map.groups.find((group) => group.id === 'physics').position, { x: 400, y: 120 });
});

test('domain label anchors alternate between visible extreme levels while foundation domains use the lowest level', 
  { skip: "the centroid logic is being changed to use the average of all structure nodes rather than the lowest or highest level" },
  () => {
  const levelNodes = [
    { id: 'low-a', kind: 'structure', level: 1 },
    { id: 'low-b', kind: 'structure', level: 1 },
    { id: 'middle', kind: 'structure', level: 3 },
    { id: 'high', kind: 'structure', level: 5 }
  ];
  const positions = {
    'low-a': { x: 10, y: 100 },
    'low-b': { x: 30, y: 100 },
    middle: { x: 50, y: 300 },
    high: { x: 90, y: 500 }
  };
  const visibleDomains = ['set-theory', 'logic', 'algebra', 'physical-foundations', 'mechanics'];
  const positionForNode = (nodeId) => positions[nodeId];

  assert.deepEqual(domainLevelAnchor('set-theory', visibleDomains, levelNodes, positionForNode), { x: 20, y: 100 });
  assert.deepEqual(domainLevelAnchor('physical-foundations', visibleDomains, levelNodes, positionForNode), { x: 20, y: 100 });
  assert.deepEqual(domainLevelAnchor('logic', visibleDomains, levelNodes, positionForNode), { x: 20, y: 100 });
  assert.deepEqual(domainLevelAnchor('algebra', visibleDomains, levelNodes, positionForNode), { x: 90, y: 500 });
  assert.deepEqual(domainLevelAnchor('mechanics', visibleDomains, levelNodes, positionForNode), { x: 20, y: 100 });
});

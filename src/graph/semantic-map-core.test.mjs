import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticMap } from '../../.test-build/graph/semantic-map-core.js';

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
    typeCounts: { models: 2 }
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

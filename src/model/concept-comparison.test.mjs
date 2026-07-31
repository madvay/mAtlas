import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConceptComparison } from '../../.test-build/model/concept-comparison.js';
import { GraphModel } from '../../.test-build/model/graph-model.js';

const data = {
  meta: {
    title: 'Atlas', version: '1', description: 'Test', direction: 'up', scope: 'test',
    fieldOrder: ['math'], domainOrder: ['algebra', 'analysis'], edgeTypeOrder: ['specializes', 'uses']
  },
  fields: { math: { label: 'Mathematics', color: '#000', order: 1, path: 'math', description: 'Math' } },
  domains: {
    algebra: { label: 'Algebra', color: '#111', order: 1, field: 'math' },
    analysis: { label: 'Analysis', color: '#222', order: 2, field: 'math' }
  },
  edgeTypes: {
    specializes: {
      label: 'Specializes', short: 'spec.', description: 'Specialization', prerequisiteTraversal: 'incoming', color: '#333',
      endpointLabels: { source: 'Specializes to', target: 'Specialization of' }
    },
    uses: {
      label: 'Uses', short: 'uses', description: 'Uses', prerequisiteTraversal: 'incoming', color: '#444',
      endpointLabels: { source: 'Uses', target: 'Used by' }
    }
  },
  sources: {},
  nodes: [
    { id: 'a', label: 'A', primaryDomain: 'algebra', domains: ['algebra'], level: 1, kind: 'structure', summary: 'A', citations: ['s1', 's2'] },
    { id: 'b', label: 'B', primaryDomain: 'algebra', domains: ['algebra', 'analysis'], level: 2, kind: 'structure', summary: 'B', citations: ['s2', 's3'] },
    { id: 'c', label: 'C', primaryDomain: 'analysis', domains: ['analysis'], level: 3, kind: 'structure', summary: 'C', citations: ['s4'] },
    { id: 'j', label: 'J', primaryDomain: 'algebra', domains: ['algebra'], level: 2, kind: 'junction', summary: 'J', citations: ['s5'] }
  ],
  edges: [
    { id: 'a-b', source: 'a', target: 'b', type: 'specializes', label: 'a to b', detail: 'direct', citations: ['s1'] },
    { id: 'a-c', source: 'a', target: 'c', type: 'uses', label: 'a uses c', detail: 'shared', citations: ['s2'] },
    { id: 'c-b', source: 'c', target: 'b', type: 'uses', label: 'c used by b', detail: 'shared', citations: ['s3'] },
    { id: 'a-j', source: 'a', target: 'j', type: 'uses', label: 'junction', detail: 'not a shared structure neighbor', citations: ['s4'] }
  ]
};

const model = new GraphModel(data);

test('comparison analysis reports direct relations, common context, and shared neighbors', () => {
  const result = analyzeConceptComparison(model, 'a', 'b', new Set(['specializes', 'uses']));
  assert.ok(result);
  assert.deepEqual(result.commonDomainIds, ['algebra']);
  assert.deepEqual(result.commonCitationIds, ['s2']);
  assert.deepEqual(result.directRelations.map((relation) => [relation.edgeId, relation.direction]), [['a-b', 'left-to-right']]);
  assert.deepEqual(result.sharedNeighbors.map((neighbor) => neighbor.nodeId), ['c']);
  assert.equal(result.sharedNeighbors[0].leftRelations[0].endpointLabel, 'Uses');
  assert.equal(result.sharedNeighbors[0].rightRelations[0].endpointLabel, 'Used by');
  assert.deepEqual(result.relationTypeCounts.map(({ edgeTypeId, leftCount, rightCount }) => [edgeTypeId, leftCount, rightCount]), [
    ['specializes', 1, 1],
    ['uses', 2, 1]
  ]);
});

test('comparison analysis respects the current relation-type filter', () => {
  const result = analyzeConceptComparison(model, 'a', 'b', new Set(['specializes']));
  assert.ok(result);
  assert.equal(result.sharedNeighbors.length, 0);
  assert.deepEqual(result.relationTypeCounts.map(({ edgeTypeId }) => edgeTypeId), ['specializes']);
});

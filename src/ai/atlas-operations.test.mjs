import test from 'node:test';
import assert from 'node:assert/strict';
import { Atlas } from '../../.test-build/ai/atlas-operations.js';

const data = {
  meta: {
    title: 'Test atlas', version: '1.2.3', description: 'Test graph', direction: 'up', scope: 'test',
    license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'Test attribution',
    defaultField: 'math', fieldOrder: ['math'], domainOrder: ['structures'], edgeTypeOrder: ['predecessor', 'outgoing-context', 'both-context']
  },
  fields: { math: { label: 'Mathematics', color: '#123456', order: 0, path: 'math', description: 'Formal test field' } },
  domains: { structures: { label: 'Structures', color: '#654321', order: 0, field: 'math' } },
  layout: { verticalBands: [{ id: 'test', fields: ['math'] }], domainLanes: { structures: 0 } },
  edgeTypes: {
    predecessor: {
      label: 'Predecessor', short: 'pred', description: 'Builds target from source.', prerequisiteTraversal: 'incoming', enforcePredecessorLevel: 'incoming', color: '#111111', endpointLabels: { source: 'Builds', target: 'Built from' }
    },
    'outgoing-context': {
      label: 'Outgoing context', short: 'out', description: 'Adds context from source to target.', prerequisiteTraversal: 'outgoing', enforcePredecessorLevel: 'none', color: '#222222', endpointLabels: { source: 'Context', target: 'Contextualized by' }
    },
    'both-context': {
      label: 'Both context', short: 'both', description: 'Connects both directions.', prerequisiteTraversal: 'both', enforcePredecessorLevel: 'none', color: '#333333', endpointLabels: { source: 'Either', target: 'Either' }
    }
  },
  sources: {
    s1: { label: 'S1', title: 'Source one', url: 'https://example.test/s1', kind: 'reference' },
    s2: { label: 'S2', title: 'Source two', url: 'https://example.test/s2', kind: 'reference' }
  },
  nodes: [
    { id: 'a', label: 'Alpha structure', primaryField: 'math', fields: ['math'], primaryDomain: 'structures', domains: ['structures'], level: 1, kind: 'structure', summary: 'Alpha', citations: ['s1'] },
    { id: 'b', label: 'Beta structure', primaryField: 'math', fields: ['math'], primaryDomain: 'structures', domains: ['structures'], level: 2, kind: 'structure', summary: 'Beta', citations: ['s2'] },
    { id: 'c', label: 'Gamma structure', primaryField: 'math', fields: ['math'], primaryDomain: 'structures', domains: ['structures'], level: 3, kind: 'structure', summary: 'Gamma', citations: [] },
    { id: 'd', label: 'Delta structure', primaryField: 'math', fields: ['math'], primaryDomain: 'structures', domains: ['structures'], level: 4, kind: 'structure', summary: 'Delta', citations: [] },
    { id: 'junction', label: 'Joint construction', primaryField: 'math', fields: ['math'], primaryDomain: 'structures', domains: ['structures'], level: 3, kind: 'junction', summary: 'Joint', citations: [] }
  ],
  edges: [
    { id: 'a-b', source: 'a', target: 'b', type: 'predecessor', label: 'alpha builds beta', detail: 'direct', citations: ['s1'] },
    { id: 'b-c', source: 'b', target: 'c', type: 'outgoing-context', label: 'beta contexts gamma', detail: 'direct', citations: ['s2'] },
    { id: 'c-d', source: 'c', target: 'd', type: 'both-context', label: 'gamma connects delta', detail: 'direct', citations: [] },
    { id: 'b-j', source: 'b', target: 'junction', type: 'predecessor', label: 'beta enters junction', detail: 'direct', citations: [] }
  ]
};

const atlas = Atlas.fromData(data);

test('mAtlas operations resolve authored concepts and retain direct relation direction and sources', () => {
  const search = atlas.searchConcepts('alpha');
  assert.equal(search.total, 1);
  assert.equal(search.matches[0].id, 'a');
  assert.equal(atlas.searchConcepts('joint', { includeJunctions: false }).total, 0);
  assert.equal(atlas.searchConcepts('joint', { includeJunctions: true }).matches[0].id, 'junction');
  assert.equal(atlas.resolveConcept('Beta structure')?.id, 'b');
  const concept = atlas.getConcept('a');
  assert.ok(concept);
  assert.equal(concept.citations[0].url, 'https://example.test/s1');
  const neighbors = atlas.getNeighbors('b');
  assert.deepEqual(neighbors.incoming.map((edge) => edge.id), ['a-b']);
  assert.deepEqual(neighbors.outgoing.map((edge) => edge.id), ['b-c', 'b-j']);
  assert.equal(neighbors.incoming[0].source.id, 'a');
  assert.equal(neighbors.incoming[0].target.id, 'b');
});

test('mAtlas operations distinguish path direction, predecessor closure, and prerequisite closure', () => {
  const path = atlas.findPaths('a', 'd', { direction: 'outgoing' });
  assert.equal(path.paths.length, 1);
  assert.deepEqual(path.paths[0].relations.map((edge) => edge.id), ['a-b', 'b-c', 'c-d']);
  assert.deepEqual(path.paths[0].relations.map((edge) => edge.traversedDirection), ['forward', 'forward', 'forward']);
  const reversePath = atlas.findPaths('d', 'a', { direction: 'either' });
  assert.equal(reversePath.paths.length, 1);
  assert.deepEqual(reversePath.paths[0].relations.map((edge) => edge.traversedDirection), ['reverse', 'reverse', 'reverse']);
  const predecessor = atlas.getPredecessorClosure(['b']);
  assert.deepEqual(predecessor.nodeIds, ['a', 'b']);
  assert.deepEqual(predecessor.edgeIds, ['a-b']);
  const prerequisite = atlas.getPrerequisiteClosure(['b']);
  assert.deepEqual(prerequisite.nodeIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(prerequisite.edgeIds, ['a-b', 'b-c', 'c-d']);
});

test('mAtlas operations provide deterministic subgraphs, comparisons, connection, and permalinks', () => {
  const subgraph = atlas.buildSubgraph(['b'], { hops: 1 });
  assert.deepEqual(subgraph.nodeIds, ['a', 'b', 'c', 'junction']);
  const comparison = atlas.compareConcepts('a', 'b');
  assert.deepEqual(comparison.commonFields, ['math']);
  assert.deepEqual(comparison.directRelations.map((edge) => edge.id), ['a-b']);
  const connected = atlas.connectConcepts(['a', 'd']);
  assert.deepEqual(connected.edgeIds, ['a-b', 'b-c', 'c-d']);
  const permalink = atlas.createPermalink('a');
  assert.equal(permalink.canonicalUrl, 'https://atlas.madvay.com/concepts/a/');
  assert.equal(permalink.interactiveUrl, 'https://atlas.madvay.com/?node=a');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeSearchIndex, normalizeSearchText } from '../../.test-build/core/search.js';

const nodes = [
  { id: 'hilbert-space', kind: 'structure', label: 'Hilbert Space', summary: 'A complete inner-product space.', primaryDomain: 'functional-analysis', domains: ['functional-analysis'], level: 0, citations: [] },
  { id: 'banach-space', kind: 'structure', label: 'Banach Space', summary: 'A complete normed vector space.', primaryDomain: 'functional-analysis', domains: ['functional-analysis'], level: 0, citations: [] },
  { id: 'inner-product-space', kind: 'structure', label: 'Inner Product Space', summary: 'A vector space with an inner product.', primaryDomain: 'linear-algebra', domains: ['linear-algebra'], level: 0, citations: [] }
];
const context = (node) => ({ fieldLabels: ['Mathematics'], domainLabels: [node.primaryDomain] });

function createIndex(source = nodes) {
  return new NodeSearchIndex(source, context);
}

test('search ranks exact labels before descriptive matches', () => {
  const matches = createIndex().search('Hilbert Space').matches;
  assert.equal(matches[0].node.id, 'hilbert-space');
});

test('search accepts identifiers and unordered query tokens', () => {
  const index = createIndex();
  assert.equal(index.search('banach-space').matches[0].node.id, 'banach-space');
  assert.equal(index.search('complete product').matches[0].node.id, 'hilbert-space');
});

test('search normalizes lightweight LaTeX punctuation and command names', () => {
  const mathNodes = [{ id: 'su2', kind: 'structure', label: '$SU(2)$ and $\\alpha$', summary: 'A Lie group.', primaryDomain: 'algebra', domains: ['algebra'], level: 0, citations: [] }];
  const index = createIndex(mathNodes);
  assert.equal(index.search('SU 2').matches[0].node.id, 'su2');
  assert.equal(index.search('alpha').matches[0].node.id, 'su2');
  assert.equal(normalizeSearchText('$\\mathbb{R}^n$'), 'r n');
});

test('search precomputes node context once instead of on every query', () => {
  let calls = 0;
  const index = new NodeSearchIndex(nodes, (node) => {
    calls += 1;
    return context(node);
  });
  assert.equal(calls, nodes.length);
  index.search('space');
  index.search('complete');
  index.search('mathematics');
  assert.equal(calls, nodes.length);
});

test('search reports total matches separately from a display limit', () => {
  const result = createIndex().search('space', { limit: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.total, 3);
});

test('search predicates allow shared indexes to serve narrower surfaces', () => {
  const withJunction = [...nodes, { id: 'joint-construction', kind: 'junction', label: 'Joint Construction', summary: 'A junction.', primaryDomain: 'algebra', domains: ['algebra'], level: 0, citations: [] }];
  const result = createIndex(withJunction).search('construction', { predicate: (node) => node.kind === 'structure' });
  assert.equal(result.total, 0);
});

test('search includes induced structures in the precomputed body', () => {
  const index = createIndex([{ id: 'metric-space', kind: 'structure', label: 'Metric Space', summary: 'A set with a metric.', induces: ['Topological structure'], primaryDomain: 'topology', domains: ['topology'], level: 0, citations: [] }]);
  assert.equal(index.search('topological structure').matches[0].node.id, 'metric-space');
});

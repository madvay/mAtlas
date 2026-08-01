import test from 'node:test';
import assert from 'node:assert/strict';
import { compactDomainLevels } from './level-compaction-model.mjs';

function graph(nodes, edges, edgeTypes = {
  structural: { enforcePredecessorLevel: 'incoming' },
  ignored: { enforcePredecessorLevel: 'none' }
}) {
  return {
    fields: { mathematics: {} },
    domains: {
      target: { field: 'mathematics', label: 'Target domain' },
      outside: { field: 'mathematics', label: 'Outside domain' }
    },
    edgeTypes,
    levelPolicy: {
      globalMinimum: { level: 0, nodeIds: ['set'] },
      primaryFieldMinima: {}
    },
    nodes,
    edges
  };
}

function node(id, level, domain = 'target') {
  return {
    id,
    level,
    primaryField: 'mathematics',
    primaryDomain: domain,
    domains: [domain]
  };
}

function secondaryDomainNode(id, level) {
  return {
    id,
    level,
    primaryField: 'mathematics',
    primaryDomain: 'outside',
    domains: ['outside', 'target']
  };
}

test('compact-domain closes single and multi-level gaps without moving the editorial lowest level', () => {
  const result = compactDomainLevels(graph([
    node('set', 0),
    node('middle', 3),
    node('upper_a', 5),
    node('upper_b', 5)
  ], [
    { id: 'set-middle', source: 'set', target: 'middle', type: 'structural' },
    { id: 'middle-upper-a', source: 'middle', target: 'upper_a', type: 'structural' },
    { id: 'middle-upper-b', source: 'middle', target: 'upper_b', type: 'structural' }
  ]), 'target');

  assert.equal(result.editorialLowestLevel, 0);
  assert.deepEqual(result.editorialLowestNodeIds, ['set']);
  assert.deepEqual(Object.fromEntries(result.changes.map((change) => [change.id, change.expected])), {
    middle: 1,
    upper_a: 2,
    upper_b: 2
  });
  assert.equal(result.levels.get('set'), 0);
  assert.equal(result.stopped, null);
  assert.deepEqual([...new Set(['set', 'middle', 'upper_a', 'upper_b'].map((id) => result.levels.get(id)))].sort((a, b) => a - b), [0, 1, 2]);
});


test('compact-domain considers and changes only concepts whose primary domain matches', () => {
  const result = compactDomainLevels(graph([
    secondaryDomainNode('set', 0),
    node('primary_base', 3),
    node('primary_upper', 5)
  ], [
    { id: 'base-upper', source: 'primary_base', target: 'primary_upper', type: 'structural' }
  ]), 'target');

  assert.equal(result.editorialLowestLevel, 3);
  assert.deepEqual(result.editorialLowestNodeIds, ['primary_base']);
  assert.deepEqual(result.changes, [
    { id: 'primary_upper', current: 5, expected: 4 }
  ]);
  assert.equal(result.levels.get('set'), 0);
  assert.equal(result.levels.get('primary_base'), 3);
  assert.equal(result.levels.get('primary_upper'), 4);
});

test('compact-domain applies every legal move in a cohort and then stops on a partial move', () => {
  const result = compactDomainLevels(graph([
    node('set', 0),
    node('base', 1),
    node('external_predecessor', 2, 'outside'),
    node('movable', 3),
    node('blocked', 3),
    node('upper', 5)
  ], [
    { id: 'set-base', source: 'set', target: 'base', type: 'structural' },
    { id: 'base-movable', source: 'base', target: 'movable', type: 'structural' },
    { id: 'external-blocked', source: 'external_predecessor', target: 'blocked', type: 'structural' }
  ]), 'target');

  assert.equal(result.levels.get('movable'), 2);
  assert.equal(result.levels.get('blocked'), 3);
  assert.equal(result.levels.get('upper'), 5);
  assert.equal(result.steps.length, 1);
  assert.deepEqual(result.steps[0].movedNodeIds, ['movable']);
  assert.equal(result.stopped, result.steps[0]);
  assert.equal(result.stopped.blocked[0].nodeId, 'blocked');
  assert.deepEqual(result.stopped.blocked[0].blockers.map((blocker) => blocker.kind), ['predecessor']);
});


test('compact-domain honors outgoing predecessor enforcement while lowering', () => {
  const result = compactDomainLevels(graph([
    node('set', 0),
    node('base', 1),
    node('limiting_model', 2, 'outside'),
    node('general_model', 3)
  ], [
    { id: 'reverse-level', source: 'general_model', target: 'limiting_model', type: 'reverse' }
  ], {
    reverse: { enforcePredecessorLevel: 'outgoing' }
  }), 'target');

  assert.equal(result.levels.get('general_model'), 3);
  assert.equal(result.stopped.blocked[0].blockers[0].constraint.predecessor, 'limiting_model');
  assert.equal(result.stopped.blocked[0].blockers[0].constraint.successor, 'general_model');
});

test('compact-domain rejects unknown domains', () => {
  assert.throws(() => compactDomainLevels(graph([node('set', 0)], []), 'missing'), /Unknown domain id missing/);
});

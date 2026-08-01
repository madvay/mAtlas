import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GraphModel } from '../../.test-build/model/graph-model.js';

const root = new URL('../../', import.meta.url);
const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
const model = new GraphModel(graphData);

test('every edge type aligns prerequisite traversal with predecessor-level enforcement', () => {
  for (const [id, edgeType] of Object.entries(graphData.edgeTypes)) {
    assert.equal(
      edgeType.prerequisiteTraversal,
      edgeType.enforcePredecessorLevel ?? 'none',
      `edge type ${id}`
    );
  }
});

test('the Fock-space bridge is a mathematics-to-QFT formulation edge', () => {
  const edge = model.edgeRecord.get('story_fock_space_to_quantum_field_theory_mathematical_formulation');
  assert.deepEqual(
    edge && { source: edge.source, target: edge.target, type: edge.type },
    { source: 'fock_space', target: 'quantum_field_theory', type: 'mathematical-formulation' }
  );
  assert.equal(model.edgeRecord.has('story_quantum_field_theory_to_fock_space_state_description'), false);
  assert.equal(model.transitivePrerequisiteNodeIds(['quantum_field_theory'], () => true).has('fock_space'), false);
  assert.equal(model.transitivePrerequisiteNodeIds(['fock_space'], () => true).has('quantum_field_theory'), false);
});

test('a mathematics-only prerequisite closure does not import physics nodes', () => {
  const mathematicsDomains = Object.entries(graphData.domains)
    .filter(([, domain]) => domain.field === 'mathematics')
    .map(([id]) => id);
  const state = {
    selectedFields: new Set(['mathematics']),
    selectedDomains: new Set(mathematicsDomains),
    selectedEdgeTypes: new Set(model.defaultEdgeTypeIds),
    excludedFields: new Set(),
    excludedDomains: new Set(),
    showPrimaryOnly: false
  };
  const required = model.requiredNodeIds(state, () => true);
  const importedPhysics = [...required].filter((nodeId) => {
    const node = model.nodeRecord.get(nodeId);
    return node && model.nodePrimaryField(node) === 'physics';
  });
  assert.deepEqual(importedPhysics, []);
});

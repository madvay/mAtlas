import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GraphModel } from '../../.test-build/model/graph-model.js';
import { classifyNodeVisibility, isCrossFieldEdgeAllowed, isWrongJunctionMode } from '../../.test-build/graph/visibility-policy.js';

const root = new URL('../../', import.meta.url);
const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
const viewsData = JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8'));
const model = new GraphModel(graphData);

function visibleGraph(view) {
  const settings = view.settings;
  const state = {
    selectedFields: new Set(settings.fields ?? []),
    selectedDomains: new Set(settings.domains ?? []),
    selectedEdgeTypes: new Set(settings.edgeTypes),
    crossFieldVisibility: settings.crossFieldVisibility,
    neighborhoodElementId: null
  };
  const crossFieldAllowed = (edge) => isCrossFieldEdgeAllowed(edge, model.isCrossFieldEdge(edge), state);
  const coreNodeIds = view.coreNodes?.length ? new Set(view.coreNodes) : null;
  const required = model.requiredNodeIds(state, (edge) => !model.isCrossFieldEdge(edge) || crossFieldAllowed(edge), coreNodeIds);
  const nodes = new Set();

  for (const node of graphData.nodes) {
    const visibility = classifyNodeVisibility(
      node.kind,
      coreNodeIds ? coreNodeIds.has(node.id) : model.nodeMatchesSelectedTaxonomy(node, state),
      required.has(node.id),
      settings.junctions
    );
    if (visibility !== 'hidden') nodes.add(node.id);
  }

  const edges = model.allEdges.filter((edge) => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) return false;
    if (!state.selectedEdgeTypes.has(edge.type)) return false;
    if (isWrongJunctionMode(
      edge,
      model.nodeRecord.get(edge.source)?.kind,
      model.nodeRecord.get(edge.target)?.kind,
      settings.junctions
    )) return false;
    return crossFieldAllowed(edge);
  });

  return { nodes, edges };
}

test('every curated view opens a non-empty graph and every sequence node is visible', () => {
  for (const view of viewsData.views) {
    const visible = visibleGraph(view);
    assert.ok(visible.nodes.size >= 2, `${view.id} should expose at least two concepts`);
    assert.ok(visible.edges.length >= 1, `${view.id} should expose at least one relation`);
    const sequence = view.nodeSequence ?? [];
    if (sequence.length) assert.ok(sequence.length >= 2, `${view.id} should contain a useful multi-step sequence`);
    for (const nodeId of sequence) {
      assert.ok(visible.nodes.has(nodeId), `${view.id} sequence node ${nodeId} should be visible`);
      assert.equal(model.nodeRecord.get(nodeId)?.kind, 'structure', `${view.id} sequence node ${nodeId} should be a structure`);
    }
  }
});

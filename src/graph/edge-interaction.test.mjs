import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeInteractionEnabled, suppressAutomaticSelectionForCurrentTap } from '../../.test-build/graph/edge-interaction.js';

test('edge interaction remains enabled when zoom gating is disabled', () => {
  assert.equal(edgeInteractionEnabled(false, 0.1), true);
});

test('edge interaction changes at the zoom threshold without restyling edges', () => {
  assert.equal(edgeInteractionEnabled(true, 0.6499), false);
  assert.equal(edgeInteractionEnabled(true, 0.65), true);
  assert.equal(edgeInteractionEnabled(true, 1.2), true);
});

test('a gated tap suppresses Cytoscape automatic selection only for the current event turn', async () => {
  let selectable = true;
  let removed = false;
  const edge = {
    selectable: () => selectable,
    unselectify: () => { selectable = false; },
    selectify: () => { selectable = true; },
    removed: () => removed
  };

  suppressAutomaticSelectionForCurrentTap(edge);
  assert.equal(selectable, false);

  let selected = false;
  if (selectable) selected = true; // Cytoscape's post-handler tap-selection phase.
  assert.equal(selected, false);

  await Promise.resolve();
  assert.equal(selectable, true);

  suppressAutomaticSelectionForCurrentTap(edge);
  removed = true;
  await Promise.resolve();
  assert.equal(selectable, false);
});

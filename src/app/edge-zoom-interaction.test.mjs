import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const atlasApp = await readFile(new URL('./atlas-app.ts', import.meta.url), 'utf8');
const graphView = await readFile(new URL('../graph/graph-view-controller.ts', import.meta.url), 'utf8');

test('zoom events do not restyle the edge collection', () => {
  assert.doesNotMatch(atlasApp, /scheduleEdgeZoomStyles/);
  assert.match(atlasApp, /cy\.on\('zoom', \(\) => \{\s*scheduleFieldBands\(\);\s*\}\);/);
  assert.doesNotMatch(graphView, /requestAnimationFrame[\s\S]*updateEdgeStyles/);
});

test('ordinary edge handlers gate activation with a constant-time zoom check', () => {
  assert.match(atlasApp, /cy\.on\('tap', 'edge',[\s\S]*if \(!graphView\.edgeInteractionEnabled\(\)\) \{[\s\S]*suppressAutomaticSelectionForCurrentTap\(target\);[\s\S]*clearGraphBackgroundInteraction\(\);[\s\S]*activateEdge\(target\.id\(\)/);
  assert.match(atlasApp, /cy\.on\('dbltap', 'edge',[\s\S]*if \(!graphView\.edgeInteractionEnabled\(\)\) return;[\s\S]*activateEdge\(target\.id\(\)/);
});

test('low-zoom edge taps suppress Cytoscape selection before clearing app state', () => {
  const tapStart = atlasApp.indexOf("cy.on('tap', 'edge'");
  const tapEnd = atlasApp.indexOf("cy.on('dbltap', 'node'", tapStart);
  const gatedTap = atlasApp.slice(tapStart, tapEnd);
  assert.match(gatedTap, /suppressAutomaticSelectionForCurrentTap\(target\);\s*clearGraphBackgroundInteraction\(\);/);
  assert.doesNotMatch(gatedTap, /target\.style\(/);
});

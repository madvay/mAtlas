import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const atlasApp = await readFile(new URL('atlas-app.ts', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../ui/svg-exporter.ts', import.meta.url), 'utf8');
const controller = await readFile(new URL('../ui/structure-overlay-controller.ts', import.meta.url), 'utf8');
const graphView = await readFile(new URL('../graph/graph-view-controller.ts', import.meta.url), 'utf8');
const graphStyles = await readFile(new URL('../graph/create-graph.ts', import.meta.url), 'utf8');
const fieldBands = await readFile(new URL('../ui/field-band-controller.ts', import.meta.url), 'utf8');

test('concept tap, double-tap, and tooltip paths are blocked in structure modes', () => {
  const activeGuards = atlasApp.match(/if \(structureOverlayController\?\.active\(\)\) return;/g) ?? [];
  assert.equal(activeGuards.length, 4);
  assert.match(atlasApp, /mouseover[\s\S]*structureOverlayController\?\.active\(\)[\s\S]*clearHover\(\)/);
});

test('structure-mode SVG concepts are visual substrate rather than hyperlinks', () => {
  assert.match(exporter, /if \(!structureSource\) parts\.push\(`<a href=/);
  assert.match(exporter, /if \(!structureSource\) parts\.push\('<\/a>'\)/);
  assert.match(exporter, /Number\(element\.data\('semanticGroup'\)\) === 1[\s\S]*fill=\"\$\{escapeHtml\(color\)\}\"[\s\S]*stroke=\"#ffffff\"/s);
  assert.doesNotMatch(exporter, /semanticGroup[\s\S]{0,1200}<rect x=/s);
});


test('structure group selection isolates incident links and clearing restores every connection', () => {
  assert.match(controller, /CONNECTION_EMPHASIS_CLASS = 'structure-connection-emphasis'/);
  assert.match(controller, /CONNECTION_HIDDEN_CLASS = 'structure-connection-hidden'/);
  assert.match(controller, /this\.selection = \{ kind: 'group', id \};[\s\S]*this\.syncConnectionEmphasis\(\)/);
  assert.match(controller, /edge\.source\(\)\.id\(\) === selectedGroupElementId \|\| edge\.target\(\)\.id\(\) === selectedGroupElementId[\s\S]*addClass\(CONNECTION_EMPHASIS_CLASS\)[\s\S]*else[\s\S]*addClass\(CONNECTION_HIDDEN_CLASS\)/);
  assert.match(controller, /removeClass\(`\$\{CONNECTION_EMPHASIS_CLASS\} \$\{CONNECTION_HIDDEN_CLASS\}`\)/);
  assert.match(graphStyles, /edge\[semanticConnection = 1\]\.structure-connection-hidden'[\s\S]*display: 'none'[\s\S]*events: 'no'/);
  assert.match(exporter, /hasClass\('structure-connection-emphasis'\)[\s\S]*selected \|\| emphasized \? 1 : 0\.18/);
});


test('structure-edge opacity remains stylesheet-owned across zoom, filter, and deselection passes', () => {
  assert.doesNotMatch(graphView, /style\('opacity',\s*edge\.selected\(\)\s*\?\s*1\s*:\s*0\.84\)/);
  assert.match(graphView, /const structureConnections = this\.options\.cy\.edges\('\[semanticConnection = 1\]'\);[\s\S]*removeStyle\('opacity'\)[\s\S]*removeStyle\('events'\)/);
  assert.doesNotMatch(graphView, /cy\.edges\(\)\.not\('\[semanticConnection = 1\]'\)\.forEach/);
  assert.match(graphStyles, /selector: 'edge'[\s\S]*opacity: 0\.32[\s\S]*events: 'yes'/);
  assert.match(controller, /this\.restoreSelection\(\);\s*this\.syncConnectionEmphasis\(\);/);
  assert.match(controller, /syncConnectionEmphasis[\s\S]*removeStyle\('opacity'\)[\s\S]*removeClass\(`\$\{CONNECTION_EMPHASIS_CLASS\} \$\{CONNECTION_HIDDEN_CLASS\}`\)/);
});

test('layout-mode transitions clear incompatible selection, neighborhood, prerequisite, and detail state', () => {
  assert.match(atlasApp, /interactionModeForLayout[\s\S]*layout === 'domains' \|\| layout === 'fields' \? layout : 'concepts'/);
  assert.match(atlasApp, /resetInteractionForLayout\(name\);[\s\S]*prepareForLayout\(name\)/);
  assert.match(atlasApp, /if \(layoutChanged\) resetInteractionForLayout\(next\.layout, \{ updateLocation: false \}\)/);
  assert.match(atlasApp, /structureOverlayController\?\.clearSelection\(\);[\s\S]*clearSelectedGraphElement\(\);[\s\S]*graphView\.clearInteractionHighlights\(\);/);
  assert.match(atlasApp, /nextMode === 'concepts'\) showEmptyDetails\(\);[\s\S]*showIntroductionForLayout\(nextLayout, false\)/);
  assert.match(graphView, /clearInteractionHighlights\(\)[\s\S]*state\.neighborhoodActive = false;[\s\S]*state\.neighborhoodElementId = null;[\s\S]*crossFieldVisibility === 'contextual'[\s\S]*this\.applyFilters\(\{ relayout: false \}\)[\s\S]*this\.clearNeighborhoodClasses\(\);[\s\S]*this\.clearPrerequisiteHighlights\(\)/);
  assert.match(controller, /showIntroductionForLayout\(layout: LayoutName/);
});

test('structure substrate dimming is installed before layout and retained throughout overlay rebuilds', () => {
  assert.match(atlasApp, /function runLayout[\s\S]*structureOverlayController\?\.prepareForLayout\(name\);[\s\S]*layoutManager\.run/);
  assert.match(atlasApp, /const applyFilters[\s\S]*structureOverlayController\?\.prepareForLayout\(state\.layout\);\s*graphView\.applyFilters/);
  assert.match(controller, /prepareForLayout\(layout: LayoutName\)[\s\S]*toggleClass\('structure-source-node'/);
  assert.match(controller, /if \(!this\.active\(\)\)[\s\S]*removeClass\('structure-source-node structure-source-junction'\)/);
  assert.match(controller, /this\.prepareForLayout\(state\.layout\);\s*cy\.elements\(OVERLAY_SELECTOR\)\.remove\(\);/);
});

test('structure selections participate in URL selection restoration and history', () => {
  assert.match(atlasApp, /structureOverlayController\?\.selectionTarget\(\)/);
  assert.match(atlasApp, /target\.kind !== 'node' && target\.kind !== 'edge'[\s\S]*structureOverlayController\?\.selectTarget\(target, true\)/);
  assert.match(controller, /onSelectionChange\(this\.selectionTarget\(\), 'push'\)/);
});

test('field boundary overlays are absent from domain and field structure layouts', () => {
  assert.match(fieldBands, /state\.layout === 'breadthfirst' \|\| state\.layout === 'domains' \|\| state\.layout === 'fields'/);
  assert.match(fieldBands, /this\.options\.state\.layout === 'domains'[\s\S]*this\.clear\(\);/);
  assert.match(atlasApp, /name === 'domains' \|\| name === 'fields'\) fieldBandController\.clear\(\)/);
});

test('structure-mode SVG graph content is 25 percent smaller while the header remains unscaled', () => {
  assert.match(exporter, /const graphScale = structureMode \? 0\.125 : 0\.5/);
  assert.match(exporter, /height = headerHeight \+ graphHeight/);
  assert.match(exporter, /<g transform="translate\([^\n]+scale\(\$\{graphScale\}\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const atlasApp = await readFile(new URL('atlas-app.ts', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../ui/svg-exporter.ts', import.meta.url), 'utf8');
const controller = await readFile(new URL('../ui/structure-overlay-controller.ts', import.meta.url), 'utf8');
const graphView = await readFile(new URL('../graph/graph-view-controller.ts', import.meta.url), 'utf8');

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


test('structure connections are dim by default and incident links are emphasized by group selection', () => {
  assert.match(controller, /CONNECTION_EMPHASIS_CLASS = 'structure-connection-emphasis'/);
  assert.match(controller, /this\.selection = \{ kind: 'group', id \};[\s\S]*this\.syncConnectionEmphasis\(\)/);
  assert.match(controller, /edge\.source\(\)\.id\(\) === selectedGroupElementId \|\| edge\.target\(\)\.id\(\) === selectedGroupElementId/);
  assert.match(exporter, /hasClass\('structure-connection-emphasis'\)[\s\S]*selected \|\| emphasized \? 1 : 0\.18/);
});


test('structure-edge opacity remains stylesheet-owned across zoom, filter, and deselection passes', () => {
  assert.doesNotMatch(graphView, /style\('opacity',\s*edge\.selected\(\)\s*\?\s*1\s*:\s*0\.84\)/);
  assert.match(graphView, /cy\.edges\('\[semanticConnection = 1\]'\)[\s\S]*removeStyle\('opacity'\)[\s\S]*removeStyle\('events'\)/);
  assert.match(graphView, /cy\.edges\(\)\.not\('\[semanticConnection = 1\]'\)\.forEach/);
  assert.match(controller, /this\.restoreSelection\(\);\s*this\.syncConnectionEmphasis\(\);/);
  assert.match(controller, /syncConnectionEmphasis[\s\S]*removeStyle\('opacity'\)[\s\S]*removeClass\(CONNECTION_EMPHASIS_CLASS\)/);
});

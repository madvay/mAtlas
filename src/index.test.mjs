import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('src/index.html', root), 'utf8');
const styles = await readFile(new URL('src/styles.css', root), 'utf8');

test('layout selection lives inside the collapsible Display section', () => {
  const toolbarStart = html.indexOf('<header class="topbar">');
  const toolbarEnd = html.indexOf('</header>', toolbarStart);
  const displayStart = html.indexOf('id="displayFilterSection"');
  const displayEnd = html.indexOf('</section>', displayStart);

  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart);
  assert.ok(displayStart >= 0 && displayEnd > displayStart);
  assert.equal(html.slice(toolbarStart, toolbarEnd).includes('id="layoutSelect"'), false);
  assert.equal(html.slice(displayStart, displayEnd).includes('id="layoutSelect"'), true);
});

test('layout selector exposes concept and structure scales', () => {
  const select = html.match(/<select id="layoutSelect"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? '';
  const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)]
    .map((match) => ({ value: match[1], label: match[2] }));
  assert.deepEqual(options, [
    { value: 'atlas', label: 'Layered' },
    { value: 'breadthfirst', label: 'Compact' },
    { value: 'domains', label: 'Domains' },
    { value: 'fields', label: 'Fields' }
  ]);
});

test('every filter subsection starts expanded and can be collapsed', () => {
  const toggles = [...html.matchAll(/<button[^>]*data-filter-section-toggle[^>]*>/g)].map((match) => match[0]);
  assert.equal(toggles.length, 5);
  for (const toggle of toggles) {
    assert.match(toggle, /aria-expanded="true"/);
    assert.match(toggle, /aria-controls="[^"]+"/);
  }
  assert.match(styles, /\.filter-section-body\[hidden\]\s*\{\s*display:\s*none(?:\s*!important)?;/);
  assert.match(styles, /\.filter-section-toggle\[aria-expanded="false"\]/);
});

test('the isolated-node display option is absent', () => {
  assert.equal(html.includes('hideIsolated'), false);
  assert.equal(html.includes('Hide isolated'), false);
  assert.equal(styles.includes('hide-isolated'), false);
});


test('edge annotations are the sole edge-label control', () => {
  assert.match(html, /id="edgeLabelsToggle"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /showGraphEdgeLabelsToggle|Show graph edge labels/);
});

test('prerequisite highlighting is an opt-in browser preference', () => {
  assert.match(html, /id="highlightPrerequisitesToggle"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="highlightPrerequisitesToggle"[^>]*checked/);
});

test('experimental features is an opt-in browser preference', () => {
  assert.match(html, /id="experimentalFeaturesToggle"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="experimentalFeaturesToggle"[^>]*checked/);
});

test('Compare is hidden by default and the obsolete Structure Map dialog is absent', () => {
  assert.match(html, /id="compareButton"[^>]*hidden/);
  assert.doesNotMatch(html, /id="semanticMapButton"|id="semanticMapDialog"/);
});

test('layout toolbar exposes all four enum values', () => {
  const values = [...html.matchAll(/data-toolbar-layout="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, ['atlas', 'domains', 'fields', 'breadthfirst']);
});

test('Compare integrates overview and direction-preserving connection analysis', () => {
  assert.doesNotMatch(html, /id="connectionButton"/);
  assert.doesNotMatch(html, /id="connectionDialog"/);
  assert.match(html, /id="compareButton"[^>]*aria-haspopup="dialog"[^>]*aria-pressed="false"/);
  assert.match(html, /data-compare-mode="overview"/);
  assert.match(html, /data-compare-mode="connections"/);
  const traversal = html.match(/<select id="compareDirection"[\s\S]*?<\/select>/)?.[0] ?? '';
  assert.match(traversal, /value="either">Either direction; preserve arrow meaning/);
  assert.match(traversal, /value="forward">Follow A → B arrows only/);
  assert.match(html, /id="compareCopySequenceButton"/);
});

test('modal dialogs are siblings rather than nested inside another closed dialog', () => {
  const dialogs = [...html.matchAll(/<dialog\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/dialog>/g)];
  assert.ok(dialogs.length >= 3);
  for (const [, id, body] of dialogs) {
    assert.doesNotMatch(body, /<dialog\b/, `${id} contains another dialog`);
  }
});

test('concept comparison has toolbar, details, and shareable dialog surfaces', () => {
  assert.match(html, /id="compareButton"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="compareDialog"/);
  assert.match(html, /id="compareLeftInput"[^>]*list="compareConceptNames"/);
  assert.match(html, /id="compareRightInput"[^>]*list="compareConceptNames"/);
  assert.match(html, /id="compareCopyButton"/);
  assert.match(styles, /\.compare-columns\s*\{/);
  assert.match(styles, /\.compare-neighbor-row\s*\{/);
});

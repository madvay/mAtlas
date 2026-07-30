import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else result.push(path);
  }
  return result;
}

test('UI HTML writes go through the retained renderer', async () => {
  const files = (await filesUnder(fileURLToPath(new URL('./', import.meta.url))))
    .filter((path) => path.endsWith('.ts') && !path.endsWith('/ui/render.ts'));
  const violations = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    if (/\.innerHTML\s*=/.test(source)) violations.push(path);
    if (/\.insertAdjacentHTML\s*\(/.test(source)) violations.push(path);
    if (/\.outerHTML\s*=/.test(source)) violations.push(path);
  }
  assert.deepEqual(violations, []);
});

test('the retained renderer avoids framework and removed-layout runtime dependencies', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  assert.deepEqual(dependencies.sort(), ['cytoscape', 'katex']);
  assert.doesNotMatch(notices, /cytoscape-cose-bilkent|cose-base|layout-base/i);
});

test('graph nodes avoid per-node encoded images and startup hides the unfit viewport', async () => {
  const graphSource = await readFile(new URL('../src/graph/create-graph.ts', import.meta.url), 'utf8');
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(graphSource, /data:image\/svg\+xml|domainRailImage/);
  assert.match(graphSource, /hideEdgesOnViewport:\s*preferences\.hideEdgesWhileMoving/);
  assert.match(graphSource, /applyRendererPreferences\(cy, preferences\);\s*return cy;/);
  assert.match(html, /<body class="atlas-loading">/);
  assert.match(html, /id="graphLoader"/);
  assert.match(appSource, /classList\.remove\('atlas-loading'\)/);
});

test('static export uses the npm-managed browser and domain markers stay consistent', async () => {
  const generator = await readFile(new URL('../scripts/generate-static-atlas-svg.mjs', import.meta.url), 'utf8');
  const labelLayer = await readFile(new URL('../src/graph/graph-math-label-layer.ts', import.meta.url), 'utf8');
  const exporter = await readFile(new URL('../src/ui/svg-exporter.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const fieldBands = await readFile(new URL('../src/ui/field-band-controller.ts', import.meta.url), 'utf8');

  assert.match(generator, /import puppeteer from 'puppeteer'/);
  assert.doesNotMatch(generator, /CHROME_BIN|spawnSync|browserCandidates/);
  assert.match(labelLayer, /graph-domain-markers/);
  assert.match(exporter, /<circle cx=/);
  assert.doesNotMatch(exporter, /katex|foreignObject|renderText|svgCssText/i);
  assert.match(exporter, /if \(!this\.state\.showEdgeLabels\) return/);
  assert.doesNotMatch(exporter, /showGraphEdgeLabels/);
  assert.match(exporter, /preferences\(\)\.dimPrerequisites/);
  assert.match(exporter, /serializePrimaryDomain\(domainId: string\)/);
  assert.match(exporter, /record && !record\.synthetic && nodeIds\.has\(record\.source\) && nodeIds\.has\(record\.target\)/);
  assert.match(exporter, /<metadata><rdf:RDF/);
  assert.match(exporter, /http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#/);
  assert.match(exporter, /http:\/\/purl\.org\/dc\/elements\/1\.1\//);
  assert.match(exporter, /http:\/\/creativecommons\.org\/ns#/);
  assert.match(exporter, /<dc:creator>Advay Mengle<\/dc:creator>/);
  assert.match(generator, /static\/domains\/\$\{encodeURIComponent\(domainId\)\}\.svg/);
  assert.doesNotMatch(exporter, /markerY[^\n]*<rect|stroke-opacity="0\.3"/);
  assert.doesNotMatch(styles, /\.graph-domain-markers\s*\{[^}]*?(?:background|box-shadow|contain):/s);
  assert.doesNotMatch(styles, /\.graph-domain-markers\s*>\s*span\s*\{[^}]*border:/s);
  assert.doesNotMatch(styles, /will-change:\s*transform/);
  assert.match(fieldBands, /container\.hidden = true/);
  assert.match(fieldBands, /container\.hidden = false/);
});

test('selection navigation replaces an in-flight viewport animation', async () => {
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');
  const activators = appSource.slice(appSource.indexOf('function activateNode'), appSource.indexOf('function clearSelection'));
  assert.equal((activators.match(/cy\.stop\(true, false\)/g) ?? []).length, 2);
});

test('the canvas renderer parks its perpetual frame loop while idle', async () => {
  const controller = await readFile(new URL('../src/graph/idle-render-controller.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');
  assert.match(appSource, /new IdleRenderController\(cy, graphEl\)/);
  assert.match(controller, /this\.renderer\.destroyed = true/);
  assert.match(controller, /this\.renderer\.startRenderLoop\(\)/);
  assert.match(controller, /this\.cy\.animated\(\) \|\| this\.renderer\.requestedFrame/);
});

test('view cards render inline math and the desktop filter panel slides at a fixed width', async () => {
  const viewsController = await readFile(new URL('../src/ui/views-controller.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(viewsController, /<h4 class="math-rich">\$\{this\.options\.math\.renderText\(view\.title\)\}<\/h4>/);
  assert.match(viewsController, /<p class="math-rich">\$\{this\.options\.math\.renderText\(view\.summary\)\}<\/p>/);
  assert.match(styles, /@media \(min-width: 901px\) \{\s*\.filters-panel \{\s*width: var\(--sidebar-left\);\s*min-width: var\(--sidebar-left\);/s);
  assert.match(styles, /\.workspace\.filters-collapsed \.filters-panel \{[^}]*transform: translateX\(-100%\);/s);
});

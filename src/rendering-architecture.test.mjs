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

test('static taxonomy images retain a visible looping horizontal shimmer while the interactive graph loads', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const generator = await readFile(new URL('../scripts/generate-concept-pages.mjs', import.meta.url), 'utf8');
  assert.match(generator, /class="static-graph-shimmer" aria-hidden="true"/);
  assert.match(styles, /\.static-graph-shimmer \{[\s\S]*position: absolute[\s\S]*inset-block: -12%[\s\S]*width: 38%/);
  assert.match(styles, /linear-gradient\([\s\S]*rgba\(191, 219, 254, 0\.34\)[\s\S]*rgba\(255, 255, 255, 1\)/);
  assert.match(styles, /box-shadow: 0 0 42px 14px rgba\(219, 234, 254, 0\.68\)/);
  assert.match(styles, /animation: static-graph-shimmer 1\.8s ease-in-out infinite/);
  assert.match(styles, /@keyframes static-graph-shimmer[\s\S]*translate3d\(-165%, 0, 0\)[\s\S]*translate3d\(365%, 0, 0\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.static-graph-shimmer[\s\S]*animation: none/s);
});

test('static export uses the npm-managed browser and domain markers stay consistent', async () => {
  const generator = await readFile(new URL('../scripts/generate-static-atlas-svg.mjs', import.meta.url), 'utf8');
  const overlayLayer = await readFile(new URL('../src/graph/graph-overlay-layer.ts', import.meta.url), 'utf8');
  const exporter = await readFile(new URL('../src/ui/svg-exporter.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const fieldBands = await readFile(new URL('../src/ui/field-band-controller.ts', import.meta.url), 'utf8');

  assert.match(generator, /import puppeteer from 'puppeteer'/);
  assert.doesNotMatch(generator, /CHROME_BIN|spawnSync|browserCandidates/);
  assert.match(overlayLayer, /graph-domain-marker-canvas/);
  assert.match(overlayLayer, /getContext\('2d'\)/);
  assert.match(overlayLayer, /requestAnimationFrame/);
  assert.doesNotMatch(overlayLayer, /createElement\('span'\)|graph-domain-markers/);
  assert.match(exporter, /<circle cx=/);
  assert.doesNotMatch(exporter, /katex|foreignObject|renderText|svgCssText/i);
  assert.match(exporter, /if \(!this\.state\.showEdgeLabels\) return/);
  assert.doesNotMatch(exporter, /showGraphEdgeLabels/);
  assert.match(exporter, /preferences\(\)\.dimPrerequisites/);
  assert.match(exporter, /serializeFieldDomainStructure\(fieldId: string\)/);
  assert.match(exporter, /Domain mode with prerequisites hidden/);
  assert.match(exporter, /serializePrimaryDomain\(domainId: string\)/);
  assert.match(exporter, /record && !record\.synthetic && nodeIds\.has\(record\.source\) && nodeIds\.has\(record\.target\)/);
  assert.match(exporter, /<metadata><rdf:RDF/);
  assert.match(exporter, /http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#/);
  assert.match(exporter, /http:\/\/purl\.org\/dc\/elements\/1\.1\//);
  assert.match(exporter, /http:\/\/creativecommons\.org\/ns#/);
  assert.match(exporter, /<dc:creator>Advay Mengle<\/dc:creator>/);
  assert.match(generator, /static\/fields\/\$\{encodeURIComponent\(fieldId\)\}\.svg/);
  assert.match(generator, /atlas:static-svg-field/);
  assert.match(generator, /static\/domains\/\$\{encodeURIComponent\(domainId\)\}\.svg/);
  assert.doesNotMatch(exporter, /markerY[^\n]*<rect|stroke-opacity="0\.3"/);
  assert.match(styles, /\.graph-domain-marker-canvas\s*\{[^}]*position: absolute[^}]*width: 100%[^}]*height: 100%/s);
  assert.doesNotMatch(styles, /\.graph-domain-markers|\.graph-domain-markers\s*>\s*span/);
  assert.doesNotMatch(styles, /will-change:\s*transform/);
  assert.match(fieldBands, /container\.hidden = true/);
  assert.match(fieldBands, /container\.hidden = false/);
});

test('selection navigation replaces an in-flight viewport animation', async () => {
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');
  const activators = appSource.slice(appSource.indexOf('function activateNode'), appSource.indexOf('function clearSelection'));
  assert.equal((activators.match(/stopGraphAnimations\(\)/g) ?? []).length, 2);
  assert.match(appSource, /function stopGraphAnimations\(\): void \{[\s\S]*cy\.stop\(true, false\)/);
});



test('selection restyling is incremental and avoids graph-wide edge bypass writes', async () => {
  const graphView = await readFile(new URL('../src/graph/graph-view-controller.ts', import.meta.url), 'utf8');
  const graphStyles = await readFile(new URL('../src/graph/create-graph.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(graphView, /cy\.edges\(\)\.not\('\[semanticConnection = 1\]'\)\.forEach/);
  assert.doesNotMatch(graphView, /edge\.style\('(opacity|events)'/);
  assert.match(graphView, /this\.neighborhoodEmphasized\.diff\(neighborhood\)/);
  assert.match(graphView, /this\.prerequisiteHighlighted\.diff\(next\)/);
  assert.match(graphView, /statusNeighborhoodIndicator/);
  assert.match(graphStyles, /selector: 'edge'[\s\S]*opacity: 0\.32[\s\S]*events: 'yes'/);
  assert.doesNotMatch(appSource, /cy\.\$\(':selected'\)/);
  assert.match(appSource, /let selectedGraphElement:/);
});
test('the canvas renderer parks its perpetual frame loop while idle', async () => {
  const controller = await readFile(new URL('../src/graph/idle-render-controller.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');
  assert.match(appSource, /new IdleRenderController\(cy, graphEl\)/);
  assert.match(controller, /this\.renderer\.destroyed = true/);
  assert.match(controller, /this\.renderer\.startRenderLoop\(\)/);
  assert.match(controller, /this\.cy\.animated\(\) \|\| this\.renderer\.requestedFrame/);
});

test('view cards render inline math and desktop side panels slide over a stable graph viewport', async () => {
  const viewsController = await readFile(new URL('../src/ui/views-controller.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(viewsController, /<h4 class="math-rich">\$\{this\.options\.math\.renderText\(view\.title\)\}<\/h4>/);
  assert.match(viewsController, /<p class="math-rich">\$\{this\.options\.math\.renderText\(view\.summary\)\}<\/p>/);
  assert.match(styles, /@media \(min-width: 901px\) \{[\s\S]*?\.workspace\.filters-collapsed\.details-collapsed \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(min-width: 901px\) \{[\s\S]*?\.filters-panel \{\s*left: 0;\s*width: var\(--sidebar-left\);\s*min-width: var\(--sidebar-left\);/);
  assert.match(styles, /@media \(min-width: 901px\) \{[\s\S]*?\.details-panel \{\s*right: 0;\s*width: var\(--sidebar-right\);\s*min-width: var\(--sidebar-right\);/);
  assert.match(styles, /\.workspace\.filters-collapsed \.filters-panel \{[^}]*transform: translateX\(-100%\);/s);
  assert.match(styles, /\.workspace\.details-collapsed \.details-panel \{[^}]*transform: translateX\(100%\);/s);
});

test('outgoing detail relations put the destination before the edge qualifier', async () => {
  const detailsController = await readFile(new URL('../src/ui/details-controller.ts', import.meta.url), 'utf8');
  assert.match(detailsController, /\$\{this\.relationLink\(relation\.nodeId\)\} <span class="relation-via">via<\/span> \$\{edgeLabel\}/);
});

test('experimental Compare controls stay synchronized across toolbar and details', async () => {
  const appSource = await readFile(new URL('../src/app/atlas-app.ts', import.meta.url), 'utf8');
  const detailsController = await readFile(new URL('../src/ui/details-controller.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(appSource, /for \(const id of \['compareButton', 'detailCompareButton'\]\)/);
  assert.match(appSource, /experimentalFeatures: \(\) => preferences\.experimentalFeatures/);
  assert.match(appSource, /setPreferences: \(next\) => \{[\s\S]*?syncExperimentalButtons\(\);/);
  assert.match(detailsController, /id="detailCompareButton"\$\{this\.options\.experimentalFeatures\(\) \? '' : ' hidden'\}/);
  assert.match(styles, /\.detail-header-actions \[hidden\]\s*\{\s*display:\s*none !important;/);
});

test('Compare connection analysis uses the visible graph and preserves authored edge direction', async () => {
  const controller = await readFile(new URL('../src/ui/compare-controller.ts', import.meta.url), 'utf8');
  const pathSearch = await readFile(new URL('../src/graph/connection-path.ts', import.meta.url), 'utf8');
  const location = await readFile(new URL('../src/app/location-controller.ts', import.meta.url), 'utf8');

  assert.match(controller, /cy\.nodes\(\)\.not\('\.filter-hidden'\)/);
  assert.match(controller, /cy\.edges\(\)\.not\('\.filter-hidden'\)/);
  assert.match(controller, /opposite the authored arrow/);
  assert.match(controller, /does not imply logical derivation/);
  assert.match(controller, /compareCopySequenceButton/);
  assert.match(pathSearch, /direction === 'either'/);
  assert.match(pathSearch, /followsArrow: false/);
  assert.match(location, /writeCompareState\(url\.searchParams/);
});

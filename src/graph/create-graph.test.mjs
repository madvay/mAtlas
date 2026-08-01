import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRendererPreferences, createGraphElements, graphStyles } from '../../.test-build/graph/create-graph.js';

function fakeGraph() {
  const renderer = { forcedPixelRatio: 1.5, motionBlurEnabled: false, motionBlur: false, hideEdgesOnViewport: true };
  const declarations = [];
  const movement = [];
  const nodes = {
    unpanify() { movement.push('unpanify'); },
    grabify() { movement.push('grabify'); },
    ungrabify() { movement.push('ungrabify'); },
    panify() { movement.push('panify'); }
  };
  const style = {
    selector(value) { declarations.push(['selector', value]); return this; },
    style(name, value) { declarations.push([name, value]); return this; },
    update() { declarations.push(['update']); return this; }
  };
  return {
    renderer,
    declarations,
    movement,
    resized: 0,
    rendered: 0,
    graph: {
      renderer: () => renderer,
      autoungrabify(value) { movement.push(['autoungrabify', value]); },
      nodes: () => nodes,
      style: () => style,
      resize() { this.owner.resized += 1; },
      forceRender() { this.owner.rendered += 1; },
      owner: null
    }
  };
}

test('renderer preferences change the live renderer and immediately redraw both resolutions', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 3 };
  try {
    const fixture = fakeGraph();
    fixture.graph.owner = fixture;
    applyRendererPreferences(fixture.graph, {
      version: 1, highResolution: true, transitions: true, motionBlur: true,
      indicateOtherDomains: true, hideEdgesWhileMoving: false, allowNodeMovement: false, dimPrerequisites: true, highlightPrerequisites: false,
      experimentalFeatures: true
    });
    assert.equal(fixture.renderer.forcedPixelRatio, null);
    assert.equal(fixture.renderer.motionBlurEnabled, true);
    assert.equal(fixture.renderer.motionBlur, true);
    assert.equal(fixture.renderer.hideEdgesOnViewport, false);
    assert.deepEqual(fixture.movement, [['autoungrabify', true], 'ungrabify', 'panify']);
    assert.ok(fixture.declarations.some(([name, value]) => name === 'transition-duration' && value === 120));
    assert.ok(fixture.declarations.some(([name, value]) => name === 'selector'
      && value === 'node.structure-source-node, node.structure-source-junction'));
    assert.ok(fixture.declarations.some(([name, value]) => name === 'selector'
      && value === 'edge.structure-source-edge'));
    const domainSelectorIndex = fixture.declarations.findIndex(([name, value]) => name === 'selector'
      && value === 'node[domainNameOverlay = 1]');
    assert.deepEqual(fixture.declarations.slice(domainSelectorIndex, domainSelectorIndex + 3), [
      ['selector', 'node[domainNameOverlay = 1]'],
      ['transition-property', 'opacity'],
      ['transition-duration', 120]
    ]);

    applyRendererPreferences(fixture.graph, {
      version: 1, highResolution: false, transitions: false, motionBlur: false,
      indicateOtherDomains: true, hideEdgesWhileMoving: true, allowNodeMovement: true, dimPrerequisites: false, highlightPrerequisites: true,
      experimentalFeatures: true
    });
    assert.equal(fixture.renderer.forcedPixelRatio, 1.5);
    assert.equal(fixture.renderer.motionBlurEnabled, false);
    assert.equal(fixture.renderer.motionBlur, false);
    assert.equal(fixture.renderer.hideEdgesOnViewport, true);
    assert.deepEqual(fixture.movement.slice(3), [['autoungrabify', false], 'unpanify', 'grabify']);
    const disabledDomainSelectorIndex = fixture.declarations.findLastIndex(([name, value]) => name === 'selector'
      && value === 'node[domainNameOverlay = 1]');
    assert.deepEqual(fixture.declarations.slice(disabledDomainSelectorIndex, disabledDomainSelectorIndex + 3), [
      ['selector', 'node[domainNameOverlay = 1]'],
      ['transition-property', 'none'],
      ['transition-duration', 0]
    ]);

    applyRendererPreferences(fixture.graph, {
      version: 1, highResolution: false, transitions: false, motionBlur: true,
      indicateOtherDomains: true, hideEdgesWhileMoving: true, allowNodeMovement: true, dimPrerequisites: false, highlightPrerequisites: true,
      experimentalFeatures: false
    });
    assert.equal(fixture.renderer.motionBlurEnabled, false);
    assert.equal(fixture.renderer.motionBlur, false);
    assert.deepEqual(fixture.movement.slice(6), [['autoungrabify', true], 'ungrabify', 'panify']);
    assert.equal(fixture.resized, 3);
    assert.equal(fixture.rendered, 3);
  } finally {
    globalThis.window = previousWindow;
  }
});


test('structure modes use text-only centroid labels and disable source-node events', () => {
  const sourceStyle = graphStyles.find((entry) => entry.selector === 'node.structure-source-node')?.style;
  const centroidStyle = graphStyles.find((entry) => entry.selector === 'node[semanticGroup = 1]')?.style;
  assert.equal(sourceStyle?.events, 'no');
  assert.equal(sourceStyle?.label, '');
  assert.equal(sourceStyle?.['transition-property'], 'none');
  assert.equal(sourceStyle?.['transition-duration'], 0);
  assert.equal(centroidStyle?.shape, 'rectangle');
  assert.equal(centroidStyle?.['background-opacity'], 0);
  assert.equal(centroidStyle?.['border-width'], 0);
  assert.equal(centroidStyle?.color, 'data(color)');
  assert.equal(centroidStyle?.['text-outline-color'], '#ffffff');
  assert.equal(centroidStyle?.width, 'data(nodeWidth)');
  assert.equal(centroidStyle?.height, 'data(nodeHeight)');
  assert.equal(centroidStyle?.['font-size'], 'data(labelFontSize)');
  const domainOverlayStyle = graphStyles.find((entry) => entry.selector === 'node[domainNameOverlay = 1]')?.style;
  const visibleDomainOverlayStyle = graphStyles.find((entry) => entry.selector === 'node[domainNameOverlay = 1].domain-name-overlay-visible')?.style;
  const atlasDomainOverlayStyle = graphStyles.find((entry) => entry.selector === 'node[domainNameOverlay = 1][domainOverlayContext = "atlas"]')?.style;
  const visibleAtlasDomainOverlayStyle = graphStyles.find((entry) => entry.selector === 'node[domainNameOverlay = 1][domainOverlayContext = "atlas"].domain-name-overlay-visible')?.style;
  const fieldDomainOverlayStyle = graphStyles.find((entry) => entry.selector === 'node[domainNameOverlay = 1][domainOverlayContext = "fields"]')?.style;
  const visibleFieldDomainOverlayStyle = graphStyles.find((entry) => entry.selector === 'node[domainNameOverlay = 1][domainOverlayContext = "fields"].domain-name-overlay-visible')?.style;
  assert.equal(domainOverlayStyle?.display, 'element');
  assert.equal(domainOverlayStyle?.opacity, 0);
  assert.equal(domainOverlayStyle?.events, 'no');
  assert.equal(domainOverlayStyle?.['z-index'], 1000);
  assert.equal(visibleDomainOverlayStyle?.opacity, 0.92);
  assert.equal(atlasDomainOverlayStyle?.color, '#ffffff');
  assert.equal(atlasDomainOverlayStyle?.['text-outline-color'], 'data(color)');
  assert.equal(atlasDomainOverlayStyle?.['text-outline-opacity'], 1);
  assert.equal(atlasDomainOverlayStyle?.['text-outline-width'], 'data(overlayTextOutlineWidth)');
  assert.equal(visibleAtlasDomainOverlayStyle?.opacity, 1);
  assert.equal(fieldDomainOverlayStyle?.['z-index'], 998);
  assert.equal(visibleFieldDomainOverlayStyle?.opacity, 0.58);
  const connectionStyle = graphStyles.find((entry) => entry.selector === 'edge[semanticConnection = 1]')?.style;
  const emphasizedConnectionStyle = graphStyles.find((entry) => entry.selector === 'edge[semanticConnection = 1].structure-connection-emphasis')?.style;
  assert.equal(connectionStyle?.opacity, 0.09);
  assert.equal(emphasizedConnectionStyle?.opacity, 1);
});


test('graph nodes and edges always use lightweight Unicode math labels', () => {
  const model = {
    data: {
      nodes: [{
        id: 'node', label: 'The $\\alpha$-$G$ action', primaryDomain: 'domain',
        kind: 'structure', level: 1, summary: 'Summary'
      }],
      domains: { domain: { color: '#123456' } },
      edgeTypes: { relation: { label: 'Relation', color: '#654321' } }
    },
    allEdges: [{
      id: 'edge', source: 'node', target: 'node', type: 'relation',
      label: '$x^2\\to y_1$', detail: 'Detail'
    }],
    nodeDomainIds() { return ['domain']; },
    nodePrimaryField() { return 'field'; },
    nodeFieldIds() { return ['field']; },
    nodeDomainLabels() { return ['Domain']; }
  };
  const labels = { semanticSize() { return 13; } };

  const elements = createGraphElements(model, labels);
  const node = elements.find((element) => element.group === 'nodes');
  const edge = elements.find((element) => element.group === 'edges');
  assert.equal(node.data.canvasLabel, 'The 𝛼-𝐺 action');
  assert.equal(edge.data.canvasLabel, '𝑥²→ 𝑦₁');
});

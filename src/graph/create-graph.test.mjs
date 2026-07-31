import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRendererPreferences, createGraphElements, graphStyles } from '../../.test-build/graph/create-graph.js';

function fakeGraph() {
  const renderer = { forcedPixelRatio: 1.5, motionBlurEnabled: false, motionBlur: false, hideEdgesOnViewport: true };
  const declarations = [];
  const movement = [];
  const markerClasses = [];
  const nodes = {
    unpanify() { movement.push('unpanify'); },
    grabify() { movement.push('grabify'); },
    ungrabify() { movement.push('ungrabify'); },
    panify() { movement.push('panify'); },
    toggleClass(name, enabled) { markerClasses.push([name, enabled]); }
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
    markerClasses,
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
      indicateOtherDomains: true, hideEdgesWhileMoving: false, allowNodeMovement: false, dimPrerequisites: true, highlightPrerequisites: false
    });
    assert.equal(fixture.renderer.forcedPixelRatio, null);
    assert.equal(fixture.renderer.motionBlurEnabled, true);
    assert.equal(fixture.renderer.motionBlur, true);
    assert.equal(fixture.renderer.hideEdgesOnViewport, false);
    assert.deepEqual(fixture.movement, [['autoungrabify', true], 'ungrabify', 'panify']);
    assert.deepEqual(fixture.markerClasses, [['secondary-domain-markers-hidden', false]]);
    assert.ok(fixture.declarations.some(([name, value]) => name === 'transition-duration' && value === 120));
    assert.ok(fixture.declarations.some(([name, value]) => name === 'selector'
      && value === 'node.structure-source-node, node.structure-source-junction'));
    assert.ok(fixture.declarations.some(([name, value]) => name === 'selector'
      && value === 'edge.structure-source-edge'));

    applyRendererPreferences(fixture.graph, {
      version: 1, highResolution: false, transitions: false, motionBlur: false,
      indicateOtherDomains: false, hideEdgesWhileMoving: true, allowNodeMovement: true, dimPrerequisites: false, highlightPrerequisites: true
    });
    assert.equal(fixture.renderer.forcedPixelRatio, 1.5);
    assert.equal(fixture.renderer.motionBlurEnabled, false);
    assert.equal(fixture.renderer.motionBlur, false);
    assert.equal(fixture.renderer.hideEdgesOnViewport, true);
    assert.deepEqual(fixture.movement.slice(3), [['autoungrabify', false], 'unpanify', 'grabify']);
    assert.deepEqual(fixture.markerClasses.at(-1), ['secondary-domain-markers-hidden', true]);
    assert.equal(fixture.resized, 2);
    assert.equal(fixture.rendered, 2);
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
  assert.equal(sourceStyle?.['background-image'], 'none');
  assert.equal(centroidStyle?.shape, 'rectangle');
  assert.equal(centroidStyle?.['background-opacity'], 0);
  assert.equal(centroidStyle?.['border-width'], 0);
  assert.equal(centroidStyle?.color, 'data(color)');
  assert.equal(centroidStyle?.['text-outline-color'], '#ffffff');
  assert.equal(centroidStyle?.width, 'data(nodeWidth)');
  assert.equal(centroidStyle?.height, 'data(nodeHeight)');
  assert.equal(centroidStyle?.['font-size'], 'data(labelFontSize)');
  const connectionStyle = graphStyles.find((entry) => entry.selector === 'edge[semanticConnection = 1]')?.style;
  const emphasizedConnectionStyle = graphStyles.find((entry) => entry.selector === 'edge[semanticConnection = 1].structure-connection-emphasis')?.style;
  assert.equal(connectionStyle?.opacity, 0.09);
  assert.equal(emphasizedConnectionStyle?.opacity, 1);
});



test('multi-domain nodes use native Cytoscape background images for marker dots', () => {
  const markerStyle = graphStyles.find((entry) => entry.selector === 'node[multiDomain = 1]')?.style;
  const hiddenStyle = graphStyles.find((entry) => entry.selector === 'node.secondary-domain-markers-hidden')?.style;
  assert.equal(typeof markerStyle?.['background-image'], 'function');
  assert.equal(typeof markerStyle?.['background-offset-x'], 'function');
  assert.equal(typeof markerStyle?.['background-image-containment'], 'function');
  assert.equal(hiddenStyle?.['background-image'], 'none');
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

  const hiddenElements = createGraphElements(model, labels, false);
  const hiddenNode = hiddenElements.find((element) => element.group === 'nodes');
  assert.equal(node.classes, '');
  assert.equal(hiddenNode.classes, 'secondary-domain-markers-hidden');
});

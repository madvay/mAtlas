import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRendererPreferences, graphStyles } from '../../.test-build/graph/create-graph.js';

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
      version: 1, highResolution: true, transitions: true, motionBlur: true, formulaeInGraph: false,
      indicateOtherDomains: true, hideEdgesWhileMoving: false, allowNodeMovement: false, dimPrerequisites: true, highlightPrerequisites: false
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

    applyRendererPreferences(fixture.graph, {
      version: 1, highResolution: false, transitions: false, motionBlur: false, formulaeInGraph: true,
      indicateOtherDomains: true, hideEdgesWhileMoving: true, allowNodeMovement: true, dimPrerequisites: false, highlightPrerequisites: true
    });
    assert.equal(fixture.renderer.forcedPixelRatio, 1.5);
    assert.equal(fixture.renderer.motionBlurEnabled, false);
    assert.equal(fixture.renderer.motionBlur, false);
    assert.equal(fixture.renderer.hideEdgesOnViewport, true);
    assert.deepEqual(fixture.movement.slice(3), [['autoungrabify', false], 'unpanify', 'grabify']);
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
  assert.equal(connectionStyle?.opacity, 0.18);
  assert.equal(emphasizedConnectionStyle?.opacity, 1);
});

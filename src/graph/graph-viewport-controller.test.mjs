import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphViewportController, viewportChangeIsMeaningful } from '../../.test-build/graph/graph-viewport-controller.js';
import {
  ABSOLUTE_MIN_ZOOM,
  DEFAULT_INTERACTIVE_MIN_ZOOM
} from '../../.test-build/graph/viewport-fit-core.js';

function mockGraph(initialMinZoom = DEFAULT_INTERACTIVE_MIN_ZOOM) {
  let minZoom = initialMinZoom;
  let appliedViewport = null;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  return {
    cy: {
      width: () => 1000,
      height: () => 600,
      maxZoom: () => 3,
      minZoom(value) {
        if (value === undefined) return minZoom;
        minZoom = value;
        return this;
      },
      zoom: () => zoom,
      pan: () => pan,
      viewport(value) {
        appliedViewport = value;
        zoom = value.zoom;
        pan = value.pan;
        return this;
      }
    },
    minZoom: () => minZoom,
    viewport: () => appliedViewport
  };
}

function elementsWithBox(box) {
  return {
    empty: () => false,
    boundingBox: () => box
  };
}

test('controller lowers Cytoscape minimum zoom to the fitted scale', () => {
  const graph = mockGraph();
  const controller = new GraphViewportController({
    cy: graph.cy,
    state: { layout: 'atlas' },
    viewportInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
  });

  controller.fit(elementsWithBox({ x1: 0, y1: 0, w: 20_000, h: 10_000 }), 20);

  assert.ok(graph.viewport());
  assert.ok(graph.viewport().zoom < DEFAULT_INTERACTIVE_MIN_ZOOM);
  assert.equal(graph.minZoom(), graph.viewport().zoom);
  assert.ok(graph.minZoom() >= ABSOLUTE_MIN_ZOOM);
});

test('viewport significance ignores sub-pixel and tiny zoom changes', () => {
  assert.equal(viewportChangeIsMeaningful(
    { zoom: 1, pan: { x: 10, y: 20 } },
    { zoom: 1.005, pan: { x: 10.5, y: 20.5 } }
  ), false);
  assert.equal(viewportChangeIsMeaningful(
    { zoom: 1, pan: { x: 10, y: 20 } },
    { zoom: 1.02, pan: { x: 10, y: 20 } }
  ), true);
});

test('cancelling an animated fit calls its completion exactly once', () => {
  let completePromise;
  let stopped = 0;
  let completed = 0;
  const graph = mockGraph();
  graph.cy.animation = () => ({
    play() { return this; },
    stop() { stopped += 1; return this; },
    promise() {
      return new Promise((resolve) => { completePromise = resolve; });
    }
  });
  const controller = new GraphViewportController({
    cy: graph.cy,
    state: { layout: 'atlas' },
    viewportInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    animate: () => true
  });

  controller.fit(elementsWithBox({ x1: 0, y1: 0, w: 2000, h: 1000 }), 20, () => { completed += 1; });
  controller.cancel();
  completePromise();

  assert.equal(stopped, 1);
  assert.equal(completed, 1);
});

test('controller restores the normal interactive minimum on a closer fit', () => {
  const graph = mockGraph(0.02);
  const controller = new GraphViewportController({
    cy: graph.cy,
    state: { layout: 'compact' },
    viewportInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
  });

  controller.fit(elementsWithBox({ x1: 0, y1: 0, w: 1000, h: 500 }), 20);

  assert.ok(graph.viewport());
  assert.ok(graph.viewport().zoom > DEFAULT_INTERACTIVE_MIN_ZOOM);
  assert.equal(graph.minZoom(), DEFAULT_INTERACTIVE_MIN_ZOOM);
});


test('controller updates minimum zoom without moving the viewport when refitting is suppressed', () => {
  const graph = mockGraph();
  let completed = 0;
  const controller = new GraphViewportController({
    cy: graph.cy,
    state: { layout: 'atlas' },
    viewportInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    animate: () => true
  });

  controller.fit(
    elementsWithBox({ x1: 0, y1: 0, w: 20_000, h: 10_000 }),
    20,
    () => { completed += 1; },
    false
  );

  assert.equal(graph.viewport(), null);
  assert.ok(graph.minZoom() < DEFAULT_INTERACTIVE_MIN_ZOOM);
  assert.ok(graph.minZoom() >= ABSOLUTE_MIN_ZOOM);
  assert.equal(completed, 1);
});

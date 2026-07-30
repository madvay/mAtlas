import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphViewportController } from '../../.test-build/graph/graph-viewport-controller.js';
import {
  ABSOLUTE_MIN_ZOOM,
  DEFAULT_INTERACTIVE_MIN_ZOOM
} from '../../.test-build/graph/viewport-fit-core.js';

function mockGraph(initialMinZoom = DEFAULT_INTERACTIVE_MIN_ZOOM) {
  let minZoom = initialMinZoom;
  let appliedViewport = null;
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
      viewport(value) {
        appliedViewport = value;
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

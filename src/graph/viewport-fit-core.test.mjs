import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSOLUTE_MIN_ZOOM,
  DEFAULT_INTERACTIVE_MIN_ZOOM,
  calculateFitViewport,
  minimumZoomForFit
} from '../../.test-build/graph/viewport-fit-core.js';

const zeroInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const zeroMargins = { top: 0, right: 0, bottom: 0, left: 0 };

test('fit viewport centers a graph inside asymmetric panel insets', () => {
  const result = calculateFitViewport(
    { x1: 0, y1: 0, w: 1000, h: 500 },
    { width: 1200, height: 800 },
    { top: 0, right: 300, bottom: 0, left: 100 },
    zeroMargins,
    20,
    0.01,
    4
  );
  assert.ok(result);
  assert.equal(result.zoom, 0.76);
  assert.equal(result.pan.x, 120);
  assert.equal(result.pan.y, 210);
});

test('field-band margins reserve rendered room beyond node bounds', () => {
  const result = calculateFitViewport(
    { x1: -500, y1: -250, w: 1000, h: 500 },
    { width: 1000, height: 600 },
    zeroInsets,
    { top: 52, right: 28, bottom: 34, left: 28 },
    20,
    0.01,
    4
  );
  assert.ok(result);
  assert.equal(result.zoom, 0.904);
  assert.equal(result.pan.x, 500);
  assert.equal(result.pan.y, 309);
});

test('fit viewport rejects an occluded viewport', () => {
  assert.equal(calculateFitViewport(
    { x1: 0, y1: 0, w: 100, h: 100 },
    { width: 300, height: 200 },
    { top: 0, right: 160, bottom: 0, left: 160 },
    zeroMargins,
    10,
    0.01,
    4
  ), null);
});

test('fit safety scale leaves room for rendering roundoff', () => {
  const result = calculateFitViewport(
    { x1: 0, y1: 0, w: 1000, h: 500 },
    { width: 1000, height: 500 },
    zeroInsets,
    zeroMargins,
    0,
    ABSOLUTE_MIN_ZOOM,
    4,
    0.98
  );
  assert.ok(result);
  assert.equal(result.zoom, 0.98);
  assert.equal(result.pan.x, 10);
  assert.equal(result.pan.y, 5);
});

test('fit may zoom below the normal interactive minimum', () => {
  const result = calculateFitViewport(
    { x1: 0, y1: 0, w: 20_000, h: 10_000 },
    { width: 1000, height: 500 },
    zeroInsets,
    zeroMargins,
    0,
    ABSOLUTE_MIN_ZOOM,
    4,
    0.98
  );
  assert.ok(result);
  assert.equal(result.zoom, 0.049);
  assert.ok(result.zoom < DEFAULT_INTERACTIVE_MIN_ZOOM);
  assert.equal(minimumZoomForFit(result.zoom), result.zoom);
});

test('fit minimum returns to the normal interactive floor when possible', () => {
  assert.equal(minimumZoomForFit(0.4), DEFAULT_INTERACTIVE_MIN_ZOOM);
  assert.equal(minimumZoomForFit(0.001), ABSOLUTE_MIN_ZOOM);
});

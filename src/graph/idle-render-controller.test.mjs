import test from 'node:test';
import assert from 'node:assert/strict';
import { IdleRenderController } from '../../.test-build/graph/idle-render-controller.js';

function timerHarness() {
  const previousWindow = globalThis.window;
  let nextId = 1;
  const timers = new Map();
  globalThis.window = {
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    }
  };
  return {
    runNext() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected a scheduled idle check');
      const [id, callback] = entry;
      timers.delete(id);
      callback();
    },
    count: () => timers.size,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  };
}

function fixture() {
  const handlers = new Map();
  const containerHandlers = new Map();
  const renderer = {
    destroyed: false,
    renderLoopStarted: true,
    requestedFrame: false,
    redrawCalls: 0,
    startCalls: 0,
    redraw() { this.redrawCalls += 1; },
    startRenderLoop() { this.startCalls += 1; this.renderLoopStarted = true; }
  };
  let animated = false;
  const cy = {
    renderer: () => renderer,
    on(events, handler) {
      for (const event of events.split(' ')) handlers.set(event, handler);
    },
    animated: () => animated
  };
  const container = {
    addEventListener(name, handler) { containerHandlers.set(name, handler); }
  };
  return {
    cy,
    container,
    renderer,
    handlers,
    containerHandlers,
    setAnimated(value) { animated = value; }
  };
}

test('the renderer parks after settled inactivity and wakes before the next graph event', () => {
  const timers = timerHarness();
  try {
    const graph = fixture();
    new IdleRenderController(graph.cy, graph.container);
    assert.equal(timers.count(), 1);

    timers.runNext();
    assert.equal(graph.renderer.destroyed, true);

    graph.handlers.get('zoom')();
    assert.equal(graph.renderer.destroyed, false);
    assert.equal(graph.renderer.renderLoopStarted, true);
    assert.equal(graph.renderer.startCalls, 1);
    assert.equal(graph.renderer.redrawCalls, 1);
    assert.equal(timers.count(), 1);
  } finally {
    timers.restore();
  }
});

test('animation or a pending renderer frame postpones parking', () => {
  const timers = timerHarness();
  try {
    const graph = fixture();
    graph.setAnimated(true);
    new IdleRenderController(graph.cy, graph.container);
    timers.runNext();
    assert.equal(graph.renderer.destroyed, false);
    assert.equal(timers.count(), 1);

    graph.setAnimated(false);
    graph.renderer.requestedFrame = true;
    timers.runNext();
    assert.equal(graph.renderer.destroyed, false);
    assert.equal(timers.count(), 1);

    graph.renderer.requestedFrame = false;
    timers.runNext();
    assert.equal(graph.renderer.destroyed, true);
  } finally {
    timers.restore();
  }
});

test('pointer and wheel activity use the same wake path as Cytoscape events', () => {
  const timers = timerHarness();
  try {
    const graph = fixture();
    new IdleRenderController(graph.cy, graph.container);
    timers.runNext();
    assert.equal(graph.renderer.destroyed, true);

    graph.containerHandlers.get('wheel')();
    assert.equal(graph.renderer.destroyed, false);
    assert.equal(graph.renderer.startCalls, 1);
  } finally {
    timers.restore();
  }
});

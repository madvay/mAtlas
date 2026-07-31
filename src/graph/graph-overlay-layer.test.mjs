import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphOverlayLayer } from '../../.test-build/graph/graph-overlay-layer.js';

class FakeElement {
  constructor() {
    this.children = [];
    this.style = {};
    this.hidden = false;
    this.className = '';
    this.textContent = '';
    this.removed = false;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute() {}
  remove() { this.removed = true; }
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const frames = [];
  globalThis.document = {
    createElement() { return new FakeElement(); }
  };
  globalThis.window = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    }
  };
  return {
    flush() {
      const pending = frames.splice(0);
      for (const callback of pending) callback();
    },
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  };
}

function nodeFixture() {
  const position = { x: 40, y: 25 };
  const classes = new Set();
  let opacity = '1';
  return {
    isNode() { return true; },
    position() { return { ...position }; },
    hasClass(name) { return classes.has(name); },
    style(name) { return name === 'display' ? 'element' : name === 'opacity' ? opacity : ''; },
    empty() { return false; },
    boundingBox() { return { x1: position.x - 82, y2: position.y + 29 }; },
    moveTo(x, y) { position.x = x; position.y = y; },
    setOpacity(value) { opacity = String(value); },
    addClass(name) { classes.add(name); },
    removeClass(name) { classes.delete(name); }
  };
}

function graphFixture(node) {
  const handlers = new Map();
  const viewport = { pan: { x: 10, y: 20 }, zoom: 1 };
  return {
    on(events, handler) {
      for (const event of events.split(/\s+/)) handlers.set(event, handler);
    },
    getElementById(id) { return id === 'node' ? node : { empty() { return true; } }; },
    pan() { return { ...viewport.pan }; },
    zoom() { return viewport.zoom; },
    setViewport(pan, zoom) { viewport.pan = pan; viewport.zoom = zoom; },
    emit(event) { handlers.get(event)?.(); }
  };
}

test('zoom updates one overlay viewport transform and Story badge geometry follows nodes', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = {
      inserted: null,
      insertAdjacentElement(_position, element) { this.inserted = element; }
    };
    const layer = new GraphOverlayLayer(cy, graphContainer);
    layer.setNodeSequence(['node']);
    dom.flush();

    const viewport = graphContainer.inserted.children[0];
    const badge = viewport.children[0];
    assert.equal(viewport.style.transform, 'translate3d(10px, 20px, 0) scale(1)');
    assert.equal(badge.className, 'graph-sequence-badge');
    assert.equal(badge.style.left, '-42px');
    assert.equal(badge.style.top, '54px');

    cy.setViewport({ x: -30, y: 18 }, 1.75);
    cy.emit('zoom');
    dom.flush();
    assert.equal(viewport.style.transform, 'translate3d(-30px, 18px, 0) scale(1.75)');

    node.moveTo(55, 70);
    cy.emit('position');
    dom.flush();
    assert.equal(badge.style.left, '-27px');
    assert.equal(badge.style.top, '99px');
  } finally {
    dom.restore();
  }
});

test('Story badge visibility and opacity follow the Cytoscape node', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = {
      inserted: null,
      insertAdjacentElement(_position, element) { this.inserted = element; }
    };
    const layer = new GraphOverlayLayer(cy, graphContainer);
    layer.setNodeSequence(['node']);
    dom.flush();

    const badge = graphContainer.inserted.children[0].children[0];
    assert.equal(badge.hidden, false);
    assert.equal(badge.style.opacity, '1');

    node.setOpacity(0.46);
    cy.emit('style');
    dom.flush();
    assert.equal(badge.style.opacity, '0.46');

    node.addClass('structure-source-node');
    cy.emit('style');
    dom.flush();
    assert.equal(badge.hidden, true);
  } finally {
    dom.restore();
  }
});

test('Story sequence badges are numbered, positioned at node bottom-left, and cleared', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = {
      inserted: null,
      insertAdjacentElement(_position, element) { this.inserted = element; }
    };
    const layer = new GraphOverlayLayer(cy, graphContainer);
    dom.flush();
    layer.setNodeSequence(['node']);
    dom.flush();

    const viewport = graphContainer.inserted.children[0];
    const badge = viewport.children.at(-1);
    assert.equal(badge.className, 'graph-sequence-badge');
    assert.equal(badge.textContent, '1');
    assert.equal(badge.style.left, '-42px');
    assert.equal(badge.style.top, '54px');

    layer.setNodeSequence([]);
    assert.equal(badge.removed, true);
  } finally {
    dom.restore();
  }
});

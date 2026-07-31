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
  const data = {
    kind: 'structure',
    multiDomain: 1,
    domainColors: ['#111111', '#222222', '#333333']
  };
  const position = { x: 40, y: 25 };
  const classes = new Set();
  let opacity = '1';
  return {
    data(key) { return data[key]; },
    isNode() { return true; },
    position() { return { ...position }; },
    hasClass(name) { return classes.has(name); },
    style(name) { return name === 'display' ? 'element' : name === 'opacity' ? opacity : ''; },
    empty() { return false; },
    boundingBox() { return { x1: position.x - 82, y2: position.y + 29 }; },
    moveTo(x, y) { position.x = x; position.y = y; },
    setOpacity(value) { opacity = String(value); },
    addClass(name) { classes.add(name); }
  };
}

function graphFixture(node) {
  const handlers = new Map();
  const viewport = { pan: { x: 10, y: 20 }, zoom: 1 };
  return {
    on(events, handler) {
      for (const event of events.split(/\s+/)) handlers.set(event, handler);
    },
    nodes() { return { forEach(callback) { callback(node); } }; },
    getElementById(id) { return id === 'node' ? node : { empty() { return true; } }; },
    pan() { return { ...viewport.pan }; },
    zoom() { return viewport.zoom; },
    setViewport(pan, zoom) { viewport.pan = pan; viewport.zoom = zoom; },
    emit(event) { handlers.get(event)?.(); }
  };
}

function preferences(overrides = {}) {
  return {
    version: 1,
    highResolution: true,
    transitions: true,
    animateGraph: false,
    refitOnChange: true,
    motionBlur: false,
    indicateOtherDomains: true,
    hideEdgesWhileMoving: true,
    allowNodeMovement: false,
    dimPrerequisites: true,
    highlightPrerequisites: false,
    experimentalFeatures: false,
    ...overrides
  };
}

test('zoom updates one overlay viewport transform and marker geometry follows nodes', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = {
      inserted: null,
      insertAdjacentElement(_position, element) { this.inserted = element; }
    };
    new GraphOverlayLayer(cy, graphContainer, preferences());
    dom.flush();

    const viewport = graphContainer.inserted.children[0];
    const marker = viewport.children[0];
    assert.equal(viewport.style.transform, 'translate3d(10px, 20px, 0) scale(1)');
    assert.equal(marker.className, 'graph-domain-markers');
    assert.equal(marker.children.length, 2);
    assert.equal(marker.style.left, '116px');
    assert.equal(marker.style.top, '50px');

    cy.setViewport({ x: -30, y: 18 }, 1.75);
    cy.emit('zoom');
    dom.flush();
    assert.equal(viewport.style.transform, 'translate3d(-30px, 18px, 0) scale(1.75)');

    node.moveTo(55, 70);
    cy.emit('position');
    dom.flush();
    assert.equal(marker.style.left, '131px');
    assert.equal(marker.style.top, '95px');
  } finally {
    dom.restore();
  }
});

test('domain marker visibility follows preferences without affecting Story badges', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = {
      inserted: null,
      insertAdjacentElement(_position, element) { this.inserted = element; }
    };
    const layer = new GraphOverlayLayer(cy, graphContainer, preferences());
    layer.setNodeSequence(['node']);
    dom.flush();

    const viewport = graphContainer.inserted.children[0];
    const marker = viewport.children[0];
    const badge = viewport.children[1];
    assert.equal(marker.hidden, false);
    assert.equal(badge.hidden, false);

    layer.setPreferences(preferences({ indicateOtherDomains: false }));
    dom.flush();
    assert.equal(marker.hidden, true);
    assert.equal(badge.hidden, false);
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
    const layer = new GraphOverlayLayer(cy, graphContainer, preferences());
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

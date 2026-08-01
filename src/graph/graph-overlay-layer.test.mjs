import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphOverlayLayer } from '../../.test-build/graph/graph-overlay-layer.js';

class FakeCanvasContext {
  constructor() {
    this.arcs = [];
    this.transforms = [];
    this.fillStyle = '';
    this.globalAlpha = 1;
    this.clearCount = 0;
  }

  setTransform(...values) { this.transforms.push(values); }
  clearRect() { this.clearCount += 1; this.arcs = []; }
  beginPath() {}
  arc(x, y, radius, start, end) {
    this.arcs.push({ x, y, radius, start, end, fillStyle: this.fillStyle, opacity: this.globalAlpha });
  }
  fill() {}
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.hidden = false;
    this.className = '';
    this.textContent = '';
    this.removed = false;
    this.attributes = new Map();
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  remove() { this.removed = true; }
}

class FakeCanvasElement extends FakeElement {
  constructor() {
    super('canvas');
    this.width = 300;
    this.height = 150;
    this.context = new FakeCanvasContext();
  }

  getContext(kind) { return kind === '2d' ? this.context : null; }
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const frames = [];
  globalThis.document = {
    createElement(tagName) { return tagName === 'canvas' ? new FakeCanvasElement() : new FakeElement(tagName); }
  };
  globalThis.window = {
    devicePixelRatio: 1,
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

function graphContainerFixture() {
  return {
    clientWidth: 400,
    clientHeight: 300,
    inserted: null,
    insertAdjacentElement(_position, element) { this.inserted = element; }
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

test('one canvas draws all domain dots and follows viewport and node geometry', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = graphContainerFixture();
    new GraphOverlayLayer(cy, graphContainer, preferences());
    dom.flush();

    const canvas = graphContainer.inserted.children[0];
    const viewport = graphContainer.inserted.children[1];
    assert.equal(canvas.className, 'graph-domain-marker-canvas');
    assert.equal(canvas.width, 400);
    assert.equal(canvas.height, 300);
    assert.equal(canvas.getAttribute('data-domain-marker-nodes'), '1');
    assert.deepEqual(canvas.context.arcs.map(({ x, y, radius, fillStyle }) => ({ x, y, radius, fillStyle })), [
      { x: 99.5, y: 45.5, radius: 4.5, fillStyle: '#222222' },
      { x: 111.5, y: 45.5, radius: 4.5, fillStyle: '#333333' }
    ]);
    assert.deepEqual(canvas.context.transforms.at(-1), [1, 0, 0, 1, 10, 20]);

    cy.setViewport({ x: -30, y: 18 }, 1.75);
    cy.emit('zoom');
    dom.flush();
    assert.deepEqual(canvas.context.transforms.at(-1), [1.75, 0, 0, 1.75, -30, 18]);

    node.moveTo(55, 70);
    cy.emit('position');
    dom.flush();
    assert.deepEqual(canvas.context.arcs.map(({ x, y }) => ({ x, y })), [
      { x: 114.5, y: 90.5 },
      { x: 126.5, y: 90.5 }
    ]);
  } finally {
    dom.restore();
  }
});

test('domain marker visibility and opacity are cached independently of Story badges', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = graphContainerFixture();
    const layer = new GraphOverlayLayer(cy, graphContainer, preferences());
    layer.setNodeSequence(['node']);
    dom.flush();

    const canvas = graphContainer.inserted.children[0];
    const viewport = graphContainer.inserted.children[1];
    const badge = viewport.children[0];
    assert.equal(canvas.context.arcs.length, 2);
    assert.equal(badge.hidden, false);

    node.setOpacity(0.46);
    cy.emit('style');
    dom.flush();
    assert.deepEqual(canvas.context.arcs.map((arc) => arc.opacity), [0.46, 0.46]);
    assert.equal(badge.style.opacity, '0.46');

    const clearsBeforeDisable = canvas.context.clearCount;
    layer.setPreferences(preferences({ indicateOtherDomains: false }));
    dom.flush();
    assert.equal(canvas.context.arcs.length, 0);
    assert.equal(canvas.hidden, true);
    assert.equal(canvas.context.clearCount, clearsBeforeDisable + 1);
    assert.equal(badge.hidden, false);

    cy.emit('zoom');
    dom.flush();
    assert.equal(canvas.context.clearCount, clearsBeforeDisable + 1);
  } finally {
    dom.restore();
  }
});

test('Story sequence badges are numbered, positioned at node bottom-left, and cleared', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = graphContainerFixture();
    const layer = new GraphOverlayLayer(cy, graphContainer, preferences());
    dom.flush();
    layer.setNodeSequence(['node']);
    dom.flush();

    const viewport = graphContainer.inserted.children[1];
    const badge = viewport.children[0];
    assert.equal(badge.className, 'graph-sequence-badge');
    assert.equal(badge.textContent, '1');
    assert.equal(badge.style.left, '-42px');
    assert.equal(badge.style.top, '54px');
    assert.equal(viewport.style.transform, 'translate3d(10px, 20px, 0) scale(1)');

    cy.setViewport({ x: -30, y: 18 }, 1.75);
    cy.emit('zoom');
    dom.flush();
    assert.equal(viewport.style.transform, 'translate3d(-30px, 18px, 0) scale(1.75)');

    layer.setNodeSequence([]);
    assert.equal(badge.removed, true);
  } finally {
    dom.restore();
  }
});

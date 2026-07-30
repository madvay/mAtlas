import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphMathLabelLayer } from '../../.test-build/graph/graph-math-label-layer.js';

class FakeElement {
  constructor() {
    this.children = [];
    this.style = {};
    this.hidden = false;
    this.className = '';
    this.innerHTML = '';
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
    hasMathLabel: 1,
    kind: 'structure',
    label: '$G$-action',
    labelFontSize: 13
  };
  const position = { x: 40, y: 25 };
  return {
    data(key) { return data[key]; },
    isNode() { return true; },
    isEdge() { return false; },
    position() { return { ...position }; },
    hasClass() { return false; },
    style(name) { return name === 'display' ? 'element' : name === 'opacity' ? '1' : ''; },
    selected() { return false; },
    empty() { return false; },
    boundingBox() { return { x1: position.x - 82, y2: position.y + 29 }; },
    moveTo(x, y) { position.x = x; position.y = y; }
  };
}

function graphFixture(node) {
  const handlers = new Map();
  const viewport = { pan: { x: 10, y: 20 }, zoom: 1 };
  return {
    on(events, handler) {
      for (const event of events.split(/\s+/)) handlers.set(event, handler);
    },
    edges() { return { forEach() {} }; },
    nodes() { return { forEach(callback) { callback(node); } }; },
    getElementById(id) { return id === 'node' ? node : { empty() { return true; } }; },
    pan() { return { ...viewport.pan }; },
    zoom() { return viewport.zoom; },
    setViewport(pan, zoom) { viewport.pan = pan; viewport.zoom = zoom; },
    emit(event) { handlers.get(event)?.(); }
  };
}

test('zoom updates one viewport transform without resizing every KaTeX label', () => {
  const dom = installDom();
  try {
    const node = nodeFixture();
    const cy = graphFixture(node);
    const graphContainer = {
      inserted: null,
      insertAdjacentElement(_position, element) { this.inserted = element; }
    };
    new GraphMathLabelLayer(cy, graphContainer, { renderText: (value) => `<b>${value}</b>` });
    dom.flush();

    const viewport = graphContainer.inserted.children[0];
    const label = viewport.children[0];
    assert.equal(viewport.style.transform, 'translate3d(10px, 20px, 0) scale(1)');
    assert.equal(label.style.left, '40px');
    assert.equal(label.style.top, '25px');
    assert.equal(label.style.fontSize, '13px');

    const geometryBeforeZoom = { ...label.style };
    cy.setViewport({ x: -30, y: 18 }, 1.75);
    cy.emit('zoom');
    dom.flush();

    assert.equal(viewport.style.transform, 'translate3d(-30px, 18px, 0) scale(1.75)');
    assert.deepEqual(label.style, geometryBeforeZoom);

    node.moveTo(55, 70);
    cy.emit('position');
    dom.flush();
    assert.equal(label.style.left, '55px');
    assert.equal(label.style.top, '70px');
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
    const layer = new GraphMathLabelLayer(cy, graphContainer, { renderText: (value) => String(value) });
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

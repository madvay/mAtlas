import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldBandController } from '../../.test-build/ui/field-band-controller.js';

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, value); }
}

class FakeHTMLElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.children = [];
    this.style = new FakeStyle();
    this.className = '';
    this.innerHTML = '';
    this.ownerDocument = null;
  }
  replaceChildren(...children) { this.children = children; }
  appendChild(child) { this.children.push(child); return child; }
}

function installDom() {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  const container = new FakeHTMLElement('fieldBands');
  let nextTimer = 1;
  const timers = new Map();
  const document = {
    getElementById(id) { return id === 'fieldBands' ? container : null; },
    createElement() {
      const element = new FakeHTMLElement();
      element.ownerDocument = document;
      return element;
    }
  };
  container.ownerDocument = document;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.document = document;
  globalThis.window = {
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    }
  };
  return {
    container,
    timerCount: () => timers.size,
    flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  };
}

function visibleNodeCollection(box) {
  return {
    not() { return this; },
    filter() { return this; },
    empty() { return false; },
    renderedBoundingBox() { return box; }
  };
}

function fixture(layout = 'atlas') {
  let geometryReads = 0;
  const box = { x1: 100, y1: 80, w: 240, h: 160 };
  const collection = visibleNodeCollection(box);
  const cy = {
    nodes() {
      return {
        not() {
          return {
            filter() {
              return {
                empty: collection.empty,
                renderedBoundingBox() { geometryReads += 1; return box; }
              };
            }
          };
        }
      };
    }
  };
  const model = {
    fieldOrder: ['mathematics'],
    nodeRecord: new Map([['node', { id: 'node', primaryDomain: 'algebra' }]]),
    nodePrimaryField: () => 'mathematics',
    data: { fields: { mathematics: { label: 'Math & Logic', color: '#123456' } } }
  };
  const state = { layout };
  return {
    state,
    controller: new FieldBandController({ cy, model, state, isMobileLayout: () => false }),
    geometryReads: () => geometryReads
  };
}

test('domain, field, and compact layouts clear bands without reading graph geometry', () => {
  const dom = installDom();
  try {
    for (const layout of ['breadthfirst', 'domains', 'fields']) {
      const item = fixture(layout);
      dom.container.hidden = false;
      dom.container.children = [new FakeHTMLElement()];
      item.controller.update();
      assert.equal(dom.container.hidden, true);
      assert.equal(dom.container.children.length, 0);
      assert.equal(item.geometryReads(), 0);
    }
  } finally {
    dom.restore();
  }
});

test('layered layout renders field bounds and escaped labels from actual geometry', () => {
  const dom = installDom();
  try {
    const item = fixture('atlas');
    item.controller.update();
    assert.equal(dom.container.hidden, false);
    assert.equal(dom.container.children.length, 1);
    const band = dom.container.children[0];
    assert.equal(band.className, 'field-band');
    assert.equal(band.style.left, '72px');
    assert.equal(band.style.top, '28px');
    assert.equal(band.style.width, '296px');
    assert.equal(band.style.height, '246px');
    assert.equal(band.style.values.get('--field-color'), '#123456');
    assert.equal(band.innerHTML, '<span>Math &amp; Logic</span>');
    assert.equal(item.geometryReads(), 1);
  } finally {
    dom.restore();
  }
});

test('pan and zoom scheduling coalesces geometry work and hides stale bands immediately', () => {
  const dom = installDom();
  try {
    const item = fixture('atlas');
    dom.container.hidden = false;
    item.controller.schedule();
    item.controller.schedule();
    assert.equal(dom.container.hidden, true);
    assert.equal(dom.timerCount(), 1);
    assert.equal(item.geometryReads(), 0);
    dom.flush();
    assert.equal(item.geometryReads(), 1);
    assert.equal(dom.container.hidden, false);
  } finally {
    dom.restore();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutManager } from '../../.test-build/graph/layout-manager.js';

function makeNode(id, position = { x: 0, y: 0 }) {
  let current = { ...position };
  return {
    id: () => id,
    position(next) {
      if (next) current = { ...next };
      return { ...current };
    }
  };
}

function makeNodeCollection(nodes, layouts) {
  return {
    not: () => makeNodeCollection(nodes, layouts),
    forEach: (callback) => nodes.forEach(callback),
    positions(callback) {
      nodes.forEach((node) => node.position(callback(node)));
      return this;
    },
    stop: () => this,
    layout(options) {
      const record = {
        options,
        stopped: 0,
        run: 0,
        layout: {
          run() { record.run += 1; return this; },
          stop() { record.stopped += 1; return this; }
        }
      };
      layouts.push(record);
      return record.layout;
    }
  };
}

test('interrupted animated layouts settle once and ignore stale stop callbacks', () => {
  const originalDocument = globalThis.document;
  const originalHtmlSelectElement = globalThis.HTMLSelectElement;
  globalThis.document = { getElementById: () => null };
  globalThis.HTMLSelectElement = class {};
  try {
    const layouts = [];
    const nodes = [makeNode('a')];
    const nodeCollection = makeNodeCollection(nodes, layouts);
    let settled = 0;
    let prepared = 0;
    const manager = new LayoutManager({
      cy: {
        nodes: () => nodeCollection,
        elements: () => ({ not: () => ({ filter: () => ({}) }) })
      },
      model: {},
      state: { layout: 'atlas' },
      onStateChange: () => {},
      animateGraph: () => true,
      onLayoutStarted: () => {},
      onLayoutPrepared: () => { prepared += 1; },
      onLayoutSettled: () => { settled += 1; },
      fitVisible: () => {},
      cancelFit: () => {}
    });
    manager.atlasPositions = () => ({ a: { x: 100, y: 50 } });

    manager.run('atlas', false);
    const first = layouts[0];
    manager.run('atlas', false);
    const second = layouts[1];

    assert.equal(first.stopped, 1);
    assert.equal(settled, 1);
    first.options.stop();
    assert.equal(prepared, 0);
    assert.equal(settled, 1);

    second.options.stop();
    assert.equal(prepared, 1);
    assert.equal(settled, 2);
    second.options.stop();
    assert.equal(prepared, 1);
    assert.equal(settled, 2);
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLSelectElement = originalHtmlSelectElement;
  }
});

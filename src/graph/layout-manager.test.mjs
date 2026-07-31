import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutManager } from '../../.test-build/graph/layout-manager.js';

function node(id, primaryField, primaryDomain, level) {
  return {
    id,
    label: id,
    primaryField,
    primaryDomain,
    level,
    kind: 'structure'
  };
}

function managerFor(nodes) {
  const domains = {
    'atomic-molecular-physics': { field: 'physics', order: 105 },
    'atomic-structure-periodicity': { field: 'chemistry', order: 201 },
    'molecular-structure-bonding': { field: 'chemistry', order: 202 }
  };
  const model = {
    data: { nodes, domains },
    fieldOrder: ['physics', 'chemistry'],
    domainOrder: Object.keys(domains),
    fieldForDomain: (domainId) => domains[domainId].field,
    nodePrimaryField: (record) => record.primaryField
  };
  return new LayoutManager({
    cy: { nodes: () => ({ stop: () => {} }) },
    model,
    state: { layout: 'atlas' },
    onStateChange: () => {},
    animateGraph: () => false,
    refitOnChange: () => false,
    onLayoutStarted: () => {},
    onLayoutPrepared: () => {},
    onLayoutSettled: () => {},
    fitVisible: () => {},
    cancelFit: () => {}
  });
}

test('Layered shares authored level rows across Physics and Chemistry', () => {
  const positions = managerFor([
    node('physics_atom', 'physics', 'atomic-molecular-physics', 28),
    node('chemistry_atom', 'chemistry', 'atomic-structure-periodicity', 28),
    node('chemistry_molecule', 'chemistry', 'molecular-structure-bonding', 35)
  ]).atlasPositions();

  assert.equal(positions.physics_atom.y, 28 * 180);
  assert.equal(positions.chemistry_atom.y, positions.physics_atom.y);
  assert.equal(positions.chemistry_molecule.y, 35 * 180);
  assert.ok(Math.abs(positions.chemistry_atom.x - positions.physics_atom.x) <= 300);
});

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
      refitOnChange: () => true,
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

test('suppressed refitting does not mark a fit-only layout run as animated', () => {
  const originalDocument = globalThis.document;
  const originalHtmlSelectElement = globalThis.HTMLSelectElement;
  globalThis.document = { getElementById: () => null };
  globalThis.HTMLSelectElement = class {};
  try {
    const layouts = [];
    const nodes = [makeNode('a', { x: 100, y: 50 })];
    const nodeCollection = makeNodeCollection(nodes, layouts);
    let startedAnimated = null;
    let fitCalls = 0;
    let settled = 0;
    const manager = new LayoutManager({
      cy: {
        nodes: () => nodeCollection,
        elements: () => ({ not: () => ({ filter: () => ({}) }) })
      },
      model: {},
      state: { layout: 'atlas' },
      onStateChange: () => {},
      animateGraph: () => true,
      refitOnChange: () => false,
      onLayoutStarted: (_name, animated) => { startedAnimated = animated; },
      onLayoutPrepared: () => {},
      onLayoutSettled: () => { settled += 1; },
      fitVisible: (_elements, _padding, onComplete) => {
        fitCalls += 1;
        onComplete();
      },
      cancelFit: () => {}
    });
    manager.atlasPositions = () => ({ a: { x: 100, y: 50 } });

    manager.run('atlas', true);

    assert.equal(startedAnimated, false);
    assert.equal(layouts.length, 0);
    assert.equal(fitCalls, 1);
    assert.equal(settled, 1);
  } finally {
    globalThis.document = originalDocument;
    globalThis.HTMLSelectElement = originalHtmlSelectElement;
  }
});

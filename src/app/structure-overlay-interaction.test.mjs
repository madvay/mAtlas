import test from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import { StructureOverlayController } from '../../.test-build/ui/structure-overlay-controller.js';

class FakeHTMLElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.innerHTML = '';
    this.childNodes = [];
    this.listeners = new Map();
    this.ownerDocument = null;
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  querySelectorAll() { return []; }
  replaceChildren(...children) { this.childNodes = children; }
}

function installDom() {
  const previous = {
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement
  };
  const elements = new Map([
    ['detailTitle', new FakeHTMLElement('detailTitle')],
    ['detailEditLink', new FakeHTMLElement('detailEditLink')],
    ['detailBody', new FakeHTMLElement('detailBody')]
  ]);
  const document = {
    getElementById(id) { return elements.get(id) ?? null; },
    createDocumentFragment() { return { append() {} }; },
    createElement() { return new FakeHTMLElement(); }
  };
  for (const element of elements.values()) element.ownerDocument = document;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.document = document;
  return {
    elements,
    restore() {
      if (previous.document === undefined) delete globalThis.document;
      else globalThis.document = previous.document;
      if (previous.HTMLElement === undefined) delete globalThis.HTMLElement;
      else globalThis.HTMLElement = previous.HTMLElement;
    }
  };
}

const fields = {
  mathematics: { label: 'Mathematics', color: '#0033aa', order: 0, path: 'math', description: '' },
  physics: { label: 'Physics', color: '#aa2200', order: 1, path: 'physics', description: '' }
};
const domains = {
  algebra: { label: 'Algebra', color: '#2244cc', order: 0, field: 'mathematics' },
  mechanics: { label: 'Mechanics', color: '#cc4422', order: 0, field: 'physics' },
  geometry: { label: 'Geometry', color: '#4466ee', order: 1, field: 'mathematics' }
};
const nodes = [
  { id: 'group', label: 'Group', primaryDomain: 'algebra', domains: ['algebra'], level: 1, kind: 'structure', summary: '', citations: [] },
  { id: 'phase', label: 'Phase space', primaryDomain: 'mechanics', domains: ['mechanics'], level: 2, kind: 'structure', summary: '', citations: [] },
  { id: 'surface', label: 'Surface', primaryDomain: 'geometry', domains: ['geometry'], level: 2, kind: 'structure', summary: '', citations: [] },
  { id: 'junction', label: 'Junction', primaryDomain: 'algebra', domains: ['algebra'], level: 2, kind: 'junction', summary: '', citations: [] }
];
const edges = [
  { id: 'group-phase', source: 'group', target: 'phase', type: 'models', label: 'Models', detail: '', citations: [] },
  { id: 'surface-phase', source: 'surface', target: 'phase', type: 'models', label: 'Models', detail: '', citations: [] }
];

function modelFixture() {
  const nodeRecord = new Map(nodes.map((node) => [node.id, node]));
  const edgeRecord = new Map(edges.map((edge) => [edge.id, edge]));
  return {
    data: { fields, domains, edgeTypes: { models: { label: 'Models', color: '#555' } } },
    nodeRecord,
    edgeRecord,
    allEdges: edges,
    fieldOrder: ['mathematics', 'physics'],
    domainOrder: ['algebra', 'geometry', 'mechanics'],
    fieldForDomain: (domainId) => domains[domainId].field,
    nodePrimaryField: (node) => domains[node.primaryDomain].field,
    isCrossFieldEdge: (edge) => domains[nodeRecord.get(edge.source).primaryDomain].field !== domains[nodeRecord.get(edge.target).primaryDomain].field
  };
}

function graphFixture() {
  return cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [
      ...nodes.map((node, index) => ({ data: { id: node.id }, position: { x: index * 100, y: index * 40 } })),
      ...edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target } }))
    ]
  });
}

function controllerFixture(layout = 'domains') {
  const cy = graphFixture();
  const model = modelFixture();
  const state = {
    layout,
    selectedEdgeTypes: new Set(['models']),
    crossFieldVisibility: 'all',
    neighborhoodElementId: null
  };
  const selectionChanges = [];
  let clearGraphSelectionCalls = 0;
  const controller = new StructureOverlayController({
    cy,
    model,
    state,
    openPanel() {},
    focusField() {},
    focusDomain() {},
    activateNode() {},
    activateEdge() {},
    onSelectionChange(target, mode) { selectionChanges.push({ target, mode }); },
    clearGraphSelection() { clearGraphSelectionCalls += 1; },
    renderMathText: String
  });
  return { cy, model, state, controller, selectionChanges, clearGraphSelectionCalls: () => clearGraphSelectionCalls };
}

function overlayMap() {
  return {
    groups: [
      { id: 'algebra', label: 'Algebra', color: '#2244cc', conceptCount: 1, internalRelations: 0, outgoingRelations: 1, incomingRelations: 0, bridgeConcepts: [], position: { x: 0, y: 0 } },
      { id: 'geometry', label: 'Geometry', color: '#4466ee', conceptCount: 1, internalRelations: 0, outgoingRelations: 1, incomingRelations: 0, bridgeConcepts: [], position: { x: 100, y: 0 } },
      { id: 'mechanics', label: 'Mechanics', color: '#cc4422', conceptCount: 1, internalRelations: 0, outgoingRelations: 0, incomingRelations: 2, bridgeConcepts: [], position: { x: 200, y: 0 } }
    ],
    connections: [
      { id: 'algebra->mechanics', source: 'algebra', target: 'mechanics', count: 1, typeCounts: { models: 1 }, edgeIds: ['group-phase'] },
      { id: 'geometry->mechanics', source: 'geometry', target: 'mechanics', count: 1, typeCounts: { models: 1 }, edgeIds: ['surface-phase'] }
    ]
  };
}

function installOverlayElements(cy) {
  cy.add([
    { group: 'nodes', data: { id: 'structure-group:domains:algebra', semanticOverlay: 1, semanticGroup: 1, semanticGroupId: 'algebra' } },
    { group: 'nodes', data: { id: 'structure-group:domains:geometry', semanticOverlay: 1, semanticGroup: 1, semanticGroupId: 'geometry' } },
    { group: 'nodes', data: { id: 'structure-group:domains:mechanics', semanticOverlay: 1, semanticGroup: 1, semanticGroupId: 'mechanics' } },
    { group: 'edges', data: { id: 'structure-connection:domains:algebra->mechanics', source: 'structure-group:domains:algebra', target: 'structure-group:domains:mechanics', semanticOverlay: 1, semanticConnection: 1, semanticConnectionId: 'algebra->mechanics' } },
    { group: 'edges', data: { id: 'structure-connection:domains:geometry->mechanics', source: 'structure-group:domains:geometry', target: 'structure-group:domains:mechanics', semanticOverlay: 1, semanticConnection: 1, semanticConnectionId: 'geometry->mechanics' } }
  ]);
}

test('structure interaction activates only for domain and field layouts', () => {
  const fixture = controllerFixture('atlas');
  assert.equal(fixture.controller.active(), false);
  fixture.state.layout = 'domains';
  assert.equal(fixture.controller.active(), true);
  fixture.state.layout = 'fields';
  assert.equal(fixture.controller.active(), true);
  fixture.cy.destroy();
});

test('refresh executes aggregation and creates selectable domain overlays from visible graph data', () => {
  const dom = installDom();
  const fixture = controllerFixture('domains');
  try {
    fixture.controller.refresh();
    assert.equal(fixture.cy.nodes('[semanticGroup = 1]').length, 3);
    assert.equal(fixture.cy.edges('[semanticConnection = 1]').length, 2);
    assert.equal(fixture.cy.getElementById('structure-group:domains:algebra').data('label'), 'Algebra');
    assert.equal(fixture.cy.getElementById('structure-connection:domains:algebra->mechanics').data('relationCount'), 1);
    assert.equal(fixture.cy.getElementById('group').hasClass('structure-source-node'), true);
    assert.equal(fixture.cy.getElementById('junction').hasClass('structure-source-junction'), true);
    assert.equal(fixture.cy.getElementById('group-phase').hasClass('structure-source-edge'), true);
  } finally {
    fixture.cy.destroy();
    dom.restore();
  }
});

test('group selection emphasizes incident aggregate links, hides unrelated links, and clears cleanly', () => {
  const dom = installDom();
  const fixture = controllerFixture('domains');
  try {
    fixture.controller.mapData = overlayMap();
    installOverlayElements(fixture.cy);
    const algebra = fixture.cy.getElementById('structure-group:domains:algebra');
    fixture.controller.selectGroupElement(algebra);

    const incident = fixture.cy.getElementById('structure-connection:domains:algebra->mechanics');
    const unrelated = fixture.cy.getElementById('structure-connection:domains:geometry->mechanics');
    assert.equal(algebra.selected(), true);
    assert.equal(incident.hasClass('structure-connection-emphasis'), true);
    assert.equal(unrelated.hasClass('structure-connection-hidden'), true);
    assert.equal(fixture.clearGraphSelectionCalls(), 1);
    assert.deepEqual(fixture.selectionChanges, [{ target: { kind: 'domain', id: 'algebra' }, mode: 'push' }]);

    fixture.controller.clearSelection();
    assert.equal(algebra.selected(), false);
    assert.equal(incident.hasClass('structure-connection-emphasis'), false);
    assert.equal(unrelated.hasClass('structure-connection-hidden'), false);
    assert.equal(fixture.controller.selectionTarget(), null);
  } finally {
    fixture.cy.destroy();
    dom.restore();
  }
});

test('selection target restoration distinguishes domain, field, and aggregate-edge URL kinds', () => {
  const dom = installDom();
  const fixture = controllerFixture('domains');
  try {
    fixture.controller.mapData = overlayMap();
    installOverlayElements(fixture.cy);
    assert.equal(fixture.controller.selectTarget({ kind: 'domain-edge', id: 'algebra->mechanics' }, false), true);
    assert.deepEqual(fixture.controller.selectionTarget(), { kind: 'domain-edge', id: 'algebra->mechanics' });
    assert.equal(fixture.controller.selectTarget({ kind: 'field', id: 'mathematics' }, false), false);

    fixture.state.layout = 'fields';
    fixture.controller.mapData = {
      groups: [{ id: 'mathematics', label: 'Mathematics', color: '#0033aa', conceptCount: 2, internalRelations: 0, outgoingRelations: 1, incomingRelations: 0, bridgeConcepts: [], position: { x: 0, y: 0 } }],
      connections: []
    };
    fixture.cy.add({ group: 'nodes', data: { id: 'structure-group:fields:mathematics', semanticOverlay: 1, semanticGroup: 1, semanticGroupId: 'mathematics' } });
    assert.equal(fixture.controller.selectTarget({ kind: 'field', id: 'mathematics' }, false), true);
    assert.deepEqual(fixture.controller.selectionTarget(), { kind: 'field', id: 'mathematics' });
  } finally {
    fixture.cy.destroy();
    dom.restore();
  }
});

test('leaving structure mode clears incompatible selection and substrate state', () => {
  const dom = installDom();
  const fixture = controllerFixture('domains');
  try {
    fixture.controller.mapData = overlayMap();
    installOverlayElements(fixture.cy);
    fixture.controller.selectGroupElement(fixture.cy.getElementById('structure-group:domains:algebra'));
    fixture.controller.prepareForLayout('atlas');
    assert.equal(fixture.controller.selectionTarget(), null);
    assert.equal(fixture.cy.getElementById('group').hasClass('structure-source-node'), false);
    assert.equal(fixture.cy.getElementById('group-phase').hasClass('structure-source-edge'), false);
    assert.deepEqual(fixture.selectionChanges.at(-1), { target: null, mode: 'replace' });
  } finally {
    fixture.cy.destroy();
    dom.restore();
  }
});

test('layout transition classes apply to existing overlays and are removed after settling', () => {
  const fixture = controllerFixture('domains');
  installOverlayElements(fixture.cy);
  fixture.controller.beginLayoutTransition('domains');
  assert.equal(fixture.cy.elements('[semanticOverlay = 1]').every((element) => element.hasClass('structure-overlay-pending')), true);
  fixture.controller.finishLayoutTransition();
  assert.equal(fixture.cy.elements('[semanticOverlay = 1]').some((element) => element.hasClass('structure-overlay-pending')), false);
  fixture.cy.destroy();
});

test('inactive refresh removes aggregate overlays and source classes', () => {
  const fixture = controllerFixture('atlas');
  installOverlayElements(fixture.cy);
  fixture.cy.getElementById('group').addClass('structure-source-node');
  fixture.cy.getElementById('junction').addClass('structure-source-junction');
  fixture.cy.getElementById('group-phase').addClass('structure-source-edge');
  fixture.controller.refresh();
  assert.equal(fixture.cy.elements('[semanticOverlay = 1]').length, 0);
  assert.equal(fixture.cy.getElementById('group').hasClass('structure-source-node'), false);
  assert.equal(fixture.cy.getElementById('junction').hasClass('structure-source-junction'), false);
  assert.equal(fixture.cy.getElementById('group-phase').hasClass('structure-source-edge'), false);
  fixture.cy.destroy();
});

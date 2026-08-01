import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelController } from '../../.test-build/ui/panel-controller.js';

class FakeClassList {
  values = new Set();
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.inert = false;
    this.innerHTML = '';
    this.textContent = '';
    this.title = '';
    this.focusCount = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return selector === '.panel-count' ? this.badge ?? null : null; }
  focus() { this.focusCount += 1; }
}

globalThis.HTMLElement = FakeElement;

globalThis.window = {
  matchMedia: () => ({ matches: true }),
  requestAnimationFrame: (callback) => { callback(); return 1; }
};

function createHarness({ detailsOpen = true } = {}) {
  const ids = [
    'workspace', 'filtersPanel', 'detailsPanel', 'filtersToggle', 'detailsToggle',
    'maximizeButton', 'filtersRailToggle', 'detailsRailToggle'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  elements.filtersToggle.badge = new FakeElement('filterBadge');
  const body = new FakeElement('body');
  const graphShell = new FakeElement('graphShell');
  const topbar = new FakeElement('topbar');
  globalThis.document = {
    body,
    getElementById: (id) => elements[id] ?? null,
    createRange: undefined
  };
  const state = {
    selectedDomains: new Set(['one', 'two']),
    filtersOpen: false,
    detailsOpen
  };
  const controller = new PanelController({ state, domainCount: 2 });
  return { controller, state, elements, body, graphShell, topbar };
}

test('mobile panels remain non-modal and do not disable graph or header interaction', () => {
  const { controller, elements, body, graphShell, topbar } = createHarness();
  controller.sync();

  assert.equal(elements.detailsPanel.inert, false);
  assert.equal(elements.detailsPanel.getAttribute('aria-hidden'), 'false');
  assert.equal(elements.detailsPanel.getAttribute('role'), null);
  assert.equal(elements.detailsPanel.getAttribute('aria-modal'), null);
  assert.equal(elements.filtersPanel.inert, true);
  assert.equal(graphShell.inert, false);
  assert.equal(topbar.inert, false);
  assert.equal(body.inert, false);
  assert.equal(body.classList.contains('mobile-panel-open'), false);
});

test('opening details from a graph selection does not steal focus from the graph', () => {
  const { controller, state, elements } = createHarness({ detailsOpen: false });
  controller.openDetails();

  assert.equal(state.detailsOpen, true);
  assert.equal(elements.detailsPanel.focusCount, 0);
});

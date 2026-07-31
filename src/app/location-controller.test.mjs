import test from 'node:test';
import assert from 'node:assert/strict';
import { LocationController, taxonomyScopeFromPath } from '../../.test-build/app/location-controller.js';
import { selectionFromParams, selectionFromPath, selectionFromTemplate } from '../../.test-build/app/location-controller.js';
import { decodeDisplayToken } from '../../.test-build/state/display-token.js';
import { decodeFilterToken } from '../../.test-build/state/filter-token.js';

test('selection location codecs accept only known graph identifiers', () => {
  const nodes = new Set(['set', 'group with space']);
  const edges = new Set(['e1']);
  assert.deepEqual(selectionFromPath('/concepts/set/', nodes), { kind: 'node', id: 'set' });
  assert.deepEqual(selectionFromPath('/concepts/group%20with%20space/index.html', nodes), { kind: 'node', id: 'group with space' });
  assert.equal(selectionFromPath('/concepts/missing/', nodes), null);
  assert.deepEqual(selectionFromParams(new URLSearchParams('node=set&edge=e1'), nodes, edges), { kind: 'node', id: 'set' });
  assert.deepEqual(selectionFromParams(new URLSearchParams('edge=e1'), nodes, edges), { kind: 'edge', id: 'e1' });
  assert.equal(selectionFromTemplate('node:missing', nodes, edges), null);
});

const shareCodec = {
  formatVersion: 1,
  fields: [{ id: 'physics' }],
  domains: [{ id: 'experiments' }],
  edgeTypes: [{ id: 'motivated' }, { id: 'verified' }]
};

const view = {
  id: 'experimental-discovery',
  title: 'Experimental discovery',
  summary: 'Follow evidence through physics.',
  narrative: 'A guided history of experiments and theories.',
  tags: ['Physics'],
  nodeSequence: ['blackbody', 'quantum'],
  settings: {
    fields: ['physics'],
    domains: ['experiments'],
    edgeTypes: ['motivated', 'verified'],
    crossFieldVisibility: 'hidden',
    edgeLabels: true,
    junctions: false,
    edgeZoomActivation: false,
    layout: 'atlas'
  }
};

function matchingState() {
  return {
    selectedFields: new Set(['physics']),
    selectedDomains: new Set(['experiments']),
    selectedEdgeTypes: new Set(['motivated', 'verified']),
    excludedFields: new Set(),
    excludedDomains: new Set(),
    crossFieldVisibility: 'hidden',
    showPrimaryOnly: false,
    hideIsolates: false,
    showEdgeLabels: true,
    showJunctions: false,
    edgeZoomActivation: false,
    hidePrerequisites: false,
    neighborhoodActive: true,
    neighborhoodElementId: 'blackbody',
    layout: 'atlas',
    searchQuery: '',
    filtersOpen: false,
    detailsOpen: true
  };
}

function installBrowser(url, templateViewId = null, templateScope = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let writtenUrl = null;
  globalThis.window = {
    location: {
      href: url,
      pathname: new URL(url).pathname,
      hash: '',
      replace(next) { writtenUrl = String(next); },
      assign(next) { writtenUrl = String(next); }
    },
    history: {
      replaceState(_state, _title, next) { writtenUrl = String(next); },
      pushState(_state, _title, next) { writtenUrl = String(next); }
    }
  };
  globalThis.document = {
    baseURI: 'https://atlas.madvay.com/',
    querySelector(selector) {
      if (selector === 'meta[name="atlas:view"]' && templateViewId) return { content: templateViewId };
      if (selector === 'meta[name="atlas:scope"]' && templateScope.fieldId) return { content: templateScope.fieldId };
      if (selector === 'meta[name="atlas:domain"]' && templateScope.domainId) return { content: templateScope.domainId };
      return null;
    }
  };
  return {
    writtenUrl: () => writtenUrl,
    restore() {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  };
}

function modelFixture() {
  return {
    data: {
      meta: { title: 'Atlas', description: 'Description' },
      fields: { physics: { path: 'physics', label: 'Physics', description: 'Physics' } },
      domains: { experiments: { field: 'physics', label: 'Experiments' } }
    },
    knownFieldIds: new Set(['physics']),
    knownDomainIds: new Set(['experiments']),
    knownNodeIds: new Set(['blackbody', 'quantum']),
    knownEdgeIds: new Set(['e1']),
    nodeRecord: new Map([
      ['blackbody', { id: 'blackbody', kind: 'structure', label: 'Blackbody', primaryDomain: 'experiments', domains: ['experiments'] }],
      ['quantum', { id: 'quantum', kind: 'structure', label: 'Quantum', primaryDomain: 'experiments', domains: ['experiments'] }]
    ]),
    edgeRecord: new Map(),
    fieldForDomain() { return 'physics'; }
  };
}

function controllerFor(state) {
  const model = modelFixture();
  return new LocationController({
    model,
    getState: () => state,
    views: new Map([[view.id, view]]),
    fieldOrder: ['physics'],
    domainOrder: ['experiments'],
    edgeTypeOrder: ['motivated', 'verified'],
    shareCodec
  });
}


test('view defaults preserve prohibited-domain settings', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/experimental-discovery/');
  try {
    const state = matchingState();
    const model = modelFixture();
    model.data.domains.geometry = { field: 'physics', label: 'Geometry' };
    model.knownDomainIds.add('geometry');
    const prohibitedView = {
      ...view,
      settings: { ...view.settings, prohibitedDomains: ['geometry'] }
    };
    const controller = new LocationController({
      model,
      getState: () => state,
      views: new Map([[prohibitedView.id, prohibitedView]]),
      fieldOrder: ['physics'],
      domainOrder: ['experiments', 'geometry'],
      edgeTypeOrder: ['motivated', 'verified'],
      shareCodec: {
        ...shareCodec,
        domains: [{ id: 'experiments' }, { id: 'geometry' }]
      }
    });
    assert.deepEqual(controller.viewDefaults(prohibitedView).prohibitedDomains, ['geometry']);
  } finally {
    browser.restore();
  }
});

test('static view metadata is used only during initial route resolution', () => {
  const browser = installBrowser('https://atlas.madvay.com/concepts/quantum/', view.id);
  try {
    const controller = controllerFor(matchingState());
    assert.equal(controller.resolveViewFromLocation(), null);
    assert.equal(controller.resolveViewFromLocation({ includeTemplate: true })?.id, view.id);
  } finally {
    browser.restore();
  }
});


test('view node links select the requested sequence step explicitly', () => {
  const browser = installBrowser('https://atlas.madvay.com/concepts/quantum/');
  try {
    const controller = controllerFor(matchingState());
    assert.equal(
      controller.viewNodeUrl(view.id, 'quantum'),
      'https://atlas.madvay.com/views/experimental-discovery/?node=quantum'
    );
  } finally {
    browser.restore();
  }
});

test('field and domain paths resolve to taxonomy scopes', () => {
  const model = modelFixture();
  assert.deepEqual(taxonomyScopeFromPath('/physics/', model, ['physics']), { fieldId: 'physics', domainId: null });
  assert.deepEqual(taxonomyScopeFromPath('/physics/experiments/', model, ['physics']), { fieldId: 'physics', domainId: 'experiments' });
  assert.deepEqual(taxonomyScopeFromPath('/physics/not-a-domain/', model, ['physics']), { fieldId: null, domainId: null });
});

test('the first sequence node is the default selection and bare view URL', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/experimental-discovery/');
  try {
    const controller = controllerFor(matchingState());
    controller.setActiveView(view.id);
    assert.deepEqual(controller.scopedDefaultViewSelection(), { kind: 'node', id: 'blackbody' });
    controller.write({ kind: 'node', id: 'blackbody' }, 'replace');
    assert.equal(browser.writtenUrl(), null);
  } finally {
    browser.restore();
  }
});

test('an exact view configuration keeps the static view route during exploration', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/experimental-discovery/');
  try {
    const state = matchingState();
    const controller = controllerFor(state);
    controller.setActiveView(view.id);

    controller.write({ kind: 'node', id: 'quantum' }, 'replace');
    assert.equal(browser.writtenUrl(), 'https://atlas.madvay.com/views/experimental-discovery/?node=quantum');
    assert.equal(controller.activeView()?.id, view.id);
  } finally {
    browser.restore();
  }
});

test('changing a filter keeps the view route and adds only a filter override', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/experimental-discovery/?node=quantum');
  try {
    const state = matchingState();
    state.selectedEdgeTypes.delete('verified');
    const controller = controllerFor(state);
    controller.setActiveView(view.id);

    controller.write({ kind: 'node', id: 'quantum' }, 'replace');
    const written = new URL(browser.writtenUrl());
    assert.equal(written.pathname, '/views/experimental-discovery/');
    assert.equal(written.searchParams.get('node'), 'quantum');
    assert.equal(written.searchParams.has('disp'), false);
    const decoded = decodeFilterToken(written.searchParams.get('filter'), shareCodec);
    assert.deepEqual(decoded.fields, ['physics']);
    assert.deepEqual(decoded.domains, ['experiments']);
    assert.deepEqual(decoded.edgeTypes, ['motivated']);
    assert.equal(controller.activeView()?.id, view.id);
  } finally {
    browser.restore();
  }
});

test('changing display settings keeps the view route and adds only a display override', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/experimental-discovery/');
  try {
    const state = matchingState();
    state.layout = 'breadthfirst';
    const controller = controllerFor(state);
    controller.setActiveView(view.id);

    controller.write({ kind: 'node', id: 'blackbody' }, 'replace');
    const written = new URL(browser.writtenUrl());
    assert.equal(written.pathname, '/views/experimental-discovery/');
    assert.equal(written.searchParams.has('node'), false);
    assert.equal(written.searchParams.has('filter'), false);
    assert.equal(decodeDisplayToken(written.searchParams.get('disp')).layout, 'breadthfirst');
  } finally {
    browser.restore();
  }
});

test('a plain View has no implicit node selection and keeps a clean bare URL', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/plain-view/');
  try {
    const state = matchingState();
    const plainView = { ...view, id: 'plain-view', nodeSequence: undefined };
    const model = modelFixture();
    const controller = new LocationController({
      model,
      getState: () => state,
      views: new Map([[plainView.id, plainView]]),
      fieldOrder: ['physics'],
      domainOrder: ['experiments'],
      edgeTypeOrder: ['motivated', 'verified'],
      shareCodec
    });
    controller.setActiveView(plainView.id);
    assert.equal(controller.scopedDefaultViewSelection(), null);
    controller.write(null, 'replace');
    assert.equal(browser.writtenUrl(), null);
  } finally {
    browser.restore();
  }
});

test('an exclusive domain pathname appears only with no selected item or view', () => {
  const browser = installBrowser('https://atlas.madvay.com/concepts/quantum/');
  try {
    const state = matchingState();
    const controller = controllerFor(state);

    controller.write({ kind: 'edge', id: 'e1' }, 'replace');
    const edgeUrl = new URL(browser.writtenUrl());
    assert.equal(edgeUrl.pathname, '/');
    assert.equal(edgeUrl.searchParams.get('edge'), 'e1');
    assert.equal(edgeUrl.searchParams.has('fields'), false);
    assert.equal(edgeUrl.searchParams.has('domains'), false);
    assert.ok(edgeUrl.searchParams.get('disp'));
    const edgeState = decodeFilterToken(edgeUrl.searchParams.get('filter'), shareCodec);
    assert.deepEqual(edgeState.fields, ['physics']);
    assert.deepEqual(edgeState.domains, ['experiments']);

    controller.write(null, 'replace');
    const domainUrl = new URL(browser.writtenUrl());
    assert.equal(domainUrl.pathname, '/physics/experiments/');
    assert.equal(domainUrl.searchParams.has('node'), false);
    assert.equal(domainUrl.searchParams.has('edge'), false);
    assert.equal(domainUrl.searchParams.has('fields'), false);
    assert.equal(domainUrl.searchParams.has('domains'), false);
    assert.ok(domainUrl.searchParams.get('filter'));
    assert.ok(domainUrl.searchParams.get('disp'));
    assert.deepEqual(decodeFilterToken(domainUrl.searchParams.get('filter'), shareCodec).domains, ['experiments']);
  } finally {
    browser.restore();
  }
});

test('a domain page supplies fresh-load taxonomy defaults', () => {
  const browser = installBrowser('https://atlas.madvay.com/physics/experiments/');
  try {
    const controller = controllerFor(matchingState());
    assert.equal(controller.scopedFieldId, 'physics');
    assert.equal(controller.scopedDomainId, 'experiments');
    assert.deepEqual(controller.scopedDefaultFieldIds(), ['physics']);
    assert.deepEqual(controller.scopedDefaultDomainIds(), ['experiments']);
    assert.deepEqual(controller.taxonomyDefaultsFromLocation(), {
      fields: ['physics'],
      domains: ['experiments']
    });
  } finally {
    browser.restore();
  }
});

test('clearing selection preserves the view route with an explicit empty selection', () => {
  const browser = installBrowser('https://atlas.madvay.com/views/experimental-discovery/?node=quantum');
  try {
    const controller = controllerFor(matchingState());
    controller.setActiveView(view.id);
    controller.write(null, 'replace');
    assert.equal(browser.writtenUrl(), 'https://atlas.madvay.com/views/experimental-discovery/?selection=none');
  } finally {
    browser.restore();
  }
});

test('comparison workspace state survives selection and filter URL rewrites', () => {
  const browser = installBrowser('https://atlas.madvay.com/concepts/blackbody/');
  try {
    const state = matchingState();
    const model = modelFixture();
    const controller = new LocationController({
      model,
      getState: () => state,
      views: new Map([[view.id, view]]),
      fieldOrder: ['physics'],
      domainOrder: ['experiments'],
      edgeTypeOrder: ['motivated', 'verified'],
      shareCodec,
      getCompareState: () => ({ nodeIds: ['blackbody', 'quantum'], mode: 'connections', direction: 'forward', pathIndex: 1 })
    });

    controller.write({ kind: 'node', id: 'quantum' }, 'replace');
    const written = new URL(browser.writtenUrl());
    assert.equal(written.pathname, '/concepts/quantum/');
    assert.equal(written.searchParams.get('compare'), 'blackbody,quantum');
    assert.equal(written.searchParams.get('compareMode'), 'connections');
    assert.equal(written.searchParams.get('compareDirection'), 'forward');
    assert.equal(written.searchParams.get('comparePath'), '1');
    assert.ok(written.searchParams.get('filter'));
    assert.ok(written.searchParams.get('disp'));
  } finally {
    browser.restore();
  }
});

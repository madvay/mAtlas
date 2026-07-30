import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicViewKind,
  stateMatchesView,
  viewCoreNodes,
  viewIdFromPath,
  viewIdFromTemplate,
  viewPagePath,
  viewRequiredNodeIds,
  viewSettingsAsUrlState,
  viewTaxonomyDefaults
} from '../../.test-build/state/view-state.js';

const view = {
  id: 'experimental-discovery',
  title: 'Experimental discovery',
  summary: 'Summary',
  narrative: 'Narrative',
  tags: ['Physics'],
  nodeSequence: ['blackbody', 'quantum'],
  settings: {
    fields: ['physics'],
    domains: ['experiments'],
    edgeTypes: ['motivated', 'verified'],
    excludedFields: ['mathematics'],
    excludedDomains: ['algebra'],
    prohibitedDomains: ['geometry'],
    crossFieldVisibility: 'hidden',
    edgeLabels: true,
    junctions: false,
    edgeZoomActivation: false,
    hidePrerequisites: true,
    layout: 'atlas'
  }
};

function appState() {
  return {
    selectedFields: new Set(['physics']),
    selectedDomains: new Set(['experiments']),
    selectedEdgeTypes: new Set(['motivated', 'verified']),
    excludedFields: new Set(['mathematics']),
    excludedDomains: new Set(['algebra']),
    prohibitedDomains: new Set(['geometry']),
    crossFieldVisibility: 'hidden',
    showPrimaryOnly: false,
    hideIsolates: false,
    showEdgeLabels: true,
    showJunctions: false,
    edgeZoomActivation: false,
    hidePrerequisites: true,
    neighborhoodActive: false,
    neighborhoodElementId: null,
    layout: 'atlas',
    searchQuery: '',
    filtersOpen: false,
    detailsOpen: false
  };
}

const resolvedDefaults = {
  fields: ['physics'],
  domains: ['experiments'],
  edgeTypes: ['motivated', 'verified'],
  excludedFields: ['mathematics'],
  excludedDomains: ['algebra'],
  prohibitedDomains: ['geometry'],
  crossFieldVisibility: 'hidden',
  showPrimaryOnly: false,
  hideIsolates: false,
  edgeLabels: true,
  junctions: false,
  edgeZoomActivation: false,
  hidePrerequisites: true,
  layout: 'atlas'
};

test('view routes parse canonical static paths and templates', () => {
  const ids = new Set([view.id]);
  assert.equal(viewIdFromPath('/views/experimental-discovery/', ids), view.id);
  assert.equal(viewIdFromPath('/views/experimental-discovery/index.html', ids), view.id);
  assert.equal(viewIdFromPath('/views/missing/', ids), null);
  assert.equal(viewIdFromPath('/views/%E0%A4%A/', ids), null);
  assert.equal(viewIdFromTemplate(view.id, ids), view.id);
  assert.equal(viewIdFromTemplate('missing', ids), null);
  assert.equal(viewPagePath(view.id), 'views/experimental-discovery/');
});

test('view settings become URL-state defaults without mutation', () => {
  const state = viewSettingsAsUrlState(view.settings);
  assert.deepEqual(state.fields, ['physics']);
  assert.deepEqual(state.excludedFields, ['mathematics']);
  assert.deepEqual(state.prohibitedDomains, ['geometry']);
  assert.equal(state.hidePrerequisites, true);
  state.fields.push('mathematics');
  assert.deepEqual(view.settings.fields, ['physics']);
});

test('view filter and display defaults are compared independently', () => {
  const state = appState();
  assert.equal(stateMatchesView(state, resolvedDefaults), true);
  state.selectedEdgeTypes.delete('verified');
  assert.equal(stateMatchesView(state, resolvedDefaults), false);
  state.selectedEdgeTypes.add('verified');
  state.layout = 'breadthfirst';
  assert.equal(stateMatchesView(state, resolvedDefaults), false);
});

test('core-node view defaults derive primary domains and public terminology', () => {
  const coreView = {
    ...view,
    coreNodes: ['junction', 'quantum', 'blackbody'],
    nodeSequence: undefined,
    settings: { ...view.settings, fields: undefined, domains: undefined }
  };
  const nodes = new Map([
    ['junction', { id: 'junction', primaryDomain: 'experiments' }],
    ['quantum', { id: 'quantum', primaryDomain: 'quantum-mechanics' }],
    ['blackbody', { id: 'blackbody', primaryDomain: 'experiments' }]
  ]);
  assert.deepEqual(viewTaxonomyDefaults(coreView, nodes, (domain) => domain === 'experiments' ? 'physics' : 'physics'), {
    fields: ['physics'],
    domains: ['experiments', 'quantum-mechanics']
  });
  assert.equal(publicViewKind(coreView), 'View');
  assert.equal(publicViewKind(view), 'Story');
  assert.deepEqual(viewCoreNodes(coreView), ['junction', 'quantum', 'blackbody']);
  assert.deepEqual([...viewRequiredNodeIds({ ...coreView, nodeSequence: ['quantum'] })], ['junction', 'quantum', 'blackbody']);
});

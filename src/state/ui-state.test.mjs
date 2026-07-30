import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addShareUiStateToParams,
  addUiStateToParams,
  createInitialState,
  parseUrlUiState,
  readUrlUiStateFromLocation,
  readUrlUiStateFromParams,
  resolveUrlUiState,
  sameIdSet,
} from '../../.test-build/state/ui-state.js';

const known = {
  fieldIds: new Set(['math', 'physics']),
  domainIds: new Set(['algebra', 'mechanics']),
  edgeTypeIds: new Set(['built-from'])
};

const shareCodec = {
  formatVersion: 1,
  fields: [{ id: 'math' }, { id: 'physics' }],
  domains: [{ id: 'algebra' }, { id: 'mechanics' }],
  edgeTypes: [{ id: 'built-from' }]
};

function compactState() {
  const state = createInitialState({}, { fields: ['physics'], domains: ['mechanics'], edgeTypes: ['built-from'] });
  state.crossFieldVisibility = 'hidden';
  state.showPrimaryOnly = true;
  state.hideIsolates = true;
  state.showEdgeLabels = false;
  state.showJunctions = false;
  state.edgeZoomActivation = false;
  state.hidePrerequisites = true;
  state.layout = 'breadthfirst';
  return state;
}

function compactParams() {
  const params = new URLSearchParams();
  addShareUiStateToParams(params, compactState(), shareCodec);
  return params;
}

test('URL state parser accepts canonical values, suppression states, prerequisite mode, and maps Organic layouts to Compact', () => {
  const parsed = parseUrlUiState(new URLSearchParams('fields=math&domains=algebra&edges=built-from&excludeFields=physics&excludeDomains=mechanics&prohibitDomains=algebra&hidePrereqs=1&showPrimaryOnly=1&hideIsolates=true&layout=cose&edgeLabels=0&junctions=true'), known);
  assert.deepEqual(parsed.fields, ['math']);
  assert.deepEqual(parsed.domains, ['algebra']);
  assert.equal(parsed.layout, 'breadthfirst');
  assert.equal(parsed.edgeLabels, false);
  assert.equal(parsed.junctions, true);
  assert.equal(parsed.showPrimaryOnly, true);
  assert.equal(parsed.hideIsolates, true);
  assert.deepEqual(parsed.excludedFields, ['physics']);
  assert.deepEqual(parsed.excludedDomains, ['mechanics']);
  assert.deepEqual(parsed.prohibitedDomains, ['algebra']);
  assert.equal(parsed.hidePrerequisites, true);
});

test('every prior Organic URL spelling maps to Compact', () => {
  for (const value of ['cose', 'cose-bilkent', 'organic']) {
    assert.equal(parseUrlUiState(new URLSearchParams(`layout=${value}`), known).layout, 'breadthfirst');
  }
});

test('URL state parser ignores duplicate and unknown ids', () => {
  const parsed = parseUrlUiState(new URLSearchParams('fields=math,math&domains=unknown'), known);
  assert.deepEqual(parsed.fields, ['math']);
  assert.equal(parsed.domains, undefined);
});

test('state serialization and legacy URL writing preserve canonical order', () => {
  const state = createInitialState({}, { fields: ['physics'], domains: ['mechanics'], edgeTypes: ['built-from'] });
  state.showEdgeLabels = false;
  state.excludedFields.add('physics');
  state.excludedDomains.add('mechanics');
  state.prohibitedDomains.add('algebra');
  state.hidePrerequisites = true;
  const params = new URLSearchParams();
  addUiStateToParams(params, state, ['math', 'physics'], ['algebra', 'mechanics'], ['built-from']);
  assert.equal(params.get('fields'), 'physics');
  assert.equal(params.get('edgeLabels'), '0');
  assert.equal(params.get('excludeFields'), 'physics');
  assert.equal(params.get('excludeDomains'), 'mechanics');
  assert.equal(params.get('prohibitDomains'), 'algebra');
  assert.equal(params.get('hidePrereqs'), '1');
});

test('prohibition wins when a domain is also encoded as excluded', () => {
  const resolved = resolveUrlUiState({ excludedDomains: ['mechanics'], prohibitedDomains: ['mechanics'] }, {
    fields: ['physics'],
    domains: ['mechanics'],
    edgeTypes: ['built-from']
  });
  assert.deepEqual(resolved.excludedDomains, []);
  assert.deepEqual(resolved.prohibitedDomains, ['mechanics']);
});

test('sameIdSet ignores ordering but not membership', () => {
  assert.equal(sameIdSet(new Set(['a', 'b']), ['b', 'a']), true);
  assert.equal(sameIdSet(new Set(['a', 'b']), ['a']), false);
});

test('compact URL writing emits independent filter and display tokens and removes explicit state', () => {
  const params = new URLSearchParams('s=unpublished&fields=math&domains=algebra&layout=atlas&unrelated=kept');
  addShareUiStateToParams(params, compactState(), shareCodec);
  assert.ok(params.get('filter'));
  assert.ok(params.get('disp'));
  assert.equal(params.has('s'), false);
  assert.equal(params.has('fields'), false);
  assert.equal(params.has('domains'), false);
  assert.equal(params.has('layout'), false);
  assert.equal(params.get('unrelated'), 'kept');

  const parsed = readUrlUiStateFromParams(params, known, shareCodec);
  assert.deepEqual(parsed.fields, ['physics']);
  assert.deepEqual(parsed.domains, ['mechanics']);
  assert.equal(parsed.hideIsolates, true);
  assert.equal(parsed.layout, 'breadthfirst');
});

test('a lone filter token supplies only filters and defaults display state', () => {
  const complete = compactParams();
  const params = new URLSearchParams(`filter=${complete.get('filter')}&layout=breadthfirst&hideIsolates=1`);
  const parsed = readUrlUiStateFromParams(params, known, shareCodec);
  assert.deepEqual(parsed.fields, ['physics']);
  assert.deepEqual(parsed.domains, ['mechanics']);
  assert.equal(parsed.layout, undefined);
  assert.equal(parsed.hideIsolates, undefined);
  const resolved = resolveUrlUiState(parsed, {
    fields: ['math'],
    domains: ['algebra'],
    edgeTypes: ['built-from'],
    hideIsolates: false,
    layout: 'atlas'
  });
  assert.deepEqual(resolved.fields, ['physics']);
  assert.equal(resolved.hideIsolates, false);
  assert.equal(resolved.layout, 'atlas');
});

test('a lone display token supplies only display state and defaults filters', () => {
  const complete = compactParams();
  const params = new URLSearchParams(`disp=${complete.get('disp')}&fields=math&domains=algebra`);
  const parsed = readUrlUiStateFromParams(params, known, shareCodec);
  assert.equal(parsed.fields, undefined);
  assert.equal(parsed.domains, undefined);
  assert.equal(parsed.layout, 'breadthfirst');
  assert.equal(parsed.hideIsolates, true);
  const resolved = resolveUrlUiState(parsed, {
    fields: ['math'],
    domains: ['algebra'],
    edgeTypes: ['built-from']
  });
  assert.deepEqual(resolved.fields, ['math']);
  assert.deepEqual(resolved.domains, ['algebra']);
  assert.equal(resolved.layout, 'breadthfirst');
});

test('legacy explicit parameters remain readable only when neither compact parameter is present', () => {
  const parsed = readUrlUiStateFromParams(new URLSearchParams('s=broken&fields=math&layout=organic'), known, shareCodec);
  assert.deepEqual(parsed.fields, ['math']);
  assert.equal(parsed.layout, 'breadthfirst');
});

test('valid independent tokens load without redirecting', () => {
  const params = compactParams();
  let replacement = null;
  const parsed = readUrlUiStateFromLocation({
    href: `https://atlas.madvay.com/?${params}`,
    replace(url) { replacement = url; }
  }, known, shareCodec);
  assert.deepEqual(parsed?.fields, ['physics']);
  assert.equal(parsed?.layout, 'breadthfirst');
  assert.equal(replacement, null);
});

test('an invalid filter token is removed while a valid display token and all unrelated location state survive', () => {
  const valid = compactParams();
  let replacement = null;
  const location = {
    href: `https://atlas.madvay.com/concepts/set/?filter=broken&disp=${valid.get('disp')}&node=set&selection=none#edge=e1`,
    replace(url) { replacement = url; }
  };
  assert.equal(readUrlUiStateFromLocation(location, known, shareCodec), null);
  assert.equal(replacement, `https://atlas.madvay.com/concepts/set/?disp=${valid.get('disp')}&node=set&selection=none#edge=e1`);
});

test('an invalid display token is removed while a valid filter token survives', () => {
  const valid = compactParams();
  let replacement = null;
  const location = {
    href: `https://atlas.madvay.com/?filter=${valid.get('filter')}&disp=broken&node=set`,
    replace(url) { replacement = url; }
  };
  assert.equal(readUrlUiStateFromLocation(location, known, shareCodec), null);
  assert.equal(replacement, `https://atlas.madvay.com/?filter=${valid.get('filter')}&node=set`);
});

test('both invalid compact tokens are removed in one redirect', () => {
  let replacement = null;
  const location = {
    href: 'https://atlas.madvay.com/math/?filter=broken&disp=also-broken&node=set#edge=e1',
    replace(url) { replacement = url; }
  };
  assert.equal(readUrlUiStateFromLocation(location, known, shareCodec), null);
  assert.equal(replacement, 'https://atlas.madvay.com/math/?node=set#edge=e1');
});

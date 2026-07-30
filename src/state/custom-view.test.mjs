import assert from 'node:assert/strict';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import {
  decodeCustomViewToken,
  duplicateView,
  encodeCustomViewToken,
  loadLocalViews,
  LOCAL_VIEWS_STORAGE_KEY,
  parseCustomView,
  saveLocalViews,
  serializeAtlasViewYaml
} from '../../.test-build/state/custom-view.js';

const known = {
  nodeIds: new Set(['set', 'function', 'group']),
  fieldIds: new Set(['mathematics']),
  domainIds: new Set(['foundations']),
  edgeTypeIds: new Set(['prerequisite'])
};

const view = {
  id: 'example-story',
  title: 'Example story',
  summary: 'A compact test story.',
  narrative: 'Follow the construction.',
  tags: ['test', 'foundations'],
  metadata: {
    credits: [{
      creators: ['Original Author'],
      attribution: 'Credit Original Author.',
      copyright: 'Copyright 2026 Original Author',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
    }],
    createdAt: '2026-07-30T20:00:00.000Z',
    updatedAt: '2026-07-30T20:00:00.000Z'
  },
  coreNodes: ['set', 'function'],
  nodeSequence: ['set', 'function'],
  stepNarratives: {
    set: 'Begin with sets.',
    function: 'Then introduce functions.'
  },
  settings: {
    edgeTypes: ['prerequisite'],
    excludedFields: [],
    excludedDomains: [],
    prohibitedDomains: [],
    crossFieldVisibility: 'contextual',
    showPrimaryOnly: false,
    hideIsolates: false,
    edgeLabels: true,
    junctions: true,
    edgeZoomActivation: true,
    hidePrerequisites: false,
    layout: 'atlas'
  }
};

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key) { return this.#values.get(key) ?? null; }
  key(index) { return [...this.#values.keys()][index] ?? null; }
  removeItem(key) { this.#values.delete(key); }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

test('custom view tokens round-trip all authoring and provenance data', () => {
  const decoded = decodeCustomViewToken(encodeCustomViewToken(view), known);
  assert.deepEqual(decoded, view);
});

test('duplicating a view retains credit and rights records unchanged', () => {
  const duplicate = duplicateView(view, 'personal-copy', '2026-07-30T21:00:00.000Z');
  assert.equal(duplicate.id, 'personal-copy');
  assert.equal(duplicate.title, 'Copy of Example story');
  assert.deepEqual(duplicate.metadata.credits, view.metadata.credits);
  assert.notEqual(duplicate.metadata.credits, view.metadata.credits);
  assert.notEqual(duplicate.metadata.credits[0], view.metadata.credits[0]);
  assert.equal(duplicate.metadata.inheritedCreditCount, view.metadata.credits.length);
  assert.deepEqual(duplicate.metadata.derivedFrom, [{ id: view.id, title: view.title }]);
  duplicate.metadata.credits[0].creators.push('Copy Editor');
  assert.deepEqual(view.metadata.credits[0].creators, ['Original Author']);
});

test('custom view parsing rejects unknown nodes and story steps outside the core set', () => {
  assert.throws(
    () => parseCustomView({ ...view, coreNodes: ['unknown'] }, known),
    /unknown identifier/
  );
  assert.throws(
    () => parseCustomView({ ...view, coreNodes: ['set'], nodeSequence: ['set', 'function'] }, known),
    /Every story step must also appear in coreNodes/
  );
});

test('local view storage ignores malformed entries without discarding valid views', () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_VIEWS_STORAGE_KEY, JSON.stringify({ version: 1, views: [view, { id: 'broken' }] }));
  assert.deepEqual(loadLocalViews(storage, known), [view]);
  saveLocalViews(storage, [view]);
  assert.deepEqual(loadLocalViews(storage, known), [view]);
});

test('YAML export preserves the complete view object', () => {
  assert.deepEqual(parseYaml(serializeAtlasViewYaml(view)), view);
});

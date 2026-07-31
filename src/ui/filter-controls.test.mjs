import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldNavActiveScopeId, fieldNavScopeLabel } from '../../.test-build/ui/filter-controls.js';

test('field navigation labels summarize partial selection only for the active field', () => {
  assert.equal(fieldNavScopeLabel('Mathematics', 3, 12, true), 'Mathematics (3 of 12)');
  assert.equal(fieldNavScopeLabel('Mathematics', 12, 12, true), 'Mathematics');
  assert.equal(fieldNavScopeLabel('Mathematics', 3, 12, false), 'Mathematics');
});

test('field navigation activates whenever every selected domain belongs to one field', () => {
  const domainOrder = ['algebra', 'analysis', 'mechanics', 'optics'];
  const fieldForDomain = (domainId) => ['algebra', 'analysis'].includes(domainId) ? 'mathematics' : 'physics';

  assert.equal(fieldNavActiveScopeId(new Set(['algebra']), domainOrder, fieldForDomain), 'mathematics');
  assert.equal(fieldNavActiveScopeId(new Set(['algebra', 'analysis']), domainOrder, fieldForDomain), 'mathematics');
  assert.equal(fieldNavActiveScopeId(new Set(['mechanics', 'optics']), domainOrder, fieldForDomain), 'physics');
  assert.equal(fieldNavActiveScopeId(new Set(['analysis', 'mechanics']), domainOrder, fieldForDomain), null);
  assert.equal(fieldNavActiveScopeId(new Set(domainOrder), domainOrder, fieldForDomain), 'global');
  assert.equal(fieldNavActiveScopeId(new Set(), domainOrder, fieldForDomain), null);
});

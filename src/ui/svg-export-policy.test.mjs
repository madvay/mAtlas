import test from 'node:test';
import assert from 'node:assert/strict';
import { includePassiveDomainOverlayInVisibleSvg } from '../../.test-build/ui/svg-export-policy.js';

test('concept-layout SVG exports exclude passive domain overlays even while visible on screen', () => {
  assert.equal(includePassiveDomainOverlayInVisibleSvg('atlas', true), false);
  assert.equal(includePassiveDomainOverlayInVisibleSvg('breadthfirst', true), false);
});

test('Fields SVG exports include only currently visible passive domain overlays', () => {
  assert.equal(includePassiveDomainOverlayInVisibleSvg('fields', true), true);
  assert.equal(includePassiveDomainOverlayInVisibleSvg('fields', false), false);
});

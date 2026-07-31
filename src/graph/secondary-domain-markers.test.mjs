import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECONDARY_DOMAIN_MARKER_BOTTOM_OFFSET,
  SECONDARY_DOMAIN_MARKER_SIZE,
  secondaryDomainMarkerHorizontalOffsets,
  secondaryDomainMarkerImages,
  secondaryDomainMarkerValues
} from '../../.test-build/graph/secondary-domain-markers.js';

function nodeWithColors(colors) {
  return { data(key) { return key === 'domainColors' ? colors : undefined; } };
}

test('native secondary-domain markers preserve dot size, order, gap, and lower-right placement', () => {
  const node = nodeWithColors(['#111111', '#222222', '#333333']);
  const images = secondaryDomainMarkerImages(node);

  assert.equal(SECONDARY_DOMAIN_MARKER_SIZE, 9);
  assert.equal(SECONDARY_DOMAIN_MARKER_BOTTOM_OFFSET, '-8px');
  assert.equal(images.length, 2);
  assert.match(decodeURIComponent(images[0]), /fill="#222222"/);
  assert.match(decodeURIComponent(images[1]), /fill="#333333"/);
  assert.deepEqual(secondaryDomainMarkerHorizontalOffsets(node), ['-22px', '-10px']);
  assert.deepEqual(secondaryDomainMarkerValues(node, '100%'), ['100%', '100%']);
});

test('marker image URIs are shared by domain color rather than generated per node', () => {
  const first = secondaryDomainMarkerImages(nodeWithColors(['#000000', '#abcdef']))[0];
  const second = secondaryDomainMarkerImages(nodeWithColors(['#ffffff', '#abcdef']))[0];
  assert.equal(first, second);
});

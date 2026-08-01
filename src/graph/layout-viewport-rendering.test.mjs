import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLayoutViewportRendering,
  useViewportTextureForLayout
} from '../../.test-build/graph/layout-viewport-rendering.js';

test('only domain structure mode uses Cytoscape viewport textures', () => {
  assert.equal(useViewportTextureForLayout('domains'), true);
  assert.equal(useViewportTextureForLayout('fields'), false);
  assert.equal(useViewportTextureForLayout('atlas'), false);
  assert.equal(useViewportTextureForLayout('breadthfirst'), false);
});

test('layout viewport rendering changes only on mode boundaries and invalidates stale textures', () => {
  const renderer = { textureOnViewport: false, textureCache: { stale: true } };
  const cy = { renderer: () => renderer };

  assert.equal(applyLayoutViewportRendering(cy, 'atlas'), false);
  assert.deepEqual(renderer.textureCache, { stale: true });

  assert.equal(applyLayoutViewportRendering(cy, 'domains'), true);
  assert.equal(renderer.textureOnViewport, true);
  assert.equal(renderer.textureCache, undefined);

  renderer.textureCache = { domain: true };
  assert.equal(applyLayoutViewportRendering(cy, 'domains'), false);
  assert.deepEqual(renderer.textureCache, { domain: true });

  assert.equal(applyLayoutViewportRendering(cy, 'fields'), true);
  assert.equal(renderer.textureOnViewport, false);
  assert.equal(renderer.textureCache, undefined);
});

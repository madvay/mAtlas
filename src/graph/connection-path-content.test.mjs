import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { findConnectionPaths } from '../../.test-build/graph/connection-path.js';

const atlas = JSON.parse(await readFile(new URL('../../.build/content/atlas.json', import.meta.url), 'utf8'));
const nodeIds = new Set(atlas.nodes.map((node) => node.id));

test('connection search remains deterministic and fast on the compiled atlas', () => {
  const options = {
    sourceId: 'set',
    targetId: 'hilbert_space',
    nodeIds,
    edges: atlas.edges,
    direction: 'either',
    maxPaths: 3,
    maxDepth: 12
  };
  const started = performance.now();
  const first = findConnectionPaths(options);
  const elapsed = performance.now() - started;
  const second = findConnectionPaths(options);

  assert.equal(first.length, 3);
  assert.deepEqual(second, first);
  assert.equal(first[0].nodeIds[0], 'set');
  assert.equal(first[0].nodeIds.at(-1), 'hilbert_space');
  assert.ok(first.every((path) => path.steps.length <= 12));
  assert.ok(first.some((path) => path.steps.some((step) => !step.followsArrow)));
  assert.ok(elapsed < 1_000, `full-atlas connection search took ${elapsed.toFixed(1)} ms`);
});

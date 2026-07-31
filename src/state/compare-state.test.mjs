import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCompareState,
  readCompareState,
  sameCompareState,
  writeCompareState
} from '../../.test-build/state/compare-state.js';

const nodes = new Map([
  ['a', { id: 'a', kind: 'structure' }],
  ['b', { id: 'b', kind: 'structure' }],
  ['j', { id: 'j', kind: 'junction' }]
]);

test('compare state accepts exactly two distinct structure concepts', () => {
  assert.deepEqual(readCompareState(new URLSearchParams('compare=a,b'), nodes), {
    nodeIds: ['a', 'b'], mode: 'overview', direction: 'either', pathIndex: 0
  });
  assert.equal(readCompareState(new URLSearchParams('compare=a,a'), nodes), null);
  assert.equal(readCompareState(new URLSearchParams('compare=a,j'), nodes), null);
  assert.equal(readCompareState(new URLSearchParams('compare=a,missing'), nodes), null);
  assert.deepEqual(readCompareState(new URLSearchParams('compare=a,b&compareDirection=forward&comparePath=3'), nodes), {
    nodeIds: ['a', 'b'], mode: 'overview', direction: 'either', pathIndex: 0
  });
});

test('connection analysis state is encoded as part of the compare workspace', () => {
  const state = {
    nodeIds: ['a', 'b'], mode: 'connections', direction: 'forward', pathIndex: 2
  };
  const params = new URLSearchParams('q=x');
  writeCompareState(params, state);
  assert.equal(params.toString(), 'q=x&compare=a%2Cb&compareMode=connections&compareDirection=forward&comparePath=2');
  assert.deepEqual(readCompareState(params, nodes), state);

  writeCompareState(params, defaultCompareState(['a', 'b']));
  assert.equal(params.toString(), 'q=x&compare=a%2Cb');
  writeCompareState(params, null);
  assert.equal(params.toString(), 'q=x');
});

test('compare state equality includes mode, traversal, and active path', () => {
  const state = defaultCompareState(['a', 'b']);
  assert.equal(sameCompareState(state, { ...state }), true);
  assert.equal(sameCompareState(state, { ...state, mode: 'connections' }), false);
  assert.equal(sameCompareState(null, null), true);
});

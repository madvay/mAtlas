import test from 'node:test';
import assert from 'node:assert/strict';
import { colorForDarkSurface, contrastRatio, readableTextColor } from '../../.test-build/core/color.js';

test('content colors retain their hue unless dark-surface contrast needs correction', () => {
  assert.equal(colorForDarkSurface('#f59e0b'), '#f59e0b');
  const adjusted = colorForDarkSurface('#1d4ed8');
  assert.notEqual(adjusted, '#1d4ed8');
  assert.ok(contrastRatio(adjusted, '#0b1220') >= 4.5);
});

test('node labels choose the more readable neutral text color for authored fills', () => {
  assert.equal(readableTextColor('#1d4ed8'), '#ffffff');
  assert.equal(readableTextColor('#facc15'), '#0f172a');
});

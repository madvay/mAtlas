import test from 'node:test';
import assert from 'node:assert/strict';
import { hasInlineMathText, normalizeCitationPart, shortenSourceLabel, stripInlineMathText, summarizePlainText } from '../../.test-build/core/text.js';

test('citation and inline-math text normalization preserves prose', () => {
  assert.equal(normalizeCitationPart('Title (Section 3)'), 'title');
  assert.equal(shortenSourceLabel('SEP — Groups', 'Groups', { SEP: 'Stanford' }), 'Stanford');
  assert.equal(hasInlineMathText('A $G$-action'), true);
  assert.equal(hasInlineMathText('A G-action'), false);
  assert.equal(stripInlineMathText('A $G$-action'), 'A 𝐺-action');
  assert.equal(summarizePlainText('  A   $G$-action  ', 100), 'A 𝐺-action');
  assert.equal(summarizePlainText('abcdefghij', 6), 'abcde…');
  assert.equal(summarizePlainText('abcd$\\alpha$zz', 6), 'abcd𝛼…');
  assert.equal(Buffer.from(summarizePlainText('abcd$\\alpha$zz', 6)).toString('utf8'), 'abcd𝛼…');
});

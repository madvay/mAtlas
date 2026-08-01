import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceContent } from '../load.mjs';
import { validateContent } from '../validate.mjs';

const source = await loadSourceContent();

function errorsFor(content) {
  return validateContent(content, 'references')[0].errors;
}

test('the authored taxonomy has exact field/domain consistency', () => {
  assert.deepEqual(errorsFor(source), []);
});

test('node primaryField must match primaryDomain and fields must equal the domain-field union', () => {
  const content = JSON.parse(JSON.stringify(source));
  const atom = content.graph.nodes.find((node) => node.id === 'atom');
  atom.primaryField = 'chemistry';
  atom.fields.push('mathematics');

  const errors = errorsFor(content).join('\n');
  assert.match(errors, /primaryField must equal field physics of primaryDomain atomic-molecular-physics/);
  assert.match(errors, /fields includes field mathematics not implied by its domains/);
});

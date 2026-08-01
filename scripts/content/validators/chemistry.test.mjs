import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceContent } from '../load.mjs';
import { validateContent } from '../validate.mjs';

const source = await loadSourceContent();

function errorsFor(content) {
  return validateContent(content, 'chemistry')[0].errors;
}

test('the Chemistry release satisfies its dedicated integrity layer', () => {
  assert.deepEqual(errorsFor(source), []);
});

test('Chemistry validation preserves Physics-primary boundary ownership', () => {
  const content = JSON.parse(JSON.stringify(source));
  const atom = content.graph.nodes.find((node) => node.id === 'atom');
  atom.primaryField = 'chemistry';
  assert.match(errorsFor(content).join('\n'), /Boundary concept atom must remain Physics-primary/);
});

test('Chemistry validation requires source diversity on authored edges', () => {
  const content = JSON.parse(JSON.stringify(source));
  const edge = content.graph.edges.find((item) => item.id === 'chem_periodic_law_to_periodic_table_model_realization');
  edge.citations = ['wp-chem-periodic-table'];
  const errors = errorsFor(content).join('\n');
  assert.match(errors, /must cite multiple sources/);
  assert.match(errors, /authoritative source beyond Wikipedia/);
});

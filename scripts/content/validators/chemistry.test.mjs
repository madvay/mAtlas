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

test('Chemistry validation rejects reversed evidence levels', () => {
  const content = JSON.parse(JSON.stringify(source));
  const experiment = content.graph.nodes.find((node) => node.id === 'gallium_discovery_periodic_test');
  experiment.level = 7;
  assert.match(errorsFor(content).join('\n'), /Verifying experiment edge .* higher-level experiment/);
});

test('Chemistry validation preserves Physics-primary boundary ownership', () => {
  const content = JSON.parse(JSON.stringify(source));
  const atom = content.graph.nodes.find((node) => node.id === 'atom');
  atom.primaryField = 'chemistry';
  assert.match(errorsFor(content).join('\n'), /Boundary concept atom must remain Physics-primary/);
});

test('Chemistry validation keeps atomic and molecular bridge levels aligned with Physics', () => {
  const content = JSON.parse(JSON.stringify(source));
  const periodicTable = content.graph.nodes.find((node) => node.id === 'periodic_table');
  periodicTable.level = 31;
  assert.match(errorsFor(content).join('\n'), /Cross-field level alignment periodic_table/);
});

test('Chemistry validation requires source diversity on authored edges', () => {
  const content = JSON.parse(JSON.stringify(source));
  const edge = content.graph.edges.find((item) => item.id === 'chem_periodic_law_to_periodic_table_model_realization');
  edge.citations = ['wp-chem-periodic-table'];
  const errors = errorsFor(content).join('\n');
  assert.match(errors, /must cite multiple sources/);
  assert.match(errors, /authoritative source beyond Wikipedia/);
});

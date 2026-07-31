import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceContent } from '../load.mjs';
import { validateContent } from '../validate.mjs';

const source = await loadSourceContent();

function errorsFor(content) {
  return validateContent(content, 'schema')[0].errors;
}

test('the authored layout satisfies the schema integrity layer', () => {
  assert.deepEqual(errorsFor(source), []);
});

test('layout validation requires every active domain to have one finite lane', () => {
  const content = JSON.parse(JSON.stringify(source));
  delete content.graph.layout.domainLanes['atomic-molecular-physics'];
  content.graph.layout.domainLanes.unknown = 10;
  assert.match(errorsFor(content).join('\n'), /domainLanes.atomic-molecular-physics/);
  assert.match(errorsFor(content).join('\n'), /unknown domain unknown/);
});

test('layout validation rejects unknown and multiply assigned vertical-band fields', () => {
  const content = JSON.parse(JSON.stringify(source));
  content.graph.layout.verticalBands[0].fields.push('unknown-field');
  content.graph.layout.verticalBands[1].fields.push('mathematics');
  assert.match(errorsFor(content).join('\n'), /unknown field unknown-field/);
  assert.match(errorsFor(content).join('\n'), /assigns field mathematics to more than one vertical band/);
});

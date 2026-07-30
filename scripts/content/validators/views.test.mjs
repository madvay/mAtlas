import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourceContent } from '../load.mjs';
import { validateContent } from '../validate.mjs';

const source = await loadSourceContent();

function errorsFor(content, layer) {
  return validateContent(content, layer)[0].errors;
}

function clonedWithFirstView(transform) {
  const content = JSON.parse(JSON.stringify(source));
  content.viewsData.views[0] = transform(content.viewsData.views[0]);
  return content;
}

test('view validation accepts plain Views and core-node Stories', () => {
  const plain = clonedWithFirstView((view) => {
    delete view.nodeSequence;
    return view;
  });
  assert.deepEqual(errorsFor(plain, 'schema'), []);
  assert.deepEqual(errorsFor(plain, 'semantic'), []);

  const core = clonedWithFirstView((view) => {
    view.coreNodes = [...view.nodeSequence];
    delete view.settings.fields;
    delete view.settings.domains;
    return view;
  });
  assert.deepEqual(errorsFor(core, 'schema'), []);
  assert.deepEqual(errorsFor(core, 'references'), []);
  assert.deepEqual(errorsFor(core, 'semantic'), []);
});

test('view validation enforces exclusive domain/core scope and sequence containment', () => {
  const both = clonedWithFirstView((view) => {
    view.coreNodes = [...view.nodeSequence];
    return view;
  });
  assert.match(errorsFor(both, 'schema').join('\n'), /exactly one of settings\.domains or coreNodes/);

  const neither = clonedWithFirstView((view) => {
    delete view.settings.fields;
    delete view.settings.domains;
    return view;
  });
  assert.match(errorsFor(neither, 'schema').join('\n'), /exactly one of settings\.domains or coreNodes/);

  const outside = clonedWithFirstView((view) => {
    view.coreNodes = [view.nodeSequence[0]];
    delete view.settings.fields;
    delete view.settings.domains;
    return view;
  });
  assert.match(errorsFor(outside, 'semantic').join('\n'), /must also appear in coreNodes/);

  const unknown = clonedWithFirstView((view) => {
    view.coreNodes = ['not-a-node'];
    delete view.nodeSequence;
    delete view.settings.fields;
    delete view.settings.domains;
    return view;
  });
  assert.match(errorsFor(unknown, 'references').join('\n'), /coreNodes references unknown node: not-a-node/);
});

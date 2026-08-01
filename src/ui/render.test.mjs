import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidateRender, renderHtml, renderText } from '../../.test-build/ui/render.js';

function fixture() {
  const fragments = [];
  let replacements = 0;
  const document = {
    createRange() {
      return {
        selectNodeContents() {},
        createContextualFragment(html) {
          const fragment = { html };
          fragments.push(fragment);
          return fragment;
        }
      };
    }
  };
  const target = {
    ownerDocument: document,
    childNodes: [],
    firstChild: null,
    textContent: '',
    replaceChildren(...children) {
      replacements += 1;
      this.childNodes = children;
      this.firstChild = children[0] ?? null;
    }
  };
  return { target, fragments, replacements: () => replacements };
}

test('renderHtml retains identical output and reparses only changed markup', () => {
  const { target, fragments, replacements } = fixture();
  renderHtml(target, '<strong>Alpha</strong>');
  renderHtml(target, '<strong>Alpha</strong>');
  assert.equal(replacements(), 1);
  assert.deepEqual(fragments.map((fragment) => fragment.html), ['<strong>Alpha</strong>']);

  renderHtml(target, '<strong>Beta</strong>');
  assert.equal(replacements(), 2);
  assert.equal(fragments.at(-1).html, '<strong>Beta</strong>');
});

test('renderText avoids unchanged text writes and invalidates retained HTML state', () => {
  const { target, replacements } = fixture();
  renderHtml(target, '<em>Alpha</em>');
  target.childNodes = [{ nodeType: 3 }];
  target.firstChild = target.childNodes[0];
  target.textContent = 'plain';

  renderText(target, 'plain');
  assert.equal(replacements(), 1);

  renderText(target, 'changed');
  assert.equal(target.textContent, 'changed');
  renderHtml(target, '<em>Alpha</em>');
  assert.equal(replacements(), 2);
});

test('invalidateRender forces a deliberate rerender of identical markup', () => {
  const { target, replacements } = fixture();
  renderHtml(target, '<span>Stable</span>');
  invalidateRender(target);
  renderHtml(target, '<span>Stable</span>');
  assert.equal(replacements(), 2);
});

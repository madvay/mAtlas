import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDocumentTheme, resolveThemePreference } from '../../.test-build/state/theme.js';

test('system theme resolves from the media query while explicit choices override it', () => {
  assert.equal(resolveThemePreference('system', false), 'light');
  assert.equal(resolveThemePreference('system', true), 'dark');
  assert.equal(resolveThemePreference('light', true), 'light');
  assert.equal(resolveThemePreference('dark', false), 'dark');
});

test('applying a theme updates document state and browser chrome metadata', () => {
  const meta = { content: '' };
  const documentObject = {
    documentElement: { dataset: {}, style: {} },
    querySelector: () => meta
  };
  assert.equal(applyDocumentTheme('system', true, documentObject), 'dark');
  assert.deepEqual(documentObject.documentElement.dataset, { theme: 'dark', themePreference: 'system' });
  assert.equal(documentObject.documentElement.style.colorScheme, 'dark');
  assert.equal(meta.content, '#0b1020');
});

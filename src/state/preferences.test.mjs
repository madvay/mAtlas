import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, parsePreferences, PREFERENCES_STORAGE_KEY } from '../../.test-build/state/preferences.js';

test('preferences have performance-conscious defaults and their own storage namespace', () => {
  assert.equal(PREFERENCES_STORAGE_KEY, 'human-knowledge-atlas:preferences:v1');
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(DEFAULT_PREFERENCES, {
    version: 1,
    theme: 'dark',
    compactControls: false,
    highResolution: true,
    transitions: true,
    animateGraph: false,
    refitOnChange: true,
    motionBlur: false,
    indicateOtherDomains: true,
    overlayDomains: true,
    hideEdgesWhileMoving: true,
    allowNodeMovement: false,
    dimPrerequisites: true,
    highlightPrerequisites: false,
    experimentalFeatures: false
  });
  assert.deepEqual(parsePreferences('{bad'), DEFAULT_PREFERENCES);
});

test('preferences restore valid booleans and default missing values', () => {
  const preferences = parsePreferences(JSON.stringify({ version: 1, highResolution: true }));
  assert.equal(preferences.theme, 'dark');
  assert.equal(preferences.compactControls, false);
  assert.equal(preferences.highResolution, true);
  assert.equal(preferences.transitions, true);
  assert.equal(preferences.animateGraph, false);
  assert.equal(preferences.refitOnChange, true);
  assert.equal(preferences.indicateOtherDomains, true);
  assert.equal(preferences.overlayDomains, true);
  assert.equal(preferences.allowNodeMovement, false);
  assert.equal(preferences.highlightPrerequisites, false);

  const enabled = parsePreferences(JSON.stringify({ version: 1, theme: 'dark', compactControls: true, animateGraph: true, refitOnChange: false, overlayDomains: false, allowNodeMovement: true, highlightPrerequisites: true }));
  assert.equal(enabled.theme, 'dark');
  assert.equal(enabled.compactControls, true);
  assert.equal(enabled.animateGraph, true);
  assert.equal(enabled.refitOnChange, false);
  assert.equal(enabled.overlayDomains, false);
  assert.equal(enabled.allowNodeMovement, true);
  assert.equal(enabled.highlightPrerequisites, true);

  assert.equal(parsePreferences(JSON.stringify({ version: 1, theme: 'light' })).theme, 'light');
  assert.equal(parsePreferences(JSON.stringify({ version: 1, theme: 'invalid' })).theme, 'dark');
});


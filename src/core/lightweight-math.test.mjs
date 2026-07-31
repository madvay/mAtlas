import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lightweightLatexToUnicode, replaceInlineLatexWithUnicode } from '../../.test-build/core/lightweight-math.js';
import { importTypeScriptModule } from '../../scripts/import-typescript-module.mjs';

const buildLightweightMath = await importTypeScriptModule(new URL('./lightweight-math.ts', import.meta.url));

test('converts common symbols, styled alphabets, operators, scripts, roots, and fractions', () => {
  assert.equal(lightweightLatexToUnicode('\\omega_n^2 \\approx \\frac{a}{b}'), '𝜔ₙ² ≈ (𝑎)/(𝑏)');
  assert.equal(lightweightLatexToUnicode('\\mathbb R^2'), 'ℝ²');
  assert.equal(lightweightLatexToUnicode('\\operatorname{Spec}(R)'), 'Spec(𝑅)');
  assert.equal(lightweightLatexToUnicode('U(1)'), '𝑈(1)');
  assert.equal(lightweightLatexToUnicode('W^\\pm'), '𝑊^(±)');
  assert.equal(lightweightLatexToUnicode('2P_{1/2}'), '2𝑃_(1/2)');
  assert.equal(lightweightLatexToUnicode('\\sqrt[3]{x} \\mapsto \\aleph_0'), '√[3](𝑥) ↦ ℵ₀');
  assert.equal(lightweightLatexToUnicode('\\alpha\\mapsto\\omega^\\alpha'), '𝛼↦𝜔^(𝛼)');
});

test('keeps astral mathematical symbols well-formed in scripts and inline text', () => {
  const summary = replaceInlineLatexWithUnicode('The least nonzero fixed point of ordinal exponentiation $\\alpha\\mapsto\\omega^\\alpha$.');
  assert.equal(summary, 'The least nonzero fixed point of ordinal exponentiation 𝛼↦𝜔^(𝛼).');
  assert.equal(Buffer.from(summary).toString('utf8'), summary);
});

test('build scripts load the canonical TypeScript lightweight renderer', () => {
  for (const expression of ['\\omega_n^2 \\approx \\frac{a}{b}', '\\mathbb R^2', '\\operatorname{Spec}(R)', 'W^\\pm', '\\sqrt[3]{x} \\mapsto \\aleph_0']) {
    assert.equal(buildLightweightMath.lightweightLatexToUnicode(expression), lightweightLatexToUnicode(expression));
  }
});

test('converts every inline formula used by graph node and edge titles to overlay-free text', async () => {
  const data = JSON.parse(await readFile(new URL('../../.build/content/atlas.json', import.meta.url), 'utf8'));
  const titles = [...data.nodes.map((node) => node.label), ...data.edges.map((edge) => edge.label)];
  const mathematicalTitles = titles.filter((title) => /\$[^$\n]+\$/.test(title));
  assert.ok(mathematicalTitles.length > 0);
  for (const title of mathematicalTitles) {
    const converted = replaceInlineLatexWithUnicode(title);
    assert.ok(converted.length > 0, title);
    assert.doesNotMatch(converted, /[$\\{}]/, title);
  }
});

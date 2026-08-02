import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateConceptPages } from './generate-concept-pages.mjs';

const root = new URL('../', import.meta.url);

test('concept pages publish complete static direct-relation records beneath the interactive atlas', async () => {
  const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
  const templateHtml = await readFile(new URL('src/index.html', root), 'utf8');
  const node = graphData.nodes.find((candidate) => candidate.kind === 'structure' && graphData.edges.some((edge) => edge.source === candidate.id || edge.target === candidate.id));
  assert.ok(node);
  const directEdge = graphData.edges.find((edge) => edge.source === node.id || edge.target === node.id);
  assert.ok(directEdge);
  const directory = await mkdtemp(join(tmpdir(), 'atlas-concept-pages-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    await generateConceptPages({ graphData, templateHtml, distUrl });
    const html = await readFile(new URL(`concepts/${encodeURIComponent(node.id)}/index.html`, distUrl), 'utf8');
    assert.ok(html.includes('class="atlas-loading concept-page"'));
    assert.ok(html.includes('class="concept-static-document"'));
    assert.ok(html.includes('Canonical static concept record'));
    assert.ok(html.includes('Concept sources'));
    assert.ok(html.includes('Incoming relations (arrows to this concept)'));
    assert.ok(html.includes('Outgoing relations (arrows from this concept)'));
    assert.ok(html.includes(`id="relation-${encodeURIComponent(directEdge.id)}"`));
    assert.ok(html.includes('Authored explanation'));
    assert.ok(html.includes('Relation sources'));
    assert.ok(html.includes(`https://atlas.madvay.com/concepts/${encodeURIComponent(node.id)}/index.html.md`));
    assert.ok(html.includes(`href="/?node=${encodeURIComponent(node.id)}"`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

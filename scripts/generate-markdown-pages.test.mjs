import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateMarkdownPages, renderConceptMarkdown } from './generate-markdown-pages.mjs';

const root = new URL('../', import.meta.url);

function publicationManifest(graphData, provenance) {
  const url = (file) => `https://atlas.madvay.com/data/latest/${file}`;
  return {
    contentVersion: provenance.contentVersion,
    schemaVersion: provenance.schemaVersion,
    distributions: {
      atlas: { contentUrl: url('atlas.json') },
      schema: { contentUrl: url('schema.json') },
      views: { contentUrl: url('views.json') },
      shareCodec: { contentUrl: url('share-codec.json') },
      provenance: { contentUrl: url('provenance.json') }
    }
  };
}

test('Markdown publication emits complete concept records and counterparts for major static pages', async () => {
  const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
  const viewsData = JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8'));
  const provenance = JSON.parse(await readFile(new URL('.build/content/provenance.json', root), 'utf8'));
  const dataManifest = publicationManifest(graphData, provenance);
  const node = graphData.nodes.find((candidate) => candidate.kind === 'structure' && graphData.edges.some((edge) => edge.source === candidate.id || edge.target === candidate.id));
  assert.ok(node);
  const record = renderConceptMarkdown(graphData, node);
  const edge = graphData.edges.find((candidate) => candidate.source === node.id || candidate.target === node.id);
  assert.ok(edge);
  assert.ok(record.includes(`**Concept ID:** \`${node.id}\``));
  assert.ok(record.includes('## Incoming relations (arrows to this concept)'));
  assert.ok(record.includes('## Outgoing relations (arrows from this concept)'));
  assert.ok(record.includes(`relation-${encodeURIComponent(edge.id)}`));
  assert.ok(record.includes('**Authored explanation:**'));
  assert.ok(record.includes('**Relation sources:**'));

  const directory = await mkdtemp(join(tmpdir(), 'atlas-markdown-pages-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    await generateMarkdownPages({ graphData, viewsData, dataManifest, distUrl });
    const conceptMarkdown = await readFile(new URL(`concepts/${encodeURIComponent(node.id)}/index.html.md`, distUrl), 'utf8');
    const fieldId = graphData.meta.fieldOrder[0];
    const fieldMarkdown = await readFile(new URL(`${graphData.fields[fieldId].path}/index.html.md`, distUrl), 'utf8');
    const domainId = graphData.meta.domainOrder[0];
    const domainMarkdown = await readFile(new URL(`${graphData.fields[graphData.domains[domainId].field].path}/${domainId}/index.html.md`, distUrl), 'utf8');
    const firstView = viewsData.views[0];
    const viewMarkdown = await readFile(new URL(`views/${encodeURIComponent(firstView.id)}/index.html.md`, distUrl), 'utf8');
    assert.ok(conceptMarkdown.startsWith(record.trimEnd()));
    assert.ok(fieldMarkdown.includes('## Domains'));
    assert.ok(domainMarkdown.includes('## Concepts'));
    assert.ok(viewMarkdown.includes('## Narrative'));
    assert.ok((await readFile(new URL('directory/index.html.md', distUrl), 'utf8')).includes('## Relation types'));
    assert.ok((await readFile(new URL('guide/index.html.md', distUrl), 'utf8')).includes('Static pages and published data'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

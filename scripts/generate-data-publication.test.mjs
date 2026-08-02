import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateDataPublication } from './generate-data-publication.mjs';

const root = new URL('../', import.meta.url);

test('data publication provides stable aliases, checksums, Dataset JSON-LD, and Markdown', async () => {
  const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
  const viewsData = JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8'));
  const provenance = JSON.parse(await readFile(new URL('.build/content/provenance.json', root), 'utf8'));
  const sourceAssets = await Promise.all([
    ['atlas', 'atlas.json', 'content/atlas.current.json'],
    ['schema', 'schema.json', 'content/schema.current.json'],
    ['views', 'views.json', 'content/views.current.json'],
    ['shareCodec', 'share-codec.json', 'content/share-codec.current.json'],
    ['provenance', 'provenance.json', 'content/provenance.current.json']
  ].map(async ([key, file, immutablePath]) => [key, {
    bytes: await readFile(new URL(`.build/content/${file}`, root)),
    immutablePath
  }]));
  const assets = Object.fromEntries(sourceAssets);
  const directory = await mkdtemp(join(tmpdir(), 'atlas-data-publication-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    const manifest = await generateDataPublication({
      graphData,
      viewsData,
      provenance,
      assets,
      distUrl,
      lastModified: '2026-08-01'
    });
    const writtenManifest = JSON.parse(await readFile(new URL('data/latest/manifest.json', distUrl), 'utf8'));
    assert.deepEqual(writtenManifest, manifest);
    assert.equal(manifest.contentVersion, provenance.contentVersion);
    assert.equal(manifest.schemaVersion, provenance.schemaVersion);
    for (const [key, distribution] of Object.entries(manifest.distributions)) {
      assert.match(distribution.sha256, /^[0-9a-f]{64}$/);
      assert.equal(distribution.contentUrl, `https://atlas.madvay.com/data/latest/${distribution.file}`);
      assert.ok(distribution.byteSize > 0);
      assert.ok(!('versionUrl' in distribution));
      assert.ok(!('immutableUrl' in distribution));
    }
    assert.deepEqual(
      JSON.parse(await readFile(new URL('data/latest/atlas.json', distUrl), 'utf8')),
      graphData
    );
    const sqlite = await readFile(new URL('data/latest/matlas.sqlite', distUrl));
    assert.match(sqlite.toString('utf8', 0, 16), /^SQLite format 3\0/);
    const conceptsNdjson = (await readFile(new URL('data/latest/concepts.ndjson', distUrl), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(conceptsNdjson[0].recordType, 'publication_metadata');
    assert.equal(conceptsNdjson[0].contentVersion, graphData.meta.version);
    assert.equal(conceptsNdjson.length, graphData.nodes.length + 1);
    const jsonld = JSON.parse(await readFile(new URL('data/latest/matlas.jsonld', distUrl), 'utf8'));
    assert.ok(Array.isArray(jsonld['@graph']));
    assert.equal(jsonld['@graph'][0]['@type'][0], 'schema:Dataset');
    const turtle = await readFile(new URL('data/latest/matlas.ttl', distUrl), 'utf8');
    assert.ok(turtle.includes(`# Content license: ${graphData.meta.licenseUrl}`));
    const firstConcept = graphData.nodes.find((node) => node.kind === 'structure');
    assert.ok(firstConcept);
    const conceptRecord = JSON.parse(await readFile(new URL(`data/latest/concepts/${encodeURIComponent(firstConcept.id)}.json`, distUrl), 'utf8'));
    const conceptRelations = JSON.parse(await readFile(new URL(`data/latest/concepts/${encodeURIComponent(firstConcept.id)}/relations.json`, distUrl), 'utf8'));
    assert.equal(conceptRecord.recordType, 'concept');
    assert.equal(conceptRecord.concept.id, firstConcept.id);
    assert.equal(conceptRelations.recordType, 'concept_relations');
    assert.ok(manifest.recordEndpoints.concepts.contentUrlTemplate.includes('{conceptId}'));
    assert.equal(manifest.retention.urlStability, 'latest-only');
    assert.equal(manifest.retention.versionedSnapshots, false);
    await assert.rejects(readFile(new URL(`data/${manifest.contentVersion}/manifest.json`, distUrl), 'utf8'), { code: 'ENOENT' });
    const page = await readFile(new URL('data/index.html', distUrl), 'utf8');
    const markdown = await readFile(new URL('data/index.html.md', distUrl), 'utf8');
    assert.ok(page.includes('"@type":"Dataset"'));
    assert.ok(page.includes('"@type":"DataDownload"'));
    assert.ok(page.includes('rel="alternate" type="text/markdown"'));
    assert.ok(page.includes('data/latest/manifest.json'));
    assert.ok(page.includes('matlas.sqlite'));
    assert.ok(markdown.includes('## Current downloads'));
    assert.ok(markdown.includes('## Small deterministic records'));
    assert.ok(markdown.includes('`source` → `target`'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

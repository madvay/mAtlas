import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateAiPublication } from './generate-ai-publication.mjs';
import { generateDataPublication } from './generate-data-publication.mjs';
import { attributionForTextPublication } from './publication-text-metadata.mjs';

const root = new URL('../', import.meta.url);

test('AI publication includes SDKs, Agent Skill, static workbench, citations, OpenAPI, and a self-contained bundle', async () => {
  const [graphData, viewsData, provenance] = await Promise.all([
    readFile(new URL('.build/content/atlas.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('.build/content/views.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('.build/content/provenance.json', root), 'utf8').then(JSON.parse)
  ]);
  const assets = Object.fromEntries(await Promise.all([
    ['atlas', 'atlas.json', 'content/atlas.current.json'],
    ['schema', 'schema.json', 'content/schema.current.json'],
    ['views', 'views.json', 'content/views.current.json'],
    ['shareCodec', 'share-codec.json', 'content/share-codec.current.json'],
    ['provenance', 'provenance.json', 'content/provenance.current.json']
  ].map(async ([key, file, immutablePath]) => [key, {
    bytes: await readFile(new URL(`.build/content/${file}`, root)),
    immutablePath
  }])));
  const directory = await mkdtemp(join(tmpdir(), 'atlas-ai-publication-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    const dataManifest = await generateDataPublication({ graphData, viewsData, provenance, assets, distUrl, lastModified: '2026-08-01' });
    const result = await generateAiPublication({
      graphData,
      dataManifest,
      distUrl,
      lastModified: '2026-08-01',
      sdkSource: 'export class Atlas { static fromData(data) { return data; } }\n',
      workbenchScriptPath: '/assets/ai-workbench.test.js'
    });
    const openapi = JSON.parse(await readFile(new URL('openapi.json', distUrl), 'utf8'));
    assert.equal(openapi.openapi, '3.1.0');
    assert.ok(openapi.paths['/data/latest/concepts/{conceptId}.json']);
    assert.ok(openapi.paths['/data/latest/concepts/{conceptId}/relations.json']);
    assert.ok(result.openApi.includes('getConceptRecord'));
    const cff = await readFile(new URL('CITATION.cff', distUrl), 'utf8');
    const citation = JSON.parse(await readFile(new URL('citation.json', distUrl), 'utf8'));
    assert.ok(cff.includes(`version: "${dataManifest.contentVersion}"`));
    assert.ok(cff.includes(`# Content license: ${graphData.meta.licenseUrl}`));
    assert.ok(cff.includes(`# Attribution: ${graphData.meta.attribution}`));
    assert.equal(citation.copyrightNotice, graphData.meta.attribution);
    const index = await readFile(new URL('ai/index.html', distUrl), 'utf8');
    const workbench = await readFile(new URL('ai/workbench/index.html', distUrl), 'utf8');
    const vocabulary = await readFile(new URL('vocab/index.html', distUrl), 'utf8');
    const vocabularyJson = JSON.parse(await readFile(new URL('vocab/matlas.jsonld', distUrl), 'utf8'));
    const [relationTypeId] = Object.keys(graphData.edgeTypes);
    const relationVocabulary = await readFile(new URL(`vocab/relation/${encodeURIComponent(relationTypeId)}/index.html`, distUrl), 'utf8');
    assert.ok(index.includes('matlas-ai-bundle.zip'));
    assert.ok(index.includes(graphData.meta.attribution));
    assert.ok(index.includes('https://github.com/madvay/mAtlas/blob/main/LICENSE'));
    assert.ok(workbench.includes('toolname="search_concepts"'));
    assert.ok(workbench.includes('toolname="find_paths"'));
    assert.ok(workbench.includes('data-atlas-url="/data/latest/atlas.json"'));
    assert.ok(workbench.includes('https://github.com/madvay/mAtlas/blob/main/LICENSE'));
    assert.ok(vocabulary.includes(graphData.meta.attribution));
    assert.equal(vocabularyJson['@type'], 'DefinedTermSet');
    assert.ok(relationVocabulary.includes(relationTypeId));
    const pythonSdk = await readFile(new URL('ai/sdk/matlas.py', distUrl), 'utf8');
    assert.ok(pythonSdk.includes('License: https://github.com/madvay/mAtlas/blob/main/LICENSE'));
    for (const pathname of [
      'ai/index.html.md',
      'ai/README.md',
      'ai/citation-guide.md',
      'ai/skills/matlas/SKILL.md',
      'ai/skills/matlas/references/schema.md',
      'ai/skills/matlas/references/citation-guide.md',
      'ai/examples/answer-with-sources.md'
    ]) {
      const text = await readFile(new URL(pathname, distUrl), 'utf8');
      assert.ok(text.includes('License URL: https://github.com/madvay/mAtlas/blob/main/LICENSE'), `${pathname} lacks the repository license.`);
      assert.ok(text.includes(attributionForTextPublication(graphData, pathname)), `${pathname} lacks file-specific attribution.`);
    }
    for (const pathname of [
      'vocab/index.html.md',
      `vocab/relation/${encodeURIComponent(relationTypeId)}/index.html.md`
    ]) {
      const text = await readFile(new URL(pathname, distUrl), 'utf8');
      assert.ok(text.includes(`License URL: ${graphData.meta.licenseUrl}`), `${pathname} lacks the content license.`);
      assert.ok(text.includes(attributionForTextPublication(graphData, pathname)), `${pathname} lacks file-specific attribution.`);
    }
    const bundle = await readFile(new URL('ai/matlas-ai-bundle.zip', distUrl));
    assert.equal(bundle.subarray(0, 4).toString('binary'), 'PK\u0003\u0004');
    const archiveText = bundle.toString('utf8');
    for (const pathname of ['README.md', 'SKILL.md', 'data/matlas.sqlite', 'sdk/matlas.py', 'sdk/matlas.mjs', 'references/schema.md', 'CITATION.cff', 'openapi.json']) {
      assert.ok(archiveText.includes(pathname), `bundle omits ${pathname}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

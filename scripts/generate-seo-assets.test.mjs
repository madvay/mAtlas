import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateSeoAssets } from './generate-seo-assets.mjs';

const root = new URL('../', import.meta.url);

test('SEO assets publish and associate the directory page and standalone SVG', async () => {
  const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
  const viewsData = JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'atlas-seo-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    const firstFieldId = graphData.meta.fieldOrder[0];
    const firstDomainId = graphData.meta.domainOrder[0];
    const fieldImages = {
      [firstFieldId]: { path: `static/fields/${encodeURIComponent(firstFieldId)}.svg`, width: 1400, height: 760 }
    };
    const domainImages = {
      [firstDomainId]: { path: `static/domains/${encodeURIComponent(firstDomainId)}.svg`, width: 1200, height: 700 }
    };
    await generateSeoAssets({
      graphData,
      viewsData,
      distUrl,
      graphDataPath: 'content/atlas.test.json',
      schemaPath: 'content/schema.test.json',
      viewsPath: 'content/views.test.json',
      atlasSvgPath: 'static/atlas.svg',
      directoryPath: 'directory/',
      fieldImages,
      domainImages,
      lastModified: '2026-07-28'
    });
    const sitemap = await readFile(new URL('sitemap.xml', distUrl), 'utf8');
    const robots = await readFile(new URL('robots.txt', distUrl), 'utf8');
    const llms = await readFile(new URL('llms.txt', distUrl), 'utf8');
    const searchIndex = JSON.parse(await readFile(new URL('content/search-index.json', distUrl), 'utf8'));
    assert.ok(searchIndex.concepts.length > 0);
    await assert.rejects(readFile(new URL('data/search-index.json', distUrl), 'utf8'), { code: 'ENOENT' });
    assert.match(sitemap, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
    assert.ok(sitemap.includes('<loc>https://atlas.madvay.com/directory/</loc><lastmod>2026-07-28</lastmod><image:image><image:loc>https://atlas.madvay.com/static/atlas.svg</image:loc></image:image>'));
    assert.ok(sitemap.includes('<loc>https://atlas.madvay.com/static/atlas.svg</loc><lastmod>2026-07-28</lastmod>'));
    const firstFieldUrl = `https://atlas.madvay.com/${graphData.fields[firstFieldId].path}/`;
    assert.ok(sitemap.includes(`<loc>${firstFieldUrl}</loc><lastmod>2026-07-28</lastmod><image:image><image:loc>https://atlas.madvay.com/${fieldImages[firstFieldId].path}</image:loc></image:image>`));
    const firstDomain = graphData.domains[firstDomainId];
    const firstDomainUrl = `https://atlas.madvay.com/${graphData.fields[firstDomain.field].path}/${encodeURIComponent(firstDomainId)}/`;
    assert.ok(sitemap.includes(`<loc>${firstDomainUrl}</loc><lastmod>2026-07-28</lastmod><image:image><image:loc>https://atlas.madvay.com/${domainImages[firstDomainId].path}</image:loc></image:image>`));
    assert.ok(!sitemap.includes('<loc>https://atlas.madvay.com/concepts/</loc>'));
    assert.ok(!sitemap.includes('<loc>https://atlas.madvay.com/static/atlas/</loc>'));
    assert.ok(!sitemap.includes('/m/'));
    assert.ok(robots.includes('User-agent: *\nAllow: /'));
    assert.ok(llms.includes('[Atlas Directory](https://atlas.madvay.com/directory/)'));
    assert.ok(llms.includes('[All-in atlas SVG](https://atlas.madvay.com/static/atlas.svg)'));
    assert.ok(llms.includes('[Graph JSON](https://atlas.madvay.com/content/atlas.test.json)'));
    assert.ok(llms.includes('[JSON Schema](https://atlas.madvay.com/content/schema.test.json)'));
    assert.ok(llms.includes('[Views JSON](https://atlas.madvay.com/content/views.test.json)'));
    assert.ok(!llms.includes('https://atlas.madvay.com/data/'));
    assert.ok(llms.includes(`](${firstDomainUrl})`));
    assert.ok(!llms.includes('https://atlas.madvay.com/static/atlas/'));
    assert.ok(!llms.includes('[Concept Directory](https://atlas.madvay.com/concepts/)'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

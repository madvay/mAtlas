import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildGuideLinks, generateGuidePage, renderGuidePage } from './generate-guide-page.mjs';
import { importTypeScriptModule } from './import-typescript-module.mjs';
import { minifyHtml } from './minify-html.mjs';

const root = new URL('../', import.meta.url);
const { decodeFilterToken } = await importTypeScriptModule(new URL('../src/state/filter-token.ts', import.meta.url));
const { decodeDisplayToken } = await importTypeScriptModule(new URL('../src/state/display-token.ts', import.meta.url));

async function fixtures() {
  return {
    graphData: JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8')),
    viewsData: JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8')),
    shareCodec: JSON.parse(await readFile(new URL('.build/content/share-codec.json', root), 'utf8'))
  };
}

function decodeLink(link, shareCodec) {
  const url = new URL(link);
  return {
    url,
    filter: decodeFilterToken(url.searchParams.get('filter'), shareCodec),
    display: decodeDisplayToken(url.searchParams.get('disp'))
  };
}

test('guide links use real content and the application compact-state encoders', async () => {
  const data = await fixtures();
  const links = buildGuideLinks(data);

  assert.equal(links.group, 'https://atlas.madvay.com/concepts/group/');
  assert.equal(links.storyTopologicalSpace, 'https://atlas.madvay.com/views/from-sets-to-spaces/?node=topological_space');
  assert.equal(links.searchElectron, 'https://atlas.madvay.com/?q=electron');

  const algebra = decodeLink(links.algebraOnly, data.shareCodec);
  assert.deepEqual(algebra.filter.fields, ['mathematics']);
  assert.deepEqual(algebra.filter.domains, ['algebra']);
  assert.equal(algebra.display.layout, 'atlas');

  const domains = decodeLink(links.domainsOverview, data.shareCodec);
  assert.equal(domains.display.layout, 'domains');
  assert.equal(domains.display.crossFieldVisibility, 'contextual');
  assert.equal(domains.url.searchParams.get('domain'), 'algebra');

  const chemistry = decodeLink(links.chemistryPrimaryOnly, data.shareCodec);
  assert.deepEqual(chemistry.filter.fields, ['chemistry']);
  assert.equal(chemistry.display.showPrimaryOnly, true);
  assert.equal(chemistry.url.searchParams.get('node'), 'molecule');

  const compare = decodeLink(links.compareGroupRing, data.shareCodec);
  assert.equal(compare.url.searchParams.get('compare'), 'group,ring');
  assert.equal(compare.url.searchParams.get('node'), 'group');
});

test('guide page is complete, crawlable, static', async () => {
  const data = await fixtures();
  const html = renderGuidePage({ ...data, guidePath: 'guide/', lastModified: '2026-07-31' });

  assert.ok(html.includes('<link rel="canonical" href="https://atlas.madvay.com/guide/">'));
  assert.ok(html.includes('<meta name="theme-color" content="#f6f7f9">'));
  assert.ok(html.includes('prefers-color-scheme: dark'));
  assert.ok(html.includes(':root[data-theme="dark"]'));
  assert.equal((html.match(/class="guide-section"/g) ?? []).length, 13);
  for (const heading of ['Quick start', 'Read the graph', 'Filters', 'Stories and Views', 'Compare and connect', 'Permalinks and export', 'Keyboard and mobile']) {
    assert.ok(html.includes(heading), `Guide omits ${heading}.`);
  }
  assert.ok(html.includes('https://atlas.madvay.com/concepts/group/'));
  assert.ok(html.includes('views/from-sets-to-spaces/?node=topological_space'));
  assert.ok(html.includes('filter='));
  assert.ok(html.includes('disp='));
  assert.ok(html.includes('<dt>Theme</dt>'));
  assert.ok(html.includes('The Preferences default is Dark'));
  assert.ok(html.includes('preserves the active resolved Light or Dark theme'));
  assert.ok(html.includes('build-published all-in export uses a deterministic Light theme'));
  assert.ok(!html.includes('<script src='));

  const directory = await mkdtemp(join(tmpdir(), 'atlas-guide-page-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    await generateGuidePage({ ...data, distUrl, lastModified: '2026-07-31' });
    const written = await readFile(new URL('guide/index.html', distUrl), 'utf8');
    assert.equal(written, minifyHtml(renderGuidePage({ ...data, distUrl, lastModified: '2026-07-31' })));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

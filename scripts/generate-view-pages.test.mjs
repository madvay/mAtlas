import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateViewPages } from './generate-view-pages.mjs';

const root = new URL('../', import.meta.url);

test('view page generator emits a directory and crawlable static routes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-views-'));
  try {
    const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
    const viewsData = JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8'));
    const templateHtml = await readFile(new URL('src/index.html', root), 'utf8');
    const distUrl = pathToFileURL(`${directory}/`);
    await generateViewPages({ graphData, viewsData, templateHtml, distUrl });

    const index = await readFile(new URL('views/index.html', distUrl), 'utf8');
    assert.match(index, /Stories &amp; Views/);
    assert.ok(index.includes('rel="alternate" type="text/markdown" href="https://atlas.madvay.com/views/index.html.md"'));
    assert.ok(index.includes('href="/guide/"'));
    assert.ok(index.includes('prefers-color-scheme: dark'));
    assert.match(index, /Local arithmetic and the 𝑝-adic world/);
    assert.match(index, /dark components, and 𝛬CDM\./);
    assert.doesNotMatch(index, />Local arithmetic and the \$p\$-adic world<|dark components, and \$\\Lambda\$CDM\./);
    for (const view of viewsData.views) {
      const html = await readFile(new URL(`views/${encodeURIComponent(view.id)}/index.html`, distUrl), 'utf8');
      assert.match(html, new RegExp(`atlas:view\" content=\"${view.id}`));
      const sequence = view.nodeSequence ?? [];
      if (sequence.length) {
        assert.ok(html.includes(`<meta name="atlas:selection" content="node:${sequence[0]}">`));
        assert.match(html, /"@type":\s*"ItemList"/);
        assert.match(html, /data-view-prev/);
        assert.match(html, /data-view-next/);
        assert.ok(html.includes(`Step 1 of ${sequence.length}`));
      } else {
        assert.doesNotMatch(html, /atlas:selection|data-view-prev|data-view-next|"@type":\s*"ItemList"/);
      }
      assert.ok(html.includes(view.title));
      assert.ok(html.includes(view.narrative));
      assert.match(html, /<base href="\.\.\/\.\.\/">/);
      assert.match(html, /<script id="view-page-jsonld" type="application\/ld\+json">/);
      assert.ok(html.includes(`rel="alternate" type="text/markdown" href="https://atlas.madvay.com/views/${encodeURIComponent(view.id)}/index.html.md"`));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('view page generator renders KaTeX in the view context heading title', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-views-'));
  try {
    const graphData = {
      meta: { title: 'Atlas of Math' },
      nodes: [{ id: 'a', label: 'A' }]
    };
    const view = {
      id: 'math-title-view',
      title: 'The $p$-adic world',
      summary: 'A short guided path.',
      narrative: 'Explore completions of number fields.',
      featured: false,
      tags: [],
      nodeSequence: ['a']
    };
    const viewsData = { views: [view] };
    const templateHtml = '<html><head><title></title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""><link rel="canonical" href=""><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><section id="viewBanner" class="view-banner" aria-live="polite" hidden></section></body></html>';
    const distUrl = pathToFileURL(`${directory}/`);

    await generateViewPages({ graphData, viewsData, templateHtml, distUrl });

    const html = await readFile(new URL(`views/${encodeURIComponent(view.id)}/index.html`, distUrl), 'utf8');
    assert.match(html, /<span class="view-context-heading"><span class="kicker">Story<\/span><strong>The <span class="katex">/);
    assert.ok(html.includes('<strong>The <span class="katex">p</span>-adic world</strong>') || html.includes('<strong>The <span class="katex">'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('view page generator omits story-only metadata and controls for a plain View', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-views-'));
  try {
    const graphData = { meta: { title: 'Atlas' }, nodes: [{ id: 'a', label: 'A' }] };
    const view = {
      id: 'plain-view', title: 'Plain view', summary: 'A configuration.', narrative: 'Inspect this graph.',
      featured: false, tags: ['Test'], settings: {}
    };
    const templateHtml = '<html><head><title></title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""><link rel="canonical" href=""><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><section id="viewBanner" class="view-banner" aria-live="polite" hidden></section></body></html>';
    const distUrl = pathToFileURL(`${directory}/`);
    await generateViewPages({ graphData, viewsData: { views: [view] }, templateHtml, distUrl });
    const html = await readFile(new URL('views/plain-view/index.html', distUrl), 'utf8');
    assert.match(html, /<span class="kicker">View<\/span>/);
    assert.doesNotMatch(html, /atlas:selection/);
    assert.doesNotMatch(html, /data-view-prev|data-view-next|Step 1 of/);
    assert.doesNotMatch(html, /"@type":\s*"ItemList"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

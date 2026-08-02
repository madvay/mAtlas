import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateDataPublication } from './generate-data-publication.mjs';
import { generateMarkdownPages } from './generate-markdown-pages.mjs';
import { generateSeoAssets } from './generate-seo-assets.mjs';
import { appUrl, conceptPath, domainPath, fieldPath } from './publication-urls.mjs';
import { attributionForTextPublication } from './publication-text-metadata.mjs';

const root = new URL('../', import.meta.url);
const PROJECT_LICENSE_URL = 'https://github.com/madvay/mAtlas/blob/main/LICENSE';
const MIXED_PUBLICATION_PATHS = new Set(['index.html.md', 'guide/index.html.md']);

function markdownPaths(graphData, viewsData) {
  const fieldIds = graphData.meta.fieldOrder ?? Object.keys(graphData.fields);
  const domainIds = graphData.meta.domainOrder ?? Object.keys(graphData.domains);
  return [
    'index.html.md',
    'concepts/index.html.md',
    'directory/index.html.md',
    'guide/index.html.md',
    'views/index.html.md',
    'data/index.html.md',
    ...graphData.nodes.filter((node) => node.kind === 'structure').map((node) => `${conceptPath(node.id)}index.html.md`),
    ...fieldIds.map((fieldId) => `${fieldPath(graphData, fieldId)}index.html.md`),
    ...domainIds.map((domainId) => `${domainPath(graphData, domainId)}index.html.md`),
    ...viewsData.views.map((view) => `views/${encodeURIComponent(view.id)}/index.html.md`)
  ];
}

test('every Markdown and LLM text publication includes its license and file-specific attribution URL', async () => {
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
  const directory = await mkdtemp(join(tmpdir(), 'atlas-publication-metadata-'));
  try {
    const distUrl = pathToFileURL(`${directory}/`);
    const dataManifest = await generateDataPublication({
      graphData,
      provenance,
      assets,
      distUrl,
      lastModified: '2026-08-01'
    });

    await generateMarkdownPages({ graphData, viewsData, dataManifest, distUrl });
    await generateSeoAssets({
      graphData,
      viewsData,
      distUrl,
      graphDataPath: 'content/atlas.test.json',
      schemaPath: 'content/schema.test.json',
      viewsPath: 'content/views.test.json',
      atlasSvgPath: 'static/atlas.svg',
      directoryPath: 'directory/',
      guidePath: 'guide/',
      dataPath: 'data/',
      dataManifestPath: 'data/latest/manifest.json',
      dataManifest,
      lastModified: '2026-08-01'
    });

    const textPaths = [...markdownPaths(graphData, viewsData), 'llms.txt', 'llms-context.txt', 'llms-context-full.txt'];
    for (const pathname of textPaths) {
      const text = await readFile(new URL(pathname, distUrl), 'utf8');
      const expectedAttribution = attributionForTextPublication(graphData, pathname);
      const expectedUrl = appUrl(pathname);
      const licenseUrl = MIXED_PUBLICATION_PATHS.has(pathname) ? PROJECT_LICENSE_URL : graphData.meta.licenseUrl;
      assert.ok(text.includes(`License URL: ${licenseUrl}`), `${pathname} lacks the license URL.`);
      assert.ok(text.includes(expectedAttribution), `${pathname} lacks the configured attribution line.`);
      assert.ok(expectedAttribution.includes(expectedUrl), `${pathname} attribution lacks its full absolute URL.`);
      assert.equal((text.match(/^## License and attribution$/gm) ?? []).length, 1, `${pathname} must contain exactly one publication notice.`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

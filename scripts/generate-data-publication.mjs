import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { escapeHtml } from './inline-math.mjs';
import { minifyHtml } from './minify-html.mjs';
import { createDerivedMachineArtifacts, DERIVED_DISTRIBUTION_DEFINITIONS } from './generate-machine-artifacts.mjs';
import { appUrl } from './publication-urls.mjs';
import { appendTextPublicationMetadata } from './publication-text-metadata.mjs';
import { staticThemeCss, themeBootstrapScript } from './page-theme.mjs';

const DATA_PAGE_PATH = 'data/';
const DATA_LATEST_PATH = 'data/latest/';
const PROJECT_LICENSE_URL = 'https://github.com/madvay/mAtlas/blob/main/LICENSE';

const BASE_DISTRIBUTION_DEFINITIONS = [
  { key: 'atlas', file: 'atlas.json', label: 'Canonical graph JSON', encodingFormat: 'application/json' },
  { key: 'schema', file: 'schema.json', label: 'Graph JSON Schema', encodingFormat: 'application/schema+json' },
  { key: 'views', file: 'views.json', label: 'Stories and Views JSON', encodingFormat: 'application/json' },
  { key: 'shareCodec', file: 'share-codec.json', label: 'Share-link codec JSON', encodingFormat: 'application/json' },
  { key: 'provenance', file: 'provenance.json', label: 'Content provenance JSON', encodingFormat: 'application/json' }
];

export const DATA_DISTRIBUTION_DEFINITIONS = [...BASE_DISTRIBUTION_DEFINITIONS, ...DERIVED_DISTRIBUTION_DEFINITIONS];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dataUrl(pathname) {
  return appUrl(`${DATA_LATEST_PATH}${pathname}`);
}

function urlTemplate(url) {
  return url.replaceAll('%7B', '{').replaceAll('%7D', '}');
}

function markdownLink(label, url) {
  return `[${String(label).replaceAll(']', '\\]')}](${url})`;
}

function outputDirectory(pathname) {
  const directory = dirname(pathname).replaceAll('\\', '/');
  return directory === '.' ? '' : `${directory}/`;
}

async function mapWithConcurrency(items, operation, concurrency = 24) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await operation(items[index], index);
    }
  });
  await Promise.all(workers);
}

export function buildDataManifest({ graphData, provenance, assets, lastModified }) {
  const contentVersion = provenance.contentVersion ?? graphData.meta.version;
  const distributions = Object.fromEntries(DATA_DISTRIBUTION_DEFINITIONS.map((definition) => {
    const asset = assets[definition.key];
    if (!asset?.bytes) throw new Error(`Missing ${definition.key} data asset for the stable data manifest.`);
    return [definition.key, {
      label: definition.label,
      file: definition.file,
      contentUrl: dataUrl(definition.file),
      encodingFormat: definition.encodingFormat,
      byteSize: asset.bytes.byteLength,
      sha256: sha256(asset.bytes)
    }];
  }));
  return {
    formatVersion: 2,
    name: graphData.meta.title,
    canonicalUrl: appUrl(DATA_PAGE_PATH),
    contentVersion,
    schemaVersion: provenance.schemaVersion,
    dateModified: lastModified,
    license: {
      name: graphData.meta.license,
      url: graphData.meta.licenseUrl,
      attribution: graphData.meta.attribution
    },
    retention: {
      urlStability: 'latest-only',
      versionedSnapshots: false,
      notice: 'This endpoint is replaced on each mAtlas publication. Save this manifest and the referenced artifacts for reproducible use.'
    },
    distributions,
    recordEndpoints: {
      concepts: {
        contentUrlTemplate: urlTemplate(dataUrl('concepts/{conceptId}.json')),
        relationsUrlTemplate: urlTemplate(dataUrl('concepts/{conceptId}/relations.json'))
      },
      domains: {
        contentUrlTemplate: urlTemplate(dataUrl('domains/{domainId}.json'))
      },
      relationTypes: {
        contentUrlTemplate: urlTemplate(dataUrl('relation-types/{relationTypeId}.json'))
      }
    }
  };
}

function datasetJsonLd({ graphData, dataManifest, lastModified }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': appUrl(DATA_PAGE_PATH),
    name: `${graphData.meta.title} dataset`,
    alternateName: 'mAtlas',
    description: graphData.meta.description,
    url: appUrl(DATA_PAGE_PATH),
    version: dataManifest.contentVersion,
    ...(lastModified ? { dateModified: lastModified } : {}),
    license: graphData.meta.licenseUrl,
    creator: { '@type': 'Person', name: 'Advay Mengle', url: 'https://advaymengle.com/' },
    isAccessibleForFree: true,
    distribution: Object.values(dataManifest.distributions).map((distribution) => ({
      '@type': 'DataDownload',
      name: distribution.label,
      contentUrl: distribution.contentUrl,
      encodingFormat: distribution.encodingFormat,
      contentSize: distribution.byteSize
    }))
  };
}

export function renderDataMarkdown({ graphData, dataManifest }) {
  const downloads = Object.values(dataManifest.distributions).map((distribution) =>
    `- ${markdownLink(distribution.label, distribution.contentUrl)} — ${distribution.encodingFormat}; ${distribution.byteSize.toLocaleString('en-US')} bytes; SHA-256: \`${distribution.sha256}\``
  );
  return [
    `# ${graphData.meta.title} dataset`,
    '',
    `Canonical landing page: ${appUrl(DATA_PAGE_PATH)}`,
    `Content version: \`${dataManifest.contentVersion}\``,
    `Schema version: \`${dataManifest.schemaVersion}\``,
    `License: ${markdownLink(graphData.meta.license, graphData.meta.licenseUrl)}`,
    '',
    '## Current downloads',
    '',
    `- ${markdownLink('Current data manifest', dataUrl('manifest.json'))}`,
    ...downloads,
    '',
    '## Small deterministic records',
    '',
    `- Canonical concept record: \`${dataManifest.recordEndpoints.concepts.contentUrlTemplate}\``,
    `- Direct concept relations: \`${dataManifest.recordEndpoints.concepts.relationsUrlTemplate}\``,
    `- Domain record: \`${dataManifest.recordEndpoints.domains.contentUrlTemplate}\``,
    `- Relation-type record: \`${dataManifest.recordEndpoints.relationTypes.contentUrlTemplate}\``,
    '',
    '## How to use the graph',
    '',
    '1. Read the stable manifest before selecting a distribution, then retain the reported content version and SHA-256 digest.',
    '2. Resolve topics by canonical ID. Every direct relation is directed `source` → `target`; a path traversed in reverse does not reverse the authored assertion.',
    '3. Use predecessor closure only for relation types that enforce predecessor levels. Use prerequisite closure only according to each relation type’s `prerequisiteTraversal` policy.',
    '4. Treat relation records as authored editorial assertions, not inferred mathematical or scientific facts.',
    '5. Cite the relevant canonical concept or relation URL and retain its attached source citations.',
    '',
    'The `/data/latest/` URLs are replaced on each mAtlas publication. They identify the current dataset only. Save this manifest and the referenced artifacts if reproducible use requires a retained snapshot.',
    ''
  ].join('\n');
}

export function renderDataPage({ graphData, dataManifest, lastModified }) {
  const canonicalUrl = appUrl(DATA_PAGE_PATH);
  const description = `Published machine-readable data for the current ${graphData.meta.title} release.`;
  const jsonLd = datasetJsonLd({ graphData, dataManifest, lastModified });
  const downloads = Object.values(dataManifest.distributions).map((distribution) => `<tr>
      <th scope="row">${escapeHtml(distribution.label)}</th>
      <td><a href="${escapeHtml(distribution.contentUrl)}">current URL</a></td>
      <td><code>${escapeHtml(distribution.encodingFormat)}</code><br><code>${escapeHtml(distribution.sha256)}</code><br>${distribution.byteSize.toLocaleString('en-US')} bytes</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-snippet:-1">
  <meta name="theme-color" content="#f6f7f9">
  ${themeBootstrapScript}
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" type="text/markdown" href="${canonicalUrl}index.html.md" title="Markdown dataset description">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(graphData.meta.title)}">
  <meta property="og:title" content="${escapeHtml(graphData.meta.title)} dataset">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <title>${escapeHtml(graphData.meta.title)} dataset</title>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    ${staticThemeCss}
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--page-bg);line-height:1.55}*{box-sizing:border-box}body{margin:0}a{color:var(--link);text-underline-offset:.16em}a:hover{text-decoration-thickness:2px}.page{max-width:1160px;margin:auto;padding:clamp(1rem,4vw,3rem)}.brand{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.brand-logo{width:58px;height:58px;object-fit:contain}.home{font-weight:750;text-decoration:none}.lede{max-width:860px;color:var(--muted);font-size:1.08rem}.links{display:flex;gap:.55rem;flex-wrap:wrap;margin:1.25rem 0}.links a{display:inline-flex;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:.45rem .72rem;text-decoration:none;font-weight:700;font-size:.86rem}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1rem 1.15rem;margin:1rem 0;box-shadow:var(--shadow)}h1,h2{color:var(--heading)}h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.1;margin:.45rem 0}h2{margin:.1rem 0 .55rem;font-size:1.35rem}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;margin-top:1rem}.meta div{border:1px solid var(--line-soft);border-radius:10px;padding:.65rem .75rem;background:var(--panel-2)}.meta dt{font-size:.78rem;font-weight:800;color:var(--muted-2);text-transform:uppercase;letter-spacing:.04em}.meta dd{margin:.18rem 0 0;font-weight:650}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;vertical-align:top;border-top:1px solid var(--line-soft);padding:.8rem .65rem}th[scope=row]{min-width:180px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem;overflow-wrap:anywhere}.notes li+li{margin-top:.4rem}.footer{color:var(--muted-2);font-size:.85rem;padding:1rem 0}@media(max-width:700px){.page{padding:1.25rem 1rem}.table-wrap{margin-inline:-.25rem}}
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div class="brand"><a class="home" href="/" aria-label="Atlas of Fundamental Concepts home"><img class="brand-logo" src="/assets/atlas-logo.png" alt="Atlas of Fundamental Concepts logo" width="58" height="58"></a><a class="home" href="/">Atlas of Fundamental Concepts</a></div>
      <h1>Published dataset</h1>
      <p class="lede">A machine-readable publication of the current authored mAtlas graph. It supports retrieval and deterministic local analysis; it does not provide a remote query service.</p>
      <nav class="links" aria-label="Dataset resources"><a href="/">Open interactive atlas</a><a href="/directory/">Atlas Directory</a><a href="/ai/">AI integration</a><a href="/ai/workbench/">Local AI workbench</a><a href="/llms.txt">llms.txt</a><a href="${dataUrl('manifest.json')}">Data manifest</a><a href="${canonicalUrl}index.html.md">Markdown</a></nav>
    </header>
    <section class="card" aria-labelledby="dataset-overview"><h2 id="dataset-overview">Dataset contract</h2><p>${escapeHtml(graphData.meta.description)}</p><dl class="meta"><div><dt>Content version</dt><dd><code>${escapeHtml(dataManifest.contentVersion)}</code></dd></div><div><dt>Schema version</dt><dd><code>${escapeHtml(dataManifest.schemaVersion)}</code></dd></div><div><dt>License</dt><dd><a href="${escapeHtml(graphData.meta.licenseUrl)}">${escapeHtml(graphData.meta.license)}</a></dd></div><div><dt>Stable manifest</dt><dd><a href="${dataUrl('manifest.json')}">/data/latest/manifest.json</a></dd></div></dl></section>
    <section class="card" aria-labelledby="downloads"><h2 id="downloads">Current downloads</h2><p>The <code>/data/latest/</code> URLs are replaced on each publication. The manifest reports the current content version and SHA-256 digests. Save the manifest and downloaded artifacts when reproducible use requires a retained snapshot.</p><div class="table-wrap"><table><thead><tr><th>Artifact</th><th>URL</th><th>Format, SHA-256, size</th></tr></thead><tbody>${downloads}</tbody></table></div></section>
    <section class="card notes" aria-labelledby="small-records"><h2 id="small-records">Small deterministic records</h2><p>Browser agents and integrations can retrieve individual records without first parsing the entire graph.</p><ul><li>Concept: <code>${escapeHtml(dataManifest.recordEndpoints.concepts.contentUrlTemplate)}</code></li><li>Concept relations: <code>${escapeHtml(dataManifest.recordEndpoints.concepts.relationsUrlTemplate)}</code></li><li>Domain: <code>${escapeHtml(dataManifest.recordEndpoints.domains.contentUrlTemplate)}</code></li><li>Relation type: <code>${escapeHtml(dataManifest.recordEndpoints.relationTypes.contentUrlTemplate)}</code></li></ul></section>
    <section class="card notes" aria-labelledby="use-with-ai"><h2 id="use-with-ai">Use with an AI system</h2><ol><li>Start with the <a href="${dataUrl('manifest.json')}">data manifest</a> or <a href="/llms.txt">llms.txt</a>.</li><li>Resolve names to canonical concept IDs before making graph claims. Direct relations remain authored <code>source → target</code> assertions even when a path traverses an edge backwards.</li><li>Use the published SQLite file or <a href="/ai/sdk/matlas.py">zero-dependency Python library</a> for paths, closures, and subgraphs. Use predecessor and prerequisite traversal exactly as the relation-type metadata defines them.</li><li>For a cited claim, use the canonical concept page and, for a direct edge, its relation fragment; retain the linked external sources attached to that record.</li><li>Do not infer unrecorded graph edges from general knowledge.</li></ol></section>
    <footer class="footer"><p>${escapeHtml(graphData.meta.attribution)} · <a href="${PROJECT_LICENSE_URL}">License</a></p></footer>
  </main>
</body>
</html>`;
}

export async function generateDataPublication({ graphData, viewsData = { views: [] }, provenance, assets, distUrl, lastModified }) {
  const { artifacts, recordFiles } = await createDerivedMachineArtifacts({ graphData, viewsData, provenance });
  const derivedAssets = Object.fromEntries(Object.entries(artifacts).map(([key, bytes]) => [key, { bytes }]));
  const allAssets = { ...assets, ...derivedAssets };
  const dataManifest = buildDataManifest({ graphData, provenance, assets: allAssets, lastModified });
  const latestDirectory = new URL(DATA_LATEST_PATH, distUrl);
  const dataDirectory = new URL(DATA_PAGE_PATH, distUrl);
  const distributionWrites = DATA_DISTRIBUTION_DEFINITIONS.map((definition) => {
    const bytes = allAssets[definition.key]?.bytes;
    if (!bytes) throw new Error(`No bytes were produced for ${definition.key}.`);
    return { pathname: `${DATA_LATEST_PATH}${definition.file}`, bytes };
  });
  const recordWrites = [...recordFiles.entries()].map(([pathname, bytes]) => ({ pathname: `${DATA_LATEST_PATH}${pathname}`, bytes }));
  const writes = [
    ...distributionWrites,
    ...recordWrites,
    { pathname: `${DATA_LATEST_PATH}manifest.json`, bytes: jsonBytes(dataManifest, true) },
    { pathname: `${DATA_PAGE_PATH}index.html`, bytes: Buffer.from(minifyHtml(renderDataPage({ graphData, dataManifest, lastModified })), 'utf8') },
    { pathname: `${DATA_PAGE_PATH}index.html.md`, bytes: Buffer.from(appendTextPublicationMetadata(renderDataMarkdown({ graphData, dataManifest }), graphData, `${DATA_PAGE_PATH}index.html.md`), 'utf8') }
  ];
  const directories = new Set([DATA_PAGE_PATH, DATA_LATEST_PATH, ...writes.map((entry) => outputDirectory(entry.pathname))]);
  await mapWithConcurrency([...directories], (directory) => mkdir(new URL(directory, distUrl), { recursive: true }), 16);
  await mapWithConcurrency(writes, (entry) => writeFile(new URL(entry.pathname, distUrl), entry.bytes));
  return dataManifest;
}

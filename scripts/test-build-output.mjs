import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const graphData = JSON.parse(await readFile(new URL('.build/content/atlas.json', root), 'utf8'));
const viewsData = JSON.parse(await readFile(new URL('.build/content/views.json', root), 'utf8'));
const compiledProvenance = JSON.parse(await readFile(new URL('.build/content/provenance.json', root), 'utf8'));
const shareCodec = JSON.parse(await readFile(new URL('.build/content/share-codec.json', root), 'utf8'));
const removedDomains = JSON.parse(await readFile(new URL('.build/content/removed-domains.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', dist), 'utf8'));
const sitemap = await readFile(new URL('sitemap.xml', dist), 'utf8');
const llms = await readFile(new URL('llms.txt', dist), 'utf8');
const llmsContext = await readFile(new URL('llms-context.txt', dist), 'utf8');
const llmsContextFull = await readFile(new URL('llms-context-full.txt', dist), 'utf8');
const openSearch = await readFile(new URL('opensearch.xml', dist), 'utf8');
const atlasSvg = await readFile(new URL('static/atlas.svg', dist), 'utf8');
const directoryPage = await readFile(new URL('directory/index.html', dist), 'utf8');
const directoryMarkdown = await readFile(new URL('directory/index.html.md', dist), 'utf8');
const guidePage = await readFile(new URL('guide/index.html', dist), 'utf8');
const guideMarkdown = await readFile(new URL('guide/index.html.md', dist), 'utf8');
const conceptsIndex = await readFile(new URL('concepts/index.html', dist), 'utf8');
const conceptsMarkdown = await readFile(new URL('concepts/index.html.md', dist), 'utf8');
const viewIndex = await readFile(new URL('views/index.html', dist), 'utf8');
const viewsMarkdown = await readFile(new URL('views/index.html.md', dist), 'utf8');
const rootMarkdown = await readFile(new URL('index.html.md', dist), 'utf8');
const appIndex = await readFile(new URL('index.html', dist), 'utf8');
const dataManifest = JSON.parse(await readFile(new URL('data/latest/manifest.json', dist), 'utf8'));
const dataPage = await readFile(new URL('data/index.html', dist), 'utf8');
const dataMarkdown = await readFile(new URL('data/index.html.md', dist), 'utf8');
const citationCff = await readFile(new URL('CITATION.cff', dist), 'utf8');
const citation = JSON.parse(await readFile(new URL('citation.json', dist), 'utf8'));
const openApi = JSON.parse(await readFile(new URL('openapi.json', dist), 'utf8'));
const aiPage = await readFile(new URL('ai/index.html', dist), 'utf8');
const aiMarkdown = await readFile(new URL('ai/index.html.md', dist), 'utf8');
const aiSkill = await readFile(new URL('ai/skills/matlas/SKILL.md', dist), 'utf8');
const workbenchPage = await readFile(new URL('ai/workbench/index.html', dist), 'utf8');
const aiBundle = await readFile(new URL('ai/matlas-ai-bundle.zip', dist));
const vocabularyPage = await readFile(new URL('vocab/index.html', dist), 'utf8');
const vocabularyMarkdown = await readFile(new URL('vocab/index.html.md', dist), 'utf8');
const vocabularyJson = JSON.parse(await readFile(new URL('vocab/matlas.jsonld', dist), 'utf8'));

async function assertMissing(url, message) {
  try {
    await access(url);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(message);
}

const recoveryParameter = '__atlas_refresh';
function assertCacheRecovery(html, pageLabel) {
  const bootstrapIndex = html.indexOf('__atlasRecovery');
  const stylesheetIndex = html.indexOf('data-atlas-critical-asset="stylesheet"');
  const scriptIndex = html.indexOf('data-atlas-critical-asset="script"');
  if (!html.includes(`<meta name="atlas:cache-bust-param" content="${recoveryParameter}">`)) throw new Error(`${pageLabel} lacks the cache-recovery parameter declaration.`);
  if (bootstrapIndex < 0 || stylesheetIndex < 0 || scriptIndex < 0 || bootstrapIndex > stylesheetIndex || bootstrapIndex > scriptIndex) throw new Error(`${pageLabel} does not install cache recovery before critical assets load.`);
  const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((match) => match[1]);
  if (!canonicals.length || canonicals.some((href) => href.includes(recoveryParameter))) throw new Error(`${pageLabel} has a missing or cache-polluted canonical URL.`);
}

const svgMetadataFragment = '<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#"><rdf:Description rdf:about=""><dc:creator>Advay Mengle</dc:creator><dc:title>mAtlas - Atlas of Fundamental Concepts</dc:title><dc:rights>mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/</dc:rights><cc:license rdf:resource="https://creativecommons.org/licenses/by-sa/4.0/"/></rdf:Description></rdf:RDF></metadata>';
function assertSvgMetadata(svg, label) {
  if (!svg.includes(svgMetadataFragment)) throw new Error(`${label} lacks the required RDF/Dublin Core/Creative Commons metadata.`);
}

function svgDimensions(svg, label) {
  const match = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
  if (!match) throw new Error(`${label} lacks integer width and height attributes.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

assertCacheRecovery(appIndex, 'The application root');

if (!appIndex.includes('rel="search" type="application/opensearchdescription+xml"')) throw new Error('The application does not advertise OpenSearch discovery.');
if (!appIndex.includes('class="skip-link"')) throw new Error('The application lacks a keyboard skip link.');
if (!openSearch.includes('<OpenSearchDescription') || !openSearch.includes('?q={searchTerms}')) throw new Error('opensearch.xml is incomplete.');
if (manifest.version !== 6) throw new Error('asset-manifest.json does not use the AI-publication content format.');
for (const key of ['graph', 'schema', 'views', 'shareCodec', 'provenance']) {
  if (!manifest.assets?.[key]?.startsWith('content/')) throw new Error(`asset-manifest.json does not publish ${key} under content/.`);
}
const publishedShareCodec = JSON.parse(await readFile(new URL(manifest.assets.shareCodec, dist), 'utf8'));
if (JSON.stringify(publishedShareCodec) !== JSON.stringify(shareCodec)) throw new Error('The published share codec differs from compiled content.');
if (!appIndex.includes(manifest.assets.shareCodec)) throw new Error('The application page does not link to the published share codec.');
if (manifest.assets?.data?.landing !== 'data/' || manifest.assets.data.manifest !== 'data/latest/manifest.json' || manifest.assets.data.sqlite !== 'data/latest/matlas.sqlite' || manifest.assets.data.jsonld !== 'data/latest/matlas.jsonld') throw new Error('asset-manifest.json does not expose the stable data publication.');
if (manifest.assets?.ai?.landing !== 'ai/' || manifest.assets.ai.bundle !== 'ai/matlas-ai-bundle.zip' || manifest.assets.ai.workbench !== 'ai/workbench/' || manifest.assets.ai.pythonSdk !== 'ai/sdk/matlas.py' || manifest.assets.ai.vocabulary !== 'vocab/' || manifest.assets.ai.vocabularyJsonLd !== 'vocab/matlas.jsonld' || !manifest.assets.ai.workbenchScript?.startsWith('assets/ai-workbench.')) throw new Error('asset-manifest.json does not expose the static AI integration publication.');
if (manifest.assets?.markdown?.directory !== 'directory/index.html.md' || manifest.assets?.llms?.contextFull !== 'llms-context-full.txt') throw new Error('asset-manifest.json does not expose the Markdown and AI-context publication routes.');
if (dataManifest.formatVersion !== 2 || dataManifest.contentVersion !== compiledProvenance.contentVersion || dataManifest.schemaVersion !== compiledProvenance.schemaVersion || dataManifest.license?.attribution !== graphData.meta.attribution || dataManifest.retention?.urlStability !== 'latest-only' || dataManifest.retention?.versionedSnapshots !== false) throw new Error('The current data manifest has the wrong content contract versions, license metadata, or retention policy.');
for (const [key, compiledFile] of [['atlas', 'atlas.json'], ['schema', 'schema.json'], ['views', 'views.json'], ['shareCodec', 'share-codec.json'], ['provenance', 'provenance.json']]) {
  const distribution = dataManifest.distributions?.[key];
  if (!distribution?.contentUrl?.endsWith(`/data/latest/${key === 'shareCodec' ? 'share-codec' : key}.json`) && !(key === 'provenance' && distribution?.contentUrl?.endsWith('/data/latest/provenance.json'))) throw new Error(`The stable data manifest lacks ${key}.`);
  const stableBytes = await readFile(new URL(`data/latest/${compiledFile}`, dist), 'utf8');
  const compiledBytes = await readFile(new URL(`.build/content/${compiledFile}`, root), 'utf8');
  if (stableBytes !== compiledBytes) throw new Error(`Stable ${key} data differs from its compiled content artifact.`);
}
for (const [key, file] of [['conceptsNdjson', 'concepts.ndjson'], ['relationsNdjson', 'relations.ndjson'], ['sourcesNdjson', 'sources.ndjson'], ['domainsNdjson', 'domains.ndjson'], ['fieldsNdjson', 'fields.ndjson'], ['relationTypesNdjson', 'relation-types.ndjson'], ['sqlite', 'matlas.sqlite'], ['jsonld', 'matlas.jsonld'], ['turtle', 'matlas.ttl']]) {
  const distribution = dataManifest.distributions?.[key];
  if (!distribution?.contentUrl?.endsWith(`/data/latest/${file}`) || 'versionUrl' in distribution || 'immutableUrl' in distribution || !/^[0-9a-f]{64}$/.test(distribution.sha256 ?? '')) throw new Error(`The current data manifest lacks a valid ${key} distribution.`);
  await access(new URL(`data/latest/${file}`, dist));
}
const sqliteBytes = await readFile(new URL('data/latest/matlas.sqlite', dist));
if (sqliteBytes.subarray(0, 16).toString('utf8') !== 'SQLite format 3\u0000') throw new Error('The published SQLite distribution is not a SQLite database.');
const conceptNdjson = await readFile(new URL('data/latest/concepts.ndjson', dist), 'utf8');
if (!conceptNdjson.startsWith('{') || !conceptNdjson.includes('"recordType":"publication_metadata"') || !conceptNdjson.includes(graphData.meta.attribution)) throw new Error('The concept NDJSON distribution lacks publication metadata and attribution.');
const jsonld = JSON.parse(await readFile(new URL('data/latest/matlas.jsonld', dist), 'utf8'));
const turtle = await readFile(new URL('data/latest/matlas.ttl', dist), 'utf8');
if (jsonld['@type'] !== 'matlas:AtlasGraph' || !Array.isArray(jsonld['@graph']) || !turtle.includes(graphData.meta.attribution)) throw new Error('The RDF graph distributions lack their graph contract or attribution.');
if (!dataManifest.recordEndpoints?.concepts?.contentUrlTemplate?.includes('{conceptId}') || !dataManifest.recordEndpoints?.concepts?.relationsUrlTemplate?.includes('{conceptId}') || !dataManifest.recordEndpoints?.domains?.contentUrlTemplate?.includes('{domainId}') || !dataManifest.recordEndpoints?.relationTypes?.contentUrlTemplate?.includes('{relationTypeId}')) throw new Error('The stable data manifest lacks predictable per-record endpoints.');
if (!dataPage.includes('"@type":"Dataset"') || !dataPage.includes('"@type":"DataDownload"') || !dataPage.includes('data/latest/manifest.json')) throw new Error('The dataset landing page lacks Dataset/DataDownload structured data or its stable manifest link.');
if (!dataPage.includes('rel="alternate" type="text/markdown"') || !dataMarkdown.includes('## Current downloads')) throw new Error('The dataset landing page lacks its Markdown equivalent.');
if (!dataPage.includes('https://github.com/madvay/mAtlas/blob/main/LICENSE')) throw new Error('The dataset landing-page footer lacks the repository license.');
await assertMissing(new URL(`data/${encodeURIComponent(dataManifest.contentVersion)}/manifest.json`, dist), 'A non-retained versioned data manifest was published.');
if (!citationCff.includes(`version: "${dataManifest.contentVersion}"`) || !citationCff.includes(graphData.meta.attribution) || citation.copyrightNotice !== graphData.meta.attribution || citation.license !== graphData.meta.licenseUrl) throw new Error('The published citation metadata lacks version, license, or attribution.');
if (openApi.openapi !== '3.1.0' || openApi['x-matlas-static-only'] !== true || !openApi.paths?.['/data/latest/concepts/{conceptId}.json']?.get || !openApi.paths?.['/data/latest/concepts/{conceptId}/relations.json']?.get || Object.values(openApi.paths ?? {}).some((pathItem) => Object.keys(pathItem).some((method) => method !== 'get'))) throw new Error('The OpenAPI document does not describe only static GET resources.');
if (!aiPage.includes('matlas-ai-bundle.zip') || !aiPage.includes(graphData.meta.attribution) || !aiMarkdown.includes('Browser-local workbench') || !aiSkill.includes('name: matlas') || !aiSkill.includes(graphData.meta.attribution)) throw new Error('The AI landing page, Markdown, or Agent Skill lacks its integration contract or attribution.');
if (!aiPage.includes('https://github.com/madvay/mAtlas/blob/main/LICENSE') || !workbenchPage.includes('https://github.com/madvay/mAtlas/blob/main/LICENSE')) throw new Error('The AI and workbench footers lack the repository license.');
for (const text of [aiMarkdown, aiSkill]) if (!text.includes('License URL: https://github.com/madvay/mAtlas/blob/main/LICENSE')) throw new Error('Mixed software/content Markdown must link to the repository license.');
if (!vocabularyPage.includes(graphData.meta.attribution) || !vocabularyPage.includes(graphData.meta.licenseUrl) || !vocabularyMarkdown.includes('## Relation types') || !vocabularyMarkdown.includes(`License URL: ${graphData.meta.licenseUrl}`) || vocabularyJson['@type'] !== 'DefinedTermSet' || !Array.isArray(vocabularyJson.hasDefinedTerm)) throw new Error('The relation vocabulary lacks a published, CC BY-SA-attributed controlled-vocabulary contract.');
if (!workbenchPage.includes('data-atlas-url="/data/latest/atlas.json"') || !workbenchPage.includes('toolname="search_concepts"') || !workbenchPage.includes('toolname="find_paths"') || !workbenchPage.includes(`src="/${manifest.assets.ai.workbenchScript}"`)) throw new Error('The static workbench lacks accessible local-data or progressive-tool integration.');
if (aiBundle.subarray(0, 4).toString('binary') !== 'PK\u0003\u0004') throw new Error('The AI bundle is not a ZIP archive.');
const aiBundleText = aiBundle.toString('utf8');
for (const pathname of ['README.md', 'SKILL.md', 'CITATION.cff', 'LICENSE', 'CONTENT_LICENSE', 'openapi.json', 'data/matlas.sqlite', 'data/matlas.jsonld', 'data/matlas.ttl', 'sdk/matlas.py', 'sdk/matlas.mjs']) {
  if (!aiBundleText.includes(pathname)) throw new Error(`The AI bundle omits ${pathname}.`);
}
await assertMissing(new URL('content/removed-domains.json', dist), 'Build-only removed-domain metadata was published at runtime.');
if ('removedDomains' in (manifest.assets ?? {})) throw new Error('asset-manifest.json exposes build-only removed-domain metadata.');
if (graphData.domains.foundation) throw new Error('Foundation remains an active runtime domain.');
if (graphData.nodes.some((node) => node.primaryDomain === 'foundation' || node.domains.includes('foundation'))) throw new Error('A runtime node still references the removed Foundation domain.');
if (manifest.content?.schemaVersion !== compiledProvenance.schemaVersion || manifest.content?.contentVersion !== compiledProvenance.contentVersion) throw new Error('asset-manifest.json does not expose the compiled content contract versions.');
const expectedBuildSha = [process.env.BUILD_SHA, process.env.GITHUB_SHA, process.env.VERCEL_GIT_COMMIT_SHA, process.env.CF_PAGES_COMMIT_SHA]
  .find((value) => /^[0-9a-f]{7,64}$/i.test(value ?? ''));
if (expectedBuildSha && !appIndex.includes(`cv${compiledProvenance.contentVersion} sv${compiledProvenance.schemaVersion} <a href="https://github.com/madvay/mAtlas/commit/${expectedBuildSha.toLowerCase()}"`)) throw new Error('The Data section does not expose the content, schema, and build versions.');
if (expectedBuildSha && !appIndex.includes(`git#${expectedBuildSha.slice(0, 7).toLowerCase()}</a>`)) throw new Error('The Data section does not display the short build SHA.');
if (!manifest.assets?.views) throw new Error('asset-manifest.json does not include the hashed views data asset.');
if (!manifest.assets?.provenance) throw new Error('asset-manifest.json does not include the hashed content provenance asset.');
if (manifest.assets?.contentLicense !== 'CONTENT_LICENSE') throw new Error('asset-manifest.json does not expose the content license notice.');
if (!manifest.assets?.css) throw new Error('asset-manifest.json does not include the application stylesheet.');
if (manifest.assets?.atlasSvg !== 'static/atlas.svg') throw new Error('asset-manifest.json does not expose the stable static/atlas.svg path.');
if (Object.keys(manifest.assets?.fieldSvgs ?? {}).length !== Object.keys(graphData.fields).length) throw new Error('asset-manifest.json does not expose one SVG path per field.');
if (Object.keys(manifest.assets?.domainSvgs ?? {}).length !== Object.keys(graphData.domains).length) throw new Error('asset-manifest.json does not expose one SVG path per domain.');
if (manifest.assets?.guide !== 'guide/') throw new Error('asset-manifest.json does not expose the stable guide/ page.');
if (manifest.assets?.directory !== 'directory/') throw new Error('asset-manifest.json does not expose the stable directory/ page.');
if ('atlasPage' in (manifest.assets ?? {})) throw new Error('asset-manifest.json still exposes the retired atlasPage entry.');
if ('searchIndex' in (manifest.assets ?? {})) throw new Error('asset-manifest.json still exposes the removed search index.');
await assertMissing(new URL('content/search-index.json', dist), 'The removed public search index was still emitted.');
await access(new URL(manifest.assets.views, dist));
const publishedSchema = JSON.parse(await readFile(new URL(manifest.assets.schema, dist), 'utf8'));
if (publishedSchema.$id !== 'https://atlas.madvay.com/content/schema.json') throw new Error('Published schema has the wrong canonical identifier.');
const publishedProvenance = JSON.parse(await readFile(new URL(manifest.assets.provenance, dist), 'utf8'));
if (JSON.stringify(publishedProvenance) !== JSON.stringify(compiledProvenance)) throw new Error('Published content provenance differs from the compiled provenance.');
const contentLicense = await readFile(new URL(manifest.assets.contentLicense, dist), 'utf8');
if (!contentLicense.includes('CC BY-SA 4.0') || !contentLicense.includes('Advay Mengle')) throw new Error('Published content license notice is incomplete.');
await access(new URL(manifest.assets.atlasSvg, dist));
await access(new URL(`${manifest.assets.directory}index.html`, dist));
const appCss = await readFile(new URL(manifest.assets.css, dist), 'utf8');
const appJs = await readFile(new URL(manifest.assets.app, dist), 'utf8');
const materialSymbolAssets = `${appIndex}
${appCss}
${appJs}`;
const legacyIconPattern = new RegExp(`${['material', 'icons'].join('-')}|${['Material', 'Icons'].join(' ')}`);
if (!/Material\+Symbols\+Outlined(?:&amp;|&)display=block/.test(appIndex)) throw new Error('The application does not load Material Symbols Outlined with blocking font display.');
if (!appCss.includes('.material-symbols-outlined') || !/font-family:(?:\"Material Symbols Outlined\"|Material Symbols Outlined)/.test(appCss)) throw new Error('The application stylesheet lacks the Material Symbols Outlined rendering contract.');
if (legacyIconPattern.test(materialSymbolAssets)) throw new Error('The built application still contains a legacy icon-font reference.');
if (!appJs.includes('./content/') || appJs.includes('./data/')) throw new Error('The application bundle does not read runtime JSON exclusively from ./content/.');
if (!appIndex.includes('id="mobileViewContext"')) throw new Error('The application template lacks the mobile guided-view context host.');
if (!appIndex.includes('id="searchResults"') || !appIndex.includes('role="combobox"')) throw new Error('The application template lacks the accessible search suggestions UI.');
if (appIndex.includes('id="conceptNames"')) throw new Error('The application still contains the retired empty search datalist.');
if (!appIndex.includes('href="/directory/"')) throw new Error('The application omits the atlas directory link.');
if (!appIndex.includes('href="/data/"')) throw new Error('The application omits the published dataset link.');
if (!appIndex.includes('href="/ai/"') || !appIndex.includes('href="/ai/workbench/"')) throw new Error('The application omits the static AI integration or local workbench links.');
if (!appIndex.includes('rel="alternate" type="text/markdown" href="https://atlas.madvay.com/index.html.md"')) throw new Error('The application root does not advertise its Markdown equivalent.');
if (appIndex.includes('href="/static/atlas/"')) throw new Error('The application still links to the retired static atlas page.');
if (!appIndex.includes('href="/guide/"')) throw new Error('The application does not link to the user guide.');
if (!appIndex.includes('href="/static/atlas.svg"')) throw new Error('The application data panel omits the stable all-in SVG link.');
if (!appIndex.includes(`href="./${manifest.assets.provenance}"`) || !appIndex.includes('href="/CONTENT_LICENSE"')) throw new Error('The application data panel omits content provenance or licensing links.');
if (!appIndex.includes('<noscript>') || !appIndex.includes('Open the atlas directory')) throw new Error('The application lacks its no-JavaScript directory fallback.');
if ((appIndex.match(/data-filter-section-toggle/g) ?? []).length !== 5) throw new Error('The application template lacks the five collapsible filter subsections.');
const displaySectionStart = appIndex.indexOf('id="displayFilterSection"');
const displaySectionEnd = appIndex.indexOf('</section>', displaySectionStart);
if (displaySectionStart < 0 || !appIndex.slice(displaySectionStart, displaySectionEnd).includes('id="layoutSelect"')) throw new Error('The layout selector is not inside the Display filter subsection.');
const topbarStart = appIndex.indexOf('<header class="topbar">');
const topbarEnd = appIndex.indexOf('</header>', topbarStart);
if (topbarStart < 0 || topbarEnd < 0 || appIndex.slice(topbarStart, topbarEnd).includes('id="layoutSelect"')) throw new Error('The layout selector leaked back into the top toolbar.');
const layoutSelect = appIndex.match(/<select id="layoutSelect"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? '';
const layoutOptions = [...layoutSelect.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((match) => [match[1], match[2]]);
if (JSON.stringify(layoutOptions) !== JSON.stringify([['atlas', 'Layered'], ['breadthfirst', 'Packed'], ['domains', 'Domains'], ['fields', 'Fields']])) throw new Error('The built layout selector does not expose the supported layouts in canonical order.');
for (const fieldId of graphData.meta.fieldOrder) {
  const field = graphData.fields[fieldId];
  if (!appIndex.includes(`href="/${field.path}/" data-scope-link="${fieldId}">${field.label}</a>`)) throw new Error(`The built scope navigation omits ${fieldId}.`);
}
const filterToggles = [...appIndex.matchAll(/<button[^>]*data-filter-section-toggle[^>]*>/g)].map((match) => match[0]);
if (filterToggles.length !== 5 || filterToggles.some((toggle) => !toggle.includes('aria-expanded="true"') || !/aria-controls="[^"]+"/.test(toggle))) throw new Error('Filter subsections must build expanded with valid collapse targets.');
if (!/\.filter-section-body\[hidden\]\{display:none(?:!important)?\}/.test(appCss) || !appCss.includes('.filter-section-toggle[aria-expanded=false]')) throw new Error('The built stylesheet does not implement collapsible filter sections.');
if (/hideIsolated|Hide isolated|hide-isolated/.test(`${appIndex}\n${appCss}`)) throw new Error('The retired isolated-node display option remains in the built application.');
const edgeLabelsToggle = appIndex.match(/<input[^>]*id="edgeLabelsToggle"[^>]*>/)?.[0] ?? appIndex.match(/<[^>]*id="edgeLabelsToggle"[^>]*>/)?.[0] ?? '';
if (!edgeLabelsToggle.includes('type="checkbox"') || /showGraphEdgeLabelsToggle|Show graph edge labels/.test(appIndex)) throw new Error('Edge annotations are not the sole edge-label control.');
for (const id of ['highlightPrerequisitesToggle', 'experimentalFeaturesToggle']) {
  const tag = appIndex.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
  if (!tag.includes('type="checkbox"') || /\schecked(?:=|\s|>)/.test(tag)) throw new Error(`${id} must be an opt-in checkbox in the built application.`);
}
const compareButton = appIndex.match(/<[^>]*id="compareButton"[^>]*>/)?.[0] ?? '';
if (!compareButton.includes('hidden') || !compareButton.includes('aria-haspopup="dialog"') || !compareButton.includes('aria-pressed="false"')) throw new Error('Compare must build hidden and dialog-capable by default.');
if (/id="semanticMapButton"|id="semanticMapDialog"|id="connectionButton"|id="connectionDialog"/.test(appIndex)) throw new Error('A retired comparison or structure-map dialog remains in the built application.');
const toolbarLayouts = [...appIndex.matchAll(/data-toolbar-layout="([^"]+)"/g)].map((match) => match[1]);
if (JSON.stringify(toolbarLayouts) !== JSON.stringify(['atlas', 'domains', 'fields', 'breadthfirst'])) throw new Error('The layout toolbar does not expose all supported layout commands.');
if (!appIndex.includes('data-compare-mode="overview"') || !appIndex.includes('data-compare-mode="connections"') || !appIndex.includes('id="compareCopySequenceButton"')) throw new Error('The Compare dialog lacks overview, connection, or sequence-copy surfaces.');
const compareDirection = appIndex.match(/<select id="compareDirection"[\s\S]*?<\/select>/)?.[0] ?? '';
if (!compareDirection.includes('value="either">Either direction; preserve arrow meaning') || !compareDirection.includes('value="forward">Follow A → B arrows only')) throw new Error('Compare direction choices do not preserve authored arrow semantics.');
for (const id of ['compareDialog', 'compareLeftInput', 'compareRightInput', 'compareCopyButton']) {
  if (!appIndex.includes(`id="${id}"`)) throw new Error(`The built comparison workspace omits ${id}.`);
}
if (!appIndex.includes('id="compareLeftInput" list="compareConceptNames"') || !appIndex.includes('id="compareRightInput" list="compareConceptNames"')) throw new Error('Comparison inputs are not connected to the concept-name datalist.');
let dialogDepth = 0;
for (const token of appIndex.matchAll(/<dialog\b|<\/dialog>/g)) {
  if (token[0].startsWith('</')) dialogDepth -= 1;
  else dialogDepth += 1;
  if (dialogDepth < 0 || dialogDepth > 1) throw new Error('Built modal dialogs are nested or unbalanced.');
}
if (dialogDepth !== 0) throw new Error('Built modal dialogs are unbalanced.');
if (!appCss.includes('.compare-columns') || !appCss.includes('.compare-neighbor-row') || !appCss.includes('.data-version')) throw new Error('The built stylesheet lacks comparison or data-version surfaces.');
if (!appIndex.includes('<body class="atlas-loading">') || !appIndex.includes('id="graphLoader"')) throw new Error('The built application does not hide the unfit graph viewport during startup.');
if (!appCss.includes('.static-graph-shimmer') || !appCss.includes('@keyframes static-graph-shimmer') || !appCss.includes('prefers-reduced-motion:reduce')) throw new Error('The built stylesheet lacks the taxonomy-image loading shimmer or reduced-motion override.');
if (!appCss.includes('.graph-domain-marker-canvas') || appCss.includes('.graph-domain-markers') || appCss.includes('will-change:transform')) throw new Error('The built domain-marker layer does not use the single-canvas implementation.');
for (const id of ['layeredLayoutButton', 'compactLayoutButton']) {
  if (!appIndex.includes(`id="${id}"`) || !appIndex.includes(`data-toolbar-layout`)) throw new Error(`The application toolbar lacks ${id}.`);
}
if (!appJs.includes('prohibitedDomains') || !appJs.includes('data-suppression')) throw new Error('The application bundle lacks prohibited-domain state or its tri-state control.');
if (!appCss.includes('.mobile-view-context') || !appCss.includes('.view-banner-mobile')) throw new Error('The application stylesheet lacks the thin-screen guided-view surfaces.');
if (!appCss.includes('.view-sequence-controls') || !appCss.includes('.filter-section-toggle')) throw new Error('The application stylesheet lacks guided-sequence or collapsible-filter controls.');
if (!appCss.includes('.graph-overlay-layer') || !appCss.includes('.graph-overlay-viewport')) throw new Error('The application stylesheet lacks the graph overlay layer.');
if (!viewIndex.includes('Stories &amp; Views') || !viewIndex.includes('rel="alternate" type="text/markdown" href="https://atlas.madvay.com/views/index.html.md"') || !viewsMarkdown.includes('Views apply curated filters')) throw new Error('The static stories and views directory or its Markdown equivalent was not generated.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/views/</loc>')) throw new Error('The sitemap omits the view directory.');
if (!sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')) throw new Error('The sitemap lacks the image sitemap namespace.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/guide/</loc>')) throw new Error('The sitemap omits guide/.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/directory/</loc>')) throw new Error('The sitemap omits directory/.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/data/</loc>')) throw new Error('The sitemap omits the dataset landing page.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/ai/</loc>')) throw new Error('The sitemap omits the AI integration landing page.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/vocab/</loc>')) throw new Error('The sitemap omits the relation vocabulary landing page.');
if (sitemap.includes('<loc>https://atlas.madvay.com/static/atlas/</loc>')) throw new Error('The sitemap still lists the retired static atlas page.');
if (sitemap.includes('<loc>https://atlas.madvay.com/concepts/</loc>')) throw new Error('The sitemap lists the redirect-only concepts index instead of directory/.');
if (!sitemap.includes('<image:image><image:loc>https://atlas.madvay.com/static/atlas.svg</image:loc></image:image>')) throw new Error('The sitemap does not associate static/atlas.svg with its HTML landing page.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/static/atlas.svg</loc>')) throw new Error('The sitemap omits static/atlas.svg.');
if (!sitemap.includes('<lastmod>')) throw new Error('The sitemap lacks last-modified dates.');
if (!llms.includes('[User Guide](https://atlas.madvay.com/guide/)')) throw new Error('llms.txt omits guide/.');
if (!llms.includes('[Atlas Directory](https://atlas.madvay.com/directory/)')) throw new Error('llms.txt omits directory/.');
if (!llms.includes('[Dataset landing page](https://atlas.madvay.com/data/)')) throw new Error('llms.txt omits the dataset landing page.');
if (!llms.includes('[Current data manifest](https://atlas.madvay.com/data/latest/manifest.json)') || !llms.includes('latest-only')) throw new Error('llms.txt omits the current data manifest or retention policy.');
if (!llms.includes('[AI integration](https://atlas.madvay.com/ai/)') || !llms.includes('[AI bundle](https://atlas.madvay.com/ai/matlas-ai-bundle.zip)') || !llms.includes('[Browser-local AI workbench](https://atlas.madvay.com/ai/workbench/)') || !llms.includes('[Static OpenAPI description](https://atlas.madvay.com/openapi.json)') || !llms.includes('[Relation vocabulary](https://atlas.madvay.com/vocab/)')) throw new Error('llms.txt omits the static AI integration entry points.');
if (!llms.includes('[Concise AI context](https://atlas.madvay.com/llms-context.txt)') || !llms.includes('[Complete AI context](https://atlas.madvay.com/llms-context-full.txt)')) throw new Error('llms.txt omits the generated AI contexts.');
if (llms.includes('https://atlas.madvay.com/static/atlas/')) throw new Error('llms.txt still references the retired static atlas page.');
if (!llms.includes('[All-in atlas SVG](https://atlas.madvay.com/static/atlas.svg)')) throw new Error('llms.txt omits static/atlas.svg.');
if (llms.includes('Current immutable graph JSON') || llms.includes('/data/<content-version>/')) throw new Error('llms.txt promises retained versioned data that GitHub Pages does not keep.');
if (!llmsContext.includes('## Relation types') || !llmsContext.includes('## Canonical concept summaries')) throw new Error('llms-context.txt lacks relation semantics or concept summaries.');
if (!llmsContextFull.includes('# Complete concept records') || !llmsContextFull.includes('Incoming relations (arrows to this concept)')) throw new Error('llms-context-full.txt lacks complete direct relation records.');
if (!directoryPage.includes('href="/guide/"')) throw new Error('The directory page does not link to the user guide.');
if (!directoryPage.includes(`href="/${manifest.assets.graph}"`) || !directoryPage.includes('href="/data/"')) throw new Error('The directory page does not link to graph JSON under /content/ and the dataset landing page.');
if (!atlasSvg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) throw new Error('static/atlas.svg is not the runtime SVG export format.');
if (!atlasSvg.includes('<title id="atlas-title">') || !atlasSvg.endsWith('</svg>')) throw new Error('static/atlas.svg is incomplete.');
assertSvgMetadata(atlasSvg, 'static/atlas.svg');
const structureCount = graphData.nodes.filter((node) => node.kind === 'structure').length;
const junctionCount = graphData.nodes.length - structureCount;
const exportedConceptLinks = atlasSvg.match(/<a href="https:\/\/atlas\.madvay\.com\/concepts\//g)?.length ?? 0;
if (exportedConceptLinks !== structureCount) throw new Error(`static/atlas.svg contains ${exportedConceptLinks} concept links; expected ${structureCount}.`);
const exportedJunctionLinks = atlasSvg.match(/<a href="https:\/\/atlas\.madvay\.com\/\?node=/g)?.length ?? 0;
if (exportedJunctionLinks !== junctionCount) throw new Error(`static/atlas.svg contains ${exportedJunctionLinks} junction links; expected ${junctionCount}.`);
const exportedRelationPaths = atlasSvg.match(/<path d="M [^"]+" fill="none" stroke=/g)?.length ?? 0;
if (exportedRelationPaths !== graphData.edges.length) throw new Error(`static/atlas.svg contains ${exportedRelationPaths} relations; expected ${graphData.edges.length}.`);
const exportedMathLabels = atlasSvg.match(/<foreignObject /g)?.length ?? 0;
if (exportedMathLabels !== 0 || /katex|foreignObject|requiredExtensions|data:font\//i.test(atlasSvg)) throw new Error('static/atlas.svg must use lightweight Unicode labels without KaTeX or HTML overlays.');

const atlasSvgFragment = atlasSvg.replace(/^\uFEFF?\s*<\?xml\s+[^?]*\?>\s*/i, '').trim();
if (!directoryPage.includes(atlasSvgFragment)) throw new Error('directory/index.html does not transclude the exact generated SVG document.');
if (!guidePage.includes('<link rel="canonical" href="https://atlas.madvay.com/guide/">')) throw new Error('The guide page has the wrong canonical URL.');
if (!guidePage.includes('prefers-color-scheme: dark') || !guidePage.includes('<dt>Theme</dt>')) throw new Error('The guide page does not follow or document the site theme preference.');
if ((guidePage.match(/class="guide-section"/g) ?? []).length !== 13) throw new Error('The guide page does not contain the complete section set.');
for (const text of ['Quick start', 'Read the graph', 'Stories and Views', 'Compare and connect', 'Permalinks and export', 'Keyboard and mobile']) {
  if (!guidePage.includes(text)) throw new Error(`The guide page omits ${text}.`);
}
if (!guidePage.includes('https://atlas.madvay.com/concepts/group/') || !guidePage.includes('views/from-sets-to-spaces/?node=topological_space')) throw new Error('The guide page lacks genuine content permalinks.');
if (!guidePage.includes('filter=') || !guidePage.includes('disp=')) throw new Error('The guide page lacks compact application-state permalinks.');
if (!directoryPage.includes('<link rel="canonical" href="https://atlas.madvay.com/directory/">')) throw new Error('The directory page has the wrong canonical URL.');
if (!directoryPage.includes('rel="alternate" type="text/markdown" href="https://atlas.madvay.com/directory/index.html.md"')) throw new Error('The directory page does not advertise its Markdown equivalent.');
if (!directoryPage.includes('"primaryImageOfPage"') || !directoryPage.includes('"ImageObject"')) throw new Error('The directory page lacks primary-image structured data.');
if (!directoryPage.includes('Browse all') || !directoryPage.includes('Relation legend:')) throw new Error('The directory page lacks its semantic concept and relation directories.');
const directoryBeforeSvg = directoryPage.slice(0, directoryPage.indexOf('<svg '));
if (!directoryBeforeSvg.includes('<math')) throw new Error('The directory concept list does not render explicit inline mathematics.');
const firstConcept = graphData.nodes.find((node) => node.kind === 'structure');
const firstConceptLink = firstConcept ? `href="/concepts/${encodeURIComponent(firstConcept.id)}/"` : '';
if (!firstConceptLink || directoryPage.indexOf(firstConceptLink) < 0 || directoryPage.indexOf(firstConceptLink) > directoryPage.indexOf('<svg ')) throw new Error('Crawlable concept links must appear before the inline SVG.');
const firstConceptRecord = JSON.parse(await readFile(new URL(`data/latest/concepts/${encodeURIComponent(firstConcept.id)}.json`, dist), 'utf8'));
const firstConceptRelations = JSON.parse(await readFile(new URL(`data/latest/concepts/${encodeURIComponent(firstConcept.id)}/relations.json`, dist), 'utf8'));
if (firstConceptRecord.recordType !== 'concept' || firstConceptRecord.concept?.id !== firstConcept.id || firstConceptRecord.contentVersion !== dataManifest.contentVersion || firstConceptRecord.attribution !== graphData.meta.attribution || firstConceptRelations.recordType !== 'concept_relations' || !Array.isArray(firstConceptRelations.incoming) || !Array.isArray(firstConceptRelations.outgoing)) throw new Error('The predictable concept record endpoints lack the generated concept contract.');
const [firstDomainId] = graphData.meta.domainOrder;
const [firstRelationTypeId] = graphData.meta.edgeTypeOrder;
const domainRecord = JSON.parse(await readFile(new URL(`data/latest/domains/${encodeURIComponent(firstDomainId)}.json`, dist), 'utf8'));
const relationTypeRecord = JSON.parse(await readFile(new URL(`data/latest/relation-types/${encodeURIComponent(firstRelationTypeId)}.json`, dist), 'utf8'));
const relationVocabularyPage = await readFile(new URL(`vocab/relation/${encodeURIComponent(firstRelationTypeId)}/index.html`, dist), 'utf8');
const relationVocabularyMarkdown = await readFile(new URL(`vocab/relation/${encodeURIComponent(firstRelationTypeId)}/index.html.md`, dist), 'utf8');
if (domainRecord.recordType !== 'domain' || domainRecord.domain?.id !== firstDomainId || !Array.isArray(domainRecord.conceptIds) || relationTypeRecord.recordType !== 'relation_type' || relationTypeRecord.relationType?.id !== firstRelationTypeId || !Array.isArray(relationTypeRecord.relationIds) || !relationVocabularyPage.includes(firstRelationTypeId) || !relationVocabularyPage.includes(graphData.meta.attribution) || !relationVocabularyPage.includes(graphData.meta.licenseUrl) || !relationVocabularyMarkdown.includes('## Directed semantics') || !relationVocabularyMarkdown.includes(`License URL: ${graphData.meta.licenseUrl}`) || !sitemap.includes(`<loc>https://atlas.madvay.com/vocab/relation/${encodeURIComponent(firstRelationTypeId)}/</loc>`)) throw new Error('The predictable domain, relation-type, or vocabulary endpoints lack generated CC BY-SA records.');
if (!directoryMarkdown.includes('## Relation types') || !directoryMarkdown.includes('## Canonical concepts')) throw new Error('The directory Markdown equivalent lacks atlas semantics or concepts.');
if (!guidePage.includes('rel="alternate" type="text/markdown" href="https://atlas.madvay.com/guide/index.html.md"')) throw new Error('The guide does not advertise its Markdown equivalent.');
if (!guidePage.includes('href="/data/"') || !guideMarkdown.match('##.*Static pages and published data')) throw new Error('The guide lacks the published-data route or its Markdown equivalent.');
if (!conceptsMarkdown.includes('# Atlas of Fundamental Concepts — Canonical concepts')) throw new Error('The canonical concept index Markdown was not generated.');
if (!rootMarkdown.includes('Current data manifest') || !rootMarkdown.includes('Complete AI context') || !rootMarkdown.includes('AI integration') || !rootMarkdown.includes('Uploadable AI bundle')) throw new Error('The root Markdown equivalent lacks publication entry points.');
if (!conceptsIndex.includes('<meta http-equiv="refresh" content="0; url=/directory/">')) throw new Error('concepts/index.html lacks its HTML redirect to /directory/.');
if (!conceptsIndex.includes('window.location.replace(target)')) throw new Error('concepts/index.html lacks its JavaScript redirect to /directory/.');
if (!conceptsIndex.includes('<link rel="canonical" href="https://atlas.madvay.com/directory/">')) throw new Error('concepts/index.html does not canonicalize to /directory/.');

for (const removedDomain of removedDomains) {
  const html = await readFile(new URL(`${removedDomain.path}/index.html`, dist), 'utf8');
  const canonicalUrl = new URL(removedDomain.redirectTo, 'https://atlas.madvay.com/').toString();
  if (!html.includes(`<meta http-equiv="refresh" content="0; url=${removedDomain.redirectTo}">`)) throw new Error(`Removed domain ${removedDomain.id} lacks its HTML redirect.`);
  if (!html.includes(`const target = ${JSON.stringify(removedDomain.redirectTo)} + window.location.search + window.location.hash;`) || !html.includes('window.location.replace(target)')) throw new Error(`Removed domain ${removedDomain.id} lacks its JavaScript redirect.`);
  if (!html.includes(`<link rel="canonical" href="${canonicalUrl}">`)) throw new Error(`Removed domain ${removedDomain.id} has the wrong canonical target.`);
  if (sitemap.includes(`<loc>https://atlas.madvay.com/${removedDomain.path}/</loc>`)) throw new Error(`The sitemap lists removed domain ${removedDomain.id}.`);
  if (directoryPage.includes(`href="/${removedDomain.path}/"`)) throw new Error(`The directory links to removed domain ${removedDomain.id}.`);
}

for (const view of viewsData.views) {
  const encodedId = encodeURIComponent(view.id);
  const html = await readFile(new URL(`views/${encodedId}/index.html`, dist), 'utf8');
  const markdown = await readFile(new URL(`views/${encodedId}/index.html.md`, dist), 'utf8');
  assertCacheRecovery(html, `Static view page ${view.id}`);
  if (legacyIconPattern.test(html)) throw new Error(`Static view page ${view.id} still contains a legacy icon-font reference.`);
  if (!html.includes(`<meta name="atlas:view" content="${view.id}">`)) throw new Error(`Static page for ${view.id} lacks its view metadata.`);
  if (!html.includes('<base href="../../">')) throw new Error(`Static page for ${view.id} has the wrong base path.`);
  if (!html.includes('<script id="view-page-jsonld" type="application/ld+json">')) throw new Error(`Static page for ${view.id} lacks view JSON-LD.`);
  const sequence = view.nodeSequence ?? [];
  if (sequence.length) {
    if (!html.includes(`<meta name="atlas:selection" content="node:${sequence[0]}">`)) throw new Error(`Static Story page for ${view.id} does not start on its first sequence node.`);
    if (!/"@type":\s*"ItemList"/.test(html)) throw new Error(`Static Story page for ${view.id} lacks sequence ItemList JSON-LD.`);
    if (!html.includes('data-view-prev') || !html.includes('data-view-next')) throw new Error(`Static Story page for ${view.id} lacks sequence navigation controls.`);
    if (!html.includes(`Step 1 of ${sequence.length}`)) throw new Error(`Static Story page for ${view.id} has the wrong sequence length.`);
  } else {
    if (html.includes('atlas:selection')) throw new Error(`Static View page for ${view.id} must not declare an implicit selection.`);
    if (/"@type":\s*"ItemList"/.test(html)) throw new Error(`Static View page for ${view.id} must not emit Story ItemList JSON-LD.`);
    if (html.includes('data-view-prev') || html.includes('data-view-next')) throw new Error(`Static View page for ${view.id} must not emit Story controls.`);
  }
  if (!html.includes(view.title) || !html.includes(view.narrative)) throw new Error(`Static page for ${view.id} lacks crawlable view copy.`);
  if (!html.includes(`rel="alternate" type="text/markdown" href="https://atlas.madvay.com/views/${encodedId}/index.html.md"`) || !markdown.includes('## Narrative')) throw new Error(`Static page for ${view.id} lacks its Markdown equivalent.`);
  if (!sitemap.includes(`<loc>https://atlas.madvay.com/views/${encodedId}/</loc>`)) throw new Error(`The sitemap omits ${view.id}.`);
}

for (const fieldId of graphData.meta.fieldOrder ?? Object.keys(graphData.fields)) {
  const field = graphData.fields[fieldId];
  const path = `${field.path}/`;
  const html = await readFile(new URL(`${path}index.html`, dist), 'utf8');
  const encodedId = encodeURIComponent(fieldId);
  const imagePath = manifest.assets.fieldSvgs?.[fieldId];
  const expectedImagePath = `static/fields/${encodedId}.svg`;
  if (imagePath !== expectedImagePath) throw new Error(`Field ${fieldId} has the wrong SVG manifest path: ${imagePath}.`);
  const fieldSvg = await readFile(new URL(imagePath, dist), 'utf8');
  const dimensions = svgDimensions(fieldSvg, imagePath);
  assertSvgMetadata(fieldSvg, imagePath);
  if (!fieldSvg.includes(`<title id="atlas-title">${field.label} domain structure — `)) throw new Error(`${imagePath} is not a field-specific Domain-mode export.`);
  if (!fieldSvg.includes(`${field.label}: Domain mode with prerequisites hidden;`)) throw new Error(`${imagePath} does not declare its Hide Prerequisites export mode.`);
  if (fieldSvg.includes('fill-opacity="0.46"')) throw new Error(`${imagePath} contains dependency-context nodes despite Hide Prerequisites mode.`);
  const fieldDomainIds = (graphData.meta.domainOrder ?? Object.keys(graphData.domains))
    .filter((domainId) => graphData.domains[domainId]?.field === fieldId);
  const populatedDomain = fieldDomainIds.find((domainId) => graphData.nodes.some((node) =>
    node.kind === 'structure' && (node.domains?.length ? node.domains : [node.primaryDomain]).includes(domainId)));
  if (populatedDomain && !fieldSvg.includes(`${graphData.domains[populatedDomain].label} — `)) throw new Error(`${imagePath} lacks its Domain-mode aggregate labels.`);

  assertCacheRecovery(html, `Static field page ${fieldId}`);
  if (!html.includes(`<meta name="atlas:scope" content="${fieldId}">`)) throw new Error(`Static field page for ${fieldId} lacks its field metadata.`);
  if (!html.includes('<base href="../">')) throw new Error(`Static field page for ${fieldId} has the wrong base path.`);
  if (!html.includes(`<link rel="canonical" href="https://atlas.madvay.com/${path}">`)) throw new Error(`Static field page for ${fieldId} has the wrong canonical URL.`);
  if (!html.includes(`rel="alternate" type="text/markdown" href="https://atlas.madvay.com/${path}index.html.md"`)) throw new Error(`Static field page for ${fieldId} does not advertise its Markdown equivalent.`);
  if (!html.includes('<script id="taxonomy-page-jsonld" type="application/ld+json">')) throw new Error(`Static field page for ${fieldId} lacks taxonomy JSON-LD.`);
  const imageUrl = `https://atlas.madvay.com/${imagePath}`;
  if (!html.includes(`<meta property="og:image" content="${imageUrl}">`)) throw new Error(`Static field page for ${fieldId} lacks its Open Graph SVG.`);
  if (!html.includes(`<meta property="og:image:width" content="${dimensions.width}">`) || !html.includes(`<meta property="og:image:height" content="${dimensions.height}">`)) throw new Error(`Static field page for ${fieldId} has incorrect SVG dimensions.`);
  for (const metadata of [
    `<meta itemprop="thumbnailUrl" content="${imageUrl}">`,
    `<link rel="image_src" href="${imageUrl}">`,
    `<meta itemprop="image" content="${imageUrl}">`,
    `<meta name="twitter:image" content="${imageUrl}">`
  ]) {
    if (!html.includes(metadata)) throw new Error(`Static field page for ${fieldId} lacks image metadata: ${metadata}`);
  }
  if (!html.includes(`class="field-static-graph" src="/${imagePath}" width="${dimensions.width}" height="${dimensions.height}"`)) throw new Error(`Static field page for ${fieldId} does not show its generated SVG while loading.`);
  if (!html.includes('<span class="static-graph-shimmer" aria-hidden="true"></span>')) throw new Error(`Static field page for ${fieldId} lacks the visible loading shimmer.`);
  if (!html.includes('"primaryImageOfPage"') || !html.includes(`"contentUrl": "${imageUrl}"`)) throw new Error(`Static field page for ${fieldId} lacks SVG structured data.`);
  if (!sitemap.includes(`<loc>https://atlas.madvay.com/${path}</loc><lastmod>`) || !sitemap.includes(`<image:loc>${imageUrl}</image:loc>`)) throw new Error(`The sitemap does not associate field ${fieldId} with its SVG.`);
  const fieldMarkdown = await readFile(new URL(`${path}index.html.md`, dist), 'utf8');
  if (!fieldMarkdown.includes('## Description') || !fieldMarkdown.includes('## Domains')) throw new Error(`Static field Markdown for ${fieldId} lacks its real scope content.`);
}

for (const node of graphData.nodes.filter((candidate) => candidate.kind === 'structure')) {
  const html = await readFile(new URL(`concepts/${encodeURIComponent(node.id)}/index.html`, dist), 'utf8');
  const markdown = await readFile(new URL(`concepts/${encodeURIComponent(node.id)}/index.html.md`, dist), 'utf8');
  assertCacheRecovery(html, `Static concept page ${node.id}`);
  if (html.includes('�')) throw new Error(`Static concept page ${node.id} contains a Unicode replacement character.`);
  if (!html.includes('class="concept-static-document"') || !html.includes('Concept sources') || !html.includes('Incoming relations (arrows to this concept)') || !html.includes('Outgoing relations (arrows from this concept)')) throw new Error(`Static concept page ${node.id} lacks its complete semantic record.`);
  if (!html.includes(`rel="alternate" type="text/markdown" href="https://atlas.madvay.com/concepts/${encodeURIComponent(node.id)}/index.html.md"`)) throw new Error(`Static concept page ${node.id} does not advertise its Markdown equivalent.`);
  if (!html.includes('class="atlas-loading concept-page"') || !html.includes('html.concept-page-html')) throw new Error(`Static concept page ${node.id} does not make its static record reachable below the interactive graph.`);
  if (!markdown.includes(`**Concept ID:** \`${node.id}\``) || !markdown.includes('## Incoming relations (arrows to this concept)') || !markdown.includes('## Outgoing relations (arrows from this concept)')) throw new Error(`Static concept Markdown for ${node.id} lacks its complete record.`);
  const directEdge = graphData.edges.find((edge) => edge.source === node.id || edge.target === node.id);
  if (directEdge && !html.includes(`id="relation-${encodeURIComponent(directEdge.id)}"`)) throw new Error(`Static concept page ${node.id} lacks a stable direct-relation fragment.`);
  if (node.id === 'epsilon_zero' && !html.includes('<meta name="description" content="The least nonzero fixed point of ordinal exponentiation 𝛼↦𝜔^(𝛼).">')) {
    throw new Error('The epsilon-zero concept page has an incorrect crawlable description.');
  }
}

for (const domainId of graphData.meta.domainOrder ?? Object.keys(graphData.domains)) {
  const domain = graphData.domains[domainId];
  const field = graphData.fields[domain.field];
  const encodedId = encodeURIComponent(domainId);
  const path = `${field.path}/${encodedId}/`;
  const html = await readFile(new URL(`${path}index.html`, dist), 'utf8');
  const imagePath = manifest.assets.domainSvgs?.[domainId];
  const expectedImagePath = `static/domains/${encodedId}.svg`;
  if (imagePath !== expectedImagePath) throw new Error(`Domain ${domainId} has the wrong SVG manifest path: ${imagePath}.`);
  const domainSvg = await readFile(new URL(imagePath, dist), 'utf8');
  const dimensions = svgDimensions(domainSvg, imagePath);
  assertSvgMetadata(domainSvg, imagePath);
  const primaryNodes = graphData.nodes.filter((node) => node.primaryDomain === domainId);
  const primaryNodeIds = new Set(primaryNodes.map((node) => node.id));
  const expectedConceptLinks = primaryNodes.filter((node) => node.kind === 'structure').length;
  const expectedJunctionLinks = primaryNodes.length - expectedConceptLinks;
  const actualConceptLinks = domainSvg.match(/<a href="https:\/\/atlas\.madvay\.com\/concepts\//g)?.length ?? 0;
  const actualJunctionLinks = domainSvg.match(/<a href="https:\/\/atlas\.madvay\.com\/\?node=/g)?.length ?? 0;
  if (actualConceptLinks !== expectedConceptLinks || actualJunctionLinks !== expectedJunctionLinks) {
    throw new Error(`${imagePath} contains ${actualConceptLinks} structure and ${actualJunctionLinks} junction links; expected ${expectedConceptLinks} and ${expectedJunctionLinks}.`);
  }
  const expectedEdges = graphData.edges.filter((edge) => primaryNodeIds.has(edge.source) && primaryNodeIds.has(edge.target)).length;
  const actualEdges = domainSvg.match(/<path d="M [^"]+" fill="none" stroke=/g)?.length ?? 0;
  if (actualEdges !== expectedEdges) throw new Error(`${imagePath} contains ${actualEdges} relations; expected all ${expectedEdges} internal relations.`);
  assertCacheRecovery(html, `Static domain page ${domainId}`);
  if (!html.includes(`<meta name="atlas:scope" content="${domain.field}">`)) throw new Error(`Static domain page for ${domainId} lacks its field metadata.`);
  if (!html.includes(`<meta name="atlas:domain" content="${domainId}">`)) throw new Error(`Static domain page for ${domainId} lacks its domain metadata.`);
  if (!html.includes('<base href="../../">')) throw new Error(`Static domain page for ${domainId} has the wrong base path.`);
  if (!html.includes(`<link rel="canonical" href="https://atlas.madvay.com/${path}">`)) throw new Error(`Static domain page for ${domainId} has the wrong canonical URL.`);
  if (!html.includes(`rel="alternate" type="text/markdown" href="https://atlas.madvay.com/${path}index.html.md"`)) throw new Error(`Static domain page for ${domainId} does not advertise its Markdown equivalent.`);
  if (!html.includes('<script id="taxonomy-page-jsonld" type="application/ld+json">')) throw new Error(`Static domain page for ${domainId} lacks taxonomy JSON-LD.`);
  const imageUrl = `https://atlas.madvay.com/${imagePath}`;
  if (!html.includes(`<meta property="og:image" content="${imageUrl}">`)) throw new Error(`Static domain page for ${domainId} lacks its Open Graph SVG.`);
  if (!html.includes(`<meta property="og:image:width" content="${dimensions.width}">`) || !html.includes(`<meta property="og:image:height" content="${dimensions.height}">`)) throw new Error(`Static domain page for ${domainId} has incorrect SVG dimensions.`);
  for (const metadata of [
    `<meta itemprop="thumbnailUrl" content="${imageUrl}">`,
    `<link rel="image_src" href="${imageUrl}">`,
    `<meta itemprop="image" content="${imageUrl}">`,
    `<meta name="twitter:image" content="${imageUrl}">`
  ]) {
    if (!html.includes(metadata)) throw new Error(`Static domain page for ${domainId} lacks image metadata: ${metadata}`);
  }
  if (!html.includes(`class="domain-static-graph" src="/${imagePath}" width="${dimensions.width}" height="${dimensions.height}"`)) throw new Error(`Static domain page for ${domainId} does not show its generated SVG while loading.`);
  if (!html.includes('<span class="static-graph-shimmer" aria-hidden="true"></span>')) throw new Error(`Static domain page for ${domainId} lacks the visible loading shimmer.`);
  if (!html.includes('"primaryImageOfPage"') || !html.includes(`"contentUrl": "${imageUrl}"`)) throw new Error(`Static domain page for ${domainId} lacks SVG structured data.`);
  if (!sitemap.includes(`<loc>https://atlas.madvay.com/${path}</loc>`)) throw new Error(`The sitemap omits domain ${domainId}.`);
  if (!sitemap.includes(`<loc>https://atlas.madvay.com/${path}</loc><lastmod>`) || !sitemap.includes(`<image:loc>${imageUrl}</image:loc>`)) throw new Error(`The sitemap does not associate domain ${domainId} with its SVG.`);
  if (!directoryPage.includes(`href="/${path}"`)) throw new Error(`The directory page does not link to domain ${domainId}.`);
  const domainMarkdown = await readFile(new URL(`${path}index.html.md`, dist), 'utf8');
  if (!domainMarkdown.includes('## Concepts')) throw new Error(`Static domain Markdown for ${domainId} lacks its concept listing.`);
}

console.log(`Verified cache recovery across the root and ${graphData.nodes.filter((node) => node.kind === 'structure').length} concept, ${Object.keys(graphData.fields).length} field, ${Object.keys(graphData.domains).length} active domain, ${removedDomains.length} removed-domain redirect, and ${viewsData.views.length} view pages, plus the atlas directory, redirects, SVG export, data assets, and sitemap entries.`);

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
const openSearch = await readFile(new URL('opensearch.xml', dist), 'utf8');
const searchIndex = JSON.parse(await readFile(new URL('content/search-index.json', dist), 'utf8'));
const atlasSvg = await readFile(new URL('static/atlas.svg', dist), 'utf8');
const directoryPage = await readFile(new URL('directory/index.html', dist), 'utf8');
const conceptsIndex = await readFile(new URL('concepts/index.html', dist), 'utf8');
const viewIndex = await readFile(new URL('views/index.html', dist), 'utf8');
const appIndex = await readFile(new URL('index.html', dist), 'utf8');

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
  const bootstrapIndex = html.indexOf('window.__atlasRecovery =');
  const stylesheetIndex = html.indexOf('data-atlas-critical-asset="stylesheet"');
  const scriptIndex = html.indexOf('data-atlas-critical-asset="script"');
  if (!html.includes(`<meta name="atlas:cache-bust-param" content="${recoveryParameter}">`)) throw new Error(`${pageLabel} lacks the cache-recovery parameter declaration.`);
  if (bootstrapIndex < 0 || stylesheetIndex < 0 || scriptIndex < 0 || bootstrapIndex > stylesheetIndex || bootstrapIndex > scriptIndex) throw new Error(`${pageLabel} does not install cache recovery before critical assets load.`);
  if (!html.includes('searchParams.set(parameterName, randomValue())') || !html.includes('window.location.replace(target)')) throw new Error(`${pageLabel} does not perform a random cache-busting replacement navigation.`);
  if (!html.includes('searchParams.delete(parameterName)') || !html.includes('window.history.replaceState')) throw new Error(`${pageLabel} does not remove the recovery parameter after successful startup.`);
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
if (searchIndex.concepts?.length !== graphData.nodes.filter((node) => node.kind === 'structure').length) throw new Error('The public search index does not contain every concept.');
if (searchIndex.concepts.some((concept) => !concept.id || !concept.label || !concept.url || !concept.summary)) throw new Error('The public search index contains incomplete concept records.');
if (manifest.version !== 3) throw new Error('asset-manifest.json does not use the content-path-aware format.');
for (const key of ['graph', 'schema', 'views', 'shareCodec', 'provenance', 'searchIndex']) {
  if (!manifest.assets?.[key]?.startsWith('content/')) throw new Error(`asset-manifest.json does not publish ${key} under content/.`);
}
const publishedShareCodec = JSON.parse(await readFile(new URL(manifest.assets.shareCodec, dist), 'utf8'));
if (JSON.stringify(publishedShareCodec) !== JSON.stringify(shareCodec)) throw new Error('The published share codec differs from compiled content.');
if (!appIndex.includes(manifest.assets.shareCodec)) throw new Error('The application page does not link to the published share codec.');
await assertMissing(new URL('data/', dist), 'The build still emits the retired /data/ directory.');
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
if (manifest.assets?.directory !== 'directory/') throw new Error('asset-manifest.json does not expose the stable directory/ page.');
if ('atlasPage' in (manifest.assets ?? {})) throw new Error('asset-manifest.json still exposes the retired atlasPage entry.');
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
if (!appIndex.includes('href="/directory/"')) throw new Error('The application omits the atlas directory link.');
if (appIndex.includes('href="/static/atlas/"')) throw new Error('The application still links to the retired static atlas page.');
if (!appIndex.includes('href="/static/atlas.svg"')) throw new Error('The application data panel omits the stable all-in SVG link.');
if (!appIndex.includes(`href="./${manifest.assets.provenance}"`) || !appIndex.includes('href="/CONTENT_LICENSE"')) throw new Error('The application data panel omits content provenance or licensing links.');
if (!appIndex.includes('<noscript>') || !appIndex.includes('Open the atlas directory')) throw new Error('The application lacks its no-JavaScript directory fallback.');
if ((appIndex.match(/data-filter-section-toggle/g) ?? []).length !== 5) throw new Error('The application template lacks the five collapsible filter subsections.');
const displaySectionStart = appIndex.indexOf('id="displayFilterSection"');
const displaySectionEnd = appIndex.indexOf('</section>', displaySectionStart);
if (displaySectionStart < 0 || !appIndex.slice(displaySectionStart, displaySectionEnd).includes('id="layoutSelect"')) throw new Error('The layout selector is not inside the Display filter subsection.');
for (const id of ['layeredLayoutButton', 'compactLayoutButton']) {
  if (!appIndex.includes(`id="${id}"`) || !appIndex.includes(`data-toolbar-layout`)) throw new Error(`The application toolbar lacks ${id}.`);
}
if (!appJs.includes('prohibitedDomains') || !appJs.includes('data-suppression')) throw new Error('The application bundle lacks prohibited-domain state or its tri-state control.');
if (!appCss.includes('.mobile-view-context') || !appCss.includes('.view-banner-mobile')) throw new Error('The application stylesheet lacks the thin-screen guided-view surfaces.');
if (!appCss.includes('.view-sequence-controls') || !appCss.includes('.filter-section-toggle')) throw new Error('The application stylesheet lacks guided-sequence or collapsible-filter controls.');
if (!appCss.includes('.graph-math-label-layer') || !appCss.includes('.graph-math-edge-label')) throw new Error('The application stylesheet lacks the selective KaTeX graph-label layer.');
if (!viewIndex.includes('Stories &amp; Views')) throw new Error('The static stories and views directory was not generated.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/views/</loc>')) throw new Error('The sitemap omits the view directory.');
if (!sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')) throw new Error('The sitemap lacks the image sitemap namespace.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/directory/</loc>')) throw new Error('The sitemap omits directory/.');
if (sitemap.includes('<loc>https://atlas.madvay.com/static/atlas/</loc>')) throw new Error('The sitemap still lists the retired static atlas page.');
if (sitemap.includes('<loc>https://atlas.madvay.com/concepts/</loc>')) throw new Error('The sitemap lists the redirect-only concepts index instead of directory/.');
if (!sitemap.includes('<image:image><image:loc>https://atlas.madvay.com/static/atlas.svg</image:loc></image:image>')) throw new Error('The sitemap does not associate static/atlas.svg with its HTML landing page.');
if (!sitemap.includes('<loc>https://atlas.madvay.com/static/atlas.svg</loc>')) throw new Error('The sitemap omits static/atlas.svg.');
if (!sitemap.includes('<lastmod>')) throw new Error('The sitemap lacks last-modified dates.');
if (!llms.includes('[Atlas Directory](https://atlas.madvay.com/directory/)')) throw new Error('llms.txt omits directory/.');
if (llms.includes('https://atlas.madvay.com/static/atlas/')) throw new Error('llms.txt still references the retired static atlas page.');
if (!llms.includes('[All-in atlas SVG](https://atlas.madvay.com/static/atlas.svg)')) throw new Error('llms.txt omits static/atlas.svg.');
if (!llms.includes('https://atlas.madvay.com/content/atlas.') || !llms.includes('https://atlas.madvay.com/content/schema.') || !llms.includes('https://atlas.madvay.com/content/views.')) throw new Error('llms.txt does not expose all published JSON under /content/.');
if (llms.includes('https://atlas.madvay.com/data/')) throw new Error('llms.txt still references the retired /data/ namespace.');
if (!directoryPage.includes(`href="/${manifest.assets.graph}"`) || directoryPage.includes('href="/data/')) throw new Error('The directory page does not link to graph JSON under /content/.');
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
if (!directoryPage.includes('<link rel="canonical" href="https://atlas.madvay.com/directory/">')) throw new Error('The directory page has the wrong canonical URL.');
if (!directoryPage.includes('"primaryImageOfPage"') || !directoryPage.includes('"ImageObject"')) throw new Error('The directory page lacks primary-image structured data.');
if (!directoryPage.includes('Browse all') || !directoryPage.includes('Relation legend:')) throw new Error('The directory page lacks its semantic concept and relation directories.');
const directoryBeforeSvg = directoryPage.slice(0, directoryPage.indexOf('<svg '));
if (!directoryBeforeSvg.includes('<math')) throw new Error('The directory concept list does not render explicit inline mathematics.');
const firstConcept = graphData.nodes.find((node) => node.kind === 'structure');
const firstConceptLink = firstConcept ? `href="/concepts/${encodeURIComponent(firstConcept.id)}/"` : '';
if (!firstConceptLink || directoryPage.indexOf(firstConceptLink) < 0 || directoryPage.indexOf(firstConceptLink) > directoryPage.indexOf('<svg ')) throw new Error('Crawlable concept links must appear before the inline SVG.');
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
}

for (const node of graphData.nodes.filter((candidate) => candidate.kind === 'structure')) {
  const html = await readFile(new URL(`concepts/${encodeURIComponent(node.id)}/index.html`, dist), 'utf8');
  assertCacheRecovery(html, `Static concept page ${node.id}`);
  if (html.includes('�')) throw new Error(`Static concept page ${node.id} contains a Unicode replacement character.`);
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
}

console.log(`Verified cache recovery across the root and ${graphData.nodes.filter((node) => node.kind === 'structure').length} concept, ${Object.keys(graphData.fields).length} field, ${Object.keys(graphData.domains).length} active domain, ${removedDomains.length} removed-domain redirect, and ${viewsData.views.length} view pages, plus the atlas directory, redirects, SVG export, data assets, and sitemap entries.`);

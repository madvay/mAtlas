import { writeFile } from 'node:fs/promises';
import { renderLlmsContext, renderLlmsContextFull } from './generate-markdown-pages.mjs';
import { appendTextPublicationMetadata } from './publication-text-metadata.mjs';
import { relationTypeVocabularyPath } from './publication-urls.mjs';

const SITE_ORIGIN = 'https://atlas.madvay.com';
const appUrl = (pathname = '') => new URL(pathname, `${SITE_ORIGIN}/`).toString();
const conceptPath = (nodeId) => `concepts/${encodeURIComponent(nodeId)}/`;
const fieldPath = (graphData, fieldId) => `${graphData.fields[fieldId]?.path ?? fieldId}/`;
const domainPath = (graphData, domainId) => `${fieldPath(graphData, graphData.domains[domainId]?.field)}${encodeURIComponent(domainId)}/`;

function buildOpenSearchXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    '  <ShortName>Fundamental Concepts</ShortName>',
    '  <Description>Search the Atlas of Fundamental Concepts</Description>',
    `  <Image height="96" width="96" type="image/png">${appUrl('favicon-96x96.png')}</Image>`,
    `  <Url type="text/html" template="${escapeXml(appUrl('?q={searchTerms}'))}"/>`,
    '  <InputEncoding>UTF-8</InputEncoding>',
    '</OpenSearchDescription>',
    ''
  ].join('\n');
}

function buildRobotsTxt() {
  return ['User-agent: *', 'Allow: /', `Sitemap: ${appUrl('sitemap.xml')}`, ''].join('\n');
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function sitemapEntry(url, { lastModified, imageUrl } = {}) {
  const children = [`<loc>${escapeXml(url)}</loc>`];
  if (lastModified) children.push(`<lastmod>${escapeXml(lastModified)}</lastmod>`);
  if (imageUrl) children.push(`<image:image><image:loc>${escapeXml(imageUrl)}</image:loc></image:image>`);
  return `  <url>${children.join('')}</url>`;
}

function buildSitemapXml(graphData, viewsData, atlasSvgPath, directoryPath, guidePath, dataPath, aiPath, fieldImages, domainImages, conceptImages, lastModified) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure');
  const fieldEntries = (graphData.meta.fieldOrder ?? Object.keys(graphData.fields))
    .map((fieldId) => ({
      url: appUrl(fieldPath(graphData, fieldId)),
      imageUrl: fieldImages?.[fieldId] ? appUrl(fieldImages[fieldId].path) : undefined
    }));
  const domainEntries = (graphData.meta.domainOrder ?? Object.keys(graphData.domains))
    .map((domainId) => ({
      url: appUrl(domainPath(graphData, domainId)),
      imageUrl: domainImages?.[domainId] ? appUrl(domainImages[domainId].path) : undefined
    }));
  const conceptEntries = concepts.map((node) => ({
    url: appUrl(conceptPath(node.id)),
    imageUrl: conceptImages?.[node.id]?.pngPath ? appUrl(conceptImages[node.id].pngPath) : undefined
  }));
  const viewUrls = viewsData.views.map((view) => appUrl(`views/${encodeURIComponent(view.id)}/`));
  const relationVocabularyUrls = Object.keys(graphData.edgeTypes).map((typeId) => appUrl(relationTypeVocabularyPath(typeId)));
  const atlasSvgUrl = appUrl(atlasSvgPath);
  const directoryUrl = appUrl(directoryPath);
  const urls = [
    appUrl(),
    ...fieldEntries.map((entry) => entry.url),
    ...domainEntries.map((entry) => entry.url),
    directoryUrl,
    appUrl(guidePath),
    appUrl(dataPath),
    appUrl(aiPath),
    appUrl('vocab/'),
    ...relationVocabularyUrls,
    appUrl('views/'),
    ...viewUrls,
    ...conceptEntries.map((entry) => entry.url),
    atlasSvgUrl
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls.map((url) => sitemapEntry(url, {
      lastModified,
      imageUrl: url === directoryUrl
        ? atlasSvgUrl
        : fieldEntries.find((entry) => entry.url === url)?.imageUrl
          ?? domainEntries.find((entry) => entry.url === url)?.imageUrl
          ?? conceptEntries.find((entry) => entry.url === url)?.imageUrl
    })),
    '</urlset>',
    ''
  ].join('\n');
}

function fallbackDataManifest(graphData, dataPath, lastModified) {
  const contentUrl = (file) => appUrl(`${dataPath}latest/${file}`);
  return {
    contentVersion: graphData.meta.version,
    schemaVersion: 'unknown',
    dateModified: lastModified,
    distributions: {
      atlas: { contentUrl: contentUrl('atlas.json') },
      schema: { contentUrl: contentUrl('schema.json') },
      views: { contentUrl: contentUrl('views.json') },
      shareCodec: { contentUrl: contentUrl('share-codec.json') },
      provenance: { contentUrl: contentUrl('provenance.json') }
    }
  };
}

function buildLlmsTxt(graphData, viewsData, {
  graphDataPath,
  schemaPath,
  viewsPath,
  atlasSvgPath,
  directoryPath,
  guidePath,
  dataPath,
  aiPath,
  dataManifestPath,
  dataManifest
}) {
  const fields = (graphData.meta.fieldOrder ?? Object.keys(graphData.fields)).map((id) => graphData.fields[id].label).join(', ');
  const domainLinks = (graphData.meta.domainOrder ?? Object.keys(graphData.domains)).map((domainId) => {
    const domain = graphData.domains[domainId];
    const field = graphData.fields[domain.field];
    return `- [${domain.label}](${appUrl(domainPath(graphData, domainId))}) — ${field?.label ?? domain.field}`;
  });
  return [
    '# Atlas of Fundamental Concepts', '', `Canonical: ${appUrl()}`, `Content version: ${dataManifest.contentVersion}`, `Schema version: ${dataManifest.schemaVersion}`, `Description: ${graphData.meta.description}`, '',
    '## Scope', graphData.meta.scope, '',
    '## AI and dataset entry points',
    `- [Dataset landing page](${appUrl(dataPath)}) — stable machine-readable publication and use instructions.`,
    `- [Current data manifest](${appUrl(dataManifestPath)}) — describes the current dataset URLs, content version, and SHA-256 hashes. This endpoint is replaced on each publication.`,
    `- [Canonical graph JSON](${dataManifest.distributions.atlas.contentUrl})`,
    `- [JSON Schema](${dataManifest.distributions.schema.contentUrl})`,
    `- [Stories and Views JSON](${dataManifest.distributions.views.contentUrl})`,
    `- [Content provenance JSON](${dataManifest.distributions.provenance.contentUrl})`,
    ...(dataManifest.distributions.sqlite ? [`- [SQLite database](${dataManifest.distributions.sqlite.contentUrl}) — selective local SQL inspection and Python graph operations.`] : []),
    ...(dataManifest.distributions.conceptsNdjson ? [`- [Concept and junction NDJSON](${dataManifest.distributions.conceptsNdjson.contentUrl})`, `- [Relations NDJSON](${dataManifest.distributions.relationsNdjson.contentUrl})`, `- [Sources NDJSON](${dataManifest.distributions.sourcesNdjson.contentUrl})`] : []),
    ...(dataManifest.distributions.jsonld ? [`- [RDF JSON-LD graph](${dataManifest.distributions.jsonld.contentUrl})`, `- [RDF Turtle graph](${dataManifest.distributions.turtle.contentUrl})`] : []),
    `- [AI integration](${appUrl(aiPath)}) — local SDKs, uploadable bundle, Agent Skill, citation guidance, and static workbench.`,
    `- [AI bundle](${appUrl(`${aiPath}matlas-ai-bundle.zip`)}) — self-contained data and deterministic local tools for upload to compatible AI systems.`,
    `- [Browser-local AI workbench](${appUrl(`${aiPath}workbench/`)}) — accessible forms and visible JSON results; progressive WebMCP tools where supported.`,
    `- [Python SDK](${appUrl(`${aiPath}sdk/matlas.py`)}) and [ESM SDK](${appUrl(`${aiPath}sdk/matlas.mjs`)})`,
    `- [Agent Skill](${appUrl(`${aiPath}skills/matlas/SKILL.md`)})`,
    `- [Static OpenAPI description](${appUrl('openapi.json')}) — GET-only generated resources, not a dynamic API.`,
    `- [Relation vocabulary](${appUrl('vocab/')}) — dereferenceable relation-type definitions used by the RDF exports.`,
    `- [Citation guide](${appUrl(`${aiPath}citation-guide.md`)}) and [CITATION.cff](${appUrl('CITATION.cff')})`,
    `- [Concise AI context](${appUrl('llms-context.txt')}) — relation semantics, coverage, and all concept summaries.`,
    `- [Complete AI context](${appUrl('llms-context-full.txt')}) — every concept record and direct authored relation.`,
    `- [Atlas Directory (Markdown)](${appUrl('directory/index.html.md')})`,
    `- [Canonical concept index (Markdown)](${appUrl('concepts/index.html.md')})`,
    `- [User Guide](${appUrl(guidePath)})`,
    `- [User Guide (Markdown)](${appUrl(`${guidePath}index.html.md`)})`,
    `- [Atlas Directory](${appUrl(directoryPath)})`,
    `- [All-in atlas SVG](${appUrl(atlasSvgPath)})`,
    `- [Stories & Views](${appUrl('views/')})`, '',
    '## Coverage',
    `- Fields: ${fields}`,
    `- Concepts: ${graphData.nodes.filter((node) => node.kind === 'structure').length}`,
    `- Nodes including construction junctions: ${graphData.nodes.length}`,
    `- Relations: ${graphData.edges.length}`,
    `- Domains: ${Object.keys(graphData.domains).length}`,
    `- Stories and views: ${viewsData.views.length}`, '',
    '## Domain pages',
    ...domainLinks,
    '',
    '## Use and citation guidance',
    '- Resolve a requested topic to a canonical concept ID before making a graph claim.',
    '- A direct authored edge is always directed from `source` to `target`; preserve its type, endpoint roles, annotation, explanation, and attached sources.',
    '- Do not infer missing graph edges from general mathematical or scientific knowledge. Distinguish direct authored edges from computed paths or closures.',
    '- Cite concepts at `https://atlas.madvay.com/concepts/<id>/` and direct relations at their `#relation-<edge-id>` fragment on the canonical endpoint page.',
    '- Retain the linked external source citations supplied with every concept and relation record.',
    '- For deterministic graph computation, use the published local SDK, SQLite distribution, or browser workbench; a static site cannot provide arbitrary remote MCP calls.',
    '- The published data contract is latest-only: save the manifest and downloaded artifacts if a result must remain reproducible after a later publication.',
    '- Treat the atlas as editorially selective and source-backed; verify technical claims against the attached sources.', ''
  ].join('\n');
}

export async function generateSeoAssets({
  graphData,
  viewsData,
  distUrl,
  graphDataPath = 'content/atlas.json',
  schemaPath = 'content/schema.json',
  viewsPath = 'content/views.json',
  atlasSvgPath = 'static/atlas.svg',
  directoryPath = 'directory/',
  guidePath = 'guide/',
  dataPath = 'data/',
  aiPath = 'ai/',
  dataManifestPath = 'data/latest/manifest.json',
  dataManifest,
  fieldImages = {},
  domainImages = {},
  conceptImages = {},
  lastModified
}) {
  const publicationManifest = dataManifest ?? fallbackDataManifest(graphData, dataPath, lastModified);
  await Promise.all([
    writeFile(new URL('robots.txt', distUrl), buildRobotsTxt()),
    writeFile(new URL('sitemap.xml', distUrl), buildSitemapXml(graphData, viewsData, atlasSvgPath, directoryPath, guidePath, dataPath, aiPath, fieldImages, domainImages, conceptImages, lastModified)),
    writeFile(new URL('llms.txt', distUrl), appendTextPublicationMetadata(buildLlmsTxt(graphData, viewsData, {
      graphDataPath,
      schemaPath,
      viewsPath,
      atlasSvgPath,
      directoryPath,
      guidePath,
      dataPath,
      aiPath,
      dataManifestPath,
      dataManifest: publicationManifest
    }), graphData, 'llms.txt')),
    writeFile(new URL('llms-context.txt', distUrl), appendTextPublicationMetadata(renderLlmsContext(graphData, viewsData, publicationManifest), graphData, 'llms-context.txt')),
    writeFile(new URL('llms-context-full.txt', distUrl), appendTextPublicationMetadata(renderLlmsContextFull(graphData, viewsData, publicationManifest), graphData, 'llms-context-full.txt')),
    writeFile(new URL('opensearch.xml', distUrl), buildOpenSearchXml())
  ]);
}

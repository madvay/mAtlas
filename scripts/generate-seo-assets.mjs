import { mkdir, writeFile } from 'node:fs/promises';

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

function buildSearchIndex(graphData) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure').map((node) => ({
    id: node.id,
    label: node.label,
    summary: node.summary,
    url: appUrl(conceptPath(node.id)),
    conceptType: node.conceptType ?? null,
    fields: node.fields ?? [node.primaryField].filter(Boolean),
    domains: node.domains ?? [node.primaryDomain].filter(Boolean)
  }));
  return `${JSON.stringify({
    version: 1,
    generatedFrom: graphData.meta.version,
    canonical: appUrl(),
    concepts
  })}\n`;
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

function buildSitemapXml(graphData, viewsData, atlasSvgPath, directoryPath, domainImages, lastModified) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure');
  const fieldUrls = (graphData.meta.fieldOrder ?? Object.keys(graphData.fields))
    .map((fieldId) => appUrl(fieldPath(graphData, fieldId)));
  const domainEntries = (graphData.meta.domainOrder ?? Object.keys(graphData.domains))
    .map((domainId) => ({
      url: appUrl(domainPath(graphData, domainId)),
      imageUrl: domainImages?.[domainId] ? appUrl(domainImages[domainId].path) : undefined
    }));
  const viewUrls = viewsData.views.map((view) => appUrl(`views/${encodeURIComponent(view.id)}/`));
  const atlasSvgUrl = appUrl(atlasSvgPath);
  const directoryUrl = appUrl(directoryPath);
  const urls = [
    appUrl(),
    ...fieldUrls,
    ...domainEntries.map((entry) => entry.url),
    directoryUrl,
    appUrl('views/'),
    ...viewUrls,
    ...concepts.map((node) => appUrl(conceptPath(node.id))),
    atlasSvgUrl
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls.map((url) => sitemapEntry(url, {
      lastModified,
      imageUrl: url === directoryUrl
        ? atlasSvgUrl
        : domainEntries.find((entry) => entry.url === url)?.imageUrl
    })),
    '</urlset>',
    ''
  ].join('\n');
}

function buildLlmsTxt(graphData, viewsData, graphDataPath, schemaPath, viewsPath, atlasSvgPath, directoryPath) {
  const fields = (graphData.meta.fieldOrder ?? Object.keys(graphData.fields)).map((id) => graphData.fields[id].label).join(', ');
  const domainLinks = (graphData.meta.domainOrder ?? Object.keys(graphData.domains)).map((domainId) => {
    const domain = graphData.domains[domainId];
    const field = graphData.fields[domain.field];
    return `- [${domain.label}](${appUrl(domainPath(graphData, domainId))}) — ${field?.label ?? domain.field}`;
  });
  return [
    '# Atlas of Fundamental Concepts', '', `Canonical: ${appUrl()}`, `Version: ${graphData.meta.version}`, `Description: ${graphData.meta.description}`, '',
    '## Scope', graphData.meta.scope, '',
    '## Data',
    `- [Atlas Directory](${appUrl(directoryPath)})`,
    `- [All-in atlas SVG](${appUrl(atlasSvgPath)})`,
    `- [Graph JSON](${appUrl(graphDataPath)})`,
    `- [JSON Schema](${appUrl(schemaPath)})`,
    `- [Views JSON](${appUrl(viewsPath)})`,
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
    '## Editorial guidance',
    '- Use canonical /concepts/<id>/ URLs when citing atlas concepts.',
    '- Use /directory/ for the complete crawlable visual overview and concept directory, and /static/atlas.svg for the standalone vector document.',
    '- Treat the atlas as editorially selective and source-backed.',
    '- Verify technical claims against the attached sources.', ''
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
  domainImages = {},
  lastModified
}) {
  await mkdir(new URL('content/', distUrl), { recursive: true });
  await Promise.all([
    writeFile(new URL('robots.txt', distUrl), buildRobotsTxt()),
    writeFile(new URL('sitemap.xml', distUrl), buildSitemapXml(graphData, viewsData, atlasSvgPath, directoryPath, domainImages, lastModified)),
    writeFile(new URL('llms.txt', distUrl), buildLlmsTxt(graphData, viewsData, graphDataPath, schemaPath, viewsPath, atlasSvgPath, directoryPath)),
    writeFile(new URL('opensearch.xml', distUrl), buildOpenSearchXml()),
    writeFile(new URL('content/search-index.json', distUrl), buildSearchIndex(graphData))
  ]);
}

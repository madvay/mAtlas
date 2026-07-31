import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, renderInlineMath, stripInlineMath } from './inline-math.mjs';
import { minifyHtml } from './minify-html.mjs';
import { importTypeScriptModule } from './import-typescript-module.mjs';

const { summarizePlainText } = await importTypeScriptModule(new URL('../src/core/text.ts', import.meta.url));

const SITE_ORIGIN = 'https://atlas.madvay.com';

function appUrl(pathname = '') {
  return new URL(pathname, `${SITE_ORIGIN}/`).toString();
}

function conceptPath(nodeId) {
  return `concepts/${encodeURIComponent(nodeId)}/`;
}

function fieldPath(graphData, fieldId) {
  return `${graphData.fields[fieldId]?.path ?? fieldId}/`;
}

function domainPath(graphData, domainId) {
  const fieldId = graphData.domains[domainId]?.field;
  return `${fieldPath(graphData, fieldId)}${encodeURIComponent(domainId)}/`;
}

function summarize(text, maxLength = 240) {
  return summarizePlainText(String(text ?? ''), maxLength);
}

function replaceFirst(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function domainImageMetadata(graphData, domainId, image) {
  if (!domainId || !image) return '';
  const domain = graphData.domains[domainId];
  const imageUrl = appUrl(image.path);
  const alt = `${domain.label} primary-domain concept graph`;
  return [
    `<meta property="og:image:type" content="image/svg+xml">`,
    `<meta itemprop="thumbnailUrl" content="${escapeHtml(imageUrl)}">`,
    `<link rel="image_src" href="${escapeHtml(imageUrl)}">`,
    `<meta itemprop="image" content="${escapeHtml(imageUrl)}">`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(alt)}">`
  ].join('\n  ');
}

function renderDomainStaticGraph(graphData, domainId, image) {
  if (!domainId || !image) return null;
  const domain = graphData.domains[domainId];
  const imageUrl = `/${image.path}`;
  const alt = `${domain.label} graph showing only nodes whose primary domain is ${domain.label}, with all relations between those nodes.`;
  return `<div id="graphLoader" class="graph-loader domain-graph-loader" role="status" aria-live="polite">
          <img class="domain-static-graph" src="${escapeHtml(imageUrl)}" width="${image.width}" height="${image.height}" alt="${escapeHtml(alt)}" decoding="async" fetchpriority="high">
          <span class="domain-graph-loading-label">Preparing the interactive atlas…</span>
        </div>`;
}

function fieldIdForNode(graphData, node) {
  return node.primaryField ?? graphData.domains[node.primaryDomain]?.field ?? graphData.meta.defaultField;
}

function nodeJsonLd({ node, graphData, canonicalUrl, description }) {
  const fieldId = fieldIdForNode(graphData, node);
  const citationUrls = (node.citations ?? [])
    .map((id) => graphData.sources[id]?.url)
    .filter((url) => typeof url === 'string');
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    '@id': canonicalUrl,
    name: summarize(node.label),
    description,
    url: canonicalUrl,
    identifier: node.id,
    termCode: node.id,
    inDefinedTermSet: appUrl('directory/'),
    isPartOf: { '@type': 'WebSite', name: graphData.meta.title, url: appUrl() },
    additionalType: node.kind === 'junction' ? 'https://schema.org/Intangible' : 'https://schema.org/Thing',
    keywords: [
      graphData.fields[fieldId]?.label,
      ...node.domains.map((domainId) => graphData.domains[domainId]?.label ?? domainId)
    ].filter(Boolean)
  };
}

function relatedConcepts(graphData, nodeId) {
  const byId = new Map(graphData.nodes.map((node) => [node.id, node]));
  const relatedIds = new Set();
  for (const edge of graphData.edges) {
    if (edge.source === nodeId && byId.get(edge.target)?.kind === 'structure') relatedIds.add(edge.target);
    if (edge.target === nodeId && byId.get(edge.source)?.kind === 'structure') relatedIds.add(edge.source);
  }
  return Array.from(relatedIds).map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label));
}

function renderStaticLinkSection(graphData, node) {
  const neighbors = relatedConcepts(graphData, node.id).slice(0, 64);
  const links = neighbors.length
    ? neighbors.map((related) => `<li><a href="concepts/${encodeURIComponent(related.id)}/">${renderInlineMath(related.label)}</a></li>`).join('')
    : '<li>No direct relation links recorded for this concept.</li>';
  return `<section class="concept-static-links" aria-label="Related concepts">
  <h2>Related concepts</h2>
  <p>Static HTML equivalents of this concept’s direct in-graph relations.</p>
  <ul>${links}</ul>
</section>`;
}

function renderConceptPage(templateHtml, { graphData, node }) {
  const canonicalUrl = appUrl(conceptPath(node.id));
  const description = summarize(node.summary || graphData.meta.description);
  const pageTitle = `${summarize(node.label)} — ${graphData.meta.title}`;
  let html = templateHtml;
  html = replaceFirst(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`);
  html = replaceFirst(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`);
  html = replaceFirst(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(pageTitle)}">`);
  html = replaceFirst(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(description)}">`);
  html = replaceFirst(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`);
  html = replaceFirst(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`);
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n  <base href="../../">\n  <meta name="atlas:selection" content="node:${escapeHtml(node.id)}">`
  );
  const structuredData = JSON.stringify(nodeJsonLd({ node, graphData, canonicalUrl, description }), null, 2);
  html = html.replace('</head>', `  <script type="application/ld+json">\n${structuredData}\n  </script>\n  <style>
    .concept-static-links { margin: 0 auto 1.5rem; padding: 0 1rem; max-width: 1280px; }
    .concept-static-links h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
    .concept-static-links p { margin: 0 0 0.65rem; font-size: 0.9rem; color: #475569; }
    .concept-static-links ul { margin: 0; padding-left: 1.2rem; columns: 2; column-gap: 1.5rem; }
    .concept-static-links li { margin: 0.2rem 0; break-inside: avoid; }
    @media (max-width: 900px) { .concept-static-links ul { columns: 1; } }
  </style>\n</head>`);
  return html.replace('</body>', `${renderStaticLinkSection(graphData, node)}\n</body>`);
}

function renderRedirectPage({ targetPath, pageTitle, heading, linkLabel }) {
  const canonicalUrl = appUrl(targetPath.slice(1));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,follow">
  <link rel="canonical" href="${canonicalUrl}">
  <meta http-equiv="refresh" content="0; url=${targetPath}">
  <title>${escapeHtml(pageTitle)}</title>
  <script>
    (() => {
      const target = ${JSON.stringify(targetPath)} + window.location.search + window.location.hash;
      window.location.replace(target);
    })();
  </script>
</head>
<body>
  <main>
    <h1>${escapeHtml(heading)}</h1>
    <p><a href="${targetPath}">${escapeHtml(linkLabel)}</a>.</p>
  </main>
</body>
</html>`;
}

export function renderConceptIndexRedirect() {
  return renderRedirectPage({
    targetPath: '/directory/',
    pageTitle: 'Redirecting to the Atlas Directory',
    heading: 'Atlas Directory moved',
    linkLabel: 'Continue to the Atlas Directory'
  });
}

export function renderRemovedDomainRedirect(removedDomain) {
  return renderRedirectPage({
    targetPath: removedDomain.redirectTo,
    pageTitle: 'Redirecting to the Atlas',
    heading: 'This domain has been merged',
    linkLabel: 'Continue to the active atlas section'
  });
}

function orderedIds(order, values) {
  const result = [];
  const seen = new Set();
  for (const id of order ?? []) {
    if (Object.prototype.hasOwnProperty.call(values, id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(values)) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

function nodeDomainIds(node) {
  return node.domains?.length ? node.domains : [node.primaryDomain];
}

function renderScopeFallback(graphData, fieldId, domainId = null) {
  const field = graphData.fields[fieldId];
  const domainIds = orderedIds(graphData.meta.domainOrder, graphData.domains)
    .filter((id) => graphData.domains[id]?.field === fieldId);
  const navigationDomainIds = domainId ? domainIds.filter((id) => id !== domainId) : domainIds;
  const domainLinks = navigationDomainIds.map((id) => {
    const domain = graphData.domains[id];
    return `<li><a href="/${domainPath(graphData, id)}">${escapeHtml(domain.label)}</a></li>`;
  }).join('');
  const concepts = domainId
    ? graphData.nodes
      .filter((node) => node.kind === 'structure' && nodeDomainIds(node).includes(domainId))
      .sort((left, right) => stripInlineMath(left.label).localeCompare(stripInlineMath(right.label)))
    : [];
  const conceptLinks = concepts.map((node) => `<li><a href="/${conceptPath(node.id)}">${escapeHtml(summarize(node.label))}</a></li>`).join('');
  const currentDomain = domainId ? graphData.domains[domainId] : null;
  return `<noscript>
  <section class="noscript-scope-directory">
    <p>The interactive graph requires JavaScript. <a href="/directory/">Open the atlas directory</a>.</p>
    <h2>${escapeHtml(currentDomain?.label ?? field.label)}</h2>
    ${currentDomain ? `<p><a href="/${fieldPath(graphData, fieldId)}">Browse all ${escapeHtml(field.label)} domains</a>.</p>` : ''}
    ${domainLinks ? `<h3>${currentDomain ? `Other ${escapeHtml(field.label)} domains` : `${escapeHtml(field.label)} domains`}</h3><ul>${domainLinks}</ul>` : ''}
    ${currentDomain ? `<h3>${escapeHtml(currentDomain.label)} concepts</h3><ul>${conceptLinks}</ul>` : ''}
  </section>
</noscript>`;
}

function scopePageJsonLd(graphData, fieldId, domainId = null, domainImage = null) {
  const field = graphData.fields[fieldId];
  const domain = domainId ? graphData.domains[domainId] : null;
  const canonicalUrl = appUrl(domainId ? domainPath(graphData, domainId) : fieldPath(graphData, fieldId));
  const items = domain
    ? graphData.nodes
      .filter((node) => node.kind === 'structure' && nodeDomainIds(node).includes(domainId))
      .map((node, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: summarize(node.label),
        url: appUrl(conceptPath(node.id))
      }))
    : orderedIds(graphData.meta.domainOrder, graphData.domains)
      .filter((id) => graphData.domains[id]?.field === fieldId)
      .map((id, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: graphData.domains[id].label,
        url: appUrl(domainPath(graphData, id))
      }));
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonicalUrl,
    name: domain ? `${domain.label} — ${graphData.meta.title}` : `${field.label} — ${graphData.meta.title}`,
    description: domain
      ? `Explore ${domain.label} concepts and relations in ${field.label}.`
      : field.description,
    url: canonicalUrl,
    isPartOf: { '@type': 'WebSite', name: graphData.meta.title, url: appUrl() },
    about: domain ? [field.label, domain.label] : [field.label],
    ...(domainImage ? {
      image: appUrl(domainImage.path),
      thumbnailUrl: appUrl(domainImage.path),
      primaryImageOfPage: {
        '@type': 'ImageObject',
        contentUrl: appUrl(domainImage.path),
        width: domainImage.width,
        height: domainImage.height,
        encodingFormat: 'image/svg+xml'
      }
    } : {}),
    mainEntity: { '@type': 'ItemList', itemListElement: items }
  };
}

export function renderScopePage(templateHtml, graphData, fieldId, domainId = null, domainImage = null) {
  const field = graphData.fields[fieldId];
  const domain = domainId ? graphData.domains[domainId] : null;
  const canonicalUrl = appUrl(domainId ? domainPath(graphData, domainId) : fieldPath(graphData, fieldId));
  const pageTitle = `${domain?.label ?? field.label} — ${graphData.meta.title}`;
  const description = domain
    ? `Explore ${domain.label} concepts and relations in ${field.label}.`
    : field.description;
  let html = templateHtml;
  html = replaceFirst(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`);
  html = replaceFirst(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`);
  html = replaceFirst(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(pageTitle)}">`);
  html = replaceFirst(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(description)}">`);
  html = replaceFirst(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`);
  html = replaceFirst(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`);
  if (domainId && domainImage) {
    const imageUrl = appUrl(domainImage.path);
    const imageAlt = `${domain.label} primary-domain concept graph`;
    html = replaceFirst(html, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    html = replaceFirst(html, /<meta property="og:image:width" content="[^"]*">/, `<meta property="og:image:width" content="${domainImage.width}">`);
    html = replaceFirst(html, /<meta property="og:image:height" content="[^"]*">/, `<meta property="og:image:height" content="${domainImage.height}">`);
    html = replaceFirst(html, /<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}">`);
    html = replaceFirst(html, /<meta name="twitter:card" content="[^"]*">/, '<meta name="twitter:card" content="summary_large_image">');
  }
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n  <base href="${domainId ? '../../' : '../'}">\n  <meta name="atlas:scope" content="${escapeHtml(fieldId)}">${domainId ? `\n  <meta name="atlas:domain" content="${escapeHtml(domainId)}">\n  <link rel="up" href="/${fieldPath(graphData, fieldId)}">` : ''}`
  );
  const jsonLd = JSON.stringify(scopePageJsonLd(graphData, fieldId, domainId, domainImage), null, 2);
  const imageMetadata = domainImageMetadata(graphData, domainId, domainImage);
  html = html.replace('</head>', `  ${imageMetadata ? `${imageMetadata}\n  ` : ''}<script id="taxonomy-page-jsonld" type="application/ld+json">\n${jsonLd}\n  </script>\n</head>`);
  const staticGraph = renderDomainStaticGraph(graphData, domainId, domainImage);
  if (staticGraph) {
    html = html.replace('<div id="graphLoader" class="graph-loader" role="status" aria-live="polite">Preparing the atlas…</div>', staticGraph);
  }
  return html.replace(/<noscript>[\s\S]*?<\/noscript>/, renderScopeFallback(graphData, fieldId, domainId));
}

export async function generateConceptPages({ graphData, templateHtml, distUrl, domainImages = {}, removedDomains = [] }) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure');
  await mkdir(new URL('concepts/', distUrl), { recursive: true });
  await writeFile(new URL('concepts/index.html', distUrl), minifyHtml(renderConceptIndexRedirect()));
  await Promise.all(concepts.map(async (node) => {
    const pageDir = new URL(conceptPath(node.id), distUrl);
    await mkdir(pageDir, { recursive: true });
    await writeFile(new URL('index.html', pageDir), minifyHtml(renderConceptPage(templateHtml, { graphData, node })));
  }));
  await Promise.all((graphData.meta.fieldOrder ?? Object.keys(graphData.fields)).map(async (fieldId) => {
    const field = graphData.fields[fieldId];
    const pageDir = new URL(`${field.path}/`, distUrl);
    await mkdir(pageDir, { recursive: true });
    await writeFile(new URL('index.html', pageDir), minifyHtml(renderScopePage(templateHtml, graphData, fieldId)));
  }));
  await Promise.all((graphData.meta.domainOrder ?? Object.keys(graphData.domains)).map(async (domainId) => {
    const fieldId = graphData.domains[domainId].field;
    const pageDir = new URL(domainPath(graphData, domainId), distUrl);
    await mkdir(pageDir, { recursive: true });
    await writeFile(new URL('index.html', pageDir), minifyHtml(renderScopePage(templateHtml, graphData, fieldId, domainId, domainImages[domainId])));
  }));
  await Promise.all(removedDomains.map(async (removedDomain) => {
    const pageDir = new URL(`${removedDomain.path}/`, distUrl);
    await mkdir(pageDir, { recursive: true });
    await writeFile(new URL('index.html', pageDir), minifyHtml(renderRemovedDomainRedirect(removedDomain)));
  }));
}

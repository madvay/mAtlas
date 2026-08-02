import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, renderInlineMath, stripInlineMath } from './inline-math.mjs';
import { minifyHtml } from './minify-html.mjs';
import { importTypeScriptModule } from './import-typescript-module.mjs';
import {
  alternateTerms,
  appUrl,
  conceptPath,
  directRelations,
  domainPath,
  fieldIdForNode,
  fieldPath,
  nodeDomainIds,
  nodeFieldIds,
  nodeMap,
  relationCanonicalUrl,
  relationFragment
} from './publication-urls.mjs';

const { summarizePlainText } = await importTypeScriptModule(new URL('../src/core/text.ts', import.meta.url));

function summarize(text, maxLength = 240) {
  return summarizePlainText(String(text ?? ''), maxLength);
}

function replaceFirst(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function scopeImageAlt(graphData, fieldId, domainId = null) {
  const field = graphData.fields[fieldId];
  if (domainId) return `${graphData.domains[domainId].label} primary-domain concept graph`;
  return `${field.label} domain structure graph with prerequisites hidden`;
}

function scopeImageMetadata(graphData, fieldId, domainId, image) {
  if (!image) return '';
  const imageUrl = appUrl(image.path);
  const alt = scopeImageAlt(graphData, fieldId, domainId);
  return [
    `<meta property="og:image:type" content="image/svg+xml">`,
    `<meta itemprop="thumbnailUrl" content="${escapeHtml(imageUrl)}">`,
    `<link rel="image_src" href="${escapeHtml(imageUrl)}">`,
    `<meta itemprop="image" content="${escapeHtml(imageUrl)}">`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(alt)}">`
  ].join('\n  ');
}

function renderScopeStaticGraph(graphData, fieldId, domainId, image) {
  if (!image) return null;
  const field = graphData.fields[fieldId];
  const domain = domainId ? graphData.domains[domainId] : null;
  const imageUrl = `/${image.path}`;
  const alt = domain
    ? `${domain.label} graph showing only nodes whose primary domain is ${domain.label}, with all relations between those nodes.`
    : `${field.label} graph in Domain mode with prerequisite closure hidden, showing the field's visible concepts beneath its domain structure and aggregate relations.`;
  const scopeClass = domain ? 'domain' : 'field';
  return `<div id="graphLoader" class="graph-loader ${scopeClass}-graph-loader" role="status" aria-live="polite">
          <img class="${scopeClass}-static-graph" src="${escapeHtml(imageUrl)}" width="${image.width}" height="${image.height}" alt="${escapeHtml(alt)}" decoding="async" fetchpriority="high">
          <span class="static-graph-shimmer" aria-hidden="true"></span>
          <span class="${scopeClass}-graph-loading-label">Preparing the interactive atlas…</span>
        </div>`;
}

function nodeJsonLd({ node, graphData, canonicalUrl, description }) {
  const fieldId = fieldIdForNode(graphData, node);
  const aliases = alternateTerms(node);
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
    ...(aliases.length ? { alternateName: aliases } : {}),
    ...(citationUrls.length ? { citation: citationUrls } : {}),
    keywords: [
      graphData.fields[fieldId]?.label,
      ...node.domains.map((domainId) => graphData.domains[domainId]?.label ?? domainId)
    ].filter(Boolean)
  };
}

function renderSourceList(graphData, sourceIds) {
  if (!sourceIds?.length) return '<p class="concept-static-muted">No citation is attached.</p>';
  return `<ul class="concept-source-list">${sourceIds.map((sourceId) => {
    const source = graphData.sources[sourceId];
    if (!source) return `<li><code>${escapeHtml(sourceId)}</code> (source record unavailable)</li>`;
    return `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}</a><span> — ${escapeHtml(source.title)} · ${escapeHtml(source.kind)} · source ID <code>${escapeHtml(sourceId)}</code></span></li>`;
  }).join('')}</ul>`;
}

function renderNodeLink(node) {
  if (!node) return '<span class="concept-static-muted">Unknown node</span>';
  const href = node.kind === 'structure' ? `/${conceptPath(node.id)}` : `/?node=${encodeURIComponent(node.id)}`;
  const suffix = node.kind === 'junction' ? ' <span class="concept-static-muted">(construction junction)</span>' : '';
  return `<a href="${escapeHtml(href)}">${renderInlineMath(node.label)}</a>${suffix}`;
}

function renderListDetail(title, items) {
  if (!items?.length) return '';
  return `<section class="concept-static-section"><h2>${escapeHtml(title)}</h2><ul>${items.map((item) => `<li>${renderInlineMath(item)}</li>`).join('')}</ul></section>`;
}

function renderGenericDetail(section) {
  const body = section.body ? `<p>${renderInlineMath(section.body)}</p>` : '';
  const items = section.items?.length ? `<ul>${section.items.map((item) => `<li>${renderInlineMath(item)}</li>`).join('')}</ul>` : '';
  return `<section class="concept-static-section"><h2>${escapeHtml(section.title)}</h2>${body}${items}</section>`;
}

function renderFieldLinks(graphData, node) {
  const links = nodeFieldIds(graphData, node).map((fieldId) => {
    const field = graphData.fields[fieldId];
    return `<a href="/${fieldPath(graphData, fieldId)}">${escapeHtml(field.label)}</a>`;
  });
  return links.length ? links.join(', ') : '<span class="concept-static-muted">No field is authored.</span>';
}

function renderDomainLinks(graphData, node, { primaryOnly = false } = {}) {
  const ids = primaryOnly ? [node.primaryDomain] : nodeDomainIds(node);
  const links = ids.map((domainId) => {
    const domain = graphData.domains[domainId];
    return domain ? `<a href="/${domainPath(graphData, domainId)}">${escapeHtml(domain.label)}</a>` : `<code>${escapeHtml(domainId)}</code>`;
  });
  return links.length ? links.join(', ') : '<span class="concept-static-muted">No domain is authored.</span>';
}

function renderRelation(graphData, edge, nodesById) {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  const type = graphData.edgeTypes[edge.type];
  const canonicalUrl = relationCanonicalUrl(edge, nodesById);
  const sourceRole = type?.endpointLabels?.source ?? 'source endpoint';
  const targetRole = type?.endpointLabels?.target ?? 'target endpoint';
  return `<article id="${escapeHtml(relationFragment(edge.id))}" class="concept-relation">
  <header><h3>${renderNodeLink(source)} <span aria-hidden="true">→</span> ${renderNodeLink(target)}</h3><a class="concept-relation-permalink" href="${escapeHtml(canonicalUrl)}">Permalink to relation</a></header>
  <p>This is an authored directed relation from the source endpoint to the target endpoint.</p>
  <dl class="concept-relation-metadata">
    <div><dt>Relation ID</dt><dd><code>${escapeHtml(edge.id)}</code></dd></div>
    <div><dt>Relation type</dt><dd>${escapeHtml(type?.label ?? edge.type)} <code>${escapeHtml(edge.type)}</code></dd></div>
    <div><dt>Direction</dt><dd>source → target</dd></div>
    <div><dt>Endpoint roles</dt><dd>source: ${escapeHtml(sourceRole)}; target: ${escapeHtml(targetRole)}</dd></div>
    <div><dt>Authored annotation</dt><dd>${renderInlineMath(edge.label)}</dd></div>
  </dl>
  <section><h4>Authored explanation</h4><p>${renderInlineMath(edge.detail)}</p></section>
  <section><h4>How to interpret this relation type</h4><p>${renderInlineMath(type?.description ?? 'No relation-type description is available.')}</p></section>
  <section><h4>Relation sources</h4>${renderSourceList(graphData, edge.citations)}</section>
</article>`;
}

function renderRelationSection(graphData, node, nodesById, direction) {
  const title = direction === 'incoming' ? 'Incoming relations (arrows to this concept)' : 'Outgoing relations (arrows from this concept)';
  const relations = directRelations(graphData, node.id, direction);
  return `<section class="concept-static-section concept-relations"><h2>${title}</h2><p>${direction === 'incoming' ? 'Each relation below ends at this concept.' : 'Each relation below starts at this concept.'}</p>${relations.length ? relations.map((edge) => renderRelation(graphData, edge, nodesById)).join('') : '<p class="concept-static-muted">No direct relations are authored in this direction.</p>'}</section>`;
}

function renderStaticConceptDocument(graphData, node) {
  const aliases = alternateTerms(node);
  const nodesById = nodeMap(graphData);
  const metadata = [
    ['Canonical name', renderInlineMath(node.label)],
    ['Concept ID', `<code>${escapeHtml(node.id)}</code>`],
    ['Content version', `<code>${escapeHtml(graphData.meta.version)}</code>`],
    ['Primary field', renderFieldLinks(graphData, { ...node, fields: [fieldIdForNode(graphData, node)] })],
    ['Fields', renderFieldLinks(graphData, node)],
    ['Primary domain', renderDomainLinks(graphData, node, { primaryOnly: true })],
    ['Domains', renderDomainLinks(graphData, node)],
    ['Alternate terminology', aliases.length ? aliases.map((term) => renderInlineMath(term)).join('; ') : '<span class="concept-static-muted">No alternate terminology is currently authored for this record.</span>']
  ];
  if (node.conceptType) metadata.push(['Concept type', escapeHtml(node.conceptType)]);
  if (node.scale) metadata.push(['Scale', escapeHtml(node.scale)]);
  if (node.status) metadata.push(['Status', escapeHtml(node.status)]);
  return `<article id="concept-record" class="concept-static-document" aria-labelledby="concept-record-title">
  <header class="concept-static-header">
    <p class="concept-static-kicker">Canonical static concept record</p>
    <h1 id="concept-record-title">${renderInlineMath(node.label)}</h1>
    <p class="concept-static-actions"><a href="/?node=${encodeURIComponent(node.id)}">Open this concept in the interactive graph</a><a href="./index.html.md">Read the Markdown equivalent</a></p>
  </header>
  <section class="concept-static-section"><h2>Summary</h2><p class="concept-static-summary">${renderInlineMath(node.summary)}</p></section>
  <section class="concept-static-section"><h2>Record metadata</h2><dl class="concept-static-metadata">${metadata.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl></section>
  ${renderListDetail('Carrier(s)', node.carriers)}
  ${renderListDetail('Data', node.data)}
  ${renderListDetail('Axioms / constraints', node.axioms)}
  ${renderListDetail('Canonically induces', node.induces)}
  ${(node.sections ?? []).map(renderGenericDetail).join('')}
  ${node.notes ? `<section class="concept-static-section"><h2>Notes</h2><p>${renderInlineMath(node.notes)}</p></section>` : ''}
  <section class="concept-static-section"><h2>Concept sources</h2>${renderSourceList(graphData, node.citations)}</section>
  ${renderRelationSection(graphData, node, nodesById, 'incoming')}
  ${renderRelationSection(graphData, node, nodesById, 'outgoing')}
</article>`;
}

function renderConceptPage(templateHtml, { graphData, node }) {
  const canonicalUrl = appUrl(conceptPath(node.id));
  const markdownUrl = `${canonicalUrl}index.html.md`;
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
  html = html.replace('<html lang="en">', '<html lang="en" class="concept-page-html">');
  html = html.replace('<body class="atlas-loading">', '<body class="atlas-loading concept-page">');
  const structuredData = JSON.stringify(nodeJsonLd({ node, graphData, canonicalUrl, description }), null, 2);
  html = html.replace('</head>', `  <link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}" title="Markdown concept record">\n  <script type="application/ld+json">\n${structuredData}\n  </script>\n  <style>
    html.concept-page-html { height: auto; overflow-y: auto; }
    body.concept-page { min-height: 100%; height: auto; overflow: visible; }
    body.concept-page #app { height: 100vh; height: 100svh; min-height: 520px; }
    .concept-static-document { max-width: 1180px; margin: 0 auto; padding: clamp(1rem, 3vw, 2.5rem) clamp(1rem, 4vw, 3rem) 3rem; color: var(--text); background: var(--bg); }
    .concept-static-document a { color: var(--link); text-underline-offset: .16em; }
    .concept-static-document h1, .concept-static-document h2, .concept-static-document h3, .concept-static-document h4 { color: var(--text-strong); }
    .concept-static-header { padding: 1.2rem 0 1rem; border-bottom: 1px solid var(--line); }
    .concept-static-header h1 { margin: .2rem 0 .6rem; font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.1; }
    .concept-static-kicker { margin: 0; color: var(--muted); font-size: .76rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .concept-static-actions { display: flex; flex-wrap: wrap; gap: .55rem; margin: .85rem 0 0; }
    .concept-static-actions a, .concept-relation-permalink { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: .42rem .68rem; background: var(--panel); text-decoration: none; font-size: .84rem; font-weight: 700; }
    .concept-static-section { margin: 1rem 0; padding: 1rem 1.1rem; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
    .concept-static-section h2 { margin: .05rem 0 .55rem; font-size: 1.25rem; }
    .concept-static-section h3 { margin: .1rem 0 .4rem; font-size: 1rem; }
    .concept-static-section h4 { margin: .7rem 0 .25rem; font-size: .92rem; }
    .concept-static-section p, .concept-static-section li { line-height: 1.55; }
    .concept-static-summary { font-size: 1.04rem; }
    .concept-static-metadata, .concept-relation-metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .6rem; margin: .6rem 0 0; }
    .concept-static-metadata div, .concept-relation-metadata div { padding: .62rem .7rem; border: 1px solid var(--line-soft); border-radius: 9px; background: var(--panel-2); }
    .concept-static-metadata dt, .concept-relation-metadata dt { color: var(--muted); font-size: .75rem; font-weight: 800; letter-spacing: .035em; text-transform: uppercase; }
    .concept-static-metadata dd, .concept-relation-metadata dd { margin: .18rem 0 0; overflow-wrap: anywhere; }
    .concept-static-document ul { padding-left: 1.2rem; }
    .concept-source-list { margin: .45rem 0 0; }
    .concept-source-list li + li { margin-top: .45rem; }
    .concept-source-list span { color: var(--muted); font-size: .88rem; }
    .concept-static-muted { color: var(--muted); }
    .concept-relations > p { color: var(--muted); }
    .concept-relation { scroll-margin-top: 1rem; margin-top: .9rem; padding: .9rem; border: 1px solid var(--line-soft); border-radius: 11px; background: var(--panel-2); }
    .concept-relation header { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
    .concept-relation h3 { flex: 1 1 320px; }
    .concept-relation p { margin: .45rem 0; }
    @media (max-width: 700px) { body.concept-page #app { min-height: 480px; }.concept-static-document { padding-inline: 1rem; }.concept-static-section { padding: .9rem; }.concept-static-metadata, .concept-relation-metadata { grid-template-columns: 1fr; } }
  </style>\n</head>`);
  return html.replace('</body>', `${renderStaticConceptDocument(graphData, node)}\n</body>`);
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

function scopePageJsonLd(graphData, fieldId, domainId = null, scopeImage = null) {
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
    ...(scopeImage ? {
      image: appUrl(scopeImage.path),
      thumbnailUrl: appUrl(scopeImage.path),
      primaryImageOfPage: {
        '@type': 'ImageObject',
        contentUrl: appUrl(scopeImage.path),
        width: scopeImage.width,
        height: scopeImage.height,
        encodingFormat: 'image/svg+xml'
      }
    } : {}),
    mainEntity: { '@type': 'ItemList', itemListElement: items }
  };
}

export function renderScopePage(templateHtml, graphData, fieldId, domainId = null, scopeImage = null) {
  const field = graphData.fields[fieldId];
  const domain = domainId ? graphData.domains[domainId] : null;
  const canonicalUrl = appUrl(domainId ? domainPath(graphData, domainId) : fieldPath(graphData, fieldId));
  const markdownUrl = `${canonicalUrl}index.html.md`;
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
  if (scopeImage) {
    const imageUrl = appUrl(scopeImage.path);
    const imageAlt = scopeImageAlt(graphData, fieldId, domainId);
    html = replaceFirst(html, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    html = replaceFirst(html, /<meta property="og:image:width" content="[^"]*">/, `<meta property="og:image:width" content="${scopeImage.width}">`);
    html = replaceFirst(html, /<meta property="og:image:height" content="[^"]*">/, `<meta property="og:image:height" content="${scopeImage.height}">`);
    html = replaceFirst(html, /<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}">`);
    html = replaceFirst(html, /<meta name="twitter:card" content="[^"]*">/, '<meta name="twitter:card" content="summary_large_image">');
  }
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n  <base href="${domainId ? '../../' : '../'}">\n  <meta name="atlas:scope" content="${escapeHtml(fieldId)}">${domainId ? `\n  <meta name="atlas:domain" content="${escapeHtml(domainId)}">\n  <link rel="up" href="/${fieldPath(graphData, fieldId)}">` : ''}`
  );
  const jsonLd = JSON.stringify(scopePageJsonLd(graphData, fieldId, domainId, scopeImage), null, 2);
  const imageMetadata = scopeImageMetadata(graphData, fieldId, domainId, scopeImage);
  html = html.replace('</head>', `  <link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}" title="Markdown taxonomy record">\n  ${imageMetadata ? `${imageMetadata}\n  ` : ''}<script id="taxonomy-page-jsonld" type="application/ld+json">\n${jsonLd}\n  </script>\n</head>`);
  const staticGraph = renderScopeStaticGraph(graphData, fieldId, domainId, scopeImage);
  if (staticGraph) {
    html = html.replace('<div id="graphLoader" class="graph-loader" role="status" aria-live="polite">Preparing the atlas…</div>', staticGraph);
  }
  return html.replace(/<noscript>[\s\S]*?<\/noscript>/, renderScopeFallback(graphData, fieldId, domainId));
}

export async function generateConceptPages({ graphData, templateHtml, distUrl, fieldImages = {}, domainImages = {}, removedDomains = [] }) {
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
    await writeFile(new URL('index.html', pageDir), minifyHtml(renderScopePage(templateHtml, graphData, fieldId, null, fieldImages[fieldId])));
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

import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, renderInlineMath, stripInlineMath } from './inline-math.mjs';
import { minifyHtml } from './minify-html.mjs';

const SITE_ORIGIN = 'https://atlas.madvay.com';
const appUrl = (pathname = '') => new URL(pathname, `${SITE_ORIGIN}/`).toString();
const conceptPath = (nodeId) => `concepts/${encodeURIComponent(nodeId)}/`;
const fieldPath = (graphData, fieldId) => `${graphData.fields[fieldId]?.path ?? fieldId}/`;
const domainPath = (graphData, domainId) => `${fieldPath(graphData, graphData.domains[domainId]?.field)}${encodeURIComponent(domainId)}/`;

function fieldIdForNode(graphData, node) {
  return node.primaryField ?? graphData.domains[node.primaryDomain]?.field ?? graphData.meta.defaultField;
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

export function inlineSvgFragment(svg) {
  const fragment = String(svg)
    .replace(/^\uFEFF?\s*<\?xml\s+[^?]*\?>\s*/i, '')
    .replace(/^\s*<!DOCTYPE\s+svg(?:\s+[^>]*)?>\s*/i, '')
    .trim();
  if (!fragment.startsWith('<svg ') || !fragment.endsWith('</svg>')) {
    throw new Error('The directory page requires a complete SVG document from the runtime exporter.');
  }
  return fragment;
}

function svgDimensions(svgFragment) {
  const rootTag = svgFragment.match(/^<svg\b[^>]*>/i)?.[0] ?? '';
  const width = Number(rootTag.match(/\bwidth="([0-9.]+)"/)?.[1]);
  const height = Number(rootTag.match(/\bheight="([0-9.]+)"/)?.[1]);
  return {
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined
  };
}

function renderStats(graphData) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure').length;
  const junctions = graphData.nodes.length - concepts;
  const stats = [
    [concepts, 'concepts'],
    [graphData.edges.length, 'relations'],
    [Object.keys(graphData.domains).length, 'domains'],
    [Object.keys(graphData.fields).length, 'fields'],
    [junctions, 'construction junctions']
  ];
  return `<dl class="atlas-stats">${stats.map(([value, label]) => `<div><dt>${value.toLocaleString('en-US')}</dt><dd>${escapeHtml(label)}</dd></div>`).join('')}</dl>`;
}

function renderFieldOverview(graphData) {
  const fieldIds = orderedIds(graphData.meta.fieldOrder, graphData.fields);
  return `<section aria-labelledby="fields-heading">
    <h2 id="fields-heading">Fields and domains</h2>
    <div class="field-grid">${fieldIds.map((fieldId) => {
      const field = graphData.fields[fieldId];
      const domains = orderedIds(graphData.meta.domainOrder, graphData.domains)
        .filter((domainId) => graphData.domains[domainId]?.field === fieldId);
      return `<article class="field-card"><h3><a href="/${fieldPath(graphData, fieldId)}">${escapeHtml(field.label)}</a></h3><p>${escapeHtml(field.description)}</p><ul class="domain-chips">${domains.map((domainId) => {
        const domain = graphData.domains[domainId];
        return `<li><a href="/${domainPath(graphData, domainId)}"><span class="domain-swatch" style="--domain-color:${escapeHtml(domain.color)}" aria-hidden="true"></span>${escapeHtml(domain.label)}</a></li>`;
      }).join('')}</ul></article>`;
    }).join('')}</div>
  </section>`;
}

function renderEdgeLegend(graphData) {
  const edgeTypeIds = orderedIds(graphData.meta.edgeTypeOrder, graphData.edgeTypes)
    .filter((edgeTypeId) => graphData.edges.some((edge) => edge.type === edgeTypeId));
  return `<details class="semantic-directory">
    <summary>Relation legend: ${edgeTypeIds.length} active meanings</summary>
    <div class="edge-legend">${edgeTypeIds.map((edgeTypeId) => {
      const edgeType = graphData.edgeTypes[edgeTypeId];
      return `<article><h3><span class="edge-sample edge-${escapeHtml(edgeType.lineStyle ?? 'solid')}" style="--edge-color:${escapeHtml(edgeType.color)}" aria-hidden="true"></span>${escapeHtml(edgeType.label)}</h3><p>${escapeHtml(edgeType.description)}</p></article>`;
    }).join('')}</div>
  </details>`;
}

function renderConceptDirectory(graphData) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure');
  const fieldIds = orderedIds(graphData.meta.fieldOrder, graphData.fields);
  const domainIds = orderedIds(graphData.meta.domainOrder, graphData.domains);
  const sections = fieldIds.map((fieldId) => {
    const domains = domainIds.filter((domainId) => graphData.domains[domainId]?.field === fieldId);
    const domainSections = domains.map((domainId) => {
      const nodes = concepts
        .filter((node) => fieldIdForNode(graphData, node) === fieldId && node.primaryDomain === domainId)
        .sort((a, b) => stripInlineMath(a.label).localeCompare(stripInlineMath(b.label)));
      if (!nodes.length) return '';
      return `<section class="concept-domain"><h4><a href="/${domainPath(graphData, domainId)}"><span class="domain-swatch" style="--domain-color:${escapeHtml(graphData.domains[domainId].color)}" aria-hidden="true"></span>${escapeHtml(graphData.domains[domainId].label)}</a> <small>${nodes.length}</small></h4><ul>${nodes.map((node) => `<li><a href="/${conceptPath(node.id)}">${renderInlineMath(node.label, 'mathml')}</a></li>`).join('')}</ul></section>`;
    }).join('');
    return `<section class="concept-field"><h3><a href="/${fieldPath(graphData, fieldId)}">${escapeHtml(graphData.fields[fieldId].label)}</a></h3>${domainSections}</section>`;
  }).join('');
  return `<details id="concept-directory" class="semantic-directory concept-directory">
    <summary>Browse all ${concepts.length.toLocaleString('en-US')} canonical concepts</summary>
    <p>These are ordinary HTML links to the canonical concept pages. Construction junctions remain visible in the diagram but are omitted here because they are visual combination devices rather than standalone concepts.</p>
    ${sections}
  </details>`;
}

function directoryPageJsonLd({ graphData, atlasSvgPath, directoryPath, graphDataPath, dimensions, lastModified }) {
  const canonicalUrl = appUrl(directoryPath);
  const svgUrl = appUrl(atlasSvgPath);
  const fieldIds = orderedIds(graphData.meta.fieldOrder, graphData.fields);
  const domainIds = orderedIds(graphData.meta.domainOrder, graphData.domains);
  const image = {
    '@type': 'ImageObject',
    '@id': `${svgUrl}#image`,
    name: `Complete ${graphData.meta.title}`,
    caption: 'The complete all-field, all-domain, all-relation SVG export of the Atlas of Fundamental Concepts.',
    contentUrl: svgUrl,
    url: svgUrl,
    encodingFormat: 'image/svg+xml',
    license: graphData.meta.licenseUrl,
    creditText: graphData.meta.attribution,
    ...(dimensions.width ? { width: dimensions.width } : {}),
    ...(dimensions.height ? { height: dimensions.height } : {})
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': canonicalUrl,
    name: `Complete ${graphData.meta.title}`,
    description: graphData.meta.description,
    url: canonicalUrl,
    ...(lastModified ? { dateModified: lastModified } : {}),
    isPartOf: { '@type': 'WebSite', name: graphData.meta.title, url: appUrl() },
    hasPart: [
      ...fieldIds.map((fieldId) => ({
        '@type': 'CollectionPage',
        name: graphData.fields[fieldId].label,
        url: appUrl(fieldPath(graphData, fieldId))
      })),
      ...domainIds.map((domainId) => ({
        '@type': 'CollectionPage',
        name: graphData.domains[domainId].label,
        url: appUrl(domainPath(graphData, domainId))
      }))
    ],
    primaryImageOfPage: image,
    mainEntity: {
      '@type': 'Dataset',
      name: graphData.meta.title,
      description: graphData.meta.description,
      url: appUrl(graphDataPath),
      license: graphData.meta.licenseUrl,
      creator: { '@type': 'Person', name: 'Advay Mengle', url: 'https://advaymengle.com/' },
      distribution: [
        { '@type': 'DataDownload', contentUrl: appUrl(graphDataPath), encodingFormat: 'application/json' },
        { '@type': 'DataDownload', contentUrl: svgUrl, encodingFormat: 'image/svg+xml' }
      ]
    }
  };
}

export function renderDirectoryPage({
  graphData,
  svg,
  atlasSvgPath = 'static/atlas.svg',
  directoryPath = 'directory/',
  graphDataPath = 'content/atlas.json',
  lastModified
}) {
  const svgFragment = inlineSvgFragment(svg);
  const dimensions = svgDimensions(svgFragment);
  const canonicalUrl = appUrl(directoryPath);
  const svgUrl = appUrl(atlasSvgPath);
  const pageTitle = `${graphData.meta.title} — Directory`;
  const description = `The complete all-field, all-domain, all-relation visual export of ${graphData.meta.title}, with crawlable concept links and relation definitions.`;
  const jsonLd = directoryPageJsonLd({ graphData, atlasSvgPath, directoryPath, graphDataPath, dimensions, lastModified });
  const modifiedMeta = lastModified ? `<meta name="dateModified" content="${escapeHtml(lastModified)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  ${modifiedMeta}
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" type="image/svg+xml" href="${svgUrl}" title="Standalone all-in atlas SVG">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(graphData.meta.title)}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${svgUrl}">
  <meta property="og:image:type" content="image/svg+xml">
  <title>${escapeHtml(pageTitle)}</title>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb;line-height:1.5}*{box-sizing:border-box}body{margin:0}a{color:#1746a2;text-underline-offset:.16em}a:hover{text-decoration-thickness:2px}.page-header,.semantic-content,.page-footer{max-width:1280px;margin-inline:auto;padding-inline:clamp(1rem,3vw,2.5rem)}.page-header{padding-top:2rem;padding-bottom:1.25rem}.page-header .brand{display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}.page-header .brand-link{color:inherit;text-decoration:none}.page-header .brand-link:hover,.page-header .brand-link:focus-visible{text-decoration:none}.page-header .brand-logo{width:58px;height:58px;object-fit:contain;flex:0 0 auto}.page-header .brand-copy{min-width:0;display:grid;gap:.4rem}.page-header h1{font-size:clamp(2rem,5vw,4rem);line-height:1.05;margin:.15rem 0 .8rem}.lede{font-size:1.05rem;color:#445168}.resource-nav{display:flex;flex-wrap:wrap;gap:.55rem;margin:1.15rem 0}.resource-nav a{display:inline-flex;align-items:center;border:1px solid #c8d1df;background:#fff;border-radius:999px;padding:.48rem .75rem;text-decoration:none;font-weight:700;font-size:.86rem}.atlas-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.65rem;margin:1.25rem 0 0}.atlas-stats div{background:#fff;border:1px solid #d7dee9;border-radius:12px;padding:.75rem .9rem}.atlas-stats dt{font-size:1.45rem;font-weight:800}.atlas-stats dd{margin:0;color:#5a667a;font-size:.8rem}.semantic-content{padding-bottom:1.5rem}.semantic-content>section,.semantic-directory{display:block;background:#fff;border:1px solid #d7dee9;border-radius:14px;padding:1rem 1.1rem;margin:.85rem 0}.semantic-content h2{margin:.05rem 0 .4rem}.semantic-content p{color:#536075}.field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:.8rem;margin-top:.9rem}.field-card{border:1px solid #e1e6ef;border-radius:11px;padding:.9rem}.field-card h3{margin:0 0 .35rem}.field-card p{margin:.25rem 0}.domain-chips{display:flex;flex-wrap:wrap;gap:.35rem;list-style:none;padding:0;margin:.75rem 0 0}.domain-chips li{display:inline-flex;font-size:.74rem;border:1px solid #dce2eb;border-radius:999px}.domain-chips a{display:inline-flex;align-items:center;gap:.32rem;padding:.22rem .45rem;text-decoration:none}.domain-chips a:hover,.domain-chips a:focus-visible{text-decoration:underline}.domain-swatch{display:inline-block;width:.72em;height:.72em;border-radius:50%;background:var(--domain-color);flex:none}.semantic-directory>summary{cursor:pointer;font-size:1rem;font-weight:800}.edge-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:.6rem;margin-top:.9rem}.edge-legend article{border-top:1px solid #e3e8f0;padding:.65rem 0}.edge-legend h3{font-size:.9rem;margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem}.edge-legend p{font-size:.82rem;margin:0}.edge-sample{display:inline-block;width:2.4rem;border-top:3px solid var(--edge-color)}.edge-dashed{border-top-style:dashed}.edge-dotted{border-top-style:dotted}.concept-directory>p{font-size:.86rem}.concept-field{margin:1.1rem 0}.concept-field>h3{border-bottom:2px solid #dde4ee;padding-bottom:.35rem}.concept-domain{margin:.8rem 0}.concept-domain h4{display:flex;align-items:center;gap:.4rem;margin:.25rem 0}.concept-domain h4 a{display:inline-flex;align-items:center;gap:.4rem}.concept-domain small{color:#6b7688;font-weight:600}.concept-domain ul{columns:3;column-gap:1.5rem;margin:.25rem 0;padding-left:1.15rem}.concept-domain li{break-inside:avoid;margin:.13rem 0;font-size:.82rem}.atlas-figure{margin:0;background:#e9eef6;border-top:1px solid #ccd5e2;border-bottom:1px solid #ccd5e2}.atlas-figure-header{max-width:1280px;margin:auto;padding:1.25rem clamp(1rem,3vw,2.5rem) .8rem}.atlas-figure-header h2{margin:0}.atlas-figure-header p{margin:.3rem 0;color:#536075}.atlas-svg-scroll{overflow:auto;padding:0 1rem 1.5rem}.atlas-svg-scroll>svg{display:block;width:max(100%,1400px);height:auto;margin:auto;background:#fbfcfe;box-shadow:0 10px 35px rgba(15,23,42,.16)}.atlas-figure figcaption{max-width:1280px;margin:auto;padding:0 clamp(1rem,3vw,2.5rem) 1.25rem;color:#5b6678;font-size:.83rem}.page-footer{padding-top:1.3rem;padding-bottom:2.5rem;color:#596579;font-size:.83rem}.page-footer p{margin:.3rem 0}@media(max-width:900px){.concept-domain ul{columns:2}.atlas-svg-scroll>svg{width:1200px}}@media(max-width:600px){.concept-domain ul{columns:1}.page-header{padding-top:1.25rem}.field-grid,.edge-legend{grid-template-columns:1fr}}@media print{.resource-nav,.semantic-directory{display:none}.atlas-svg-scroll{overflow:visible;padding:0}.atlas-svg-scroll>svg{width:100%;box-shadow:none}.atlas-figure{border:0}}
  </style>
</head>
<body>
  <header class="page-header">
    <div class="brand">
      <a class="brand-link" href="/" aria-label="Atlas of Fundamental Concepts home">
        <img class="brand-logo" src="/assets/atlas-logo.png" alt="Atlas of Fundamental Concepts logo" width="58" height="58" decoding="async">
      </a>
      <div class="brand-copy">
        <h1>${escapeHtml(pageTitle)}</h1>
        <p class="lede">${escapeHtml(graphData.meta.description)}</p>
      </div>
    </div>
    <nav class="resource-nav" aria-label="Atlas resources">
      <a href="/">Explore the interactive atlas</a>
      <a href="/views/">Explore stories and views</a>
      <a href="#concept-directory">Browse canonical concepts</a>
      <a href="${svgUrl}">Open the standalone SVG</a>
      <a href="/${escapeHtml(graphDataPath)}">Download graph JSON</a>
    </nav>
    ${renderStats(graphData)}
  </header>
  <main>
    <div class="semantic-content">
      ${renderFieldOverview(graphData)}
      ${renderEdgeLegend(graphData)}
      ${renderConceptDirectory(graphData)}
    </div>
    <figure class="atlas-figure" aria-labelledby="complete-atlas-heading">
      <div class="atlas-figure-header"><h2 id="complete-atlas-heading">Complete visual graph</h2><p>Every domain, active relation type, construction junction, and cross-field connection is enabled. Select any concept label in the SVG to open its atlas location.</p></div>
      <div class="atlas-svg-scroll">${svgFragment}</div>
    </figure>
  </main>
  <footer class="page-footer">
    <p>${escapeHtml(graphData.meta.direction)}</p>
    <p>${escapeHtml(graphData.meta.attribution)} · <a href="${escapeHtml(graphData.meta.licenseUrl)}">${escapeHtml(graphData.meta.license)}</a></p>
  </footer>
</body>
</html>`;
}

export async function generateDirectoryPage(options) {
  const pagePath = options.directoryPath ?? 'directory/';
  const pageDirectory = new URL(pagePath, options.distUrl);
  await mkdir(pageDirectory, { recursive: true });
  const html = renderDirectoryPage(options);
  await writeFile(new URL('index.html', pageDirectory), minifyHtml(html));
  return html;
}

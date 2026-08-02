import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, renderInlineMath } from './inline-math.mjs';
import { importTypeScriptModule } from './import-typescript-module.mjs';
import { minifyHtml } from './minify-html.mjs';
import { staticThemeCss, themeBootstrapScript } from './page-theme.mjs';

const { addShareUiStateToParams } = await importTypeScriptModule(
  new URL('../src/state/ui-state.ts', import.meta.url)
);

const SITE_ORIGIN = 'https://atlas.madvay.com';
const appUrl = (pathname = '') => new URL(pathname, `${SITE_ORIGIN}/`).toString();
const conceptPath = (nodeId) => `concepts/${encodeURIComponent(nodeId)}/`;
const viewPath = (viewId) => `views/${encodeURIComponent(viewId)}/`;
const fieldPath = (graphData, fieldId) => `${graphData.fields[fieldId]?.path ?? fieldId}/`;
const domainPath = (graphData, domainId) => `${fieldPath(graphData, graphData.domains[domainId]?.field)}${encodeURIComponent(domainId)}/`;

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

function requireRecord(records, id, label) {
  const record = records[id];
  if (!record) throw new Error(`The user guide requires ${label} "${id}".`);
  return record;
}

function requireNode(graphData, id) {
  const node = graphData.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`The user guide requires concept or junction "${id}".`);
  return node;
}

function requireView(viewsData, id) {
  const view = viewsData.views.find((candidate) => candidate.id === id);
  if (!view) throw new Error(`The user guide requires Story or View "${id}".`);
  return view;
}

function activeEdgeTypeIds(graphData) {
  return orderedIds(graphData.meta.edgeTypeOrder, graphData.edgeTypes)
    .filter((id) => graphData.edgeTypes[id]?.activeInDataset !== false);
}

function stateFor(graphData, overrides = {}) {
  const fieldIds = overrides.fields ?? orderedIds(graphData.meta.fieldOrder, graphData.fields);
  const domainIds = overrides.domains ?? orderedIds(graphData.meta.domainOrder, graphData.domains);
  return {
    selectedFields: new Set(fieldIds),
    selectedDomains: new Set(domainIds),
    selectedEdgeTypes: new Set(overrides.edgeTypes ?? activeEdgeTypeIds(graphData)),
    excludedFields: new Set(overrides.excludedFields ?? []),
    excludedDomains: new Set(overrides.excludedDomains ?? []),
    prohibitedDomains: new Set(overrides.prohibitedDomains ?? []),
    crossFieldVisibility: overrides.crossFieldVisibility ?? 'all',
    showPrimaryOnly: overrides.showPrimaryOnly ?? false,
    hideIsolates: overrides.hideIsolates ?? false,
    showEdgeLabels: overrides.edgeLabels ?? true,
    showJunctions: overrides.junctions ?? true,
    edgeZoomActivation: overrides.edgeZoomActivation ?? true,
    hidePrerequisites: overrides.hidePrerequisites ?? false,
    neighborhoodActive: false,
    neighborhoodElementId: null,
    layout: overrides.layout ?? 'atlas',
    searchQuery: '',
    filtersOpen: false,
    detailsOpen: false
  };
}

function compactPermalink(pathname, graphData, shareCodec, overrides = {}, extraParams = {}) {
  const url = new URL(pathname, `${SITE_ORIGIN}/`);
  addShareUiStateToParams(url.searchParams, stateFor(graphData, overrides), shareCodec);
  for (const [name, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  }
  return url.toString();
}

export function buildGuideLinks({ graphData, viewsData, shareCodec }) {
  requireRecord(graphData.fields, 'mathematics', 'field');
  requireRecord(graphData.fields, 'physics', 'field');
  requireRecord(graphData.fields, 'chemistry', 'field');
  requireRecord(graphData.domains, 'algebra', 'domain');
  requireRecord(graphData.domains, 'quantum-mechanics', 'domain');
  requireRecord(graphData.domains, 'chemical-foundations', 'domain');
  requireRecord(graphData.domains, 'category-theory', 'domain');
  requireNode(graphData, 'group');
  requireNode(graphData, 'ring');
  requireNode(graphData, 'electron');
  requireNode(graphData, 'molecule');
  requireNode(graphData, 'topological_space');
  requireNode(graphData, 'j_ordered_group');
  const setsToSpaces = requireView(viewsData, 'from-sets-to-spaces');
  if (!(setsToSpaces.nodeSequence ?? []).includes('topological_space')) {
    throw new Error('The user-guide Story example requires topological_space in from-sets-to-spaces.');
  }

  const mathematicsDomains = orderedIds(graphData.meta.domainOrder, graphData.domains)
    .filter((domainId) => graphData.domains[domainId]?.field === 'mathematics');
  const orderAndAlgebraDomains = ['order', 'algebra'];

  return {
    atlas: appUrl(),
    directory: appUrl('directory/'),
    stories: appUrl('views/'),
    searchElectron: appUrl('?q=electron'),
    group: appUrl(conceptPath('group')),
    ring: appUrl(conceptPath('ring')),
    molecule: appUrl(conceptPath('molecule')),
    algebraDomain: appUrl(domainPath(graphData, 'algebra')),
    quantumMechanicsDomain: appUrl(domainPath(graphData, 'quantum-mechanics')),
    story: appUrl(viewPath('from-sets-to-spaces')),
    storyTopologicalSpace: `${appUrl(viewPath('from-sets-to-spaces'))}?node=topological_space`,
    orderedGroupJunction: compactPermalink(
      fieldPath(graphData, 'mathematics'),
      graphData,
      shareCodec,
      { fields: ['mathematics'], domains: orderAndAlgebraDomains },
      { node: 'j_ordered_group' }
    ),
    algebraOnly: compactPermalink(
      conceptPath('group'),
      graphData,
      shareCodec,
      { fields: ['mathematics'], domains: ['algebra'] }
    ),
    domainsOverview: compactPermalink(
      fieldPath(graphData, 'mathematics'),
      graphData,
      shareCodec,
      { fields: ['mathematics'], domains: mathematicsDomains, layout: 'domains', crossFieldVisibility: 'contextual' },
      { domain: 'algebra' }
    ),
    fieldsOverview: compactPermalink(
      '',
      graphData,
      shareCodec,
      { layout: 'fields', crossFieldVisibility: 'all' },
      { field: 'physics' }
    ),
    compareGroupRing: compactPermalink(
      fieldPath(graphData, 'mathematics'),
      graphData,
      shareCodec,
      { fields: ['mathematics'], domains: ['algebra'] },
      { node: 'group', compare: 'group,ring' }
    ),
    chemistryPrimaryOnly: compactPermalink(
      fieldPath(graphData, 'chemistry'),
      graphData,
      shareCodec,
      {
        fields: ['chemistry'],
        domains: orderedIds(graphData.meta.domainOrder, graphData.domains)
          .filter((domainId) => graphData.domains[domainId]?.field === 'chemistry'),
        showPrimaryOnly: true
      },
      { node: 'molecule' }
    )
  };
}

function guideJsonLd({ graphData, guidePath, lastModified }) {
  const canonicalUrl = appUrl(guidePath);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': canonicalUrl,
    headline: `${graphData.meta.title} User Guide`,
    name: `${graphData.meta.title} User Guide`,
    description: `How to navigate, read, filter, compare, share, and export ${graphData.meta.title}.`,
    url: canonicalUrl,
    ...(lastModified ? { dateModified: lastModified } : {}),
    author: { '@type': 'Person', name: 'Advay Mengle', url: 'https://advaymengle.com/' },
    isPartOf: { '@type': 'WebSite', name: graphData.meta.title, url: appUrl() },
    license: graphData.meta.licenseUrl,
    copyrightNotice: graphData.meta.attribution,
    about: orderedIds(graphData.meta.fieldOrder, graphData.fields).map((fieldId) => graphData.fields[fieldId]?.label).filter(Boolean)
  };
}

function renderRelationLegend(graphData) {
  const ids = activeEdgeTypeIds(graphData);
  return `<details id="relation-legend" class="guide-card relation-legend">
    <summary>Complete relation key: ${ids.length} active meanings</summary>
    <p>Arrow direction and edge type are authored claims. The exact annotation on an edge states what changes in that particular relation.</p>
    <div class="relation-grid">${ids.map((id) => {
      const type = graphData.edgeTypes[id];
      return `<article><h3><span class="edge-sample edge-${escapeHtml(type.lineStyle ?? 'solid')}" style="--edge-color:${escapeHtml(type.color)}" aria-hidden="true"></span>${escapeHtml(type.label)}</h3><p>${escapeHtml(type.description)}</p></article>`;
    }).join('')}</div>
  </details>`;
}

function renderDomainExamples(graphData) {
  return ['algebra', 'quantum-mechanics', 'chemical-foundations'].map((domainId) => {
    const domain = graphData.domains[domainId];
    return `<a class="domain-pill" href="/${domainPath(graphData, domainId)}"><span class="domain-swatch" style="--domain-color:${escapeHtml(domain.color)}" aria-hidden="true"></span>${escapeHtml(domain.label)}</a>`;
  }).join('');
}

function renderQuickStartCard(title, body, href, linkLabel, id = '') {
  return `<article class="quick-card"${id ? ` id="${escapeHtml(id)}"` : ''}><h3>${escapeHtml(title)}</h3><p>${body}</p><a class="try-link" href="${escapeHtml(href)}">${escapeHtml(linkLabel)} <span aria-hidden="true">→</span></a></article>`;
}

export function renderGuidePage({
  graphData,
  viewsData,
  shareCodec,
  guidePath = 'guide/',
  lastModified
}) {
  const links = buildGuideLinks({ graphData, viewsData, shareCodec });
  const canonicalUrl = appUrl(guidePath);
  const pageTitle = `${graphData.meta.title} — User Guide`;
  const description = `A complete user guide to navigating, reading, filtering, comparing, sharing, and exporting ${graphData.meta.title}.`;
  const jsonLd = guideJsonLd({ graphData, guidePath, lastModified });
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure').length;
  const junctions = graphData.nodes.length - concepts;
  const modifiedMeta = lastModified ? `<meta name="dateModified" content="${escapeHtml(lastModified)}">` : '';
  const group = requireNode(graphData, 'group');
  const ring = requireNode(graphData, 'ring');
  const molecule = requireNode(graphData, 'molecule');
  const topologicalSpace = requireNode(graphData, 'topological_space');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f6f7f9">
  ${themeBootstrapScript}
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  ${modifiedMeta}
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" type="text/markdown" href="${canonicalUrl}index.html.md" title="Markdown user guide">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${escapeHtml(graphData.meta.title)}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${appUrl('assets/atlas-logo.png')}">
  <meta name="twitter:card" content="summary">
  <title>${escapeHtml(pageTitle)}</title>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    ${staticThemeCss}
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;scroll-behavior:smooth;--body-text:#3f4b60;--code-bg:#edf1f7;--code-line:#dbe2ec;--control-line:#c8d1df;--focus-soft:rgba(23,70,162,.08);--callout-bg:#fff9e8;--callout-border:#e3a008;--callout-text:#6c4b00;--allowed-bg:#e8edf5;--allowed-text:#445168;--excluded-bg:#fff0b8;--excluded-text:#7a5700;--prohibited-bg:#fee2e2;--prohibited-text:#9b1c1c;--node-border:#fff;--node-outline:#738098;--junction-bg:#fff;--junction-border:#3c4a61}
    :root[data-theme="dark"]{--body-text:#cbd5e1;--code-bg:#1e293b;--code-line:#334155;--control-line:#475569;--focus-soft:rgba(147,197,253,.16);--callout-bg:#3f2d12;--callout-border:#fbbf24;--callout-text:#fde68a;--allowed-bg:#263449;--allowed-text:#cbd5e1;--excluded-bg:#493914;--excluded-text:#fde68a;--prohibited-bg:#3f1d24;--prohibited-text:#fecaca;--node-border:#94a3b8;--node-outline:#0b1220;--junction-bg:#3b2718;--junction-border:#f59e0b}
    *{box-sizing:border-box}body{margin:0;background:var(--page-bg);color:var(--text)}a{color:var(--link);text-underline-offset:.16em}a:hover{text-decoration-thickness:2px}h1,h2,h3,h4{color:var(--heading)}code,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}code{font-size:.88em;background:var(--code-bg);border:1px solid var(--code-line);border-radius:5px;padding:.08em .3em}kbd{display:inline-block;min-width:1.7em;text-align:center;background:var(--panel);border:1px solid var(--control-line);border-bottom-width:2px;border-radius:5px;padding:.06em .34em;font-size:.78em;font-weight:700}.skip-link{position:fixed;z-index:20;left:1rem;top:-4rem;background:var(--panel);border:2px solid var(--link);border-radius:7px;padding:.55rem .8rem}.skip-link:focus{top:1rem}.page-header,.page-footer,.guide-shell{max-width:1280px;margin-inline:auto;padding-inline:clamp(1rem,3vw,2.5rem)}.page-header{padding-top:2rem;padding-bottom:1.25rem}.brand{display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}.brand-link{color:inherit;text-decoration:none}.brand-link:hover,.brand-link:focus-visible{text-decoration:none}.brand-logo{width:58px;height:58px;object-fit:contain;flex:0 0 auto}.brand-copy{min-width:0;display:grid;gap:.35rem}.kicker{text-transform:uppercase;letter-spacing:.1em;font-size:.7rem;font-weight:800;color:var(--muted)}.page-header h1{font-size:clamp(2rem,5vw,4rem);line-height:1.05;margin:.05rem 0 .45rem}.lede{font-size:1.08rem;color:var(--muted);max-width:850px;margin:.2rem 0}.resource-nav{display:flex;flex-wrap:wrap;gap:.55rem;margin:1.15rem 0}.resource-nav a,.try-link{display:inline-flex;align-items:center;border:1px solid var(--control-line);background:var(--panel);border-radius:999px;padding:.48rem .75rem;text-decoration:none;font-weight:750;font-size:.86rem}.resource-nav a:hover,.resource-nav a:focus-visible,.try-link:hover,.try-link:focus-visible{border-color:var(--link);box-shadow:0 0 0 2px var(--focus-soft)}.atlas-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.65rem;margin:1.25rem 0 0}.atlas-stats div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:.75rem .9rem}.atlas-stats dt{font-size:1.45rem;font-weight:800}.atlas-stats dd{margin:0;color:var(--muted-2);font-size:.8rem}.guide-shell{display:grid;grid-template-columns:minmax(210px,260px) minmax(0,1fr);gap:1rem;align-items:start;padding-bottom:2rem}.guide-toc{position:sticky;top:1rem;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:.9rem}.guide-toc h2{font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;margin:.1rem 0 .55rem;color:var(--muted)}.guide-toc ol{list-style:none;margin:0;padding:0}.guide-toc li+li{border-top:1px solid var(--line-soft)}.guide-toc a{display:block;padding:.45rem .35rem;text-decoration:none;font-size:.86rem;font-weight:650}.guide-content{min-width:0}.guide-section,.guide-card,.quick-card{background:var(--panel);border:1px solid var(--line);border-radius:14px}.guide-section{padding:clamp(1rem,2vw,1.35rem);margin:0 0 1rem;scroll-margin-top:1rem}.guide-section>h2{font-size:clamp(1.45rem,3vw,2rem);line-height:1.15;margin:.05rem 0 .45rem}.section-lede{font-size:1rem;color:var(--muted);margin:.15rem 0 1rem}.guide-section h3{line-height:1.25}.guide-section p,.guide-section li{color:var(--body-text)}.guide-section li+li{margin-top:.28rem}.quick-grid,.card-grid,.preference-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.quick-card,.guide-card{padding:1rem}.quick-card h3,.guide-card h3{margin:.05rem 0 .35rem}.quick-card p,.guide-card p{margin:.2rem 0 .8rem}.quick-card .try-link{margin-top:.25rem}.callout{border-left:4px solid var(--callout-border);background:var(--callout-bg);border-radius:0 10px 10px 0;padding:.75rem .9rem;margin:1rem 0}.callout strong{color:var(--callout-text)}.node-key,.suppression-key,.layout-grid{display:grid;gap:.65rem}.node-key{grid-template-columns:repeat(3,minmax(0,1fr))}.key-item{border:1px solid var(--line-soft);border-radius:11px;padding:.8rem}.concept-sample{display:inline-flex;width:2.25rem;height:1.4rem;border:3px solid var(--node-border);border-radius:9px;background:var(--sample-color,#4c78d0);box-shadow:0 0 0 1px var(--node-outline);vertical-align:middle;margin-right:.5rem}.junction-sample{display:inline-block;width:1.25rem;height:1.25rem;transform:rotate(45deg);background:var(--junction-bg);border:2px solid var(--junction-border);vertical-align:middle;margin:.15rem .8rem .15rem .3rem}.marker-sample{display:inline-flex;gap:.12rem;vertical-align:middle;margin-right:.5rem}.marker-sample span{width:.45rem;height:.45rem;border-radius:50%;background:var(--sample-color)}.domain-examples{display:flex;flex-wrap:wrap;gap:.4rem}.domain-pill{display:inline-flex;align-items:center;gap:.32rem;border:1px solid var(--line);border-radius:999px;padding:.25rem .5rem;text-decoration:none;font-size:.78rem;font-weight:700}.domain-swatch{display:inline-block;width:.72em;height:.72em;border-radius:50%;background:var(--domain-color);flex:none}.suppression-key{grid-template-columns:repeat(3,minmax(0,1fr));margin:.8rem 0}.suppression-state{border:1px solid var(--line-soft);border-radius:11px;padding:.8rem}.suppression-icon{display:inline-grid;place-items:center;width:1.7rem;height:1.7rem;border-radius:50%;font-weight:900;margin-right:.35rem}.allowed .suppression-icon{background:var(--allowed-bg);color:var(--allowed-text)}.excluded .suppression-icon{background:var(--excluded-bg);color:var(--excluded-text)}.prohibited .suppression-icon{background:var(--prohibited-bg);color:var(--prohibited-text)}.layout-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.layout-card{border:1px solid var(--line-soft);border-radius:11px;padding:.85rem}.layout-card h3{margin:.05rem 0 .25rem}.option-list{display:grid;grid-template-columns:minmax(180px,.34fr) 1fr;gap:0;border:1px solid var(--line-soft);border-radius:11px;overflow:hidden;margin:.8rem 0}.option-list dt,.option-list dd{margin:0;padding:.62rem .75rem;border-bottom:1px solid var(--line-soft)}.option-list dt{font-weight:800;background:var(--panel-2)}.option-list dd{color:var(--body-text)}.option-list dt:last-of-type,.option-list dd:last-of-type{border-bottom:0}.steps{counter-reset:step;list-style:none;padding:0;margin:.8rem 0}.steps li{counter-increment:step;position:relative;padding:.75rem .75rem .75rem 3rem;border:1px solid var(--line-soft);border-radius:11px;margin:.55rem 0}.steps li::before{content:counter(step);position:absolute;left:.75rem;top:.65rem;width:1.55rem;height:1.55rem;display:grid;place-items:center;border-radius:50%;background:var(--primary);color:#fff;font-size:.78rem;font-weight:800}.relation-legend{display:block;margin-top:1rem}.relation-legend>summary{cursor:pointer;font-size:1rem;font-weight:800}.relation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin-top:.8rem}.relation-grid article{border-top:1px solid var(--line-soft);padding:.65rem 0}.relation-grid h3{font-size:.9rem;margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem}.relation-grid p{font-size:.82rem;margin:0}.edge-sample{display:inline-block;width:2.4rem;border-top:3px solid var(--edge-color)}.edge-dashed{border-top-style:dashed}.edge-dotted{border-top-style:dotted}.permalink-anatomy{overflow-wrap:anywhere;background:var(--panel-2);border:1px solid var(--code-line);border-radius:10px;padding:.8rem}.permalink-anatomy b{color:var(--link)}.muted{color:var(--muted)}.page-footer{padding-top:.8rem;padding-bottom:2.5rem;color:var(--muted-2);font-size:.83rem}.page-footer p{margin:.3rem 0}@media(max-width:900px){.guide-shell{grid-template-columns:1fr}.guide-toc{position:static}.guide-toc ol{columns:2}.quick-grid,.card-grid,.preference-grid,.node-key,.suppression-key,.layout-grid,.relation-grid{grid-template-columns:1fr}}@media(max-width:600px){.page-header{padding-top:1.25rem}.guide-toc ol{columns:1}.option-list{grid-template-columns:1fr}.option-list dt{border-bottom:0;padding-bottom:.25rem}.option-list dd{padding-top:.25rem}.brand{align-items:flex-start}}@media print{:root,:root[data-theme="dark"]{color-scheme:light;--page-bg:#fff;--panel:#fff;--panel-2:#f8fafc;--text:#172033;--heading:#0f172a;--muted:#536075;--muted-2:#596579;--line:#bbb;--line-soft:#ddd;--link:#1746a2;--primary:#1e40af;--body-text:#3f4b60;--code-bg:#edf1f7;--code-line:#dbe2ec;--control-line:#c8d1df;--callout-bg:#fff9e8;--callout-border:#e3a008;--callout-text:#6c4b00;--allowed-bg:#e8edf5;--allowed-text:#445168;--excluded-bg:#fff0b8;--excluded-text:#7a5700;--prohibited-bg:#fee2e2;--prohibited-text:#9b1c1c;--node-border:#fff;--node-outline:#738098;--junction-bg:#fff;--junction-border:#3c4a61}.resource-nav,.guide-toc,.try-link{display:none}.guide-shell{display:block}.guide-section,.guide-card,.quick-card{break-inside:avoid}.page-header,.page-footer,.guide-shell{max-width:none;padding-inline:0}}
  </style>
</head>
<body>
  <a class="skip-link" href="#guide-content">Skip to the guide</a>
  <header class="page-header">
    <div class="brand">
      <a class="brand-link" href="/" aria-label="Atlas of Fundamental Concepts home"><img class="brand-logo" src="/assets/atlas-logo.png" alt="Atlas of Fundamental Concepts logo" width="58" height="58" decoding="async"></a>
      <div class="brand-copy"><div class="kicker">New and experienced users</div><h1>User Guide</h1><p class="lede">Use the atlas as a map, a reference, a guided narrative, or a reproducible research view. This page covers every user-facing control without requiring the interactive application to load.</p></div>
    </div>
    <nav class="resource-nav" aria-label="Atlas resources">
      <a href="${escapeHtml(links.atlas)}">Explore the interactive atlas</a>
      <a href="${escapeHtml(links.directory)}">Open the Directory</a>
      <a href="${escapeHtml(links.stories)}">Browse Stories &amp; Views</a>
      <a href="/data/">Browse published data</a>
      <a href="#quick-start">Start here</a>
      <a href="#sharing">Permalinks and export</a>
    </nav>
    <dl class="atlas-stats">
      <div><dt>${concepts.toLocaleString('en-US')}</dt><dd>canonical concepts</dd></div>
      <div><dt>${graphData.edges.length.toLocaleString('en-US')}</dt><dd>authored relations</dd></div>
      <div><dt>${Object.keys(graphData.domains).length}</dt><dd>domains</dd></div>
      <div><dt>${viewsData.views.length}</dt><dd>Stories and Views</dd></div>
      <div><dt>${junctions}</dt><dd>construction junctions</dd></div>
    </dl>
  </header>

  <div class="guide-shell">
    <nav class="guide-toc" aria-label="Guide contents">
      <h2>Contents</h2>
      <ol>
        <li><a href="#quick-start">1. Quick start</a></li>
        <li><a href="#reading">2. Read the graph</a></li>
        <li><a href="#navigation">3. Move and select</a></li>
        <li><a href="#search">4. Search and scope</a></li>
        <li><a href="#filters">5. Filters</a></li>
        <li><a href="#layouts">6. Layouts</a></li>
        <li><a href="#details">7. Details and sources</a></li>
        <li><a href="#stories">8. Stories and Views</a></li>
        <li><a href="#compare">9. Compare and connect</a></li>
        <li><a href="#preferences">10. Preferences</a></li>
        <li><a href="#sharing">11. Permalinks and export</a></li>
        <li><a href="#static">12. Static pages and data</a></li>
        <li><a href="#keyboard">13. Keyboard and mobile</a></li>
      </ol>
    </nav>

    <main id="guide-content" class="guide-content">
      <section id="quick-start" class="guide-section">
        <h2>1. Quick start</h2>
        <p class="section-lede">Choose a starting method based on what you want to do. Each example below opens real atlas content and, where relevant, a complete saved application state.</p>
        <div class="quick-grid">
          ${renderQuickStartCard('Find a concept', `Search for <strong>electron</strong>. Every match is marked; the highest-ranked result opens in Details.`, links.searchElectron, 'Search electron')}
          ${renderQuickStartCard('Read one concept', `Open ${renderInlineMath(group.label)} with its canonical concept URL, then follow its recorded relations.`, links.group, `Open ${group.label}`)}
          ${renderQuickStartCard('Follow a guided Story', `Start <strong>From sets to spaces</strong>, or jump directly to the ${renderInlineMath(topologicalSpace.label)} step.`, links.storyTopologicalSpace, 'Open Story at step 5')}
          ${renderQuickStartCard('See the large-scale structure', `Open Mathematics in <strong>Domains</strong> layout with Algebra selected. The aggregate arrows summarize the visible directed relations.`, links.domainsOverview, 'Open domain structure', 'example-domain-overview')}
          ${renderQuickStartCard('Inspect a multi-input construction', `Open the diamond where a group and total order jointly form a totally ordered group.`, links.orderedGroupJunction, 'Open construction diamond')}
          ${renderQuickStartCard('Reproduce a filtered view', `Open only Algebra, with ${renderInlineMath(group.label)} selected. The compact share tokens encode the complete filter and display state.`, links.algebraOnly, 'Open saved Algebra state')}
        </div>
      </section>

      <section id="reading" class="guide-section">
        <h2>2. Read the graph</h2>
        <p class="section-lede">The atlas is an editorial map of structural, mathematical, physical, chemical, historical, and evidential relationships. Position supports interpretation, but it is not a proof and horizontal distance is not a metric.</p>
        <div class="node-key">
          <div class="key-item"><h3><span class="concept-sample" style="--sample-color:${escapeHtml(graphData.domains.algebra.color)}" aria-hidden="true"></span>Concept node</h3><p>One solid rounded node represents one concept. Its fill and lane use its <strong>primary domain</strong>.</p></div>
          <div class="key-item"><h3><span class="marker-sample" aria-hidden="true"><span style="--sample-color:${escapeHtml(graphData.domains.algebra.color)}"></span><span style="--sample-color:${escapeHtml(graphData.domains['category-theory'].color)}"></span></span>Additional domains</h3><p>Small colored markers show secondary memberships. The concept remains one node, not a duplicate.</p></div>
          <div class="key-item"><h3><span class="junction-sample" aria-hidden="true"></span>Construction diamond</h3><p>A diamond is an <strong>AND</strong> construction: every listed input and the compatibility condition are required.</p></div>
        </div>
        <h3>Levels and lanes</h3>
        <p>In <strong>Layered</strong> layout, authored vertical levels generally move from less structure near the top toward specialization, added data or axioms, composition, approximation, physical realization, collective organization, or emergence below. Mathematics occupies the upper formal band. Physics and Chemistry share the lower scientific band while retaining their authored relative levels. Horizontal lanes group primary domains; their separation is organizational rather than quantitative.</p>
        <div class="domain-examples" aria-label="Example domain pages">${renderDomainExamples(graphData)}</div>
        <h3>Relations</h3>
        <p>An arrow has three parts: its direction, its relation type, and its specific annotation. Do not infer that every downward edge means “derived from,” or that experimental support is logical proof. Select an edge to read its exact meaning and sources.</p>
        <h3>Prerequisite context</h3>
        <p>When you select a subset of domains, the atlas can retain required prerequisite concepts from outside that subset. Those nodes are normally faded. They are context, not direct matches. <strong>Hide prerequisites</strong> removes this closure; domain and field suppression can restrict it more selectively.</p>
        <h3>Construction diamonds</h3>
        <p>When construction junctions are visible, incoming branches meet at a diamond and an outgoing branch reaches the result. When junctions are hidden, the atlas contracts the diamond into dashed direct branches. Labels beginning with <strong>jointly</strong> still mean every associated branch is required.</p>
        ${renderRelationLegend(graphData)}
      </section>

      <section id="navigation" class="guide-section">
        <h2>3. Move and select</h2>
        <div class="card-grid">
          <article class="guide-card"><h3>Pan and zoom</h3><ul><li>Drag blank graph space to pan.</li><li>Use the mouse wheel, a trackpad gesture, or pinch to zoom.</li><li>The <strong>Fit</strong> button, or <kbd>F</kbd>, fits all currently visible graph elements into the unobscured viewport.</li></ul></article>
          <article class="guide-card"><h3>Select and clear</h3><ul><li>Click or tap a node or interactive edge to select it and open Details.</li><li>Double-click or double-tap to select, center, and zoom toward it.</li><li>Click or tap blank graph space to clear selection, search marks, neighborhood emphasis, and Details.</li></ul></article>
          <article class="guide-card"><h3>Neighborhood emphasis</h3><p>Selecting a concept emphasizes its immediate neighborhood. The target-shaped toolbar button removes or restores that emphasis without changing the selected item.</p></article>
          <article class="guide-card"><h3>Panels and fullscreen</h3><p>Filters and Details slide over the graph instead of continuously relaying it. The fullscreen button hides both, then restores their previous open state.</p></article>
        </div>
        <div class="callout"><strong>Zoomed-out edges:</strong> with <strong>Edge interaction only when zoomed in</strong> enabled, edges remain visible at overview scale but do not capture clicks or taps. This makes panning and selecting nodes less error-prone.</div>
      </section>

      <section id="search" class="guide-section">
        <h2>4. Search and scope</h2>
        <h3>Search</h3>
        <ol class="steps"><li>Press <kbd>/</kbd> or select the search box.</li><li>Type a concept label, domain, field, or identifier. Suggestions are ranked as you type.</li><li>Use the arrow keys to choose a result and press Enter, or select a suggestion directly.</li><li>The atlas marks every match and opens the chosen concept. Search does not remove nonmatching concepts.</li></ol>
        <p><a class="try-link" href="${escapeHtml(links.searchElectron)}">Try the real “electron” search →</a></p>
        <h3>Field and domain scope</h3>
        <p>The top navigation opens the entire atlas or a field route such as Mathematics, Physics, or Chemistry. Domain pages such as <a href="${escapeHtml(links.algebraDomain)}">Algebra</a> and <a href="${escapeHtml(links.quantumMechanicsDomain)}">Quantum mechanics</a> are also interactive application routes with static, crawlable page content underneath.</p>
        <p>The <a href="${escapeHtml(links.directory)}">Directory</a> is the complete static overview: field and domain summaries, all canonical concept links, the relation legend, and the all-in SVG.</p>
      </section>

      <section id="filters" class="guide-section">
        <h2>5. Filters</h2>
        <p class="section-lede">Filters determine which concepts and relations are admitted. Display settings change how that admitted graph is presented. The URL records both groups independently.</p>
        <h3>Fields and domains</h3>
        <dl class="option-list">
          <dt>Checkbox</dt><dd>Adds or removes that field or domain from the direct selection.</dd>
          <dt>Linked name</dt><dd>Isolates that field or domain. Selecting its linked name again while it is the sole selection chooses every other field or domain instead.</dd>
          <dt><strong>all / none</strong></dt><dd>Selects every field and domain, or clears them all.</dd>
          <dt>Counts</dt><dd>Field counts include all concepts belonging to the field. Domain counts include primary and secondary memberships.</dd>
        </dl>
        <h3>Suppression states</h3>
        <p>The visibility button beside each domain cycles through three states. This is separate from whether its checkbox is selected.</p>
        <div class="suppression-key">
          <div class="suppression-state allowed"><h3><span class="suppression-icon" aria-hidden="true">○</span>Allowed</h3><p>Ordinary direct matching and prerequisite context.</p></div>
          <div class="suppression-state excluded"><h3><span class="suppression-icon" aria-hidden="true">◐</span>Excluded</h3><p>A node whose primary domain is excluded is not admitted merely as prerequisite context. An enabled, non-excluded secondary membership may still select it directly.</p></div>
          <div class="suppression-state prohibited"><h3><span class="suppression-icon" aria-hidden="true">×</span>Prohibited</h3><p>A node with that primary domain is always hidden, including through secondary memberships and prerequisite closure.</p></div>
        </div>
        <p>Field suppression is two-state: allowed or excluded. Domain suppression cycles gray → yellow → red → gray.</p>
        <h3>Relation types</h3>
        <p>Relation checkboxes control both the edges drawn and the relation types allowed to participate in prerequisite closure. Selecting a relation-type name isolates that type; selecting the same isolated name again chooses every other active type.</p>
        <h3>Display controls</h3>
        <dl class="option-list">
          <dt>Edge labels</dt><dd>Shows or hides the authored annotations attached to relations.</dd>
          <dt>Edge interaction only when zoomed in</dt><dd>Prevents overview-scale edges from capturing pointer input.</dd>
          <dt>Construction junctions</dt><dd>Shows diamonds, or contracts them into dashed direct AND-branches.</dd>
          <dt>Hide prerequisites</dt><dd>Disables transitive prerequisite context entirely.</dd>
          <dt>Show only primary domain matches</dt><dd>Ignores secondary domain memberships when deciding direct matches.</dd>
          <dt>Hide isolates without filtered relations</dt><dd>Removes nodes left with no incident relation under the current visibility and relation filters.</dd>
          <dt>Cross-field links: Contextual</dt><dd>Shows cross-field relations for overview and the selected neighborhood, rather than all the time.</dd>
          <dt>Cross-field links: All / Hidden</dt><dd>Shows every admitted cross-field relation, or none of them.</dd>
        </dl>
        <p><a class="try-link" href="${escapeHtml(links.chemistryPrimaryOnly)}">Open Chemistry with primary-only matching →</a></p>
      </section>

      <section id="layouts" class="guide-section">
        <h2>6. Layouts</h2>
        <div class="layout-grid">
          <article class="layout-card"><h3>Layered</h3><p>Uses authored vertical levels and primary-domain lanes. It is the best layout for reading structural progression and cross-field placement.</p></article>
          <article class="layout-card"><h3>Compact</h3><p>Uses only currently visible nodes. Empty authored levels consume no rows, and deterministic ordering makes the same visible set reproduce the same arrangement.</p></article>
          <article class="layout-card"><h3>Domains</h3><p>Preserves the Layered concept positions as a dim substrate, then summarizes visible primary domains as centroid nodes connected by weighted directed aggregate relations.</p></article>
          <article class="layout-card"><h3>Fields</h3><p>Uses the same semantic-overview method at field scale. It is useful for seeing the overall flow among Mathematics, Physics, and Chemistry.</p></article>
        </div>
        <p>In Domains and Fields layouts, selecting a centroid hides unrelated aggregate arrows until the selection is cleared. Selecting a centroid or aggregate relation opens counts and supporting relations in Details. Arrow thickness records how many visible authored relations contribute to that aggregate direction.</p>
        <p><a class="try-link" href="${escapeHtml(links.fieldsOverview)}">Open the field structure with Physics selected →</a></p>
        <div class="callout"><strong>Compact suggestion:</strong> the Compact toolbar button may briefly pulse amber when the current Layered graph is unusually wide and sparse. It is a suggestion, not an automatic layout change.</div>
      </section>

      <section id="details" class="guide-section">
        <h2>7. Details and sources</h2>
        <p class="section-lede">Details is the atlas’s reading surface. Select a concept, construction junction, edge, domain, field, or aggregate relation to inspect the corresponding record.</p>
        <div class="card-grid">
          <article class="guide-card"><h3>Concepts</h3><p>Summary, field and domain memberships, type and scale metadata, carriers, data, axioms or constraints, induced structures, editorial sections, notes, relations, Stories, Views, and sources.</p></article>
          <article class="guide-card"><h3>Relations</h3><p>Source and target, edge type, the exact “what changes” annotation, interpretation of the type, and citations. In relation groups, the destination appears first and the annotation follows as <em>via [annotation]</em>.</p></article>
          <article class="guide-card"><h3>Construction junctions</h3><p>All required inputs, the compatibility condition, and the resulting concept. Hidden-junction synthetic edges repeat the AND warning.</p></article>
          <article class="guide-card"><h3>Structure overlays</h3><p>Visible concept counts, aggregate in/out counts, and the authored relations contributing to a selected domain, field, or aggregate arrow.</p></article>
        </div>
        <h3>Header actions</h3>
        <ul><li><strong>Link</strong> copies a permalink containing the current selection, filter state, display state, and active comparison.</li><li><strong>Edit</strong> opens the corresponding source record on GitHub. This is for readers who want to propose corrections or additions.</li><li><strong>Compare</strong> appears when Experimental features are enabled and pins the selected concept into the comparison workspace.</li></ul>
        <p>Taxonomy badges and relation links are navigable. A relation link can reveal a concept currently hidden by ordinary filters, but it does not silently override a prohibited-domain setting.</p>
      </section>

      <section id="stories" class="guide-section">
        <h2>8. Stories and Views</h2>
        <div class="card-grid">
          <article class="guide-card"><h3>View</h3><p>A curated graph configuration: fields, domains, relation types, display options, layout, and optional core nodes.</p></article>
          <article class="guide-card"><h3>Story</h3><p>A View with an ordered concept sequence. Numbered badges mark its nodes, and Previous/Next controls move through the sequence while leaving the rest of the graph available for exploration.</p></article>
        </div>
        <ol class="steps"><li>Open <strong>Stories &amp; Views</strong> from the toolbar or the static directory.</li><li>Select a card. A Story begins at its first step; a View opens its curated configuration.</li><li>Expand the banner for the narrative and sequence controls.</li><li>Change filters or display options as needed. The changes remain attached as URL overrides while required Story or core nodes stay visible.</li><li>Use the explicit exit action at the top of Filters. For a core-node Story or View, <strong>Use primary domains</strong> converts the core nodes into their ordinary domain scope.</li></ol>
        <p><a class="try-link" href="${escapeHtml(links.story)}">Open “From sets to spaces” from the beginning →</a></p>
      </section>

      <section id="compare" class="guide-section">
        <h2>9. Compare and connect <span class="muted">(experimental)</span></h2>
        <p>Enable <strong>Experimental features</strong> in Preferences to reveal Compare in the toolbar and concept Details.</p>
        <div class="card-grid">
          <article class="guide-card"><h3>Overview</h3><p>Contrasts two concepts’ recorded definitions, taxonomy, source overlap, direct enabled relations, relation-type profile, and shared adjacent concepts.</p></article>
          <article class="guide-card"><h3>Connections</h3><p>Finds up to three short paths through the <strong>currently visible</strong> graph. Choose either traversal direction while preserving arrow meaning, or follow authored arrows from A to B only.</p></article>
        </div>
        <p>Connections never silently re-enable hidden concepts or relation types. A path is limited to twelve relations. You can choose an alternative path, fit it, select its nodes or edges, and copy its node sequence in Story-authoring format.</p>
        <p><a class="try-link" href="${escapeHtml(links.compareGroupRing)}">Prepare a real ${escapeHtml(group.label)}–${escapeHtml(ring.label)} comparison →</a></p>
      </section>

      <section id="preferences" class="guide-section">
        <h2>10. Preferences</h2>
        <p class="section-lede">Preferences are saved only in the current browser. They are intentionally excluded from shared URLs.</p>
        <dl class="option-list">
          <dt>Theme</dt><dd><strong>Dark</strong> and <strong>Light</strong> select a fixed appearance. <strong>System</strong> follows the operating system and updates when its color scheme changes. The interactive atlas and generated HTML pages use the same saved choice. Authored domain colors retain their meaning while text, relation colors, label fills, outlines, and backgrounds adjust for contrast. The Preferences default is System; before a choice has been saved, standalone static pages follow the system scheme.</dd>
          <dt>High resolution</dt><dd>Uses the browser’s full device pixel ratio. Turn it off to cap rendering resolution on dense or high-DPI displays.</dd>
          <dt>Fade transitions</dt><dd>Animates opacity and style changes over a short interval.</dd>
          <dt>Animate graph</dt><dd>Animates node motion and fitting during layout changes. Off by default.</dd>
          <dt>Auto-fit</dt><dd>Refits after filter or layout changes. Turn it off to preserve your current viewport.</dd>
          <dt>Mark additional domains</dt><dd>Shows small markers for secondary domain memberships.</dd>
          <dt>Overlay domains</dt><dd>Shows domain-name overlays at useful zoom ranges in Layered and Fields modes.</dd>
          <dt>Hide edges while moving</dt><dd>Temporarily suppresses edges during pan and zoom to improve interaction performance.</dd>
          <dt>Dim prerequisites</dt><dd>Fades prerequisite-only context. Turning it off leaves those nodes at ordinary opacity.</dd>
          <dt>Highlight prerequisite path</dt><dd>Highlights the selected concept’s transitive prerequisite nodes and edges.</dd>
          <dt>Experimental features</dt><dd>Reveals Compare and gates Motion blur and Allow node dragging.</dd>
          <dt>Motion blur</dt><dd>Uses the renderer’s motion-blur mode. It has no effect unless Experimental features is also enabled.</dd>
          <dt>Allow node dragging</dt><dd>Lets you move individual nodes. It has no effect unless Experimental features is also enabled; ordinary dragging pans the graph.</dd>
        </dl>
        <p><strong>Reset</strong> restores the default preference set. It does not change filters or the shareable display state.</p>
      </section>

      <section id="sharing" class="guide-section">
        <h2>11. Permalinks and export</h2>
        <h3>What a permalink preserves</h3>
        <p>The app separates shareable state into two compact, independently versioned tokens:</p>
        <div class="permalink-anatomy"><b>filter=</b> selected fields, domains, relation types, and suppression states<br><b>disp=</b> layout, cross-field visibility, primary-only matching, isolate handling, labels, junctions, edge activation, and prerequisite visibility<br><b>selection</b> a concept, edge, field, domain, or aggregate relation<br><b>compare</b> an optional comparison pair, mode, direction, and active path</div>
        <p>Canonical concept, field, domain, and Story/View paths remain human-readable. The compact tokens reproduce the live graph state. Browser-only Preferences are excluded.</p>
        <p>The guide’s saved-state examples are generated at build time with the same encoders used by the application. For example, <a href="${escapeHtml(links.algebraOnly)}">this Algebra permalink</a> contains real current identifiers and valid compact tokens.</p>
        <h3>SVG export</h3>
        <p>The download button exports the currently visible graph as a standalone SVG. It preserves the active resolved Light or Dark theme, layout, labels, annotations, domain markers, selection and emphasis, Story sequence badges, and metadata. Domains and Fields overlays export as shown. The build-published all-in export uses a deterministic Light theme and is always available at <a href="/static/atlas.svg">/static/atlas.svg</a>.</p>
      </section>

      <section id="static" class="guide-section">
        <h2>12. Static pages and data</h2>
        <p>The atlas is interactive, but its principal routes also publish static HTML for search engines, citation, accessibility, and no-script browsing.</p>
        <dl class="option-list">
          <dt><a href="/directory/">/directory/</a></dt><dd>Complete semantic directory plus the exact all-in SVG.</dd>
          <dt>/math/, /physics/, /chemistry/</dt><dd>Field landing pages with interactive scope and static SVG previews.</dd>
          <dt>/math/algebra/ and other domains</dt><dd>Domain landing pages scoped to primary-domain concepts.</dd>
          <dt>/concepts/&lt;id&gt;/</dt><dd>Canonical concept pages. Example: <a href="${escapeHtml(links.molecule)}">${renderInlineMath(molecule.label)}</a>.</dd>
          <dt><a href="/views/">/views/</a></dt><dd>Static Story and View directory, with one crawlable page per entry.</dd>
          <dt><a href="/data/">/data/</a></dt><dd>Dataset landing page with stable JSON URLs, checksums, and AI-use guidance.</dd>
          <dt><a href="/static/atlas.svg">/static/atlas.svg</a></dt><dd>Standalone vector map with links back to concept routes.</dd>
          <dt>Data section in Filters</dt><dd>Published graph, schema, Story/View data, share codec, provenance, content license, Directory, and standalone SVG.</dd>
        </dl>
        <p>The graph is editorially selective and source-backed. Use the citations attached to each record for technical verification rather than treating the map’s geometry as evidence by itself.</p>
      </section>

      <section id="keyboard" class="guide-section">
        <h2>13. Keyboard and mobile</h2>
        <div class="card-grid">
          <article class="guide-card"><h3>Keyboard</h3><p><kbd>/</kbd> focuses search · <kbd>F</kbd> fits the graph · <kbd>Escape</kbd> clears search and closes open mobile panels. Search suggestions and Compare tabs support arrow-key navigation.</p></article>
          <article class="guide-card"><h3>Mobile and touch</h3><p>Pinch to zoom and drag to pan. Filters enter from the left; Details rises from the bottom. The active Story or View context moves into the Details surface when necessary.</p></article>
        </div>
        <p>All toolbar buttons and filter controls have accessible names. The static Directory and this guide remain usable without JavaScript.</p>
      </section>
    </main>
  </div>

  <footer class="page-footer">
    <p>${escapeHtml(graphData.meta.direction)}</p>
    <p>${escapeHtml(graphData.meta.attribution)} · See the <a href="https://github.com/madvay/mAtlas/blob/main/LICENSE">LICENSE</a>.</p>
  </footer>
</body>
</html>`;
}

export async function generateGuidePage(options) {
  const pagePath = options.guidePath ?? 'guide/';
  const pageDirectory = new URL(pagePath, options.distUrl);
  await mkdir(pageDirectory, { recursive: true });
  const html = renderGuidePage(options);
  await writeFile(new URL('index.html', pageDirectory), minifyHtml(html));
  return html;
}

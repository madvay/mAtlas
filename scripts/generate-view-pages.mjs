import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, renderInlineMath } from './inline-math.mjs';
import { importTypeScriptModule } from './import-typescript-module.mjs';
import { minifyHtml } from './minify-html.mjs';

const { replaceInlineLatexWithUnicode } = await importTypeScriptModule(
  new URL('../src/core/lightweight-math.ts', import.meta.url)
);

const SITE_ORIGIN = 'https://atlas.madvay.com';
const appUrl = (pathname = '') => new URL(pathname, `${SITE_ORIGIN}/`).toString();
const viewPath = (viewId) => `views/${encodeURIComponent(viewId)}/`;
const nodeSequence = (view) => view.nodeSequence ?? [];
const publicKind = (view) => nodeSequence(view).length ? 'Story' : 'View';

function replaceFirst(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function renderTags(tags) {
  return `<div class="view-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`;
}

function renderStaticSequence(view, graphData) {
  const sequence = nodeSequence(view);
  if (!sequence.length) return '';
  const firstNodeId = sequence[0];
  const firstLabel = graphData.nodes.find((node) => node.id === firstNodeId)?.label ?? firstNodeId ?? '';
  return `<div class="view-sequence-controls" role="group" aria-label="Guided sequence navigation">
      <button type="button" class="view-sequence-button" data-view-prev aria-label="Previous step" title="Previous step" disabled><span class="material-icons" aria-hidden="true">chevron_left</span><span class="view-sequence-button-label">Previous</span></button>
      <div class="view-sequence-position"><span>Step 1 of ${sequence.length}</span><strong>${renderInlineMath(firstLabel)}</strong></div>
      <button type="button" class="view-sequence-button" data-view-next aria-label="Next step" title="Next step"${sequence.length < 2 ? ' disabled' : ''}><span class="view-sequence-button-label">Next</span><span class="material-icons" aria-hidden="true">chevron_right</span></button>
    </div>`;
}

function renderStaticBanner(view, graphData) {
  const kind = publicKind(view);
  return `<section id="viewBanner" class="view-banner" aria-live="polite"><div class="view-banner-copy">
      <details class="view-context-details" open>
        <summary>
          <span class="material-icons view-context-icon" aria-hidden="true">explore</span>
          <span class="view-context-heading"><span class="kicker">${kind}</span><strong>${renderInlineMath(view.title)}</strong></span>
          <span class="material-icons view-context-chevron" aria-hidden="true">expand_more</span>
        </summary>
        <div class="view-context-body">
          <p>${escapeHtml(view.narrative)}</p>
          ${renderStaticSequence(view, graphData)}
          <div class="view-banner-actions"><button type="button" class="text-button" data-open-views>Browse stories and views</button><a href="${appUrl(viewPath(view.id))}">Permalink</a></div>
        </div>
      </details>
    </div></section>`;
}

function renderViewPage(templateHtml, graphData, view) {
  const canonicalUrl = appUrl(viewPath(view.id));
  const pageTitle = `${view.title} — ${graphData.meta.title}`;
  let html = templateHtml;
  html = replaceFirst(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`);
  html = replaceFirst(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(view.summary)}">`);
  html = replaceFirst(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(pageTitle)}">`);
  html = replaceFirst(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(view.summary)}">`);
  html = replaceFirst(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`);
  html = replaceFirst(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`);
  const sequence = nodeSequence(view);
  const selectionMeta = sequence[0] ? `\n  <meta name="atlas:selection" content="node:${escapeHtml(sequence[0])}">` : '';
  html = html.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n  <base href="../../">\n  <meta name="atlas:view" content="${escapeHtml(view.id)}">${selectionMeta}`
  );
  html = html.replace('<section id="viewBanner" class="view-banner" aria-live="polite" hidden></section>', renderStaticBanner(view, graphData));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': canonicalUrl,
    name: view.title,
    description: view.summary,
    url: canonicalUrl,
    isPartOf: { '@type': 'WebSite', name: graphData.meta.title, url: appUrl() },
    about: view.tags,
    ...(sequence.length ? { mainEntity: {
      '@type': 'ItemList',
      itemListElement: sequence.map((nodeId, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: { '@type': 'DefinedTerm', '@id': appUrl(`concepts/${encodeURIComponent(nodeId)}/`) }
      }))
    } } : {})
  };
  return html.replace('</head>', `  <script id="view-page-jsonld" type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n  </script>\n</head>`);
}

function renderViewCard(view) {
  const title = escapeHtml(replaceInlineLatexWithUnicode(view.title));
  const summary = escapeHtml(replaceInlineLatexWithUnicode(view.summary));
  const imageSrc = view.image ? new URL(view.image.src, appUrl()).toString() : '';
  const image = view.image ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(view.image.alt)}" loading="lazy">` : '';
  const sequence = nodeSequence(view);
  const kind = publicKind(view);
  const meta = sequence.length ? `${sequence.length} guided steps` : 'Curated graph configuration';
  return `<article>${image}<div><h2><a href="./${encodeURIComponent(view.id)}/">${title}</a></h2><p>${summary}</p>${renderTags(view.tags)}<p><strong>${kind} · ${meta}</strong></p><a class="open" href="./${encodeURIComponent(view.id)}/">Open ${kind.toLowerCase()}</a></div></article>`;
}

function renderViewIndex(graphData, viewsData) {
  const canonicalUrl = appUrl('views/');
  const featured = viewsData.views.filter((view) => view.featured);
  const other = viewsData.views.filter((view) => !view.featured);
  const section = (title, views) => `<section><h2>${escapeHtml(title)}</h2><div class="grid">${views.map(renderViewCard).join('')}</div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Curated stories and views through the Atlas of Fundamental Concepts."><link rel="canonical" href="${canonicalUrl}"><title>Stories &amp; Views — ${escapeHtml(graphData.meta.title)}</title><style>
  :root{font-family:Inter,system-ui,sans-serif;color:#172033;background:#f6f7f9}body{margin:0}main{max-width:1180px;margin:auto;padding:2rem 1rem 4rem}header{margin-bottom:2rem}h1{margin:.25rem 0;font-size:2rem}header p{max-width:760px;color:#475569;line-height:1.55}.home{color:#1d4ed8;text-decoration:none;font-weight:650}section{margin-top:2.2rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}article{background:white;border:1px solid #d8dee8;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.06);overflow:hidden}article>div{padding:1rem}article img{width:100%;aspect-ratio:16/8;object-fit:cover}article h2{font-size:1.05rem;margin:0 0 .5rem}article h2 a{color:#172033;text-decoration:none}article p{color:#475569;font-size:.9rem;line-height:1.5;min-height:4.1em}.view-tags{display:flex;gap:.35rem;flex-wrap:wrap;margin:.8rem 0}.view-tags span{font-size:.72rem;padding:.2rem .5rem;border-radius:999px;background:#eff6ff;color:#1e3a8a}.open{display:inline-block;margin-top:.25rem;color:white;background:#1e40af;border-radius:8px;padding:.55rem .8rem;text-decoration:none;font-weight:700;font-size:.85rem}
  </style></head><body><main><header><a class="home" href="/">← Atlas home</a> · <a class="home" href="/directory/">Atlas directory</a><h1>Stories &amp; Views</h1><p>Views apply curated filters, relation types, and display settings. Stories add a numbered concept sequence with Previous and Next navigation. You can adjust either while keeping its URL as long as its required nodes remain visible.</p></header>${section('Featured stories and views', featured)}${other.length ? section('More stories and views', other) : ''}</main></body></html>`;
}

export async function generateViewPages({ graphData, viewsData, templateHtml, distUrl }) {
  await mkdir(new URL('views/', distUrl), { recursive: true });
  await writeFile(new URL('views/index.html', distUrl), minifyHtml(renderViewIndex(graphData, viewsData)));
  await Promise.all(viewsData.views.map(async (view) => {
    const pageDir = new URL(viewPath(view.id), distUrl);
    await mkdir(pageDir, { recursive: true });
    await writeFile(new URL('index.html', pageDir), minifyHtml(renderViewPage(templateHtml, graphData, view)));
  }));
}

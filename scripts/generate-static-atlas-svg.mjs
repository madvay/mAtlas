import puppeteer from 'puppeteer';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const STATIC_EXPORT_MARKER = '<meta name="atlas:static-svg-build" content="1">';
const SITE_ORIGIN = 'https://atlas.madvay.com/';
const BUILD_TIMEOUT_MS = 120_000;

function validateSvgResult(result, label) {
  if (!result || typeof result.svg !== 'string'
    || !result.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')
    || !result.svg.includes('<svg ')
    || !result.svg.endsWith('</svg>')) {
    throw new Error(`The runtime SVG exporter returned malformed output for ${label}.`);
  }
  if (!Number.isFinite(result.width) || result.width <= 0 || !Number.isFinite(result.height) || result.height <= 0) {
    throw new Error(`The runtime SVG exporter returned invalid dimensions for ${label}.`);
  }
  return result;
}

function domainSvgPath(domainId) {
  return `static/domains/${encodeURIComponent(domainId)}.svg`;
}

function fieldSvgPath(fieldId) {
  return `static/fields/${encodeURIComponent(fieldId)}.svg`;
}

function fieldBuildPage(buildPage, fieldId) {
  const marker = `<meta name="atlas:static-svg-field" content="${escapeHtmlAttribute(fieldId)}">`;
  return buildPage.replace(STATIC_EXPORT_MARKER, `${STATIC_EXPORT_MARKER}\n  ${marker}`);
}


function escapeInlineScript(value) {
  return value.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');
}

function escapeInlineStyle(value) {
  return value.replaceAll('</style', '<\\/style');
}


function escapeHtmlAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function cssAssetMimeType(pathname) {
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  if (pathname.endsWith('.woff')) return 'font/woff';
  if (pathname.endsWith('.ttf')) return 'font/ttf';
  if (pathname.endsWith('.otf')) return 'font/otf';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function relativeDistUrl(pathname, distUrl) {
  const path = pathname.replace(/^\/+/, '');
  if (!path || path.includes('..')) throw new Error(`Unsafe build asset path: ${pathname}`);
  return new URL(path, distUrl);
}

async function inlineLocalCssAssets(css, stylesheetHref, distUrl) {
  const stylesheetUrl = new URL(stylesheetHref, SITE_ORIGIN);
  return replaceAsync(css, /url\((['"]?)([^'"\)]+)\1\)/g, async (match) => {
    const rawUrl = match[2].trim();
    if (!rawUrl || /^(?:data:|blob:|#|https?:)/i.test(rawUrl)) return match[0];
    const assetUrl = new URL(rawUrl, stylesheetUrl);
    if (assetUrl.origin !== new URL(SITE_ORIGIN).origin) return match[0];
    const bytes = await readFile(relativeDistUrl(assetUrl.pathname, distUrl));
    const mimeType = cssAssetMimeType(assetUrl.pathname.toLowerCase());
    return `url("data:${mimeType};base64,${bytes.toString('base64')}")`;
  });
}

async function replaceAsync(source, pattern, replacement) {
  const matches = [...source.matchAll(pattern)];
  let result = source;
  for (const match of matches.reverse()) {
    const index = match.index;
    if (index === undefined) continue;
    const value = await replacement(match);
    result = `${result.slice(0, index)}${value}${result.slice(index + match[0].length)}`;
  }
  return result;
}

async function selfContainedBuildPage(distUrl) {
  let html = await readFile(new URL('index.html', distUrl), 'utf8');
  html = await replaceAsync(
    html,
    /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    async (match) => {
      const href = match[1];
      if (/^https?:/i.test(href)) return '';
      const css = await readFile(relativeDistUrl(href, distUrl), 'utf8');
      const selfContainedCss = await inlineLocalCssAssets(css, href, distUrl);
      return `<style data-atlas-source-href="${escapeHtmlAttribute(href)}">${escapeInlineStyle(selfContainedCss)}</style>`;
    }
  );
  html = await replaceAsync(
    html,
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    async (match) => {
      const src = match[2];
      if (/^https?:/i.test(src)) return '';
      const attributes = `${match[1]} ${match[3]}`.replace(/\s+/g, ' ').trim();
      const js = await readFile(relativeDistUrl(src, distUrl), 'utf8');
      return `<script${attributes ? ` ${attributes}` : ''}>${escapeInlineScript(js)}</script>`;
    }
  );

  const contentFiles = (await readdir(new URL('content/', distUrl))).filter((file) => file.endsWith('.json'));
  const embeddedData = Object.fromEntries(await Promise.all(contentFiles.map(async (file) => [
    `/content/${file}`,
    await readFile(new URL(`content/${file}`, distUrl), 'utf8')
  ])));
  const serializedData = JSON.stringify(embeddedData).replaceAll('<', '\\u003c');
  const fetchShim = `<script>(()=>{const files=${serializedData};const nativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),document.baseURI);if(Object.prototype.hasOwnProperty.call(files,url.pathname)){return Promise.resolve(new Response(files[url.pathname],{status:200,headers:{"content-type":"application/json; charset=utf-8"}}));}return nativeFetch(input,init);};})();</script>`;
  return html
    .replace('<head>', `<head>\n  <base href="https://atlas.madvay.com/">\n  ${STATIC_EXPORT_MARKER}`)
    .replace('</head>', `  ${fetchShim}\n</head>`);
}

async function prepareStaticExporterPage(browser, buildPage) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const diagnostics = [];
  page.on('console', (message) => diagnostics.push(message.text()));
  page.on('pageerror', (error) => diagnostics.push(error.message));
  await page.setContent(buildPage, { waitUntil: 'domcontentloaded', timeout: BUILD_TIMEOUT_MS });
  try {
    await page.waitForFunction(
      () => document.documentElement.dataset.atlasStaticSvg === 'ready'
        && Boolean(window.__atlasStaticSvgExporter),
      { timeout: BUILD_TIMEOUT_MS, polling: 50 }
    );
  } catch (error) {
    await page.close();
    const detail = diagnostics.length ? `\n${diagnostics.slice(-20).join('\n')}` : '';
    throw new Error(`The runtime SVG exporter did not become ready.${detail}`, { cause: error });
  }
  return page;
}

async function openStaticExporter(distUrl) {
  const buildPage = await selfContainedBuildPage(distUrl);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking']
  });
  try {
    const page = await prepareStaticExporterPage(browser, buildPage);
    return { browser, page, buildPage };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function serializeInPage(page, method, argument, label) {
  const result = await page.evaluate(({ method, argument }) => {
    const exporter = window.__atlasStaticSvgExporter;
    if (!exporter) throw new Error('Missing runtime SVG exporter.');
    if (method === 'domain') return exporter.serializePrimaryDomain(argument);
    if (method === 'field') return exporter.serializeFieldDomainStructure(argument);
    return exporter.serializeVisible();
  }, { method, argument });
  return validateSvgResult(result, label);
}

export async function generateStaticAtlasSvg({ distUrl }) {
  const { browser, page } = await openStaticExporter(distUrl);
  try {
    const result = await serializeInPage(page, 'visible', '', 'the all-in atlas');
    await mkdir(new URL('static/', distUrl), { recursive: true });
    await writeFile(new URL('static/atlas.svg', distUrl), result.svg);
    return result.svg;
  } finally {
    await browser.close();
  }
}

export async function generateStaticAtlasSvgs({ distUrl, graphData }) {
  const { browser, page, buildPage } = await openStaticExporter(distUrl);
  try {
    const atlas = await serializeInPage(page, 'visible', '', 'the all-in atlas');
    await Promise.all([
      mkdir(new URL('static/', distUrl), { recursive: true }),
      mkdir(new URL('static/domains/', distUrl), { recursive: true }),
      mkdir(new URL('static/fields/', distUrl), { recursive: true })
    ]);
    await writeFile(new URL('static/atlas.svg', distUrl), atlas.svg);

    const domains = {};
    for (const domainId of graphData.meta.domainOrder ?? Object.keys(graphData.domains)) {
      const result = await serializeInPage(page, 'domain', domainId, `domain ${domainId}`);
      const path = domainSvgPath(domainId);
      await writeFile(new URL(path, distUrl), result.svg);
      domains[domainId] = {
        path,
        width: result.width,
        height: result.height,
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount
      };
    }
    const fields = {};
    for (const fieldId of graphData.meta.fieldOrder ?? Object.keys(graphData.fields)) {
      const fieldPage = await prepareStaticExporterPage(browser, fieldBuildPage(buildPage, fieldId));
      try {
        const result = await serializeInPage(fieldPage, 'field', fieldId, `field ${fieldId}`);
        const path = fieldSvgPath(fieldId);
        await writeFile(new URL(path, distUrl), result.svg);
        fields[fieldId] = {
          path,
          width: result.width,
          height: result.height,
          nodeCount: result.nodeCount,
          edgeCount: result.edgeCount
        };
      } finally {
        await fieldPage.close();
      }
    }

    return {
      atlas: {
        svg: atlas.svg,
        path: 'static/atlas.svg',
        width: atlas.width,
        height: atlas.height,
        nodeCount: atlas.nodeCount,
        edgeCount: atlas.edgeCount
      },
      fields,
      domains
    };
  } finally {
    await browser.close();
  }
}

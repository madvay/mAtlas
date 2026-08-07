import puppeteer from 'puppeteer';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const STATIC_EXPORT_MARKER = '<meta name="atlas:static-svg-build" content="1">';
const SITE_ORIGIN = 'https://atlas.madvay.com/';
const BUILD_TIMEOUT_MS = 120_000;
const CONCEPT_IMAGE_ENV = 'MATLAS_GENERATE_CONCEPT_IMAGES';
const CONCEPT_IMAGE_SIZE = 900;
const CONCEPT_RASTER_WORKERS = 4;

export function conceptImageGenerationEnabled(environment = process.env) {
  return /^(?:1|true|yes|on)$/i.test(String(environment[CONCEPT_IMAGE_ENV] ?? '').trim());
}

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

function conceptSvgPath(nodeId) {
  return `static/concepts/${encodeURIComponent(nodeId)}.svg`;
}

function conceptPngPath(nodeId) {
  return `static/concepts/${encodeURIComponent(nodeId)}.png`;
}

class StaticFileProgress {
  constructor(total) {
    this.total = Math.max(1, total);
    this.current = 0;
    this.lastBucket = -1;
    this.tty = Boolean(process.stdout.isTTY);
    this.render('starting');
  }

  advance(label) {
    this.current = Math.min(this.total, this.current + 1);
    this.render(label);
  }

  finish(label = 'complete') {
    this.current = this.total;
    this.render(label, true);
    if (this.tty) process.stdout.write('\n');
  }

  render(label, force = false) {
    const ratio = this.current / this.total;
    const bucket = Math.floor(ratio * 50);
    if (!force && !this.tty && bucket === this.lastBucket) return;
    this.lastBucket = bucket;
    const width = 30;
    const filled = Math.min(width, Math.round(ratio * width));
    const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
    const percent = (ratio * 100).toFixed(1).padStart(5);
    const message = `Static files [${bar}] ${percent}% ${String(this.current).padStart(String(this.total).length)}/${this.total} ${label}`;
    if (this.tty) process.stdout.write(`\r\u001b[2K${message}`);
    else console.log(message);
  }
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
    if (method === 'concept') return exporter.serializeConcept(argument);
    return exporter.serializeVisible();
  }, { method, argument });
  return validateSvgResult(result, label);
}

async function prepareSvgRasterPage(browser) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body><canvas id="raster" width="${CONCEPT_IMAGE_SIZE}" height="${CONCEPT_IMAGE_SIZE}"></canvas></body></html>`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function rasterizeConceptSvg(page, svg) {
  const base64 = await page.evaluate(async ({ svg, size }) => {
    await document.fonts.ready;
    const canvas = document.getElementById('raster');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing SVG raster canvas.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the SVG raster canvas context.');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Chromium could not decode the concept SVG.'));
        image.src = objectUrl;
      });
      context.clearRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, { svg, size: CONCEPT_IMAGE_SIZE });
  return Buffer.from(base64, 'base64');
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

export async function generateStaticAtlasSvgs({
  distUrl,
  graphData,
  generateConceptImages = conceptImageGenerationEnabled()
}) {
  const domainIds = graphData.meta.domainOrder ?? Object.keys(graphData.domains);
  const fieldIds = graphData.meta.fieldOrder ?? Object.keys(graphData.fields);
  const conceptNodes = generateConceptImages
    ? graphData.nodes.filter((node) => node.kind === 'structure')
    : [];
  const progress = new StaticFileProgress(1 + domainIds.length + fieldIds.length + conceptNodes.length * 2);
  const { browser, page, buildPage } = await openStaticExporter(distUrl);
  try {
    const atlas = await serializeInPage(page, 'visible', '', 'the all-in atlas');
    await Promise.all([
      mkdir(new URL('static/', distUrl), { recursive: true }),
      mkdir(new URL('static/domains/', distUrl), { recursive: true }),
      mkdir(new URL('static/fields/', distUrl), { recursive: true }),
      ...(generateConceptImages ? [mkdir(new URL('static/concepts/', distUrl), { recursive: true })] : [])
    ]);
    await writeFile(new URL('static/atlas.svg', distUrl), atlas.svg);
    progress.advance('atlas.svg');

    const domains = {};
    for (const domainId of domainIds) {
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
      progress.advance(path);
    }

    const fields = {};
    for (const fieldId of fieldIds) {
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
        progress.advance(path);
      } finally {
        await fieldPage.close();
      }
    }

    const concepts = {};
    if (generateConceptImages) {
      const rasterPages = await Promise.all(Array.from(
        { length: Math.min(CONCEPT_RASTER_WORKERS, conceptNodes.length) },
        () => prepareSvgRasterPage(browser)
      ));
      const rasterQueues = rasterPages.map(() => Promise.resolve());
      try {
        let conceptIndex = 0;
        for (const node of conceptNodes) {
          const result = await serializeInPage(page, 'concept', node.id, `concept ${node.id}`);
          if (result.width !== CONCEPT_IMAGE_SIZE || result.height !== CONCEPT_IMAGE_SIZE) {
            throw new Error(`Concept ${node.id} exported at ${result.width}x${result.height}; expected ${CONCEPT_IMAGE_SIZE}x${CONCEPT_IMAGE_SIZE}.`);
          }
          const svgPath = conceptSvgPath(node.id);
          const pngPath = conceptPngPath(node.id);
          await writeFile(new URL(svgPath, distUrl), result.svg);
          progress.advance(svgPath);
          concepts[node.id] = {
            path: pngPath,
            svgPath,
            pngPath,
            width: result.width,
            height: result.height,
            nodeCount: result.nodeCount,
            edgeCount: result.edgeCount
          };
          const workerIndex = conceptIndex % rasterPages.length;
          const rasterPage = rasterPages[workerIndex];
          rasterQueues[workerIndex] = rasterQueues[workerIndex].then(async () => {
            const png = await rasterizeConceptSvg(rasterPage, result.svg);
            await writeFile(new URL(pngPath, distUrl), png);
            progress.advance(pngPath);
          });
          conceptIndex += 1;
        }
        await Promise.all(rasterQueues);
      } finally {
        await Promise.all(rasterPages.map((rasterPage) => rasterPage.close()));
      }
    }

    progress.finish(generateConceptImages ? 'complete with concept images' : `complete; ${CONCEPT_IMAGE_ENV} is off`);
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
      domains,
      concepts,
      conceptImagesEnabled: generateConceptImages
    };
  } finally {
    await browser.close();
  }
}

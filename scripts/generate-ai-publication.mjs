import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { escapeHtml } from './inline-math.mjs';
import { minifyHtml } from './minify-html.mjs';
import { appUrl, relationTypeVocabularyPath, relationTypeVocabularyUrl } from './publication-urls.mjs';
import { appendTextPublicationMetadata } from './publication-text-metadata.mjs';
import { staticThemeCss, themeBootstrapScript } from './page-theme.mjs';
import { createZipArchive } from './zip-archive.mjs';

const AI_PATH = 'ai/';
const PROJECT_LICENSE_URL = 'https://github.com/madvay/mAtlas/blob/main/LICENSE';
const WORKBENCH_PATH = 'ai/workbench/';
const SKILL_PATH = 'ai/skills/matlas/';

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function markdownLink(label, url) {
  return `[${String(label).replaceAll(']', '\\]')}](${url})`;
}

function sourceComment(language, graphData) {
  const prefix = language === 'python' ? '# ' : '// ';
  return `${prefix}mAtlas software and mixed publications: ${PROJECT_LICENSE_URL}\n${prefix}Graph data used by this example: ${graphData.meta.licenseUrl}\n${prefix}Attribution: ${graphData.meta.attribution}\n`;
}

function projectLicenseFooter(graphData, suffix = '') {
  return `${escapeHtml(graphData.meta.attribution)} · <a href="${PROJECT_LICENSE_URL}">License</a>${suffix}`;
}

function citationCff(graphData, dataManifest, lastModified) {
  return [
    'cff-version: 1.2.0',
    `message: "If you use mAtlas data or authored graph relations, cite this dataset and retain its attached source citations. ${graphData.meta.attribution}"`,
    `title: "${graphData.meta.title}"`,
    'abbreviated-title: "mAtlas"',
    'type: dataset',
    `version: "${dataManifest.contentVersion}"`,
    `date-released: "${lastModified}"`,
    'authors:',
    '  - family-names: "Mengle"',
    '    given-names: "Advay"',
    'license: "CC-BY-SA-4.0"',
    `url: "${appUrl()}"`,
    `repository-code: "https://github.com/madvay/mAtlas"`,
    `repository-artifact: "${appUrl('ai/matlas-ai-bundle.zip')}"`,
    `keywords:`,
    '  - mathematics',
    '  - physics',
    '  - chemistry',
    '  - knowledge graph',
    '  - concept atlas',
    `# Content license: ${graphData.meta.licenseUrl}`,
    `# Attribution: ${graphData.meta.attribution}`,
    ''
  ].join('\n');
}

function citationJson(graphData, dataManifest, lastModified) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': appUrl('citation.json'),
    name: graphData.meta.title,
    alternateName: 'mAtlas',
    version: dataManifest.contentVersion,
    dateModified: lastModified,
    url: appUrl(),
    sameAs: [appUrl('data/'), appUrl('ai/matlas-ai-bundle.zip')],
    license: graphData.meta.licenseUrl,
    copyrightNotice: graphData.meta.attribution,
    creator: { '@type': 'Person', name: 'Advay Mengle', url: 'https://advaymengle.com/' },
    citation: `${graphData.meta.title}, version ${dataManifest.contentVersion} (${lastModified}), ${appUrl('data/')}`,
    conceptCitationPattern: `${appUrl('concepts/{conceptId}/')}`,
    relationCitationPattern: `${appUrl('concepts/{conceptId}/#relation-{relationId}')}`
  };
}

function citationGuideMarkdown(graphData, dataManifest) {
  return [
    `# Citing ${graphData.meta.title}`,
    '',
    `Use mAtlas version \`${dataManifest.contentVersion}\` as a curated, source-backed graph dataset. Citation metadata is available as ${markdownLink('CITATION.cff', appUrl('CITATION.cff'))} and ${markdownLink('citation.json', appUrl('citation.json'))}.`,
    '',
    '## Cite an authored graph assertion',
    '',
    'For a direct relation, cite both the mAtlas relation fragment and the attached external sources. The relation fragment identifies the exact directed assertion, relation type, explanation, and source list.',
    '',
    '1. Cite the canonical concept page, for example `https://atlas.madvay.com/concepts/<concept-id>/`.',
    '2. For a direct edge, cite its `#relation-<edge-id>` fragment on the canonical endpoint page.',
    '3. Retain the scholarly or reference source URLs attached to the concept or relation record.',
    '4. State the mAtlas content version and distinguish a direct authored relation from a computed path, subgraph, predecessor closure, or prerequisite closure.',
    '',
    '## Example form',
    '',
    `> mAtlas, “<concept label>,” content version ${dataManifest.contentVersion}, <canonical concept or relation URL>; underlying sources: <source URL(s)>.`,
    '',
    `mAtlas content is licensed under ${markdownLink(graphData.meta.license, graphData.meta.licenseUrl)}. The software SDKs and tools are Apache-2.0; the downloadable bundle contains both license texts.`,
    ''
  ].join('\n');
}

function schemaReferenceMarkdown(graphData, dataManifest) {
  return [
    '# mAtlas schema and graph-operation reference',
    '',
    `Canonical schema: ${markdownLink('data/latest/schema.json', dataManifest.distributions.schema.contentUrl)}`,
    `Canonical graph: ${markdownLink('data/latest/atlas.json', dataManifest.distributions.atlas.contentUrl)}`,
    '',
    '## Core records',
    '',
    '- A **concept** is a structure node with a stable canonical ID and public concept page.',
    '- A **construction junction** is a graph node representing an AND-style multi-input construction. It is included in graph exports because relations may cite it as an endpoint.',
    '- A **relation** is a directed authored assertion from `source` to `target`, with a type, annotation, detailed explanation, and citation IDs.',
    '- A **relation type** determines two distinct traversals: `enforcePredecessorLevel` for predecessor closure, and `prerequisiteTraversal` for prerequisite closure.',
    '',
    '## Deterministic operations',
    '',
    '- `find_paths`: explores authored edges; `direction="either"` may traverse an edge backwards but does not alter the original `source → target` assertion.',
    '- `get_predecessor_closure`: follows only edges whose relation type declares predecessor enforcement, in that declared direction.',
    '- `get_prerequisite_closure`: follows only the incoming, outgoing, or both direction explicitly declared by each relation type.',
    '- `connect_concepts` and `build_subgraph`: compose direct authored relations into bounded computed results.',
    '',
    'Do not create a new relation simply because general knowledge suggests one. Return the attached citations with every substantive graph claim.',
    ''
  ].join('\n');
}

function skillMarkdown(graphData, dataManifest) {
  return [
    '---',
    'name: matlas',
    'description: >-',
    '  Uses the Atlas of Fundamental Concepts (mAtlas) to answer source-backed questions about authored relationships among mathematics, physics, and chemistry concepts. Use for canonical concept resolution, direct neighbors, paths, predecessor closure, prerequisite closure, connecting subgraphs, comparison, and citation-aware graph context. Do not infer absent graph edges from general knowledge.',
    '---',
    '',
    '# mAtlas',
    '',
    `This skill uses mAtlas content version \`${dataManifest.contentVersion}\`. Its portable data files are in \`data/\`; the public manifest is ${appUrl('data/latest/manifest.json')}.`,
    '',
    '## Required procedure',
    '',
    '1. Resolve every requested topic to a canonical ID using `search` before making graph claims.',
    '2. Use `scripts/matlas.py` (or `scripts/matlas.mjs`) for paths, closures, connected subgraphs, and comparisons. Do not compute graph traversal from memory.',
    '3. Preserve each direct edge’s original `source → target` direction, type, explanation, canonical relation URL, and attached citations.',
    '4. Label a result as direct, path-derived, predecessor closure, prerequisite closure, or subgraph-derived. Do not present a computed transitive result as one direct authored relation.',
    '5. Cite the canonical concept or relation URL plus the underlying sources attached to the record. Report the content version.',
    '',
    '## Data selection',
    '',
    '- Use `data/matlas.sqlite` with Python when selective SQL inspection or local graph queries are useful.',
    '- Use `data/atlas.json` with the ESM SDK or browser-local workbench.',
    '- Use NDJSON for streaming ingestion, and RDF/JSON-LD or Turtle only when semantic-web interoperability is required.',
    '',
    '## Constraints',
    '',
    '- mAtlas is editorially selective and source-backed, not unrestricted mathematical or scientific authority.',
    '- A path may traverse an edge in reverse for connectivity; that does not reverse the authored statement.',
    '- Predecessor and prerequisite are distinct terms and must not be conflated.',
    '',
    `See ${markdownLink('the schema reference', './references/schema.md')} and ${markdownLink('the citation guide', './references/citation-guide.md')}.`,
    ''
  ].join('\n');
}

function bundleReadme(graphData, dataManifest) {
  return [
    `# ${graphData.meta.title} AI bundle`,
    '',
    `Content version: \`${dataManifest.contentVersion}\``,
    '',
    'This bundle lets a local coding agent, notebook, or file-upload chatbot retrieve and compute against the authored graph without a remote server. All graph operations are deterministic and local.',
    '',
    '## Quick start: Python',
    '',
    '```python',
    'from sdk.matlas import Atlas',
    '',
    'atlas = Atlas.from_sqlite("data/matlas.sqlite")',
    'print(atlas.find_paths("group", "galois_group", direction="either"))',
    '```',
    '',
    'Or use the CLI:',
    '',
    '```sh',
    'python sdk/matlas.py --sqlite data/matlas.sqlite search "quotient topology"',
    'python sdk/matlas.py --sqlite data/matlas.sqlite closure quantum_field_theory --traversal prerequisite',
    '```',
    '',
    '## Quick start: ESM',
    '',
    '```js',
    'import { readFile } from "node:fs/promises";',
    'import { Atlas } from "./sdk/matlas.mjs";',
    '',
    'const data = JSON.parse(await readFile("data/atlas.json", "utf8"));',
    'const atlas = Atlas.fromData(data);',
    'console.log(atlas.getPrerequisiteClosure(["quantum_field_theory"]));',
    '```',
    '',
    '## Answering rules',
    '',
    '1. Resolve names to canonical IDs before querying.',
    '2. Do not invent relations missing from the data.',
    '3. Distinguish a direct authored relation from a computed path or closure.',
    '4. Preserve direct relation direction, attached citations, and content version.',
    '5. Cite canonical concept/relation URLs and the underlying sources.',
    '',
    'See `SKILL.md`, `references/schema.md`, and `references/citation-guide.md` before using the bundle in an agent workflow.',
    ''
  ].join('\n');
}

function answerWithSourcesExample(dataManifest) {
  return [
    '# Answering with mAtlas sources',
    '',
    `Use the installed bundle’s content version \`${dataManifest.contentVersion}\` and state it in the answer.`,
    '',
    '1. Run `search` to resolve each requested name to a canonical concept ID.',
    '2. For direct facts, use `get` or `neighbors`; for a route, use `paths`; for dependency context, use the correct closure operation.',
    '3. In the answer, say whether the result is a direct authored edge or a computed result.',
    '4. Include the canonical concept/relation URL emitted by the SDK and every attached source URL relevant to the claim.',
    '5. If a relation is absent, say that the mAtlas dataset does not author it. Do not fill the gap from general knowledge without clearly separating that knowledge from the dataset.',
    ''
  ].join('\n');
}

function pythonExample(name, statements, graphData) {
  return `${sourceComment('python', graphData)}from pathlib import Path\nimport json\nimport sys\n\nsys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sdk'))\nfrom matlas import Atlas\n\natlas = Atlas.from_sqlite(Path(__file__).resolve().parents[1] / 'data' / 'matlas.sqlite')\n${statements}\nprint(json.dumps(result, ensure_ascii=False, indent=2))\n`;
}

function mjsExample(graphData) {
  return `${sourceComment('mjs', graphData)}import { readFile } from 'node:fs/promises';\nimport { Atlas } from '../sdk/matlas.mjs';\n\nconst data = JSON.parse(await readFile(new URL('../data/atlas.json', import.meta.url), 'utf8'));\nconst atlas = Atlas.fromData(data);\nconst result = atlas.compareConcepts('group', 'ring');\nconsole.log(JSON.stringify(result, null, 2));\n`;
}

function openApiDocument(graphData, dataManifest) {
  const response = (schema) => ({
    '200': {
      description: 'Static resource generated at build time.',
      content: { 'application/json': { schema } }
    },
    '404': { description: 'The requested published record does not exist.' }
  });
  return {
    openapi: '3.1.0',
    info: {
      title: `${graphData.meta.title} static data API`,
      version: dataManifest.contentVersion,
      description: 'Read-only GET resources generated at build time. This document describes static files, not a dynamic query service.',
      license: { name: graphData.meta.license, url: graphData.meta.licenseUrl },
      'x-matlas-attribution': graphData.meta.attribution
    },
    servers: [{ url: appUrl().replace(/\/$/, ''), description: 'Published static site' }],
    'x-matlas-static-only': true,
    'x-matlas-content-version': dataManifest.contentVersion,
    paths: {
      '/data/latest/manifest.json': { get: { operationId: 'getDataManifest', summary: 'Get the stable data manifest', responses: response({ $ref: '#/components/schemas/DataManifest' }) } },
      '/data/latest/atlas.json': { get: { operationId: 'getAtlas', summary: 'Get the canonical graph JSON', responses: response({ $ref: '#/components/schemas/GraphData' }) } },
      '/data/latest/schema.json': { get: { operationId: 'getSchema', summary: 'Get the graph JSON Schema', responses: response({ type: 'object' }) } },
      '/data/latest/views.json': { get: { operationId: 'getViews', summary: 'Get Stories and Views JSON', responses: response({ type: 'object' }) } },
      '/data/latest/concepts/{conceptId}.json': {
        get: {
          operationId: 'getConceptRecord', summary: 'Get one canonical concept record',
          parameters: [{ $ref: '#/components/parameters/conceptId' }],
          responses: response({ $ref: '#/components/schemas/ConceptRecord' })
        }
      },
      '/data/latest/concepts/{conceptId}/relations.json': {
        get: {
          operationId: 'getConceptRelations', summary: 'Get direct incoming and outgoing relations for one concept',
          parameters: [{ $ref: '#/components/parameters/conceptId' }],
          responses: response({ $ref: '#/components/schemas/ConceptRelations' })
        }
      },
      '/data/latest/domains/{domainId}.json': {
        get: {
          operationId: 'getDomainRecord', summary: 'Get one domain record and its member concept IDs',
          parameters: [{ $ref: '#/components/parameters/domainId' }],
          responses: response({ $ref: '#/components/schemas/DomainRecord' })
        }
      },
      '/data/latest/relation-types/{relationTypeId}.json': {
        get: {
          operationId: 'getRelationTypeRecord', summary: 'Get one relation-type definition and direct relation IDs',
          parameters: [{ $ref: '#/components/parameters/relationTypeId' }],
          responses: response({ $ref: '#/components/schemas/RelationTypeRecord' })
        }
      }
    },
    components: {
      parameters: {
        conceptId: { name: 'conceptId', in: 'path', required: true, description: 'Canonical mAtlas concept ID.', schema: { type: 'string' } },
        domainId: { name: 'domainId', in: 'path', required: true, description: 'Canonical mAtlas domain ID.', schema: { type: 'string' } },
        relationTypeId: { name: 'relationTypeId', in: 'path', required: true, description: 'Canonical mAtlas relation type ID.', schema: { type: 'string' } }
      },
      schemas: {
        DataManifest: { type: 'object', required: ['contentVersion', 'distributions', 'license'], additionalProperties: true },
        GraphData: { type: 'object', required: ['meta', 'fields', 'domains', 'edgeTypes', 'sources', 'nodes', 'edges'], additionalProperties: false },
        ConceptRecord: { type: 'object', required: ['recordType', 'contentVersion', 'concept', 'sources', 'license', 'attribution'], additionalProperties: true },
        ConceptRelations: { type: 'object', required: ['recordType', 'contentVersion', 'conceptId', 'incoming', 'outgoing'], additionalProperties: true },
        DomainRecord: { type: 'object', required: ['recordType', 'domain', 'field', 'conceptIds'], additionalProperties: true },
        RelationTypeRecord: { type: 'object', required: ['recordType', 'relationType', 'relationIds'], additionalProperties: true }
      }
    }
  };
}

function aiIndexMarkdown(graphData, dataManifest) {
  return [
    `# ${graphData.meta.title} — AI integration`,
    '',
    `Content version: \`${dataManifest.contentVersion}\``,
    '',
    'This static integration surface provides source-ready pages for retrieval and deterministic local graph operations without a backend service.',
    '',
    '## Entry points',
    '',
    `- ${markdownLink('AI bundle', appUrl('ai/matlas-ai-bundle.zip'))} — data, zero-dependency SDKs, Agent Skill, examples, citation metadata, and licenses in one uploadable file.`,
    `- ${markdownLink('Browser-local workbench', appUrl(WORKBENCH_PATH))} — accessible forms, visible JSON results, and progressive WebMCP tools.`,
    `- ${markdownLink('Python SDK', appUrl('ai/sdk/matlas.py'))} and ${markdownLink('ESM SDK', appUrl('ai/sdk/matlas.mjs'))}.`,
    `- ${markdownLink('Agent Skill', appUrl(`${SKILL_PATH}SKILL.md`))}.`,
    `- ${markdownLink('OpenAPI description', appUrl('openapi.json'))} — static GET-only data resources.`,
    `- ${markdownLink('Relation vocabulary', appUrl('vocab/'))} — dereferenceable definitions for the relation-type URLs used by RDF exports.`,
    `- ${markdownLink('Dataset manifest', dataManifest.distributions.atlas.contentUrl.replace(/atlas\.json$/, 'manifest.json'))}.`,
    `- ${markdownLink('Citation guide', appUrl('ai/citation-guide.md'))}.`,
    '',
    '## Important limits',
    '',
    'A static site cannot expose arbitrary remote MCP methods. Use the bundle in an AI code environment, the static browser workbench, or WebMCP in a supporting browser tab. The OpenAPI document only describes pre-generated GET resources.',
    ''
  ].join('\n');
}

function aiIndexPage(graphData, dataManifest, lastModified) {
  const canonicalUrl = appUrl(AI_PATH);
  const markdownUrl = appUrl(`${AI_PATH}index.html.md`);
  const description = `Static, source-aware AI integration resources for ${graphData.meta.title}.`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'WebPage', '@id': canonicalUrl,
    name: `${graphData.meta.title} AI integration`, description, url: canonicalUrl,
    dateModified: lastModified, license: graphData.meta.licenseUrl,
    isPartOf: { '@id': appUrl(), '@type': 'WebSite', name: graphData.meta.title }
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow,max-snippet:-1"><meta name="theme-color" content="#f6f7f9">
  ${themeBootstrapScript}
  <link rel="canonical" href="${canonicalUrl}"><link rel="alternate" type="text/markdown" href="${markdownUrl}" title="Markdown AI integration guide"><link rel="icon" href="/favicon.ico" sizes="any">
  <title>${escapeHtml(graphData.meta.title)} AI integration</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>${staticThemeCss}:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--page-bg);line-height:1.55}*{box-sizing:border-box}body{margin:0}.page{max-width:1080px;margin:auto;padding:clamp(1rem,4vw,3rem)}a{color:var(--link);text-underline-offset:.16em}.brand{display:flex;align-items:center;gap:.9rem;font-weight:800}.brand img{width:52px;height:52px}.brand a{text-decoration:none}.lede{max-width:800px;color:var(--muted);font-size:1.1rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem}.card{border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow);border-radius:14px;padding:1rem 1.1rem}.card h2{font-size:1.2rem;margin:.1rem 0 .5rem;color:var(--heading)}.card p{color:var(--muted)}.button{display:inline-flex;border:1px solid var(--primary);background:var(--primary);color:white!important;border-radius:999px;padding:.52rem .8rem;font-weight:750;text-decoration:none}.links{display:flex;gap:.55rem;flex-wrap:wrap;margin:1.2rem 0}.links a{display:inline-flex;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:.4rem .68rem;text-decoration:none;font-weight:700;font-size:.86rem}.note{margin:1rem 0;border-left:4px solid var(--primary);padding:.15rem 1rem;background:var(--accent-soft);color:var(--accent-text)}.footer{padding:1rem 0;color:var(--muted-2);font-size:.85rem}</style>
</head>
<body><main class="page">
  <header><div class="brand"><a href="/" aria-label="Atlas of Fundamental Concepts home"><img src="/assets/atlas-logo.png" width="52" height="52" alt="Atlas of Fundamental Concepts logo"></a><a href="/">Atlas of Fundamental Concepts</a></div><h1>AI integration</h1><p class="lede">Published data, deterministic local graph tools, and an accessible browser workbench. No account, inference service, or backend API is required.</p><nav class="links" aria-label="AI integration navigation"><a href="/data/">Dataset</a><a href="/llms.txt">llms.txt</a><a href="/directory/">Directory</a><a href="${markdownUrl}">Markdown</a></nav></header>
  <section class="cards" aria-label="AI integration resources"><article class="card"><h2>Uploadable AI bundle</h2><p>One archive with the SQLite database, JSON and RDF data, zero-dependency Python and ESM libraries, an Agent Skill, examples, citation metadata, and both licenses.</p><a class="button" href="/ai/matlas-ai-bundle.zip">Download AI bundle</a></article><article class="card"><h2>Local workbench</h2><p>Search, inspect direct relations, find authored paths, compute distinct closures, build subgraphs, compare concepts, and copy visible JSON—all in the browser.</p><a class="button" href="/ai/workbench/">Open workbench</a></article><article class="card"><h2>Portable SDKs</h2><p>Use the Python standard library plus SQLite, or a zero-dependency ESM module. Both preserve authored direction, source records, and content version.</p><p><a href="/ai/sdk/matlas.py">Python SDK</a> · <a href="/ai/sdk/matlas.mjs">ESM SDK</a></p></article><article class="card"><h2>Agent Skill</h2><p>Installable instructions for compatible agents. The bundle includes the skill next to its scripts, references, and local data.</p><p><a href="/ai/skills/matlas/SKILL.md">Read SKILL.md</a></p></article><article class="card"><h2>Static integrations</h2><p>Small predictable JSON records, dereferenceable relation vocabulary terms, and a GET-only OpenAPI description support agents that can retrieve files but cannot run arbitrary code.</p><p><a href="/openapi.json">OpenAPI description</a> · <a href="/vocab/">Relation vocabulary</a> · <a href="/data/latest/manifest.json">Data manifest</a></p></article><article class="card"><h2>Citation chain</h2><p>mAtlas graph assertions need both their canonical concept or relation URL and their attached scholarly or reference sources.</p><p><a href="/ai/citation-guide.md">Citation guide</a> · <a href="/CITATION.cff">CITATION.cff</a></p></article></section>
  <aside class="note"><p><strong>Static limitation:</strong> there is no remote query endpoint or hosted MCP server. For arbitrary operations, use the bundle’s local code, the browser workbench, or the progressive WebMCP registration in a browser that supports it.</p></aside>
  <footer class="footer"><p>${projectLicenseFooter(graphData)}</p></footer>
</main></body></html>`;
}

function vocabularyJsonLd(graphData, dataManifest) {
  const canonicalUrl = appUrl('vocab/');
  return {
    '@context': {
      '@vocab': appUrl('vocab/'),
      schema: 'https://schema.org/',
      skos: 'http://www.w3.org/2004/02/skos/core#',
      dcterms: 'http://purl.org/dc/terms/'
    },
    '@id': canonicalUrl,
    '@type': 'DefinedTermSet',
    name: 'mAtlas relation vocabulary',
    description: 'Dereferenceable definitions for mAtlas typed, directed relation assertions.',
    url: canonicalUrl,
    version: dataManifest.contentVersion,
    license: graphData.meta.licenseUrl,
    copyrightNotice: graphData.meta.attribution,
    hasDefinedTerm: Object.entries(graphData.edgeTypes).map(([id, type]) => ({
      '@id': relationTypeVocabularyUrl(id),
      '@type': 'DefinedTerm',
      name: type.label,
      termCode: id,
      description: type.description,
      inDefinedTermSet: { '@id': canonicalUrl }
    }))
  };
}

function vocabularyIndexMarkdown(graphData, dataManifest) {
  return [
    '# mAtlas relation vocabulary',
    '',
    `Canonical vocabulary: ${appUrl('vocab/')}`,
    `Content version: \`${dataManifest.contentVersion}\``,
    '',
    'This controlled vocabulary defines the durable relation-type URLs used by the RDF/JSON-LD and Turtle exports. Every mAtlas relation remains an authored directed `source` → `target` assertion; a relation type does not license inference of an unrecorded edge.',
    '',
    '## Relation types',
    '',
    ...Object.entries(graphData.edgeTypes).map(([id, type]) => `- ${markdownLink(type.label, relationTypeVocabularyUrl(id))} (\`${id}\`) — ${type.description}`),
    '',
    `Machine-readable vocabulary: ${markdownLink('vocab/matlas.jsonld', appUrl('vocab/matlas.jsonld'))}`,
    `Relation records: ${markdownLink('data/latest/relation-types.ndjson', appUrl('data/latest/relation-types.ndjson'))}`,
    ''
  ].join('\n');
}

function relationTypeVocabularyMarkdown(graphData, dataManifest, typeId, type) {
  const relationCount = graphData.edges.filter((edge) => edge.type === typeId).length;
  return [
    `# ${type.label} — mAtlas relation type`,
    '',
    `Canonical term: ${relationTypeVocabularyUrl(typeId)}`,
    `Term code: \`${typeId}\``,
    `Content version: \`${dataManifest.contentVersion}\``,
    '',
    type.description,
    '',
    '## Directed semantics',
    '',
    `An authored edge has the form \`source\` → \`target\`. Source role: ${type.endpointLabels.source}. Target role: ${type.endpointLabels.target}.`,
    `Predecessor-level policy: \`${type.enforcePredecessorLevel ?? 'none'}\`. Prerequisite traversal policy: \`${type.prerequisiteTraversal}\`.`,
    `This release contains ${relationCount.toLocaleString('en-US')} direct authored relation${relationCount === 1 ? '' : 's'} of this type.`,
    '',
    `Machine-readable record: ${markdownLink(`data/latest/relation-types/${typeId}.json`, appUrl(`data/latest/relation-types/${encodeURIComponent(typeId)}.json`))}`,
    ''
  ].join('\n');
}

function vocabularyPage({ graphData, title, description, canonicalUrl, jsonLd, content }) {
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow,max-snippet:-1"><meta name="theme-color" content="#f6f7f9">
  ${themeBootstrapScript}
  <link rel="canonical" href="${canonicalUrl}"><link rel="alternate" type="text/markdown" href="${canonicalUrl}index.html.md" title="Markdown vocabulary page"><link rel="icon" href="/favicon.ico" sizes="any"><title>${escapeHtml(title)}</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>${staticThemeCss}:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--page-bg);line-height:1.55}*{box-sizing:border-box}body{margin:0}.page{max-width:960px;margin:auto;padding:clamp(1rem,4vw,3rem)}a{color:var(--link);text-underline-offset:.16em}.brand{display:flex;align-items:center;gap:.8rem;font-weight:800}.brand img{width:48px;height:48px}.brand a{text-decoration:none}.lede{max-width:760px;color:var(--muted);font-size:1.06rem}.links{display:flex;gap:.55rem;flex-wrap:wrap;margin:1rem 0}.links a{display:inline-flex;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:.4rem .66rem;text-decoration:none;font-weight:700;font-size:.84rem}.card{margin:1rem 0;padding:1rem 1.1rem;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)}.card h2{margin:.1rem 0 .55rem;color:var(--heading)}.terms{margin:0;padding-left:1.2rem}.terms li+li{margin-top:.65rem}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.65rem}.meta div{padding:.65rem .75rem;border:1px solid var(--line-soft);border-radius:9px;background:var(--panel-2)}.meta dt{font-size:.77rem;color:var(--muted-2);font-weight:800;text-transform:uppercase;letter-spacing:.04em}.meta dd{margin:.15rem 0 0}.footer{padding:1rem 0;color:var(--muted-2);font-size:.85rem}code{overflow-wrap:anywhere}</style>
</head><body><main class="page">
  <header><div class="brand"><a href="/" aria-label="Atlas of Fundamental Concepts home"><img src="/assets/atlas-logo.png" width="48" height="48" alt="Atlas of Fundamental Concepts logo"></a><a href="/">Atlas of Fundamental Concepts</a></div><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(description)}</p><nav class="links" aria-label="Vocabulary navigation"><a href="/vocab/">Relation vocabulary</a><a href="/data/">Dataset</a><a href="/ai/">AI integration</a><a href="/llms.txt">llms.txt</a></nav></header>
  ${content}
  <footer class="footer"><p>${escapeHtml(graphData.meta.attribution)} · <a href="${escapeHtml(graphData.meta.licenseUrl)}">${escapeHtml(graphData.meta.license)}</a></p></footer>
</main></body></html>`;
}

function vocabularyIndexPage(graphData, dataManifest) {
  const canonicalUrl = appUrl('vocab/');
  const jsonLd = vocabularyJsonLd(graphData, dataManifest);
  const terms = Object.entries(graphData.edgeTypes).map(([id, type]) => `<li><a href="${escapeHtml(relationTypeVocabularyUrl(id))}"><strong>${escapeHtml(type.label)}</strong></a> <code>${escapeHtml(id)}</code><br><span>${escapeHtml(type.description)}</span></li>`).join('');
  return vocabularyPage({
    graphData,
    title: 'mAtlas relation vocabulary',
    description: 'Dereferenceable definitions for the typed, directed relation URLs used by mAtlas RDF exports.',
    canonicalUrl,
    jsonLd,
    content: `<section class="card"><h2>Controlled vocabulary</h2><p>Use these terms to interpret the relation type of an authored mAtlas edge. The edge itself remains the citable assertion and carries its specific explanation and source citations.</p><p><a href="/vocab/matlas.jsonld">Machine-readable JSON-LD vocabulary</a> · <a href="/data/latest/relation-types.ndjson">Relation-type NDJSON</a></p></section><section class="card"><h2>Relation types</h2><ul class="terms">${terms}</ul></section>`
  });
}

function relationTypeVocabularyPage(graphData, dataManifest, typeId, type) {
  const canonicalUrl = relationTypeVocabularyUrl(typeId);
  const relationCount = graphData.edges.filter((edge) => edge.type === typeId).length;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'DefinedTerm', '@id': canonicalUrl,
    name: type.label, termCode: typeId, description: type.description,
    inDefinedTermSet: { '@id': appUrl('vocab/') }, license: graphData.meta.licenseUrl,
    copyrightNotice: graphData.meta.attribution
  };
  return vocabularyPage({
    graphData,
    title: `${type.label} relation type`,
    description: type.description,
    canonicalUrl,
    jsonLd,
    content: `<section class="card"><h2>Directed semantics</h2><p>Every direct mAtlas edge is an authored <code>source</code> → <code>target</code> assertion of this type.</p><dl class="meta"><div><dt>Term code</dt><dd><code>${escapeHtml(typeId)}</code></dd></div><div><dt>Source role</dt><dd>${escapeHtml(type.endpointLabels.source)}</dd></div><div><dt>Target role</dt><dd>${escapeHtml(type.endpointLabels.target)}</dd></div><div><dt>Direct relations in this release</dt><dd>${relationCount.toLocaleString('en-US')}</dd></div><div><dt>Predecessor-level policy</dt><dd><code>${escapeHtml(type.enforcePredecessorLevel ?? 'none')}</code></dd></div><div><dt>Prerequisite traversal</dt><dd><code>${escapeHtml(type.prerequisiteTraversal)}</code></dd></div></dl></section><section class="card"><h2>Machine-readable record</h2><p><a href="/data/latest/relation-types/${encodeURIComponent(typeId)}.json">/data/latest/relation-types/${escapeHtml(typeId)}.json</a> provides this definition and the IDs of every direct relation of this type.</p><p>A path may traverse an edge backwards for connectivity, but that never reverses the authored source-to-target assertion.</p></section>`
  });
}

function workbenchPage(graphData, dataManifest, workbenchScriptPath) {
  const canonicalUrl = appUrl(WORKBENCH_PATH);
  const description = `Browser-local deterministic graph workbench for ${graphData.meta.title}.`;
  const form = (id, title, description, fields, button, toolName) => `<section class="tool-card" aria-labelledby="${id}-title"><h2 id="${id}-title">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><form id="${id}-form" toolname="${toolName}" tooldescription="${escapeHtml(description)}">${fields}<button type="submit">${escapeHtml(button)}</button></form></section>`;
  const input = (id, label, options = {}) => `<label for="${id}">${escapeHtml(label)}<input id="${id}" name="${id}" type="${options.type ?? 'text'}"${options.value !== undefined ? ` value="${escapeHtml(options.value)}"` : ''}${options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ''}${options.required ? ' required' : ''}></label>`;
  const select = (id, label, values, selected = values[0]?.value ?? '') => `<label for="${id}">${escapeHtml(label)}<select id="${id}" name="${id}">${values.map((value) => `<option value="${escapeHtml(value.value)}"${value.value === selected ? ' selected' : ''}>${escapeHtml(value.label)}</option>`).join('')}</select></label>`;
  const direction = [{ value: 'either', label: 'Either direction' }, { value: 'outgoing', label: 'Authored source → target' }, { value: 'incoming', label: 'Reverse traversal only' }];
  const typeOptions = Object.entries(graphData.edgeTypes).map(([id, type]) => `<option value="${escapeHtml(id)}">${escapeHtml(type.label)} (${escapeHtml(id)})</option>`).join('');
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="noindex,follow"><meta name="theme-color" content="#f6f7f9">
  ${themeBootstrapScript}
  <link rel="canonical" href="${canonicalUrl}"><link rel="icon" href="/favicon.ico" sizes="any"><title>mAtlas local AI workbench</title>
  <style>${staticThemeCss}:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--page-bg);line-height:1.5}*{box-sizing:border-box}body{margin:0}.page{max-width:1280px;margin:auto;padding:clamp(1rem,3vw,2.4rem)}a{color:var(--link);text-underline-offset:.16em}.brand{display:flex;align-items:center;gap:.8rem;font-weight:800}.brand img{width:46px;height:46px}.brand a{text-decoration:none}.lede{max-width:850px;color:var(--muted);font-size:1.05rem}.links{display:flex;gap:.55rem;flex-wrap:wrap;margin:1rem 0}.links a{display:inline-flex;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:.38rem .66rem;text-decoration:none;font-weight:700;font-size:.84rem}.status{display:block;margin:1rem 0;padding:.65rem .8rem;border:1px solid var(--line);border-radius:9px;background:var(--panel-2);color:var(--muted)}.status[data-state="error"]{border-color:#dc2626;color:#b91c1c}.tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:1rem;align-items:start}.tool-card,.result-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow);padding:1rem}.tool-card h2,.result-card h2{font-size:1.15rem;color:var(--heading);margin:.05rem 0 .35rem}.tool-card p{color:var(--muted);font-size:.92rem}.tool-card form{display:grid;gap:.65rem}.tool-card label{display:grid;gap:.25rem;font-size:.86rem;font-weight:700}.tool-card input,.tool-card select,.tool-card textarea{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);color:var(--text);font:inherit;padding:.48rem .55rem}.tool-card select[multiple]{min-height:7.5rem}.tool-card button{justify-self:start;border:1px solid var(--primary);border-radius:999px;background:var(--primary);color:#fff;padding:.48rem .76rem;font:inherit;font-weight:750;cursor:pointer}.tool-card button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}.hint{font-size:.8rem;color:var(--muted)}.result-card{margin-top:1rem}.result-card pre{max-height:520px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:.6rem 0 0;padding:.8rem;border:1px solid var(--line-soft);border-radius:9px;background:var(--panel-2);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.footer{padding:1rem 0;color:var(--muted-2);font-size:.85rem}@media(max-width:620px){.page{padding:1.1rem .85rem}.tools{grid-template-columns:1fr}}</style>
</head><body><main class="page" aria-busy="true">
  <header><div class="brand"><a href="/" aria-label="Atlas of Fundamental Concepts home"><img src="/assets/atlas-logo.png" width="46" height="46" alt="Atlas of Fundamental Concepts logo"></a><a href="/">Atlas of Fundamental Concepts</a></div><h1>Local AI workbench</h1><p class="lede">Runs against the published graph in this browser. Results are visibly rendered as JSON and preserve the authored edge direction, relation metadata, citations, and content version.</p><nav class="links" aria-label="Workbench navigation"><a href="/ai/">AI integration</a><a href="/data/">Dataset</a><a href="/data/latest/manifest.json">Data manifest</a><a href="/llms.txt">llms.txt</a></nav></header>
  <output id="workbench-status" class="status" role="status" aria-live="polite">Loading the published graph…</output>
  <p class="hint">Inputs accept canonical IDs. Search first when a name is uncertain. Relation-type restriction is optional; leave it unselected to use all authored relation types.</p>
  <section class="tools" aria-label="mAtlas graph operations">
    ${form('search', 'Search concepts', 'Resolve names, IDs, taxonomy, and authored text to canonical mAtlas concepts.', `${input('search-query', 'Concept query', { required: true, placeholder: 'for example: quotient topology' })}${input('search-limit', 'Maximum matches', { type: 'number', value: '10' })}`, 'Search', 'search_concepts')}
    ${form('neighbors', 'Direct relations', 'Return direct incoming and outgoing typed authored relations for one concept.', `${input('neighbors-concept', 'Concept ID', { required: true, placeholder: 'group' })}${select('neighbors-direction', 'Include', direction)}<label for="neighbors-types">Restrict relation types (optional)<select id="neighbors-types" name="neighbors-types" multiple>${typeOptions}</select></label>`, 'Get direct relations', 'get_neighbors')}
    ${form('path', 'Find authored paths', 'Find shortest paths through existing authored edges. Reverse traversal never reverses the original edge assertion.', `${input('path-source', 'Starting concept ID', { required: true, placeholder: 'group' })}${input('path-target', 'Ending concept ID', { required: true, placeholder: 'galois_group' })}${select('path-direction', 'Traversal direction', direction)}${input('path-depth', 'Maximum edges', { type: 'number', value: '8' })}${input('path-count', 'Maximum paths', { type: 'number', value: '5' })}`, 'Find paths', 'find_paths')}
    ${form('closure', 'Compute closure', 'Compute the distinct predecessor or prerequisite closure defined by relation-type metadata.', `${input('closure-concepts', 'Concept ID(s)', { required: true, placeholder: 'quantum_field_theory' })}${select('closure-kind', 'Closure kind', [{ value: 'prerequisite', label: 'Prerequisite closure' }, { value: 'predecessor', label: 'Predecessor closure' }])}`, 'Compute closure', 'get_prerequisite_closure')}
    ${form('connect', 'Connect concepts', 'Connect several concepts with a deterministic shortest-path heuristic over authored edges.', `${input('connect-concepts', 'Concept IDs (comma or newline separated)', { required: true, placeholder: 'group, ring, field' })}${select('connect-direction', 'Traversal direction', direction)}${input('connect-depth', 'Maximum edges per connection', { type: 'number', value: '8' })}`, 'Connect concepts', 'connect_concepts')}
    ${form('subgraph', 'Build a bounded subgraph', 'Expand direct neighbors around one or more concept IDs for a compact, machine-readable context package.', `${input('subgraph-concepts', 'Concept IDs (comma or newline separated)', { required: true, placeholder: 'group, ring' })}${select('subgraph-direction', 'Traversal direction', direction)}${input('subgraph-hops', 'Neighbor hops', { type: 'number', value: '1' })}`, 'Build subgraph', 'build_subgraph')}
    ${form('compare', 'Compare concepts', 'Compare authored metadata, direct relationships, common fields, domains, sources, and neighbors.', `${input('compare-left', 'First concept ID', { required: true, placeholder: 'group' })}${input('compare-right', 'Second concept ID', { required: true, placeholder: 'ring' })}`, 'Compare', 'compare_concepts')}
    ${form('permalink', 'Create canonical links', 'Return a canonical concept URL and an interactive-graph URL for one concept.', `${input('permalink-concept', 'Concept ID', { required: true, placeholder: 'group' })}`, 'Create links', 'create_permalink')}
  </section>
  <section class="result-card" aria-labelledby="result-title"><h2 id="result-title">Machine-readable result</h2><p class="hint">A browser agent can read this result directly from the DOM. Use Copy JSON to move it into another AI context.</p><button id="copy-result" type="button">Copy JSON</button><pre id="workbench-result" tabindex="0" aria-live="polite">{}</pre></section>
  <footer class="footer"><p>${projectLicenseFooter(graphData, ` · Content version ${escapeHtml(dataManifest.contentVersion)}`)}</p></footer>
</main><script type="module" src="${escapeHtml(workbenchScriptPath)}" data-atlas-url="/data/latest/atlas.json" data-manifest-url="/data/latest/manifest.json"></script></body></html>`;
}

function bundleManifest(graphData, dataManifest, files) {
  return {
    formatVersion: 1,
    name: `${graphData.meta.title} AI bundle`,
    contentVersion: dataManifest.contentVersion,
    canonicalDatasetUrl: appUrl('data/'),
    license: { name: graphData.meta.license, url: graphData.meta.licenseUrl, attribution: graphData.meta.attribution },
    files: files.map(({ pathname, bytes }) => ({
      pathname,
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })).sort((left, right) => left.pathname.localeCompare(right.pathname))
  };
}

export async function generateAiPublication({ graphData, dataManifest, distUrl, lastModified, sdkSource, workbenchScriptPath }) {
  const [pythonSource, projectLicense, contentLicense] = await Promise.all([
    readFile(new URL('../src/ai/matlas.py', import.meta.url), 'utf8'),
    readFile(new URL('../LICENSE', import.meta.url)),
    readFile(new URL('../content/LICENSE', import.meta.url))
  ]);
  const openApi = jsonText(openApiDocument(graphData, dataManifest));
  const cff = citationCff(graphData, dataManifest, lastModified);
  const citation = jsonText(citationJson(graphData, dataManifest, lastModified));
  const mixedLicense = { licenseUrl: PROJECT_LICENSE_URL };
  const contentPublicationLicense = { licenseUrl: graphData.meta.licenseUrl };
  const guide = appendTextPublicationMetadata(citationGuideMarkdown(graphData, dataManifest), graphData, 'ai/citation-guide.md', mixedLicense);
  const skillCitationGuide = appendTextPublicationMetadata(citationGuideMarkdown(graphData, dataManifest), graphData, `${SKILL_PATH}references/citation-guide.md`, mixedLicense);
  const bundleCitationGuide = appendTextPublicationMetadata(citationGuideMarkdown(graphData, dataManifest), graphData, 'references/citation-guide.md', mixedLicense);
  const schemaReference = appendTextPublicationMetadata(schemaReferenceMarkdown(graphData, dataManifest), graphData, `${SKILL_PATH}references/schema.md`, mixedLicense);
  const skill = appendTextPublicationMetadata(skillMarkdown(graphData, dataManifest), graphData, `${SKILL_PATH}SKILL.md`, mixedLicense);
  const readme = appendTextPublicationMetadata(bundleReadme(graphData, dataManifest), graphData, 'ai/README.md', mixedLicense);
  const answerExample = appendTextPublicationMetadata(answerWithSourcesExample(dataManifest), graphData, 'ai/examples/answer-with-sources.md', mixedLicense);
  const aiMarkdown = appendTextPublicationMetadata(aiIndexMarkdown(graphData, dataManifest), graphData, `${AI_PATH}index.html.md`, mixedLicense);
  const vocabularyContext = jsonText(vocabularyJsonLd(graphData, dataManifest));
  const vocabularyIndexMarkdownText = appendTextPublicationMetadata(vocabularyIndexMarkdown(graphData, dataManifest), graphData, 'vocab/index.html.md', contentPublicationLicense);
  const vocabularyFiles = [
    { pathname: 'vocab/matlas.jsonld', bytes: Buffer.from(vocabularyContext, 'utf8') },
    { pathname: 'vocab/index.html', bytes: Buffer.from(minifyHtml(vocabularyIndexPage(graphData, dataManifest)), 'utf8') },
    { pathname: 'vocab/index.html.md', bytes: Buffer.from(vocabularyIndexMarkdownText, 'utf8') },
    ...Object.entries(graphData.edgeTypes).flatMap(([typeId, type]) => {
      const path = relationTypeVocabularyPath(typeId);
      const markdown = appendTextPublicationMetadata(relationTypeVocabularyMarkdown(graphData, dataManifest, typeId, type), graphData, `${path}index.html.md`, contentPublicationLicense);
      return [
        { pathname: `${path}index.html`, bytes: Buffer.from(minifyHtml(relationTypeVocabularyPage(graphData, dataManifest, typeId, type)), 'utf8') },
        { pathname: `${path}index.html.md`, bytes: Buffer.from(markdown, 'utf8') }
      ];
    })
  ];
  const publishedFiles = [
    { pathname: 'CITATION.cff', bytes: Buffer.from(cff, 'utf8') },
    { pathname: 'citation.json', bytes: Buffer.from(citation, 'utf8') },
    { pathname: 'openapi.json', bytes: Buffer.from(openApi, 'utf8') },
    { pathname: `${AI_PATH}index.html`, bytes: Buffer.from(minifyHtml(aiIndexPage(graphData, dataManifest, lastModified)), 'utf8') },
    { pathname: `${AI_PATH}index.html.md`, bytes: Buffer.from(aiMarkdown, 'utf8') },
    { pathname: `${AI_PATH}README.md`, bytes: Buffer.from(readme, 'utf8') },
    { pathname: `${AI_PATH}citation-guide.md`, bytes: Buffer.from(guide, 'utf8') },
    { pathname: `${AI_PATH}sdk/matlas.py`, bytes: Buffer.from(pythonSource, 'utf8') },
    { pathname: `${AI_PATH}sdk/matlas.mjs`, bytes: Buffer.from(sdkSource, 'utf8') },
    { pathname: `${SKILL_PATH}SKILL.md`, bytes: Buffer.from(skill, 'utf8') },
    { pathname: `${SKILL_PATH}scripts/matlas.py`, bytes: Buffer.from(pythonSource, 'utf8') },
    { pathname: `${SKILL_PATH}scripts/matlas.mjs`, bytes: Buffer.from(sdkSource, 'utf8') },
    { pathname: `${SKILL_PATH}references/schema.md`, bytes: Buffer.from(schemaReference, 'utf8') },
    { pathname: `${SKILL_PATH}references/citation-guide.md`, bytes: Buffer.from(skillCitationGuide, 'utf8') },
    { pathname: `${AI_PATH}examples/answer-with-sources.md`, bytes: Buffer.from(answerExample, 'utf8') },
    { pathname: `${AI_PATH}examples/find-path.py`, bytes: Buffer.from(pythonExample('find-path', "result = atlas.find_paths('group', 'galois_group', direction='either')", graphData), 'utf8') },
    { pathname: `${AI_PATH}examples/prerequisite-closure.py`, bytes: Buffer.from(pythonExample('prerequisite-closure', "result = atlas.get_prerequisite_closure(['quantum_field_theory'])", graphData), 'utf8') },
    { pathname: `${AI_PATH}examples/build-subgraph.py`, bytes: Buffer.from(pythonExample('build-subgraph', "result = atlas.build_subgraph(['group', 'ring'], hops=1)", graphData), 'utf8') },
    { pathname: `${AI_PATH}examples/compare-concepts.mjs`, bytes: Buffer.from(mjsExample(graphData), 'utf8') },
    { pathname: `${WORKBENCH_PATH}index.html`, bytes: Buffer.from(minifyHtml(workbenchPage(graphData, dataManifest, workbenchScriptPath)), 'utf8') },
    ...vocabularyFiles
  ];
  const directories = new Set(publishedFiles.map((file) => file.pathname.slice(0, file.pathname.lastIndexOf('/') + 1)).filter(Boolean));
  await Promise.all([...directories].map((directory) => mkdir(new URL(directory, distUrl), { recursive: true })));
  await Promise.all(publishedFiles.map((file) => writeFile(new URL(file.pathname, distUrl), file.bytes)));

  const bundlePaths = [
    ['README.md', Buffer.from(readme, 'utf8')],
    ['SKILL.md', Buffer.from(skill, 'utf8')],
    ['CITATION.cff', Buffer.from(cff, 'utf8')],
    ['citation.json', Buffer.from(citation, 'utf8')],
    ['openapi.json', Buffer.from(openApi, 'utf8')],
    ['LICENSE', projectLicense],
    ['CONTENT_LICENSE', contentLicense],
    ['sdk/matlas.py', Buffer.from(pythonSource, 'utf8')],
    ['sdk/matlas.mjs', Buffer.from(sdkSource, 'utf8')],
    ['scripts/matlas.py', Buffer.from(pythonSource, 'utf8')],
    ['scripts/matlas.mjs', Buffer.from(sdkSource, 'utf8')],
    ['references/schema.md', Buffer.from(schemaReference, 'utf8')],
    ['references/citation-guide.md', Buffer.from(bundleCitationGuide, 'utf8')],
    ['examples/answer-with-sources.md', Buffer.from(answerExample, 'utf8')],
    ['examples/find-path.py', publishedFiles.find((file) => file.pathname === `${AI_PATH}examples/find-path.py`)?.bytes],
    ['examples/prerequisite-closure.py', publishedFiles.find((file) => file.pathname === `${AI_PATH}examples/prerequisite-closure.py`)?.bytes],
    ['examples/build-subgraph.py', publishedFiles.find((file) => file.pathname === `${AI_PATH}examples/build-subgraph.py`)?.bytes],
    ['examples/compare-concepts.mjs', publishedFiles.find((file) => file.pathname === `${AI_PATH}examples/compare-concepts.mjs`)?.bytes]
  ].map(([pathname, bytes]) => ({ pathname, bytes: Buffer.from(bytes ?? '') }));
  for (const file of ['manifest.json', 'atlas.json', 'schema.json', 'views.json', 'provenance.json', 'concepts.ndjson', 'relations.ndjson', 'sources.ndjson', 'domains.ndjson', 'fields.ndjson', 'relation-types.ndjson', 'matlas.sqlite', 'matlas.jsonld', 'matlas.ttl']) {
    bundlePaths.push({ pathname: `data/${file}`, bytes: await readFile(new URL(`data/latest/${file}`, distUrl)) });
  }
  const manifest = bundleManifest(graphData, dataManifest, bundlePaths);
  bundlePaths.push({ pathname: 'manifest.json', bytes: Buffer.from(jsonText(manifest), 'utf8') });
  await writeFile(new URL(`${AI_PATH}matlas-ai-bundle.zip`, distUrl), createZipArchive(bundlePaths));
  return { openApi, bundleManifest: manifest };
}

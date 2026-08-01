import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { contentManifestUrl, contentSourceDirectory, generatedContentSourceDirectory } from './paths.mjs';

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${detail}`);
  }
}

function parseYamlBytes(bytes, label) {
  try {
    return parseYaml(bytes.toString('utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid YAML: ${detail}`);
  }
}

function sourceFileUrl(file, label, extensionPattern) {
  if (typeof file !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?\.(?:json|ya?ml)$/u.test(file) || file.includes('..')) {
    throw new Error(`content/manifest.json files.${label} must be a path under content/ ending in .json, .yaml, or .yml.`);
  }
  if (!extensionPattern.test(file)) {
    throw new Error(`content/manifest.json files.${label} must match ${extensionPattern}.`);
  }
  const url = new URL(file, contentSourceDirectory);
  if (!url.href.startsWith(contentSourceDirectory.href)) {
    throw new Error(`content/manifest.json files.${label} must resolve inside content/.`);
  }
  return url;
}

function localYamlPartUrl(baseUrl, file, label) {
  if (typeof file !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?\.ya?ml$/u.test(file) || file.includes('..')) {
    throw new Error(`${label} must reference a .yaml/.yml file inside content/.`);
  }
  const url = new URL(file, baseUrl);
  if (!url.href.startsWith(contentSourceDirectory.href)) {
    throw new Error(`${label} must resolve inside content/.`);
  }
  return url;
}

function contentYamlUrl(baseUrl, file, label) {
  if (typeof file !== 'string' || !/^[A-Za-z0-9./-]+\.ya?ml$/u.test(file)) {
    throw new Error(`${label} must reference a .yaml/.yml file inside content/.`);
  }
  const url = new URL(file, baseUrl);
  if (!url.href.startsWith(contentSourceDirectory.href)) {
    throw new Error(`${label} must resolve inside content/.`);
  }
  return url;
}

function normalizeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function contentRelativeLabel(url) {
  const marker = '/content/';
  const index = url.pathname.indexOf(marker);
  return index >= 0 ? `content/${url.pathname.slice(index + marker.length)}` : url.pathname;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = [];
  for (const value of values) {
    if (seen.has(value)) duplicates.push(value);
    else seen.add(value);
  }
  return duplicates;
}

function loadRemovedDomains(index, fieldsList, domainsList) {
  const entries = index.removedDomains ?? [];
  if (!Array.isArray(entries)) {
    throw new Error('content/concepts/index.yaml removedDomains must be a sequence when provided.');
  }
  const activePaths = new Set();
  for (const [fieldId, field] of Object.entries(fieldsList.map)) {
    if (typeof field?.path === 'string') activePaths.add(field.path);
    for (const [domainId, domain] of Object.entries(domainsList.map)) {
      if (domain?.field === fieldId && typeof field?.path === 'string') activePaths.add(`${field.path}/${domainId}`);
    }
  }
  const ids = new Set();
  const paths = new Set();
  return entries.map((entry, indexOffset) => {
    const label = `content/concepts/index.yaml removedDomains[${indexOffset}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} must be an object.`);
    }
    const keys = Object.keys(entry);
    for (const key of keys) if (!['id', 'path', 'redirectTo'].includes(key)) throw new Error(`${label} has unknown property "${key}".`);
    if (typeof entry.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)) {
      throw new Error(`${label}.id must be a lowercase kebab-case domain id.`);
    }
    if (ids.has(entry.id)) throw new Error(`${label}.id duplicates removed domain "${entry.id}".`);
    if (domainsList.map[entry.id]) throw new Error(`${label}.id conflicts with active domain "${entry.id}".`);
    if (typeof entry.path !== 'string' || !/^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(entry.path)) {
      throw new Error(`${label}.path must be a root-relative page path without leading or trailing slashes.`);
    }
    if (paths.has(entry.path)) throw new Error(`${label}.path duplicates removed-domain path "${entry.path}".`);
    if (activePaths.has(entry.path)) throw new Error(`${label}.path conflicts with active taxonomy page "${entry.path}".`);
    if (typeof entry.redirectTo !== 'string' || !/^\/(?:[A-Za-z0-9._~-]+\/)*$/u.test(entry.redirectTo)) {
      throw new Error(`${label}.redirectTo must be an absolute site path ending in a slash.`);
    }
    if (`/${entry.path}/` === entry.redirectTo) throw new Error(`${label}.redirectTo must not redirect to itself.`);
    ids.add(entry.id);
    paths.add(entry.path);
    return { id: entry.id, path: entry.path, redirectTo: entry.redirectTo };
  });
}

function indexedListToMap(indexList, label) {
  if (!Array.isArray(indexList) || indexList.length === 0) {
    throw new Error(`${label} must be a non-empty sequence of objects with id fields.`);
  }
  const ids = indexList.map((entry) => entry?.id);
  const duplicateIds = duplicateValues(ids.filter((id) => typeof id === 'string'));
  if (duplicateIds.length) {
    throw new Error(`${label} contains duplicate ids: ${duplicateIds.slice(0, 5).join(', ')}${duplicateIds.length > 5 ? ` (+${duplicateIds.length - 5} more)` : ''}.`);
  }
  const missingIdIndex = indexList.findIndex((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !entry.id);
  if (missingIdIndex >= 0) {
    throw new Error(`${label}[${missingIdIndex}] must be an object with a non-empty string id.`);
  }
  return {
    ids: indexList.map((entry) => entry.id),
    map: Object.fromEntries(indexList.map((entry) => {
      const { id, ...rest } = entry;
      return [id, rest];
    }))
  };
}

async function listConceptDomainFiles(indexUrl) {
  const conceptsRootUrl = new URL('./', indexUrl);
  const rootEntries = await readdir(conceptsRootUrl, { withFileTypes: true });
  const domainFiles = [];
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    const fieldId = entry.name;
    const fieldDirUrl = new URL(`${fieldId}/`, conceptsRootUrl);
    const fileEntries = await readdir(fieldDirUrl, { withFileTypes: true });
    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile()) continue;
      if (!/\.ya?ml$/u.test(fileEntry.name)) continue;
      const domainId = fileEntry.name.replace(/\.ya?ml$/u, '');
      domainFiles.push({
        file: `${fieldId}/${fileEntry.name}`,
        fieldId,
        domainId
      });
    }
  }
  return domainFiles;
}

async function writeIntermediateJson(fileName, value) {
  await mkdir(generatedContentSourceDirectory, { recursive: true });
  const fileUrl = new URL(fileName, generatedContentSourceDirectory);
  const bytes = normalizeJson(value);
  await writeFile(fileUrl, bytes);
  return { fileUrl, bytes };
}

async function loadStructuredGraphFromYaml(indexUrl) {
  const indexBytes = await readFile(indexUrl);
  const index = parseYamlBytes(indexBytes, contentRelativeLabel(indexUrl));
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error('content/concepts/index.yaml must be a YAML object.');
  }
  if (!index.meta || typeof index.meta !== 'object' || Array.isArray(index.meta)) {
    throw new Error('content/concepts/index.yaml meta must be an object.');
  }
  if (!index.levelPolicy || typeof index.levelPolicy !== 'object' || Array.isArray(index.levelPolicy)) {
    throw new Error('content/concepts/index.yaml levelPolicy must be an object.');
  }
  const fieldsList = indexedListToMap(index.fields, 'content/concepts/index.yaml fields');
  const domainsList = indexedListToMap(index.domains, 'content/concepts/index.yaml domains');
  const edgeTypesList = indexedListToMap(index.edgeTypes, 'content/concepts/index.yaml edgeTypes');
  const removedDomains = loadRemovedDomains(index, fieldsList, domainsList);
  for (const [domainId, domain] of Object.entries(domainsList.map)) {
    if (typeof domain?.field !== 'string' || !fieldsList.map[domain.field]) {
      throw new Error(`content/concepts/index.yaml domains entry "${domainId}" must reference a known field id.`);
    }
  }
  if (typeof index.sources !== 'string') {
    throw new Error('content/concepts/index.yaml sources must be a YAML filename.');
  }
  if (typeof index.layout !== 'string') {
    throw new Error('content/concepts/index.yaml layout must be a YAML filename.');
  }
  const layoutUrl = contentYamlUrl(indexUrl, index.layout, 'content/concepts/index.yaml layout');
  const layoutBytes = await readFile(layoutUrl);
  const layout = parseYamlBytes(layoutBytes, contentRelativeLabel(layoutUrl));
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new Error('content/layout.yaml must be a YAML object.');
  }
  const sourcesUrl = localYamlPartUrl(indexUrl, index.sources, 'content/concepts/index.yaml sources');
  const sourcePart = parseYamlBytes(await readFile(sourcesUrl), contentRelativeLabel(sourcesUrl));
  if (!sourcePart || typeof sourcePart !== 'object' || Array.isArray(sourcePart)) {
    throw new Error('content/concepts/sources.yaml must be a YAML object with "citationLegend" and "sources".');
  }
  if (!sourcePart.citationLegend || typeof sourcePart.citationLegend !== 'object' || Array.isArray(sourcePart.citationLegend)) {
    throw new Error('content/concepts/sources.yaml citationLegend must be an object.');
  }
  if (!sourcePart.sources || typeof sourcePart.sources !== 'object' || Array.isArray(sourcePart.sources)) {
    throw new Error('content/concepts/sources.yaml sources must be an object.');
  }
  const discoveredDomainFiles = await listConceptDomainFiles(indexUrl);
  const discoveredDomainFileMap = new Map(discoveredDomainFiles.map((entry) => [`${entry.fieldId}/${entry.domainId}`, entry.file]));
  const expectedDomainFileKeys = domainsList.ids.map((domainId) => {
    const fieldId = domainsList.map[domainId].field;
    return `${fieldId}/${domainId}`;
  });
  const missingDomainFiles = expectedDomainFileKeys.filter((key) => !discoveredDomainFileMap.has(key));
  if (missingDomainFiles.length) {
    throw new Error(`Missing concept domain files for domains defined in content/concepts/index.yaml: ${missingDomainFiles.slice(0, 5).map((key) => `${key}.yaml`).join(', ')}${missingDomainFiles.length > 5 ? ` (+${missingDomainFiles.length - 5} more)` : ''}.`);
  }
  const expectedDomainFileKeySet = new Set(expectedDomainFileKeys);
  const unexpectedDomainFiles = discoveredDomainFiles.filter((entry) => !expectedDomainFileKeySet.has(`${entry.fieldId}/${entry.domainId}`));
  if (unexpectedDomainFiles.length) {
    throw new Error(`Unexpected concept domain files not defined by content/concepts/index.yaml domains: ${unexpectedDomainFiles.slice(0, 5).map((entry) => entry.file).join(', ')}${unexpectedDomainFiles.length > 5 ? ` (+${unexpectedDomainFiles.length - 5} more)` : ''}.`);
  }
  const nodeMap = new Map();
  const edgeMap = new Map();
  const nodes = [];
  const edges = [];
  for (const domainId of domainsList.ids) {
    const expectedFieldId = domainsList.map[domainId].field;
    const file = discoveredDomainFileMap.get(`${expectedFieldId}/${domainId}`) ?? `${expectedFieldId}/${domainId}.yaml`;
    const conceptUrl = localYamlPartUrl(indexUrl, file, `content/concepts/${file}`);
    const conceptBytes = await readFile(conceptUrl);
    const conceptData = parseYamlBytes(conceptBytes, contentRelativeLabel(conceptUrl)) ?? {};
    if (typeof conceptData !== 'object' || Array.isArray(conceptData)) {
      throw new Error(`content/concepts/${file} must be a YAML object with "nodes" and "edges".`);
    }
    const localNodes = conceptData.nodes ?? [];
    const localEdges = conceptData.edges ?? [];
    if (!Array.isArray(localNodes)) throw new Error(`content/concepts/${file} nodes must be a sequence when provided.`);
    if (!Array.isArray(localEdges)) throw new Error(`content/concepts/${file} edges must be a sequence when provided.`);
    const localNodeIds = new Set();
    for (const [nodeIndex, node] of localNodes.entries()) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new Error(`content/concepts/${file} nodes[${nodeIndex}] must be an object.`);
      }
      if (typeof node.id !== 'string' || !node.id) {
        throw new Error(`content/concepts/${file} nodes[${nodeIndex}] must define a non-empty string id.`);
      }
      if (nodeMap.has(node.id)) {
        throw new Error(`Duplicate node id "${node.id}" in content/concepts/${file}; already defined in another concept file.`);
      }
      if (node.primaryDomain !== domainId) {
        throw new Error(`content/concepts/${file} node "${node.id}" primaryDomain must be "${domainId}" (found "${node.primaryDomain ?? 'undefined'}").`);
      }
      localNodeIds.add(node.id);
      nodeMap.set(node.id, node);
      nodes.push(node);
    }
    for (const [edgeIndex, edge] of localEdges.entries()) {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
        throw new Error(`content/concepts/${file} edges[${edgeIndex}] must be an object.`);
      }
      if (typeof edge.id !== 'string' || !edge.id) {
        throw new Error(`content/concepts/${file} edges[${edgeIndex}] must define a non-empty string id.`);
      }
      if (edgeMap.has(edge.id)) {
        throw new Error(`Duplicate edge id "${edge.id}" in content/concepts/${file}; already defined in another concept file.`);
      }
      if (typeof edge.source !== 'string' || !localNodeIds.has(edge.source)) {
        throw new Error(`content/concepts/${file} edge "${edge.id}" source "${edge.source ?? ''}" must reference a node in the same file.`);
      }
      edgeMap.set(edge.id, edge);
      edges.push(edge);
    }
  }
  const meta = {
    ...index.meta,
    fieldOrder: fieldsList.ids,
    domainOrder: domainsList.ids,
    edgeTypeOrder: edgeTypesList.ids
  };
  return {
    graph: {
      meta,
      citationLegend: sourcePart.citationLegend,
      domains: domainsList.map,
      fields: fieldsList.map,
      edgeTypes: edgeTypesList.map,
      levelPolicy: index.levelPolicy,
      layout,
      sources: sourcePart.sources,
      nodes,
      edges
    },
    removedDomains,
    layoutBytes,
    layoutUrl
  };
}

async function loadViewsFromYaml(indexUrl) {
  const indexBytes = await readFile(indexUrl);
  const index = parseYamlBytes(indexBytes, contentRelativeLabel(indexUrl));
  if (!Array.isArray(index?.views)) {
    throw new Error('content/views/index.yaml must define a "views" sequence.');
  }
  if (index.meta != null && (typeof index.meta !== 'object' || Array.isArray(index.meta))) {
    throw new Error('content/views/index.yaml meta must be an object when provided.');
  }
  const views = await Promise.all(index.views.map(async (entry, indexOffset) => {
    const file = typeof entry === 'string' ? entry : entry?.file;
    const viewUrl = localYamlPartUrl(indexUrl, file, `content/views/index.yaml views[${indexOffset}]`);
    const viewBytes = await readFile(viewUrl);
    const view = parseYamlBytes(viewBytes, contentRelativeLabel(viewUrl));
    if (!view || typeof view !== 'object' || Array.isArray(view)) {
      throw new Error(`content/views/index.yaml views[${indexOffset}] must resolve to a YAML object.`);
    }
    return view;
  }));
  return { meta: index.meta ?? {}, views };
}

async function loadShareCodecFromYaml(url) {
  const bytes = await readFile(url);
  const data = parseYamlBytes(bytes, contentRelativeLabel(url));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('content/share-codec.yaml must be a YAML object.');
  }
  const intermediate = await writeIntermediateJson('share-codec.json', data);
  return { data, bytes: intermediate.bytes };
}

async function loadJsonOrYaml(url, label) {
  if (url.pathname.endsWith('.json')) {
    const bytes = await readFile(url);
    return { data: parseJson(bytes, contentRelativeLabel(url)), bytes };
  }
  if (label === 'graph') {
    const { graph, removedDomains, layoutBytes, layoutUrl } = await loadStructuredGraphFromYaml(url);
    const { bytes } = await writeIntermediateJson('structures.json', graph);
    return { data: graph, bytes, removedDomains, layoutBytes, layoutUrl };
  }
  const data = await loadViewsFromYaml(url);
  const { bytes } = await writeIntermediateJson('views.json', data);
  return { data, bytes };
}

export async function loadSourceContent() {
  const manifestBytes = await readFile(contentManifestUrl);
  const manifest = parseJson(manifestBytes, 'content/manifest.json');
  const graphUrl = sourceFileUrl(manifest.files?.graph, 'graph', /\.(?:json|ya?ml)$/u);
  const schemaUrl = sourceFileUrl(manifest.files?.schema, 'schema', /\.json$/u);
  const viewsUrl = sourceFileUrl(manifest.files?.views, 'views', /\.(?:json|ya?ml)$/u);
  const shareCodecUrl = sourceFileUrl(manifest.files?.shareCodec, 'shareCodec', /\.ya?ml$/u);
  const [graphResult, schemaBytes, viewsResult, shareCodecResult] = await Promise.all([
    loadJsonOrYaml(graphUrl, 'graph'),
    readFile(schemaUrl),
    loadJsonOrYaml(viewsUrl, 'views'),
    loadShareCodecFromYaml(shareCodecUrl)
  ]);
  return {
    manifest,
    manifestBytes,
    graph: graphResult.data,
    graphBytes: graphResult.bytes,
    schema: parseJson(schemaBytes, `content/${manifest.files.schema}`),
    schemaBytes,
    viewsData: viewsResult.data,
    viewsBytes: viewsResult.bytes,
    shareCodec: shareCodecResult.data,
    shareCodecBytes: shareCodecResult.bytes,
    removedDomains: graphResult.removedDomains ?? [],
    layoutBytes: graphResult.layoutBytes,
    urls: { graphUrl, schemaUrl, viewsUrl, shareCodecUrl, layoutUrl: graphResult.layoutUrl }
  };
}

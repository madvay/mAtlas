import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appUrl,
  conceptPath,
  domainPath,
  fieldPath,
  nodeMap,
  relationCanonicalUrl,
  relationTypeVocabularyUrl
} from './publication-urls.mjs';

export const DERIVED_DISTRIBUTION_DEFINITIONS = [
  { key: 'conceptsNdjson', file: 'concepts.ndjson', label: 'Concepts and construction junctions NDJSON', encodingFormat: 'application/x-ndjson' },
  { key: 'relationsNdjson', file: 'relations.ndjson', label: 'Relations NDJSON', encodingFormat: 'application/x-ndjson' },
  { key: 'sourcesNdjson', file: 'sources.ndjson', label: 'Sources NDJSON', encodingFormat: 'application/x-ndjson' },
  { key: 'domainsNdjson', file: 'domains.ndjson', label: 'Domains NDJSON', encodingFormat: 'application/x-ndjson' },
  { key: 'fieldsNdjson', file: 'fields.ndjson', label: 'Fields NDJSON', encodingFormat: 'application/x-ndjson' },
  { key: 'relationTypesNdjson', file: 'relation-types.ndjson', label: 'Relation types NDJSON', encodingFormat: 'application/x-ndjson' },
  { key: 'sqlite', file: 'matlas.sqlite', label: 'mAtlas SQLite database', encodingFormat: 'application/vnd.sqlite3' },
  { key: 'jsonld', file: 'matlas.jsonld', label: 'mAtlas RDF JSON-LD graph', encodingFormat: 'application/ld+json' },
  { key: 'turtle', file: 'matlas.ttl', label: 'mAtlas RDF Turtle graph', encodingFormat: 'text/turtle' }
];

function jsonBytes(value, pretty = false) {
  return Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`, 'utf8');
}

function publicationMetadata(graphData) {
  return {
    formatVersion: 1,
    contentVersion: graphData.meta.version,
    license: {
      name: graphData.meta.license,
      url: graphData.meta.licenseUrl
    },
    attribution: graphData.meta.attribution
  };
}

function nodeReference(node) {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    canonicalUrl: node.kind === 'structure'
      ? appUrl(conceptPath(node.id))
      : appUrl(`?node=${encodeURIComponent(node.id)}`)
  };
}

function sourceRecords(graphData, citationIds) {
  return (citationIds ?? []).flatMap((sourceId) => {
    const source = graphData.sources[sourceId];
    return source ? [{ id: sourceId, ...source }] : [];
  });
}

function relationRecord(graphData, edge, nodesById) {
  const type = graphData.edgeTypes[edge.type];
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  return {
    ...edge,
    canonicalUrl: relationCanonicalUrl(edge, nodesById),
    sourceRecord: source ? nodeReference(source) : { id: edge.source },
    targetRecord: target ? nodeReference(target) : { id: edge.target },
    relationType: type ? { id: edge.type, ...type } : { id: edge.type },
    sources: sourceRecords(graphData, edge.citations)
  };
}

function ndjson(rows) {
  return Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function sourceReferenceUrl(sourceId) {
  return `${appUrl('data/latest/sources.ndjson')}#${encodeURIComponent(sourceId)}`;
}

function rdfContext() {
  return {
    '@vocab': appUrl('vocab/'),
    schema: 'https://schema.org/',
    dcterms: 'http://purl.org/dc/terms/',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    matlas: appUrl('vocab/'),
    source: { '@id': 'matlas:source', '@type': '@id' },
    target: { '@id': 'matlas:target', '@type': '@id' },
    relationType: { '@id': 'matlas:relationType', '@type': '@id' },
    citation: { '@id': 'dcterms:references', '@type': '@id' },
    field: { '@id': 'matlas:field', '@type': '@id' },
    domain: { '@id': 'matlas:domain', '@type': '@id' }
  };
}

function buildJsonLd(graphData, provenance) {
  const nodesById = nodeMap(graphData);
  const metadata = publicationMetadata(graphData);
  const graph = [{
    '@id': appUrl('data/'),
    '@type': ['schema:Dataset', 'matlas:AtlasDataset'],
    'schema:name': `${graphData.meta.title} dataset`,
    'schema:description': graphData.meta.description,
    'schema:version': metadata.contentVersion,
    'schema:license': graphData.meta.licenseUrl,
    'dcterms:rights': graphData.meta.attribution,
    'schema:distribution': DERIVED_DISTRIBUTION_DEFINITIONS.map((definition) => ({
      '@id': appUrl(`data/latest/${definition.file}`),
      '@type': 'schema:DataDownload',
      'schema:encodingFormat': definition.encodingFormat
    }))
  }];
  for (const [fieldId, field] of Object.entries(graphData.fields)) {
    graph.push({
      '@id': appUrl(fieldPath(graphData, fieldId)),
      '@type': ['skos:ConceptScheme', 'matlas:Field'],
      'skos:prefLabel': field.label,
      'schema:description': field.description,
      'dcterms:identifier': fieldId
    });
  }
  for (const [domainId, domain] of Object.entries(graphData.domains)) {
    graph.push({
      '@id': appUrl(domainPath(graphData, domainId)),
      '@type': ['skos:Collection', 'matlas:Domain'],
      'skos:prefLabel': domain.label,
      'dcterms:identifier': domainId,
      field: { '@id': appUrl(fieldPath(graphData, domain.field)) }
    });
  }
  for (const node of graphData.nodes) {
    graph.push({
      '@id': nodeReference(node).canonicalUrl,
      '@type': node.kind === 'structure' ? ['skos:Concept', 'schema:DefinedTerm', 'matlas:Concept'] : ['matlas:ConstructionJunction'],
      'skos:prefLabel': node.label,
      'schema:name': node.label,
      'schema:description': node.summary,
      'dcterms:identifier': node.id,
      field: (node.fields?.length ? node.fields : [node.primaryField ?? graphData.domains[node.primaryDomain]?.field]).filter(Boolean)
        .map((fieldId) => ({ '@id': appUrl(fieldPath(graphData, fieldId)) })),
      domain: (node.domains?.length ? node.domains : [node.primaryDomain])
        .map((domainId) => ({ '@id': appUrl(domainPath(graphData, domainId)) })),
      citation: (node.citations ?? []).map((sourceId) => ({ '@id': sourceReferenceUrl(sourceId) }))
    });
  }
  for (const edge of graphData.edges) {
    const relation = relationRecord(graphData, edge, nodesById);
    graph.push({
      '@id': relation.canonicalUrl,
      '@type': 'matlas:Relation',
      'schema:name': edge.label,
      'schema:description': edge.detail,
      'dcterms:identifier': edge.id,
      source: { '@id': relation.sourceRecord.canonicalUrl },
      target: { '@id': relation.targetRecord.canonicalUrl },
      relationType: { '@id': relationTypeVocabularyUrl(edge.type) },
      citation: (edge.citations ?? []).map((sourceId) => ({ '@id': sourceReferenceUrl(sourceId) }))
    });
  }
  for (const [typeId, type] of Object.entries(graphData.edgeTypes)) {
    graph.push({
      '@id': relationTypeVocabularyUrl(typeId),
      '@type': 'matlas:RelationType',
      'schema:name': type.label,
      'schema:description': type.description,
      'dcterms:identifier': typeId,
      'matlas:prerequisiteTraversal': type.prerequisiteTraversal,
      'matlas:enforcePredecessorLevel': type.enforcePredecessorLevel ?? 'none'
    });
  }
  for (const [sourceId, source] of Object.entries(graphData.sources)) {
    graph.push({
      '@id': sourceReferenceUrl(sourceId),
      '@type': 'schema:CreativeWork',
      'schema:name': source.title,
      'schema:url': source.url,
      'dcterms:identifier': sourceId,
      'matlas:sourceKind': source.kind,
      'matlas:sourceLabel': source.label
    });
  }
  return {
    '@context': rdfContext(),
    '@id': appUrl('data/latest/matlas.jsonld'),
    '@type': 'matlas:AtlasGraph',
    'dcterms:hasVersion': provenance.contentVersion ?? graphData.meta.version,
    'dcterms:license': graphData.meta.licenseUrl,
    'dcterms:rights': graphData.meta.attribution,
    '@graph': graph
  };
}

function turtleString(value) {
  return `"${String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}"`;
}

function turtleIri(value) {
  return `<${String(value).replaceAll('>', '%3E')}>`;
}

function turtleList(values) {
  return values.map(turtleIri).join(', ');
}

function buildTurtle(graphData, provenance) {
  const nodesById = nodeMap(graphData);
  const lines = [
    '@prefix dcterms: <http://purl.org/dc/terms/> .',
    '@prefix schema: <https://schema.org/> .',
    '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .',
    `@prefix matlas: <${appUrl('vocab/')}> .`,
    '',
    `${turtleIri(appUrl('data/'))} a schema:Dataset, matlas:AtlasDataset ;`,
    `  schema:name ${turtleString(`${graphData.meta.title} dataset`)} ;`,
    `  schema:description ${turtleString(graphData.meta.description)} ;`,
    `  schema:version ${turtleString(provenance.contentVersion ?? graphData.meta.version)} ;`,
    `  dcterms:license ${turtleIri(graphData.meta.licenseUrl)} ;`,
    `  dcterms:rights ${turtleString(graphData.meta.attribution)} .`,
    ''
  ];
  for (const [fieldId, field] of Object.entries(graphData.fields)) {
    lines.push(
      `${turtleIri(appUrl(fieldPath(graphData, fieldId)))} a skos:ConceptScheme, matlas:Field ;`,
      `  skos:prefLabel ${turtleString(field.label)} ;`,
      `  dcterms:identifier ${turtleString(fieldId)} ;`,
      `  schema:description ${turtleString(field.description)} .`,
      ''
    );
  }
  for (const [domainId, domain] of Object.entries(graphData.domains)) {
    lines.push(
      `${turtleIri(appUrl(domainPath(graphData, domainId)))} a skos:Collection, matlas:Domain ;`,
      `  skos:prefLabel ${turtleString(domain.label)} ;`,
      `  dcterms:identifier ${turtleString(domainId)} ;`,
      `  matlas:field ${turtleIri(appUrl(fieldPath(graphData, domain.field)))} .`,
      ''
    );
  }
  for (const node of graphData.nodes) {
    const fields = (node.fields?.length ? node.fields : [node.primaryField ?? graphData.domains[node.primaryDomain]?.field]).filter(Boolean)
      .map((fieldId) => appUrl(fieldPath(graphData, fieldId)));
    const domains = (node.domains?.length ? node.domains : [node.primaryDomain])
      .map((domainId) => appUrl(domainPath(graphData, domainId)));
    lines.push(
      `${turtleIri(nodeReference(node).canonicalUrl)} a ${node.kind === 'structure' ? 'skos:Concept, schema:DefinedTerm, matlas:Concept' : 'matlas:ConstructionJunction'} ;`,
      `  skos:prefLabel ${turtleString(node.label)} ;`,
      `  schema:description ${turtleString(node.summary)} ;`,
      `  dcterms:identifier ${turtleString(node.id)}${fields.length ? ` ;\n  matlas:field ${turtleList(fields)}` : ''}${domains.length ? ` ;\n  matlas:domain ${turtleList(domains)}` : ''}${node.citations?.length ? ` ;\n  dcterms:references ${turtleList(node.citations.map(sourceReferenceUrl))}` : ''} .`,
      ''
    );
  }
  for (const edge of graphData.edges) {
    const relation = relationRecord(graphData, edge, nodesById);
    lines.push(
      `${turtleIri(relation.canonicalUrl)} a matlas:Relation ;`,
      `  schema:name ${turtleString(edge.label)} ;`,
      `  schema:description ${turtleString(edge.detail)} ;`,
      `  dcterms:identifier ${turtleString(edge.id)} ;`,
      `  matlas:source ${turtleIri(relation.sourceRecord.canonicalUrl)} ;`,
      `  matlas:target ${turtleIri(relation.targetRecord.canonicalUrl)} ;`,
      `  matlas:relationType ${turtleIri(relationTypeVocabularyUrl(edge.type))}${edge.citations?.length ? ` ;\n  dcterms:references ${turtleList(edge.citations.map(sourceReferenceUrl))}` : ''} .`,
      ''
    );
  }
  for (const [typeId, type] of Object.entries(graphData.edgeTypes)) {
    lines.push(
      `${turtleIri(relationTypeVocabularyUrl(typeId))} a matlas:RelationType ;`,
      `  schema:name ${turtleString(type.label)} ;`,
      `  schema:description ${turtleString(type.description)} ;`,
      `  dcterms:identifier ${turtleString(typeId)} ;`,
      `  matlas:prerequisiteTraversal ${turtleString(type.prerequisiteTraversal)} ;`,
      `  matlas:enforcePredecessorLevel ${turtleString(type.enforcePredecessorLevel ?? 'none')} .`,
      ''
    );
  }
  for (const [sourceId, source] of Object.entries(graphData.sources)) {
    lines.push(
      `${turtleIri(sourceReferenceUrl(sourceId))} a schema:CreativeWork ;`,
      `  schema:name ${turtleString(source.title)} ;`,
      `  schema:url ${turtleIri(source.url)} ;`,
      `  dcterms:identifier ${turtleString(sourceId)} ;`,
      `  matlas:sourceKind ${turtleString(source.kind)} .`,
      ''
    );
  }
  lines.push(`# Content license: ${graphData.meta.licenseUrl}`, `# Attribution: ${graphData.meta.attribution}`, '');
  return Buffer.from(lines.join('\n'), 'utf8');
}

async function createSqlite(graphData, viewsData, provenance) {
  const temporaryRoot = process.env.MATLAS_TEMP_DIRECTORY
    ?? fileURLToPath(new URL('../.build/tmp/', import.meta.url));
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'matlas-sqlite-'));
  const output = join(temporaryDirectory, 'matlas.sqlite');
  const scriptPath = fileURLToPath(new URL('./generate-matlas-sqlite.py', import.meta.url));
  const command = process.env.MATLAS_PYTHON ?? 'python3';
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, [scriptPath, '--output', output], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', (error) => reject(new Error(`Unable to run ${command} for the mAtlas SQLite export: ${error.message}`)));
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mAtlas SQLite export failed with status ${code ?? 'unknown'}: ${stderr.trim()}`));
      });
      child.stdin.end(JSON.stringify({ graphData, viewsData, provenance }));
    });
    return await readFile(output);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function buildRecordFiles(graphData) {
  const nodesById = nodeMap(graphData);
  const metadata = publicationMetadata(graphData);
  const files = new Map();
  const structures = graphData.nodes.filter((node) => node.kind === 'structure');
  for (const node of structures) {
    const conceptUrl = appUrl(conceptPath(node.id));
    const incoming = graphData.edges.filter((edge) => edge.target === node.id).map((edge) => relationRecord(graphData, edge, nodesById));
    const outgoing = graphData.edges.filter((edge) => edge.source === node.id).map((edge) => relationRecord(graphData, edge, nodesById));
    files.set(`concepts/${encodeURIComponent(node.id)}.json`, jsonBytes({
      ...metadata,
      recordType: 'concept',
      canonicalUrl: conceptUrl,
      interactiveUrl: appUrl(`?node=${encodeURIComponent(node.id)}`),
      concept: node,
      sources: sourceRecords(graphData, node.citations)
    }, true));
    files.set(`concepts/${encodeURIComponent(node.id)}/relations.json`, jsonBytes({
      ...metadata,
      recordType: 'concept_relations',
      conceptId: node.id,
      canonicalUrl: conceptUrl,
      incoming,
      outgoing
    }, true));
  }
  for (const [domainId, domain] of Object.entries(graphData.domains)) {
    const field = graphData.fields[domain.field];
    const conceptIds = structures
      .filter((node) => (node.domains?.length ? node.domains : [node.primaryDomain]).includes(domainId))
      .map((node) => node.id)
      .sort();
    files.set(`domains/${encodeURIComponent(domainId)}.json`, jsonBytes({
      ...metadata,
      recordType: 'domain',
      canonicalUrl: appUrl(domainPath(graphData, domainId)),
      domain: { id: domainId, ...domain },
      field: field ? { id: domain.field, ...field } : { id: domain.field },
      conceptIds
    }, true));
  }
  for (const [typeId, type] of Object.entries(graphData.edgeTypes)) {
    const relationIds = graphData.edges.filter((edge) => edge.type === typeId).map((edge) => edge.id).sort();
    files.set(`relation-types/${encodeURIComponent(typeId)}.json`, jsonBytes({
      ...metadata,
      recordType: 'relation_type',
      canonicalUrl: relationTypeVocabularyUrl(typeId),
      relationType: { id: typeId, ...type },
      relationIds
    }, true));
  }
  return files;
}

export async function createDerivedMachineArtifacts({ graphData, viewsData, provenance }) {
  const metadata = publicationMetadata(graphData);
  const nodesById = nodeMap(graphData);
  const nodes = [...graphData.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...graphData.edges].sort((left, right) => left.id.localeCompare(right.id));
  const artifacts = {
    conceptsNdjson: ndjson([
      { recordType: 'publication_metadata', format: 'matlas-ndjson/1', ...metadata },
      ...nodes.map((node) => ({
        recordType: node.kind === 'structure' ? 'concept' : 'construction_junction',
        ...metadata,
        canonicalUrl: nodeReference(node).canonicalUrl,
        ...node
      }))
    ]),
    relationsNdjson: ndjson([
      { recordType: 'publication_metadata', format: 'matlas-ndjson/1', ...metadata },
      ...edges.map((edge) => ({ recordType: 'relation', ...metadata, ...relationRecord(graphData, edge, nodesById) }))
    ]),
    sourcesNdjson: ndjson([
      { recordType: 'publication_metadata', format: 'matlas-ndjson/1', ...metadata },
      ...Object.entries(graphData.sources).sort(([left], [right]) => left.localeCompare(right)).map(([id, source]) => ({
        recordType: 'source', ...metadata, id, ...source, canonicalUrl: sourceReferenceUrl(id)
      }))
    ]),
    domainsNdjson: ndjson([
      { recordType: 'publication_metadata', format: 'matlas-ndjson/1', ...metadata },
      ...Object.entries(graphData.domains).sort(([left], [right]) => left.localeCompare(right)).map(([id, domain]) => ({
        recordType: 'domain', ...metadata, id, ...domain, canonicalUrl: appUrl(domainPath(graphData, id))
      }))
    ]),
    fieldsNdjson: ndjson([
      { recordType: 'publication_metadata', format: 'matlas-ndjson/1', ...metadata },
      ...Object.entries(graphData.fields).sort(([left], [right]) => left.localeCompare(right)).map(([id, field]) => ({
        recordType: 'field', ...metadata, id, ...field, canonicalUrl: appUrl(fieldPath(graphData, id))
      }))
    ]),
    relationTypesNdjson: ndjson([
      { recordType: 'publication_metadata', format: 'matlas-ndjson/1', ...metadata },
      ...Object.entries(graphData.edgeTypes).sort(([left], [right]) => left.localeCompare(right)).map(([id, type]) => ({
        recordType: 'relation_type', ...metadata, id, ...type, canonicalUrl: relationTypeVocabularyUrl(id)
      }))
    ]),
    sqlite: await createSqlite(graphData, viewsData, provenance),
    jsonld: jsonBytes(buildJsonLd(graphData, provenance), true),
    turtle: buildTurtle(graphData, provenance)
  };
  return { artifacts, recordFiles: buildRecordFiles(graphData) };
}

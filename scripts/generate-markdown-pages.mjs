import { mkdir, writeFile } from 'node:fs/promises';
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
  publicNodeUrl,
  relationCanonicalUrl
} from './publication-urls.mjs';
import { appendTextPublicationMetadata } from './publication-text-metadata.mjs';

const PROJECT_LICENSE_URL = 'https://github.com/madvay/mAtlas/blob/main/LICENSE';
const MIXED_PUBLICATION_PATHS = new Set(['index.html.md', 'guide/index.html.md']);

function markdownText(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replace(/\s+/gu, ' ').trim();
}

function markdownCode(value) {
  return `\`${String(value ?? '').replaceAll('`', '\\`')}\``;
}

function markdownLink(label, href) {
  return `[${markdownText(label)}](${href})`;
}

function nodeMarkdownLink(node) {
  return markdownLink(node?.label ?? node?.id ?? 'Unknown node', publicNodeUrl(node));
}

function sourceMarkdown(graphData, sourceId) {
  const source = graphData.sources[sourceId];
  if (!source) return `${markdownCode(sourceId)} (source record unavailable)`;
  return `${markdownLink(source.label, source.url)} — ${markdownText(source.title)} (${markdownText(source.kind)}; source ID ${markdownCode(sourceId)})`;
}

function sourceListMarkdown(graphData, sourceIds, heading) {
  if (!sourceIds?.length) return '';
  return [
    `## ${heading}`,
    '',
    ...sourceIds.map((sourceId) => `- ${sourceMarkdown(graphData, sourceId)}`),
    ''
  ].join('\n');
}

function fieldMarkdownLinks(graphData, node) {
  return nodeFieldIds(graphData, node).map((fieldId) => markdownLink(graphData.fields[fieldId].label, appUrl(fieldPath(graphData, fieldId))));
}

function domainMarkdownLinks(graphData, node) {
  return nodeDomainIds(node).map((domainId) => {
    const domain = graphData.domains[domainId];
    return domain ? markdownLink(domain.label, appUrl(domainPath(graphData, domainId))) : markdownCode(domainId);
  });
}

function detailsMarkdown(node) {
  const sections = [];
  const listSections = [
    ['Carrier(s)', node.carriers],
    ['Data', node.data],
    ['Axioms / constraints', node.axioms],
    ['Canonically induces', node.induces]
  ];
  for (const [heading, items] of listSections) {
    if (!items?.length) continue;
    sections.push(`## ${heading}\n\n${items.map((item) => `- ${markdownText(item)}`).join('\n')}\n`);
  }
  for (const section of node.sections ?? []) {
    const body = section.body ? `${markdownText(section.body)}\n` : '';
    const items = section.items?.length ? `${section.items.map((item) => `- ${markdownText(item)}`).join('\n')}\n` : '';
    sections.push(`## ${markdownText(section.title)}\n\n${body}${items}`);
  }
  if (node.notes) sections.push(`## Notes\n\n${markdownText(node.notes)}\n`);
  return sections.join('\n');
}

function relationMarkdown(graphData, edge, nodesById) {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  const type = graphData.edgeTypes[edge.type];
  const sourceLabel = source ? nodeMarkdownLink(source) : markdownCode(edge.source);
  const targetLabel = target ? nodeMarkdownLink(target) : markdownCode(edge.target);
  const relationUrl = relationCanonicalUrl(edge, nodesById);
  const sourceRole = type?.endpointLabels?.source ?? 'source endpoint';
  const targetRole = type?.endpointLabels?.target ?? 'target endpoint';
  return [
    `### ${markdownText(source?.label ?? edge.source)} → ${markdownText(target?.label ?? edge.target)}`,
    '',
    `- **Relation URL:** ${relationUrl}`,
    `- **Relation ID:** ${markdownCode(edge.id)}`,
    `- **Direction:** ${sourceLabel} → ${targetLabel}`,
    `- **Relation type:** ${markdownText(type?.label ?? edge.type)} (${markdownCode(edge.type)})`,
    `- **Endpoint roles:** source is ${markdownText(sourceRole)}; target is ${markdownText(targetRole)}.`,
    `- **Authored annotation:** ${markdownText(edge.label)}`,
    '',
    `**Authored explanation:** ${markdownText(edge.detail)}`,
    '',
    `**Edge-type interpretation:** ${markdownText(type?.description ?? 'No edge-type description is available.')}`,
    '',
    edge.citations?.length
      ? `**Relation sources:**\n${edge.citations.map((sourceId) => `- ${sourceMarkdown(graphData, sourceId)}`).join('\n')}`
      : '**Relation sources:** No citation is attached.',
    ''
  ].join('\n');
}

function relationSectionMarkdown(graphData, node, nodesById, direction) {
  const label = direction === 'incoming' ? 'Incoming relations (arrows to this concept)' : 'Outgoing relations (arrows from this concept)';
  const edges = directRelations(graphData, node.id, direction);
  if (!edges.length) return `## ${label}\n\nNo direct ${direction} relations are authored for this concept.\n`;
  return `## ${label}\n\n${edges.map((edge) => relationMarkdown(graphData, edge, nodesById)).join('\n')}`;
}

export function renderConceptMarkdown(graphData, node) {
  const nodesById = nodeMap(graphData);
  const fields = fieldMarkdownLinks(graphData, node);
  const domains = domainMarkdownLinks(graphData, node);
  const aliases = alternateTerms(node);
  const metadata = [
    `- **Concept ID:** ${markdownCode(node.id)}`,
    `- **Canonical page:** ${appUrl(conceptPath(node.id))}`,
    `- **Interactive graph:** ${appUrl(`?node=${encodeURIComponent(node.id)}`)}`,
    `- **Content version:** ${markdownCode(graphData.meta.version)}`,
    `- **Primary field:** ${markdownLink(graphData.fields[fieldIdForNode(graphData, node)]?.label ?? fieldIdForNode(graphData, node), appUrl(fieldPath(graphData, fieldIdForNode(graphData, node))) )}`,
    `- **Fields:** ${fields.join(', ') || 'No field is authored.'}`,
    `- **Primary domain:** ${domainMarkdownLinks(graphData, { ...node, domains: [node.primaryDomain] }).join(', ') || markdownCode(node.primaryDomain)}`,
    `- **Domains:** ${domains.join(', ') || 'No domain is authored.'}`
  ];
  if (node.conceptType) metadata.push(`- **Concept type:** ${markdownText(node.conceptType)}`);
  if (node.scale) metadata.push(`- **Scale:** ${markdownText(node.scale)}`);
  if (node.status) metadata.push(`- **Status:** ${markdownText(node.status)}`);
  return [
    `# ${markdownText(node.label)}`,
    '',
    'Canonical mAtlas concept record.',
    '',
    ...metadata,
    `- **Alternate terminology:** ${aliases.length ? aliases.map(markdownText).join('; ') : 'No alternate terminology is currently authored for this record.'}`,
    '',
    '## Summary',
    '',
    markdownText(node.summary),
    '',
    detailsMarkdown(node),
    sourceListMarkdown(graphData, node.citations, 'Concept sources'),
    relationSectionMarkdown(graphData, node, nodesById, 'incoming'),
    relationSectionMarkdown(graphData, node, nodesById, 'outgoing')
  ].filter(Boolean).join('\n');
}

export function renderScopeMarkdown(graphData, fieldId, domainId = null) {
  const field = graphData.fields[fieldId];
  const domain = domainId ? graphData.domains[domainId] : null;
  const title = domain ? `${domain.label} — ${graphData.meta.title}` : `${field.label} — ${graphData.meta.title}`;
  const concepts = domain
    ? graphData.nodes.filter((node) => node.kind === 'structure' && nodeDomainIds(node).includes(domainId))
    : graphData.nodes.filter((node) => node.kind === 'structure' && nodeFieldIds(graphData, node).includes(fieldId));
  const domainLinks = (graphData.meta.domainOrder ?? Object.keys(graphData.domains))
    .filter((id) => graphData.domains[id]?.field === fieldId)
    .map((id) => `- ${markdownLink(graphData.domains[id].label, appUrl(domainPath(graphData, id)))}`);
  return [
    `# ${markdownText(title)}`,
    '',
    `Canonical page: ${appUrl(domain ? domainPath(graphData, domainId) : fieldPath(graphData, fieldId))}`,
    `Interactive graph: ${appUrl(domain ? domainPath(graphData, domainId) : fieldPath(graphData, fieldId))}`,
    `Content version: ${markdownCode(graphData.meta.version)}`,
    '',
    '## Description',
    '',
    markdownText(domain ? `Explore ${domain.label} concepts and relations in ${field.label}.` : field.description),
    '',
    `## ${domain ? 'Concepts' : 'Domains'}`,
    '',
    ...(domain ? concepts
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((node) => `- ${markdownLink(node.label, appUrl(conceptPath(node.id)))} (${markdownCode(node.id)}) — ${markdownText(node.summary)}`)
      : domainLinks),
    ''
  ].join('\n');
}

export function renderDirectoryMarkdown(graphData) {
  const fields = graphData.meta.fieldOrder ?? Object.keys(graphData.fields);
  const relationTypes = graphData.meta.edgeTypeOrder ?? Object.keys(graphData.edgeTypes);
  const lines = [
    `# ${graphData.meta.title} — Directory`,
    '',
    `Canonical page: ${appUrl('directory/')}`,
    `Content version: ${markdownCode(graphData.meta.version)}`,
    '',
    markdownText(graphData.meta.description),
    '',
    '## Fields and domains',
    ''
  ];
  for (const fieldId of fields) {
    const field = graphData.fields[fieldId];
    lines.push(`### ${markdownLink(field.label, appUrl(fieldPath(graphData, fieldId)))}`, '', markdownText(field.description), '');
    for (const domainId of graphData.meta.domainOrder ?? Object.keys(graphData.domains)) {
      const domain = graphData.domains[domainId];
      if (domain.field === fieldId) lines.push(`- ${markdownLink(domain.label, appUrl(domainPath(graphData, domainId)))}`);
    }
    lines.push('');
  }
  lines.push('## Relation types', '');
  for (const typeId of relationTypes) {
    const type = graphData.edgeTypes[typeId];
    lines.push(`- **${markdownText(type.label)}** (${markdownCode(typeId)}): ${markdownText(type.description)} Source role: ${markdownText(type.endpointLabels.source)}. Target role: ${markdownText(type.endpointLabels.target)}.`);
  }
  lines.push('', '## Canonical concepts', '');
  for (const node of graphData.nodes.filter((candidate) => candidate.kind === 'structure').sort((left, right) => left.label.localeCompare(right.label))) {
    lines.push(`- ${markdownLink(node.label, appUrl(conceptPath(node.id)))} (${markdownCode(node.id)}) — ${markdownText(node.summary)}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderGuideMarkdown(graphData, viewsData) {
  const relationTypes = graphData.meta.edgeTypeOrder ?? Object.keys(graphData.edgeTypes);
  return [
    `# ${graphData.meta.title} — User Guide`,
    '',
    `Canonical page: ${appUrl('guide/')}`,
    '',
    '## 1. Quick start',
    '',
    'Search for a concept, select it to inspect its record and direct relations, then use the Filters panel to restrict fields, domains, and relation types. The toolbar switches among Layered, Compact, Domains, and Fields layouts.',
    '',
    '## 2. Read the graph',
    '',
    'Every arrow is a directed authored relation from source to target. Its type, endpoint roles, annotation, explanation, and sources define the claim. Construction junctions represent AND-style combinations: all listed inputs and their compatibility condition are required.',
    '',
    '## 3. Search, select, and navigate',
    '',
    'Use the search box or `/` to find concepts by label, domain, field, or ID. Drag to pan, scroll or pinch to zoom, and use Fit (`F`) to fit the visible graph. Select blank space to clear the current selection.',
    '',
    '## 4. Filters and display',
    '',
    'Fields and domains select direct matches. Relation type filters control visible edge types and prerequisite closure. Display controls govern labels, construction junctions, prerequisites, primary-domain matching, cross-field links, and layout. Preferences are browser-local and are not included in shared URLs.',
    '',
    '## 5. Relations and sources',
    '',
    ...relationTypes.map((typeId) => {
      const type = graphData.edgeTypes[typeId];
      return `- **${markdownText(type.label)}** (${markdownCode(typeId)}): ${markdownText(type.description)} Source endpoint: ${markdownText(type.endpointLabels.source)}; target endpoint: ${markdownText(type.endpointLabels.target)}.`;
    }),
    '',
    '## 6. Stories and Views',
    '',
    'Views are curated filters and display settings. Stories add an ordered concept sequence. Both can be opened from the toolbar or the static Stories & Views directory.',
    '',
    ...viewsData.views.map((view) => `- ${markdownLink(view.title, appUrl(`views/${encodeURIComponent(view.id)}/`))}: ${markdownText(view.summary)}`),
    '',
    '## 7. Permalinks and export',
    '',
    'Permalinks preserve graph selection and shared filter/display state. The SVG export downloads the currently visible graph. Browser-local preferences are not encoded in URLs.',
    '',
    '## 8. Static pages and published data',
    '',
    `- ${markdownLink('Dataset landing page', appUrl('data/'))}`,
    `- ${markdownLink('Atlas Directory', appUrl('directory/'))}`,
    `- ${markdownLink('Current data manifest', appUrl('data/latest/manifest.json'))}`,
    `- ${markdownLink('AI integration', appUrl('ai/'))}`,
    `- ${markdownLink('Browser-local AI workbench', appUrl('ai/workbench/'))}`,
    `- ${markdownLink('Uploadable AI bundle', appUrl('ai/matlas-ai-bundle.zip'))}`,
    `- ${markdownLink('All-in atlas SVG', appUrl('static/atlas.svg'))}`,
    '',
    'The graph is editorially selective and source-backed. For technical claims, preserve the attached external citations rather than treating graphical placement as evidence.',
    ''
  ].join('\n');
}

export function renderViewMarkdown(graphData, view) {
  const nodesById = nodeMap(graphData);
  const sequence = view.nodeSequence ?? [];
  return [
    `# ${markdownText(view.title)}`,
    '',
    `Canonical page: ${appUrl(`views/${encodeURIComponent(view.id)}/`)}`,
    `Kind: ${sequence.length ? 'Story' : 'View'}`,
    '',
    '## Summary',
    '',
    markdownText(view.summary),
    '',
    '## Narrative',
    '',
    markdownText(view.narrative),
    '',
    '## Tags',
    '',
    view.tags?.length ? view.tags.map((tag) => `- ${markdownText(tag)}`).join('\n') : 'No tags.',
    '',
    ...(sequence.length ? [
      '## Story sequence',
      '',
      ...sequence.map((nodeId, index) => {
        const node = nodesById.get(nodeId);
        return `${index + 1}. ${node ? nodeMarkdownLink(node) : markdownCode(nodeId)}`;
      }),
      ''
    ] : []),
    '## Interactive settings',
    '',
    `- Fields: ${(view.settings?.fields ?? []).map(markdownCode).join(', ') || 'Route defaults'}`,
    `- Domains: ${(view.settings?.domains ?? []).map(markdownCode).join(', ') || 'Route defaults'}`,
    `- Relation types: ${(view.settings?.edgeTypes ?? []).map(markdownCode).join(', ') || 'None'}`,
    `- Layout: ${markdownCode(view.settings?.layout ?? 'atlas')}`,
    ''
  ].join('\n');
}

export function renderViewsIndexMarkdown(graphData, viewsData) {
  return [
    `# ${graphData.meta.title} — Stories and Views`,
    '',
    `Canonical page: ${appUrl('views/')}`,
    '',
    'Views apply curated filters and display settings. Stories additionally provide a numbered concept sequence.',
    '',
    ...viewsData.views.map((view) => `- ${markdownLink(view.title, appUrl(`views/${encodeURIComponent(view.id)}/`))} — ${markdownText(view.summary)}`),
    ''
  ].join('\n');
}

export function renderConceptIndexMarkdown(graphData) {
  const concepts = graphData.nodes.filter((node) => node.kind === 'structure').sort((left, right) => left.label.localeCompare(right.label));
  return [
    `# ${graphData.meta.title} — Canonical concepts`,
    '',
    `Full directory: ${appUrl('directory/')}`,
    '',
    ...concepts.map((node) => `- ${markdownLink(node.label, appUrl(conceptPath(node.id)))} (${markdownCode(node.id)}) — ${markdownText(node.summary)}`),
    ''
  ].join('\n');
}

export function renderRootMarkdown(graphData, dataManifest) {
  return [
    `# ${graphData.meta.title}`,
    '',
    `Canonical site: ${appUrl()}`,
    `Content version: ${markdownCode(graphData.meta.version)}`,
    '',
    markdownText(graphData.meta.description),
    '',
    '## Entry points',
    '',
    `- ${markdownLink('Dataset landing page', appUrl('data/'))}`,
    `- ${markdownLink('Current data manifest', appUrl('data/latest/manifest.json'))}`,
    `- ${markdownLink('AI integration', appUrl('ai/'))}`,
    `- ${markdownLink('Uploadable AI bundle', appUrl('ai/matlas-ai-bundle.zip'))}`,
    `- ${markdownLink('Browser-local AI workbench', appUrl('ai/workbench/'))}`,
    `- ${markdownLink('Relation vocabulary', appUrl('vocab/'))}`,
    `- ${markdownLink('Atlas Directory', appUrl('directory/'))}`,
    `- ${markdownLink('User Guide', appUrl('guide/'))}`,
    `- ${markdownLink('Stories and Views', appUrl('views/'))}`,
    `- ${markdownLink('Concise AI context', appUrl('llms-context.txt'))}`,
    `- ${markdownLink('Complete AI context', appUrl('llms-context-full.txt'))}`,
    '',
    `The current data manifest identifies content version ${markdownCode(dataManifest.contentVersion)} and SHA-256 digests for the current published artifacts. It is replaced on each publication; save it with the downloaded artifacts when a retained snapshot is required.`,
    ''
  ].join('\n');
}

export function renderLlmsContext(graphData, viewsData, dataManifest) {
  const relationTypes = graphData.meta.edgeTypeOrder ?? Object.keys(graphData.edgeTypes);
  const fields = graphData.meta.fieldOrder ?? Object.keys(graphData.fields);
  return [
    `# ${graphData.meta.title} — AI context`,
    '',
    `Canonical site: ${appUrl()}`,
    `Dataset: ${appUrl('data/')}`,
    `Content version: ${markdownCode(dataManifest.contentVersion)}`,
    `Schema version: ${markdownCode(dataManifest.schemaVersion)}`,
    '',
    '## Use and citation rules',
    '',
    'mAtlas is an authored, source-backed graph. Resolve a requested topic to a canonical concept ID. A direct relation is an explicit editorial assertion directed from `source` to `target`; do not infer graph edges that are absent from the data. Distinguish a direct authored edge from any transitive path or closure computed from it. Cite the canonical concept URL and, for a direct relation, its relation URL; preserve the external sources attached to the record.',
    '',
    '## Dataset access',
    '',
    `- Current manifest: ${appUrl('data/latest/manifest.json')} (latest-only; save it with downloaded artifacts for reproducible use)`,
    `- Canonical graph JSON: ${dataManifest.distributions.atlas.contentUrl}`,
    `- JSON Schema: ${dataManifest.distributions.schema.contentUrl}`,
    `- Stories and Views: ${dataManifest.distributions.views.contentUrl}`,
    '',
    '## Fields and domains',
    '',
    ...fields.flatMap((fieldId) => {
      const field = graphData.fields[fieldId];
      const domains = (graphData.meta.domainOrder ?? Object.keys(graphData.domains))
        .filter((domainId) => graphData.domains[domainId].field === fieldId)
        .map((domainId) => markdownText(graphData.domains[domainId].label));
      return [`- **${markdownText(field.label)}** (${markdownCode(fieldId)}): ${markdownText(field.description)} Domains: ${domains.join('; ')}.`];
    }),
    '',
    '## Relation types',
    '',
    ...relationTypes.map((typeId) => {
      const type = graphData.edgeTypes[typeId];
      return `- **${markdownText(type.label)}** (${markdownCode(typeId)}): ${markdownText(type.description)} Source role: ${markdownText(type.endpointLabels.source)}. Target role: ${markdownText(type.endpointLabels.target)}. Prerequisite traversal: ${markdownCode(type.prerequisiteTraversal)}.`;
    }),
    '',
    '## Canonical concept summaries',
    '',
    ...graphData.nodes.filter((node) => node.kind === 'structure').sort((left, right) => left.label.localeCompare(right.label)).map((node) =>
      `- ${markdownLink(node.label, appUrl(conceptPath(node.id)))} (${markdownCode(node.id)}; ${fieldMarkdownLinks(graphData, node).join(', ')}): ${markdownText(node.summary)}`
    ),
    '',
    '## Stories and Views',
    '',
    ...viewsData.views.map((view) => `- ${markdownLink(view.title, appUrl(`views/${encodeURIComponent(view.id)}/`))}: ${markdownText(view.summary)}`),
    ''
  ].join('\n');
}

export function renderLlmsContextFull(graphData, viewsData, dataManifest) {
  return [
    renderLlmsContext(graphData, viewsData, dataManifest),
    '# Complete concept records',
    '',
    ...graphData.nodes.filter((node) => node.kind === 'structure').sort((left, right) => left.label.localeCompare(right.label)).map((node) => renderConceptMarkdown(graphData, node)),
    ''
  ].join('\n');
}

export async function generateMarkdownPages({ graphData, viewsData, dataManifest, distUrl }) {
  const writes = [];
  const writeMarkdown = async (pathname, content) => {
    const fileUrl = new URL(pathname, distUrl);
    await mkdir(new URL('./', fileUrl), { recursive: true });
    const license = MIXED_PUBLICATION_PATHS.has(pathname) ? { licenseUrl: PROJECT_LICENSE_URL } : undefined;
    await writeFile(fileUrl, appendTextPublicationMetadata(content, graphData, pathname, license));
  };

  writes.push(writeMarkdown('index.html.md', renderRootMarkdown(graphData, dataManifest)));
  writes.push(writeMarkdown('concepts/index.html.md', renderConceptIndexMarkdown(graphData)));
  writes.push(writeMarkdown('directory/index.html.md', renderDirectoryMarkdown(graphData)));
  writes.push(writeMarkdown('guide/index.html.md', renderGuideMarkdown(graphData, viewsData)));
  writes.push(writeMarkdown('views/index.html.md', renderViewsIndexMarkdown(graphData, viewsData)));

  for (const node of graphData.nodes.filter((candidate) => candidate.kind === 'structure')) {
    writes.push(writeMarkdown(`${conceptPath(node.id)}index.html.md`, renderConceptMarkdown(graphData, node)));
  }
  for (const fieldId of graphData.meta.fieldOrder ?? Object.keys(graphData.fields)) {
    writes.push(writeMarkdown(`${fieldPath(graphData, fieldId)}index.html.md`, renderScopeMarkdown(graphData, fieldId)));
  }
  for (const domainId of graphData.meta.domainOrder ?? Object.keys(graphData.domains)) {
    writes.push(writeMarkdown(`${domainPath(graphData, domainId)}index.html.md`, renderScopeMarkdown(graphData, graphData.domains[domainId].field, domainId)));
  }
  for (const view of viewsData.views) {
    writes.push(writeMarkdown(`views/${encodeURIComponent(view.id)}/index.html.md`, renderViewMarkdown(graphData, view)));
  }
  await Promise.all(writes);
}

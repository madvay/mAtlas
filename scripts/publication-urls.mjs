export const SITE_ORIGIN = 'https://atlas.madvay.com';

export function appUrl(pathname = '') {
  return new URL(pathname, `${SITE_ORIGIN}/`).toString();
}

export function conceptPath(nodeId) {
  return `concepts/${encodeURIComponent(nodeId)}/`;
}

export function fieldPath(graphData, fieldId) {
  return `${graphData.fields[fieldId]?.path ?? fieldId}/`;
}

export function domainPath(graphData, domainId) {
  const fieldId = graphData.domains[domainId]?.field;
  return `${fieldPath(graphData, fieldId)}${encodeURIComponent(domainId)}/`;
}

export function nodeDomainIds(node) {
  return node.domains?.length ? node.domains : node.primaryDomain ? [node.primaryDomain] : [];
}

export function fieldIdForNode(graphData, node) {
  return node.primaryField ?? graphData.domains[node.primaryDomain]?.field ?? graphData.meta.defaultField;
}

export function nodeFieldIds(graphData, node) {
  const primaryField = fieldIdForNode(graphData, node);
  const ids = node.fields?.length ? node.fields : primaryField ? [primaryField] : [];
  return [...new Set(ids.filter((id) => graphData.fields[id]))];
}

export function nodeMap(graphData) {
  return new Map(graphData.nodes.map((node) => [node.id, node]));
}

export function publicNodeUrl(node) {
  return node?.kind === 'structure'
    ? appUrl(conceptPath(node.id))
    : appUrl(`?node=${encodeURIComponent(node?.id ?? '')}`);
}

export function relationFragment(edgeId) {
  return `relation-${encodeURIComponent(edgeId)}`;
}

export function relationTypeVocabularyPath(typeId) {
  return `vocab/relation/${encodeURIComponent(typeId)}/`;
}

export function relationTypeVocabularyUrl(typeId) {
  return appUrl(relationTypeVocabularyPath(typeId));
}

export function relationCanonicalUrl(edge, nodesById) {
  const target = nodesById.get(edge.target);
  const source = nodesById.get(edge.source);
  const pageNode = target?.kind === 'structure' ? target : source?.kind === 'structure' ? source : null;
  const path = pageNode ? conceptPath(pageNode.id) : `?edge=${encodeURIComponent(edge.id)}`;
  return appUrl(`${path}#${relationFragment(edge.id)}`);
}

export function directRelations(graphData, nodeId, direction) {
  const matches = graphData.edges.filter((edge) => direction === 'incoming' ? edge.target === nodeId : edge.source === nodeId);
  return matches.sort((left, right) => {
    const leftNeighbor = direction === 'incoming' ? left.source : left.target;
    const rightNeighbor = direction === 'incoming' ? right.source : right.target;
    return leftNeighbor.localeCompare(rightNeighbor) || left.id.localeCompare(right.id);
  });
}

export function alternateTerms(node) {
  const candidates = node?.alternateTerms ?? node?.alternateLabels ?? node?.aliases;
  return Array.isArray(candidates)
    ? [...new Set(candidates.filter((term) => typeof term === 'string' && term.trim()).map((term) => term.trim()))]
    : [];
}

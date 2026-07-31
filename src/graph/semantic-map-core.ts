import type { FieldDefinition, DomainDefinition, GraphEdge, GraphNode, Point } from '../types.js';

export type SemanticMapScale = 'fields' | 'domains';

export interface SemanticMapGroup {
  id: string;
  label: string;
  color: string;
  fieldId: string;
  conceptIds: string[];
  conceptCount: number;
  internalRelations: number;
  incomingRelations: number;
  outgoingRelations: number;
  bridgeConcepts: Array<{ nodeId: string; count: number }>;
  position: Point;
}

export interface SemanticMapConnection {
  id: string;
  source: string;
  target: string;
  count: number;
  typeCounts: Record<string, number>;
  edgeIds: string[];
}

export interface SemanticMapData {
  groups: SemanticMapGroup[];
  connections: SemanticMapConnection[];
}

export interface SemanticMapInput {
  scale: SemanticMapScale;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  fields: Readonly<Record<string, FieldDefinition>>;
  domains: Readonly<Record<string, DomainDefinition>>;
  fieldOrder: readonly string[];
  domainOrder: readonly string[];
  fieldForDomain: (domainId: string) => string;
  primaryFieldForNode: (node: GraphNode) => string;
  positionForNode?: (nodeId: string) => Point | undefined;
  anchorForGroup?: (groupId: string, conceptIds: readonly string[]) => Point | undefined;
}

function groupId(scale: SemanticMapScale, node: GraphNode, primaryFieldForNode: (node: GraphNode) => string): string {
  return scale === 'fields' ? primaryFieldForNode(node) : node.primaryDomain;
}

function centeredRowPositions(ids: readonly string[], y: number, spacing: number): Map<string, Point> {
  const positions = new Map<string, Point>();
  const centerOffset = (ids.length - 1) * spacing / 2;
  ids.forEach((id, index) => positions.set(id, { x: index * spacing - centerOffset, y }));
  return positions;
}

function semanticPositions(
  scale: SemanticMapScale,
  groupIds: ReadonlySet<string>,
  fieldOrder: readonly string[],
  domainOrder: readonly string[],
  fieldForDomain: (domainId: string) => string
): Map<string, Point> {
  if (scale === 'fields') {
    const ids = fieldOrder.filter((id) => groupIds.has(id));
    return centeredRowPositions(ids, 0, 360);
  }

  const positions = new Map<string, Point>();
  const activeFields = fieldOrder.filter((fieldId) => domainOrder.some((domainId) =>
    groupIds.has(domainId) && fieldForDomain(domainId) === fieldId));
  const maxColumns = 8;
  const columnSpacing = 310;
  const rowSpacing = 220;
  const fieldGap = 170;
  const fieldBlocks = activeFields.map((fieldId) => {
    const ids = domainOrder.filter((domainId) => groupIds.has(domainId) && fieldForDomain(domainId) === fieldId);
    const rowCount = Math.max(1, Math.ceil(ids.length / maxColumns));
    return { fieldId, ids, height: (rowCount - 1) * rowSpacing };
  });
  const totalHeight = fieldBlocks.reduce((sum, block) => sum + block.height, 0)
    + Math.max(0, fieldBlocks.length - 1) * fieldGap;
  let y = -totalHeight / 2;
  for (const block of fieldBlocks) {
    for (let start = 0, rowIndex = 0; start < block.ids.length; start += maxColumns, rowIndex += 1) {
      const rowIds = block.ids.slice(start, start + maxColumns);
      const row = centeredRowPositions(rowIds, y + rowIndex * rowSpacing, columnSpacing);
      row.forEach((point, id) => positions.set(id, point));
    }
    y += block.height + fieldGap;
  }
  return positions;
}

function centroid(conceptIds: readonly string[], positionForNode: (nodeId: string) => Point | undefined): Point | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const nodeId of conceptIds) {
    const point = positionForNode(nodeId);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    x += point.x;
    y += point.y;
    count += 1;
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
}

export function domainLevelAnchor(
  groupId: string,
  visibleDomainIds: readonly string[],
  nodes: readonly GraphNode[],
  positionForNode: (nodeId: string) => Point | undefined
): Point | null {
  const ordinaryDomainIds = visibleDomainIds
    .filter((domainId) => domainId !== 'set-theory' && domainId !== 'physical-foundations');
  const ordinaryIndex = ordinaryDomainIds.indexOf(groupId);
  const useCentered = true || (groupId !== 'set-theory' && groupId !== 'physical-foundations');
  if (useCentered) {
    const structureNodes = nodes.filter((node) => node.kind === 'structure' && node.primaryDomain === groupId);
    if (!structureNodes.length) return null;
    return centroid(structureNodes.map((node) => node.id), positionForNode);
  }
  const useLowest = groupId === 'set-theory'
    || groupId === 'physical-foundations'
    || ordinaryIndex < 0
    || ordinaryIndex % 2 === 0;
  const structureNodes = nodes.filter((node) => node.kind === 'structure');
  if (!structureNodes.length) return null;
  const level = useLowest
    ? Math.min(...structureNodes.map((node) => node.level))
    : Math.max(...structureNodes.map((node) => node.level));
  return centroid(
    structureNodes.filter((node) => node.level === level).map((node) => node.id),
    positionForNode
  );
}

export function buildSemanticMap(input: SemanticMapInput): SemanticMapData {
  const structureNodes = input.nodes.filter((node) => node.kind === 'structure');
  const visibleNodeIds = new Set(structureNodes.map((node) => node.id));
  const nodeById = new Map(structureNodes.map((node) => [node.id, node]));
  const conceptIdsByGroup = new Map<string, string[]>();

  for (const node of structureNodes) {
    const id = groupId(input.scale, node, input.primaryFieldForNode);
    const concepts = conceptIdsByGroup.get(id) ?? [];
    concepts.push(node.id);
    conceptIdsByGroup.set(id, concepts);
  }

  const groupIds = new Set(conceptIdsByGroup.keys());
  const fallbackPositions = semanticPositions(
    input.scale,
    groupIds,
    input.fieldOrder,
    input.domainOrder,
    input.fieldForDomain
  );
  const internalCounts = new Map<string, number>();
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const bridgeCounts = new Map<string, Map<string, number>>();
  const connections = new Map<string, SemanticMapConnection>();

  const incrementBridge = (group: string, nodeId: string): void => {
    const groupCounts = bridgeCounts.get(group) ?? new Map<string, number>();
    groupCounts.set(nodeId, (groupCounts.get(nodeId) ?? 0) + 1);
    bridgeCounts.set(group, groupCounts);
  };

  for (const edge of input.edges) {
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const sourceGroup = groupId(input.scale, sourceNode, input.primaryFieldForNode);
    const targetGroup = groupId(input.scale, targetNode, input.primaryFieldForNode);
    if (sourceGroup === targetGroup) {
      internalCounts.set(sourceGroup, (internalCounts.get(sourceGroup) ?? 0) + 1);
      continue;
    }

    outgoingCounts.set(sourceGroup, (outgoingCounts.get(sourceGroup) ?? 0) + 1);
    incomingCounts.set(targetGroup, (incomingCounts.get(targetGroup) ?? 0) + 1);
    incrementBridge(sourceGroup, sourceNode.id);
    incrementBridge(targetGroup, targetNode.id);

    const id = `${sourceGroup}->${targetGroup}`;
    const connection = connections.get(id) ?? {
      id,
      source: sourceGroup,
      target: targetGroup,
      count: 0,
      typeCounts: {},
      edgeIds: []
    };
    connection.count += 1;
    connection.typeCounts[edge.type] = (connection.typeCounts[edge.type] ?? 0) + 1;
    connection.edgeIds.push(edge.id);
    connections.set(id, connection);
  }

  const orderedIds = input.scale === 'fields'
    ? input.fieldOrder.filter((id) => groupIds.has(id))
    : input.domainOrder.filter((id) => groupIds.has(id));
  const groups = orderedIds.map((id): SemanticMapGroup => {
    const fieldId = input.scale === 'fields' ? id : input.fieldForDomain(id);
    const definition = input.scale === 'fields' ? input.fields[id] : input.domains[id];
    const conceptIds = [...(conceptIdsByGroup.get(id) ?? [])].sort();
    const bridgeConcepts = [...(bridgeCounts.get(id) ?? new Map<string, number>())]
      .map(([nodeId, count]) => ({ nodeId, count }))
      .sort((left, right) => right.count - left.count || left.nodeId.localeCompare(right.nodeId));
    const position = input.anchorForGroup?.(id, conceptIds)
      ?? (input.positionForNode
        ? centroid(conceptIds, input.positionForNode) ?? fallbackPositions.get(id) ?? { x: 0, y: 0 }
        : fallbackPositions.get(id) ?? { x: 0, y: 0 });
    return {
      id,
      label: definition?.label ?? id,
      color: definition?.color ?? '#64748b',
      fieldId,
      conceptIds,
      conceptCount: conceptIds.length,
      internalRelations: internalCounts.get(id) ?? 0,
      incomingRelations: incomingCounts.get(id) ?? 0,
      outgoingRelations: outgoingCounts.get(id) ?? 0,
      bridgeConcepts,
      position
    };
  });

  return {
    groups,
    connections: [...connections.values()]
      .map((connection) => ({ ...connection, edgeIds: [...connection.edgeIds].sort() }))
      .sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target))
  };
}

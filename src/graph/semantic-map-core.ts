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
  const positions = semanticPositions(
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
      typeCounts: {}
    };
    connection.count += 1;
    connection.typeCounts[edge.type] = (connection.typeCounts[edge.type] ?? 0) + 1;
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
      position: positions.get(id) ?? { x: 0, y: 0 }
    };
  });

  return {
    groups,
    connections: [...connections.values()].sort((left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target))
  };
}

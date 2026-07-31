import type { GraphEdge, GraphNode } from '../types.js';
import type { GraphModel } from './graph-model.js';

export interface ComparisonRelation {
  edgeId: string;
  edgeTypeId: string;
  edgeTypeLabel: string;
  edgeLabel: string;
  endpointLabel: string;
  neighborId: string;
  sourceId: string;
  targetId: string;
  synthetic: boolean;
}

export interface DirectComparisonRelation extends ComparisonRelation {
  direction: 'left-to-right' | 'right-to-left';
}

export interface SharedNeighborComparison {
  nodeId: string;
  leftRelations: ComparisonRelation[];
  rightRelations: ComparisonRelation[];
}

export interface RelationTypeComparison {
  edgeTypeId: string;
  edgeTypeLabel: string;
  leftCount: number;
  rightCount: number;
}

export interface ConceptComparisonAnalysis {
  left: GraphNode;
  right: GraphNode;
  commonFieldIds: string[];
  commonDomainIds: string[];
  commonCitationIds: string[];
  directRelations: DirectComparisonRelation[];
  sharedNeighbors: SharedNeighborComparison[];
  relationTypeCounts: RelationTypeComparison[];
}

function intersectOrdered(left: readonly string[], right: readonly string[]): string[] {
  const rightIds = new Set(right);
  return left.filter((id) => rightIds.has(id));
}

function relationFor(model: GraphModel, edge: GraphEdge, conceptId: string): ComparisonRelation | null {
  if (edge.source !== conceptId && edge.target !== conceptId) return null;
  const type = model.data.edgeTypes[edge.type];
  if (!type) return null;
  const outgoing = edge.source === conceptId;
  return {
    edgeId: edge.id,
    edgeTypeId: edge.type,
    edgeTypeLabel: type.label,
    edgeLabel: edge.label,
    endpointLabel: outgoing ? type.endpointLabels.source : type.endpointLabels.target,
    neighborId: outgoing ? edge.target : edge.source,
    sourceId: edge.source,
    targetId: edge.target,
    synthetic: Boolean(edge.synthetic)
  };
}

function compareRelations(model: GraphModel, a: ComparisonRelation, b: ComparisonRelation): number {
  const typeDifference = model.edgeTypeOrder.indexOf(a.edgeTypeId) - model.edgeTypeOrder.indexOf(b.edgeTypeId);
  if (typeDifference) return typeDifference;
  return a.edgeLabel.localeCompare(b.edgeLabel) || a.edgeId.localeCompare(b.edgeId);
}

function incidentRelations(
  model: GraphModel,
  conceptId: string,
  allowedEdgeTypes: ReadonlySet<string>
): Map<string, ComparisonRelation[]> {
  const result = new Map<string, ComparisonRelation[]>();
  // Compare the authored graph contract, not renderer-only synthetic edges.
  // Otherwise a hidden construction junction would be counted twice: once by
  // its canonical input/output edges and again by its collapsed display edge.
  for (const edge of model.data.edges) {
    if (!allowedEdgeTypes.has(edge.type)) continue;
    const relation = relationFor(model, edge, conceptId);
    if (!relation) continue;
    const relations = result.get(relation.neighborId) ?? [];
    relations.push(relation);
    result.set(relation.neighborId, relations);
  }
  for (const relations of result.values()) relations.sort((a, b) => compareRelations(model, a, b));
  return result;
}

export function analyzeConceptComparison(
  model: GraphModel,
  leftId: string,
  rightId: string,
  allowedEdgeTypes: ReadonlySet<string>
): ConceptComparisonAnalysis | null {
  if (leftId === rightId) return null;
  const left = model.nodeRecord.get(leftId);
  const right = model.nodeRecord.get(rightId);
  if (left?.kind !== 'structure' || right?.kind !== 'structure') return null;

  const leftIncident = incidentRelations(model, leftId, allowedEdgeTypes);
  const rightIncident = incidentRelations(model, rightId, allowedEdgeTypes);
  const directRelations = (leftIncident.get(rightId) ?? []).map((relation): DirectComparisonRelation => ({
    ...relation,
    direction: relation.sourceId === leftId ? 'left-to-right' : 'right-to-left'
  }));

  const sharedNeighbors: SharedNeighborComparison[] = [];
  for (const [nodeId, leftRelations] of leftIncident) {
    if (nodeId === rightId) continue;
    const neighbor = model.nodeRecord.get(nodeId);
    const rightRelations = rightIncident.get(nodeId);
    if (neighbor?.kind !== 'structure' || !rightRelations?.length) continue;
    sharedNeighbors.push({ nodeId, leftRelations, rightRelations });
  }
  sharedNeighbors.sort((a, b) => {
    const aLabel = model.nodeRecord.get(a.nodeId)?.label ?? a.nodeId;
    const bLabel = model.nodeRecord.get(b.nodeId)?.label ?? b.nodeId;
    return aLabel.localeCompare(bLabel) || a.nodeId.localeCompare(b.nodeId);
  });

  const relationTypeCounts = model.edgeTypeOrder
    .filter((edgeTypeId) => allowedEdgeTypes.has(edgeTypeId))
    .map((edgeTypeId): RelationTypeComparison => {
      const leftCount = [...leftIncident.values()].flat().filter((relation) => relation.edgeTypeId === edgeTypeId).length;
      const rightCount = [...rightIncident.values()].flat().filter((relation) => relation.edgeTypeId === edgeTypeId).length;
      return {
        edgeTypeId,
        edgeTypeLabel: model.data.edgeTypes[edgeTypeId]?.label ?? edgeTypeId,
        leftCount,
        rightCount
      };
    })
    .filter(({ leftCount, rightCount }) => leftCount > 0 || rightCount > 0);

  return {
    left,
    right,
    commonFieldIds: intersectOrdered(model.nodeFieldIds(left), model.nodeFieldIds(right)),
    commonDomainIds: intersectOrdered(model.nodeDomainIds(left), model.nodeDomainIds(right)),
    commonCitationIds: intersectOrdered(left.citations, right.citations),
    directRelations,
    sharedNeighbors,
    relationTypeCounts
  };
}

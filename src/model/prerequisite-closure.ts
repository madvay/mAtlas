import type { EdgeTypeDefinition, GraphEdge } from '../types.js';

export interface PrerequisiteStep {
  edge: GraphEdge;
  nodeId: string;
}

export interface PrerequisiteClosure {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export type PrerequisiteAdjacency = ReadonlyMap<string, readonly PrerequisiteStep[]>;

function appendStep(adjacency: Map<string, PrerequisiteStep[]>, fromNodeId: string, step: PrerequisiteStep): void {
  const steps = adjacency.get(fromNodeId) ?? [];
  steps.push(step);
  adjacency.set(fromNodeId, steps);
}

export function buildPrerequisiteAdjacency(
  edges: readonly GraphEdge[],
  edgeTypes: Readonly<Record<string, EdgeTypeDefinition>>
): PrerequisiteAdjacency {
  const adjacency = new Map<string, PrerequisiteStep[]>();

  for (const edge of edges) {
    const traversal = edgeTypes[edge.type]?.prerequisiteTraversal;
    if (traversal !== 'incoming' && traversal !== 'outgoing' && traversal !== 'both' && traversal !== 'none') {
      throw new Error(`Edge type "${edge.type}" must define prerequisiteTraversal as incoming, outgoing, both, or none.`);
    }
    if (traversal === 'incoming' || traversal === 'both') {
      appendStep(adjacency, edge.target, { edge, nodeId: edge.source });
    }
    if (traversal === 'outgoing' || traversal === 'both') {
      appendStep(adjacency, edge.source, { edge, nodeId: edge.target });
    }
  }

  return adjacency;
}

export function prerequisiteClosure(
  rootNodeIds: readonly string[],
  adjacency: PrerequisiteAdjacency,
  edgeAllowed: (edge: GraphEdge) => boolean,
  nodeAllowed: (nodeId: string) => boolean = () => true
): PrerequisiteClosure {
  const nodeIds = new Set(rootNodeIds);
  const edgeIds = new Set<string>();
  const queue = [...rootNodeIds];

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    if (!nodeId) continue;
    for (const step of adjacency.get(nodeId) ?? []) {
      if (!edgeAllowed(step.edge) || !nodeAllowed(step.nodeId)) continue;
      edgeIds.add(step.edge.id);
      if (nodeIds.has(step.nodeId)) continue;
      nodeIds.add(step.nodeId);
      queue.push(step.nodeId);
    }
  }

  return { nodeIds, edgeIds };
}

export function prerequisiteClosureNodeIds(
  rootNodeIds: readonly string[],
  adjacency: PrerequisiteAdjacency,
  edgeAllowed: (edge: GraphEdge) => boolean,
  nodeAllowed: (nodeId: string) => boolean = () => true
): Set<string> {
  return prerequisiteClosure(rootNodeIds, adjacency, edgeAllowed, nodeAllowed).nodeIds;
}

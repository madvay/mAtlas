import type { GraphEdge } from '../types.js';

export type ConnectionDirection = 'either' | 'forward';

export interface ConnectionPathStep {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  followsArrow: boolean;
}

export interface ConnectionPath {
  nodeIds: string[];
  steps: ConnectionPathStep[];
}

export interface FindConnectionPathsOptions {
  sourceId: string;
  targetId: string;
  nodeIds: ReadonlySet<string>;
  edges: readonly GraphEdge[];
  direction?: ConnectionDirection;
  maxPaths?: number;
  maxDepth?: number;
  maxExpansions?: number;
}

interface AdjacentStep {
  edgeId: string;
  nextNodeId: string;
  followsArrow: boolean;
}

interface SearchState {
  nodeId: string;
  nodeIds: string[];
  steps: ConnectionPathStep[];
}

function compareAdjacent(left: AdjacentStep, right: AdjacentStep): number {
  return left.nextNodeId.localeCompare(right.nextNodeId)
    || left.edgeId.localeCompare(right.edgeId)
    || Number(right.followsArrow) - Number(left.followsArrow);
}

function stepKey(edgeId: string, fromNodeId: string, toNodeId: string): string {
  return `${edgeId}\u0000${fromNodeId}\u0000${toNodeId}`;
}

function pathSignature(path: ConnectionPath): string {
  return path.steps.map((step) => stepKey(step.edgeId, step.fromNodeId, step.toNodeId)).join('|');
}

function comparePaths(left: ConnectionPath, right: ConnectionPath): number {
  return left.steps.length - right.steps.length || pathSignature(left).localeCompare(pathSignature(right));
}

function sameRoot(path: ConnectionPath, rootNodeIds: readonly string[]): boolean {
  if (path.nodeIds.length < rootNodeIds.length) return false;
  return rootNodeIds.every((nodeId, index) => path.nodeIds[index] === nodeId);
}

function shortestPath(
  sourceId: string,
  targetId: string,
  adjacency: ReadonlyMap<string, readonly AdjacentStep[]>,
  maxDepth: number,
  maxExpansions: number,
  blockedNodes: ReadonlySet<string> = new Set(),
  blockedSteps: ReadonlySet<string> = new Set()
): ConnectionPath | null {
  if (blockedNodes.has(sourceId) || blockedNodes.has(targetId)) return null;
  if (sourceId === targetId) return { nodeIds: [sourceId], steps: [] };

  const queue: SearchState[] = [{ nodeId: sourceId, nodeIds: [sourceId], steps: [] }];
  const bestDepth = new Map<string, number>([[sourceId, 0]]);
  let cursor = 0;
  let expansions = 0;

  while (cursor < queue.length && expansions < maxExpansions) {
    const current = queue[cursor++];
    if (!current || current.steps.length >= maxDepth) continue;
    for (const adjacent of adjacency.get(current.nodeId) ?? []) {
      expansions += 1;
      if (blockedNodes.has(adjacent.nextNodeId)) continue;
      if (blockedSteps.has(stepKey(adjacent.edgeId, current.nodeId, adjacent.nextNodeId))) continue;
      const nextDepth = current.steps.length + 1;
      const priorDepth = bestDepth.get(adjacent.nextNodeId);
      if (priorDepth !== undefined && priorDepth <= nextDepth) continue;
      const step: ConnectionPathStep = {
        edgeId: adjacent.edgeId,
        fromNodeId: current.nodeId,
        toNodeId: adjacent.nextNodeId,
        followsArrow: adjacent.followsArrow
      };
      const next: SearchState = {
        nodeId: adjacent.nextNodeId,
        nodeIds: [...current.nodeIds, adjacent.nextNodeId],
        steps: [...current.steps, step]
      };
      if (adjacent.nextNodeId === targetId) return { nodeIds: next.nodeIds, steps: next.steps };
      bestDepth.set(adjacent.nextNodeId, nextDepth);
      queue.push(next);
      if (expansions >= maxExpansions) break;
    }
  }
  return null;
}

/**
 * Returns up to K shortest loopless paths using Yen's algorithm over an
 * unweighted, deterministic adjacency list. The caller supplies the currently
 * admissible graph, so filtering and collapsed-junction display are respected.
 */
export function findConnectionPaths(options: FindConnectionPathsOptions): ConnectionPath[] {
  const {
    sourceId,
    targetId,
    nodeIds,
    edges,
    direction = 'either',
    maxPaths = 3,
    maxDepth = 12,
    maxExpansions = 100_000
  } = options;
  if (maxPaths <= 0 || maxDepth < 0 || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];

  const adjacency = new Map<string, AdjacentStep[]>();
  const add = (nodeId: string, step: AdjacentStep): void => {
    const entries = adjacency.get(nodeId) ?? [];
    entries.push(step);
    adjacency.set(nodeId, entries);
  };
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    add(edge.source, { edgeId: edge.id, nextNodeId: edge.target, followsArrow: true });
    if (direction === 'either') add(edge.target, { edgeId: edge.id, nextNodeId: edge.source, followsArrow: false });
  }
  for (const entries of adjacency.values()) entries.sort(compareAdjacent);

  const first = shortestPath(sourceId, targetId, adjacency, maxDepth, maxExpansions);
  if (!first) return [];
  const accepted: ConnectionPath[] = [first];
  const acceptedSignatures = new Set([pathSignature(first)]);
  const candidates: ConnectionPath[] = [];
  const candidateSignatures = new Set<string>();

  while (accepted.length < maxPaths) {
    const previous = accepted[accepted.length - 1];
    if (!previous) break;

    for (let spurIndex = 0; spurIndex < previous.nodeIds.length - 1; spurIndex += 1) {
      const spurNodeId = previous.nodeIds[spurIndex];
      if (!spurNodeId) continue;
      const rootNodeIds = previous.nodeIds.slice(0, spurIndex + 1);
      const rootSteps = previous.steps.slice(0, spurIndex);
      const blockedNodes = new Set(rootNodeIds.slice(0, -1));
      const blockedSteps = new Set<string>();

      for (const path of accepted) {
        if (!sameRoot(path, rootNodeIds)) continue;
        const blocked = path.steps[spurIndex];
        if (blocked) blockedSteps.add(stepKey(blocked.edgeId, blocked.fromNodeId, blocked.toNodeId));
      }

      const remainingDepth = maxDepth - rootSteps.length;
      const spurPath = shortestPath(
        spurNodeId,
        targetId,
        adjacency,
        remainingDepth,
        maxExpansions,
        blockedNodes,
        blockedSteps
      );
      if (!spurPath) continue;
      const candidate: ConnectionPath = {
        nodeIds: [...rootNodeIds.slice(0, -1), ...spurPath.nodeIds],
        steps: [...rootSteps, ...spurPath.steps]
      };
      const signature = pathSignature(candidate);
      if (acceptedSignatures.has(signature) || candidateSignatures.has(signature)) continue;
      candidateSignatures.add(signature);
      candidates.push(candidate);
    }

    candidates.sort(comparePaths);
    const next = candidates.shift();
    if (!next) break;
    candidateSignatures.delete(pathSignature(next));
    accepted.push(next);
    acceptedSignatures.add(pathSignature(next));
  }

  return accepted;
}

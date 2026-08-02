import { NodeSearchIndex, normalizeSearchText } from '../core/search.js';
import type { EdgeTypeDefinition, GraphData, GraphEdge, GraphNode, SourceDefinition } from '../types.js';

const SITE_ORIGIN = 'https://atlas.madvay.com/';
const DEFAULT_PATH_DEPTH = 8;
const DEFAULT_MAX_PATHS = 5;
const MAX_PATH_EXPANSIONS = 50_000;

export type PathDirection = 'outgoing' | 'incoming' | 'either';
export type ClosureKind = 'predecessor' | 'prerequisite';

export interface SearchConceptOptions {
  limit?: number | undefined;
  includeJunctions?: boolean | undefined;
}

export interface NeighborOptions {
  direction?: PathDirection | undefined;
  relationTypes?: readonly string[] | undefined;
}

export interface PathOptions extends NeighborOptions {
  maxDepth?: number | undefined;
  maxPaths?: number | undefined;
}

export interface ClosureOptions {
  relationTypes?: readonly string[] | undefined;
}

export interface SubgraphOptions extends NeighborOptions {
  hops?: number | undefined;
}

export interface ConceptReference {
  id: string;
  label: string;
  kind: GraphNode['kind'];
  canonicalUrl: string;
  interactiveUrl: string;
}

export interface SourceRecord extends SourceDefinition {
  id: string;
}

export interface RelationRecord {
  id: string;
  source: ConceptReference;
  target: ConceptReference;
  type: {
    id: string;
    label: string;
    description: string;
    sourceRole: string;
    targetRole: string;
    prerequisiteTraversal: EdgeTypeDefinition['prerequisiteTraversal'];
    enforcePredecessorLevel: EdgeTypeDefinition['enforcePredecessorLevel'];
  };
  label: string;
  detail: string;
  canonicalUrl: string;
  citations: SourceRecord[];
}

export interface ConceptRecord {
  id: string;
  label: string;
  kind: GraphNode['kind'];
  canonicalUrl: string;
  interactiveUrl: string;
  contentVersion: string;
  fields: string[];
  domains: string[];
  record: GraphNode;
  citations: SourceRecord[];
}

export interface AtlasOperationMeta {
  contentVersion: string;
  canonicalDatasetUrl: string;
  license: unknown;
  attribution: string;
}

interface TraversedEdge {
  edge: GraphEdge;
  nextNodeId: string;
  traversedDirection: 'forward' | 'reverse';
}

interface ClosureStep {
  edge: GraphEdge;
  nextNodeId: string;
}

function siteUrl(pathname = ''): string {
  return new URL(pathname, SITE_ORIGIN).toString();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(0, Math.floor(value ?? fallback)));
}

function sortedEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return [...edges].sort((left, right) => left.id.localeCompare(right.id));
}

export function canonicalConceptUrl(node: Pick<GraphNode, 'id' | 'kind'>): string {
  return node.kind === 'structure'
    ? siteUrl(`concepts/${encodeURIComponent(node.id)}/`)
    : siteUrl(`?node=${encodeURIComponent(node.id)}`);
}

export function interactiveConceptUrl(nodeId: string): string {
  return siteUrl(`?node=${encodeURIComponent(nodeId)}`);
}

function edgeCanonicalUrl(edge: GraphEdge, nodesById: ReadonlyMap<string, GraphNode>): string {
  const target = nodesById.get(edge.target);
  const source = nodesById.get(edge.source);
  const pageNode = target?.kind === 'structure' ? target : source?.kind === 'structure' ? source : null;
  if (!pageNode) return siteUrl(`?edge=${encodeURIComponent(edge.id)}`);
  return `${canonicalConceptUrl(pageNode)}#relation-${encodeURIComponent(edge.id)}`;
}

function recordText(node: GraphNode): string {
  return [
    node.summary,
    ...(node.carriers ?? []),
    ...(node.data ?? []),
    ...(node.axioms ?? []),
    ...(node.induces ?? []),
    node.notes ?? '',
    ...(node.sections ?? []).flatMap((section) => [section.title, section.body ?? '', ...(section.items ?? [])])
  ].join(' ');
}

export class Atlas {
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  readonly edgeById: ReadonlyMap<string, GraphEdge>;
  readonly outgoingByNode: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly incomingByNode: ReadonlyMap<string, readonly GraphEdge[]>;
  private readonly searchIndex: NodeSearchIndex;

  constructor(readonly data: GraphData) {
    this.nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    this.edgeById = new Map(data.edges.map((edge) => [edge.id, edge]));
    this.outgoingByNode = this.indexEdges((edge) => edge.source);
    this.incomingByNode = this.indexEdges((edge) => edge.target);
    this.searchIndex = new NodeSearchIndex(data.nodes, (node) => ({
      fieldLabels: this.nodeFieldIds(node).map((fieldId) => data.fields[fieldId]?.label ?? fieldId),
      domainLabels: this.nodeDomainIds(node).map((domainId) => data.domains[domainId]?.label ?? domainId)
    }));
  }

  static fromData(data: GraphData): Atlas {
    return new Atlas(data);
  }

  static async fromUrl(url: string, fetchImplementation: typeof fetch = fetch): Promise<Atlas> {
    const response = await fetchImplementation(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Unable to load mAtlas data (${response.status}) from ${url}.`);
    return new Atlas(await response.json() as GraphData);
  }

  metadata(): AtlasOperationMeta {
    return {
      contentVersion: this.data.meta.version,
      canonicalDatasetUrl: siteUrl('data/'),
      license: this.data.meta.license,
      attribution: String(this.data.meta.attribution ?? '')
    };
  }

  searchConcepts(query: string, options: SearchConceptOptions = {}): {
    query: string;
    normalizedQuery: string;
    total: number;
    matches: Array<ConceptReference & { summary: string; score: number; fields: string[]; domains: string[] }>;
  } {
    const limit = positiveInteger(options.limit, 20, 100);
    const result = options.includeJunctions
      ? this.searchIndex.search(query, { limit })
      : this.searchIndex.search(query, { limit, predicate: (node) => node.kind === 'structure' });
    return {
      query,
      normalizedQuery: result.normalizedQuery,
      total: result.total,
      matches: result.matches.map(({ node, score }) => ({
        ...this.conceptReference(node),
        summary: node.summary,
        score,
        fields: this.nodeFieldIds(node),
        domains: this.nodeDomainIds(node)
      }))
    };
  }

  resolveConcept(identifier: string, options: Pick<SearchConceptOptions, 'includeJunctions'> = {}): GraphNode | null {
    const direct = this.nodeById.get(identifier);
    if (direct && (options.includeJunctions || direct.kind === 'structure')) return direct;
    const normalized = normalizeSearchText(identifier);
    if (!normalized) return null;
    const matches = this.searchConcepts(identifier, { limit: 1, ...(options.includeJunctions === undefined ? {} : { includeJunctions: options.includeJunctions }) }).matches;
    if (!matches.length) return null;
    const node = this.nodeById.get(matches[0]?.id ?? '');
    return node ?? null;
  }

  getConcept(identifier: string): ConceptRecord | null {
    const node = this.nodeById.get(identifier);
    if (!node) return null;
    return {
      ...this.conceptReference(node),
      contentVersion: this.data.meta.version,
      fields: this.nodeFieldIds(node),
      domains: this.nodeDomainIds(node),
      record: node,
      citations: this.citationRecords(node.citations)
    };
  }

  getNeighbors(identifier: string, options: NeighborOptions = {}): {
    concept: ConceptReference;
    incoming: RelationRecord[];
    outgoing: RelationRecord[];
  } {
    const node = this.requireNode(identifier);
    const direction = options.direction ?? 'either';
    const allowed = this.relationTypeFilter(options.relationTypes);
    return {
      concept: this.conceptReference(node),
      incoming: direction === 'outgoing'
        ? []
        : sortedEdges((this.incomingByNode.get(node.id) ?? []).filter(allowed)).map((edge) => this.relationRecord(edge)),
      outgoing: direction === 'incoming'
        ? []
        : sortedEdges((this.outgoingByNode.get(node.id) ?? []).filter(allowed)).map((edge) => this.relationRecord(edge))
    };
  }

  findPaths(sourceId: string, targetId: string, options: PathOptions = {}): {
    source: ConceptReference;
    target: ConceptReference;
    direction: PathDirection;
    paths: Array<{
      nodeIds: string[];
      nodes: ConceptReference[];
      relations: Array<RelationRecord & { traversedDirection: 'forward' | 'reverse' }>;
    }>;
    maxDepth: number;
    maxPaths: number;
    truncated: boolean;
  } {
    const source = this.requireNode(sourceId);
    const target = this.requireNode(targetId);
    const direction = options.direction ?? 'either';
    const maxDepth = positiveInteger(options.maxDepth, DEFAULT_PATH_DEPTH, 20);
    const maxPaths = Math.max(1, positiveInteger(options.maxPaths, DEFAULT_MAX_PATHS, 25));
    const allowed = this.relationTypeFilter(options.relationTypes);
    if (source.id === target.id) {
      return {
        source: this.conceptReference(source),
        target: this.conceptReference(target),
        direction,
        paths: [{ nodeIds: [source.id], nodes: [this.conceptReference(source)], relations: [] }],
        maxDepth,
        maxPaths,
        truncated: false
      };
    }

    const queue: Array<{ nodeIds: string[]; steps: TraversedEdge[] }> = [{ nodeIds: [source.id], steps: [] }];
    const paths: Array<{ nodeIds: string[]; nodes: ConceptReference[]; relations: Array<RelationRecord & { traversedDirection: 'forward' | 'reverse' }> }> = [];
    let foundDepth: number | null = null;
    let expansions = 0;

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current) continue;
      if (foundDepth !== null && current.steps.length >= foundDepth) continue;
      if (current.steps.length >= maxDepth) continue;
      const currentId = current.nodeIds[current.nodeIds.length - 1];
      if (!currentId) continue;
      for (const step of this.traversedEdges(currentId, direction, allowed)) {
        expansions += 1;
        if (expansions > MAX_PATH_EXPANSIONS) break;
        if (current.nodeIds.includes(step.nextNodeId)) continue;
        const nextNodeIds = [...current.nodeIds, step.nextNodeId];
        const nextSteps = [...current.steps, step];
        if (step.nextNodeId === target.id) {
          foundDepth ??= nextSteps.length;
          if (nextSteps.length === foundDepth) {
            paths.push({
              nodeIds: nextNodeIds,
              nodes: nextNodeIds.map((nodeId) => this.conceptReference(this.requireNode(nodeId))),
              relations: nextSteps.map((pathStep) => ({
                ...this.relationRecord(pathStep.edge),
                traversedDirection: pathStep.traversedDirection
              }))
            });
          }
          if (paths.length >= maxPaths) break;
          continue;
        }
        if (foundDepth === null) queue.push({ nodeIds: nextNodeIds, steps: nextSteps });
      }
      if (paths.length >= maxPaths || expansions > MAX_PATH_EXPANSIONS) break;
    }

    return {
      source: this.conceptReference(source),
      target: this.conceptReference(target),
      direction,
      paths,
      maxDepth,
      maxPaths,
      truncated: expansions > MAX_PATH_EXPANSIONS
    };
  }

  getPredecessorClosure(rootIds: readonly string[], options: ClosureOptions = {}): ReturnType<Atlas['closureResult']> {
    return this.closureResult(rootIds, 'predecessor', options);
  }

  getPrerequisiteClosure(rootIds: readonly string[], options: ClosureOptions = {}): ReturnType<Atlas['closureResult']> {
    return this.closureResult(rootIds, 'prerequisite', options);
  }

  connectConcepts(rootIds: readonly string[], options: PathOptions = {}): {
    requested: ConceptReference[];
    paths: Array<ReturnType<Atlas['findPaths']>['paths'][number]>;
    nodeIds: string[];
    edgeIds: string[];
    unresolved: string[];
  } {
    const uniqueIds = unique(rootIds);
    const requested: ConceptReference[] = [];
    const unresolved: string[] = [];
    for (const id of uniqueIds) {
      const node = this.nodeById.get(id);
      if (node) requested.push(this.conceptReference(node));
      else unresolved.push(id);
    }
    if (requested.length < 2) return { requested, paths: [], nodeIds: requested.map((node) => node.id), edgeIds: [], unresolved };

    const first = requested[0];
    if (!first) return { requested, paths: [], nodeIds: [], edgeIds: [], unresolved };
    const connected: ConceptReference[] = [first];
    const paths: Array<ReturnType<Atlas['findPaths']>['paths'][number]> = [];
    const nodeIds = new Set(connected.map((node) => node.id));
    const edgeIds = new Set<string>();

    for (const candidate of requested.slice(1)) {
      const candidates = connected
        .map((existing) => this.findPaths(candidate.id, existing.id, { ...options, maxPaths: 1 }).paths[0])
        .filter((path): path is NonNullable<typeof path> => Boolean(path));
      candidates.sort((left, right) => left.relations.length - right.relations.length
        || left.nodeIds.join('\u0000').localeCompare(right.nodeIds.join('\u0000')));
      const path = candidates[0];
      if (!path) {
        unresolved.push(candidate.id);
        continue;
      }
      paths.push(path);
      connected.push(candidate);
      for (const nodeId of path.nodeIds) nodeIds.add(nodeId);
      for (const relation of path.relations) edgeIds.add(relation.id);
    }
    return { requested, paths, nodeIds: [...nodeIds].sort(), edgeIds: [...edgeIds].sort(), unresolved };
  }

  buildSubgraph(rootIds: readonly string[], options: SubgraphOptions = {}): {
    roots: ConceptReference[];
    nodeIds: string[];
    nodes: ConceptReference[];
    relations: RelationRecord[];
    hops: number;
    direction: PathDirection;
  } {
    const roots = unique(rootIds).map((id) => this.requireNode(id));
    const direction = options.direction ?? 'either';
    const hops = positiveInteger(options.hops, 1, 10);
    const allowed = this.relationTypeFilter(options.relationTypes);
    const nodeIds = new Set(roots.map((node) => node.id));
    const edgeIds = new Set<string>();
    const queue = roots.map((node) => ({ nodeId: node.id, distance: 0 }));

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current || current.distance >= hops) continue;
      for (const step of this.traversedEdges(current.nodeId, direction, allowed)) {
        edgeIds.add(step.edge.id);
        if (nodeIds.has(step.nextNodeId)) continue;
        nodeIds.add(step.nextNodeId);
        queue.push({ nodeId: step.nextNodeId, distance: current.distance + 1 });
      }
    }
    const sortedNodeIds = [...nodeIds].sort();
    return {
      roots: roots.map((node) => this.conceptReference(node)),
      nodeIds: sortedNodeIds,
      nodes: sortedNodeIds.map((id) => this.conceptReference(this.requireNode(id))),
      relations: [...edgeIds].sort().map((id) => this.relationRecord(this.edgeById.get(id)!)),
      hops,
      direction
    };
  }

  compareConcepts(leftId: string, rightId: string): {
    left: ConceptRecord;
    right: ConceptRecord;
    commonFields: string[];
    commonDomains: string[];
    commonCitationIds: string[];
    directRelations: RelationRecord[];
    sharedNeighborIds: string[];
  } {
    const left = this.getConcept(leftId);
    const right = this.getConcept(rightId);
    if (!left || !right) throw new Error('Both concept IDs must exist in the dataset.');
    const leftNeighbors = new Set(this.neighborNodeIds(left.id));
    const rightNeighbors = new Set(this.neighborNodeIds(right.id));
    const directRelations = sortedEdges(this.data.edges.filter((edge) =>
      (edge.source === left.id && edge.target === right.id) || (edge.source === right.id && edge.target === left.id)
    )).map((edge) => this.relationRecord(edge));
    return {
      left,
      right,
      commonFields: this.sharedValues(left.fields, right.fields),
      commonDomains: this.sharedValues(left.domains, right.domains),
      commonCitationIds: this.sharedValues(left.record.citations, right.record.citations),
      directRelations,
      sharedNeighborIds: [...leftNeighbors].filter((id) => rightNeighbors.has(id)).sort()
    };
  }

  createPermalink(identifier: string): { concept: ConceptReference; canonicalUrl: string; interactiveUrl: string } {
    const node = this.requireNode(identifier);
    const concept = this.conceptReference(node);
    return { concept, canonicalUrl: concept.canonicalUrl, interactiveUrl: concept.interactiveUrl };
  }

  private closureResult(rootIds: readonly string[], kind: ClosureKind, options: ClosureOptions) {
    const roots = unique(rootIds).map((id) => this.requireNode(id));
    const allowed = this.relationTypeFilter(options.relationTypes);
    const adjacency = this.closureAdjacency(kind, allowed);
    const nodeIds = new Set(roots.map((node) => node.id));
    const edgeIds = new Set<string>();
    const queue = roots.map((node) => node.id);
    for (let index = 0; index < queue.length; index += 1) {
      const nodeId = queue[index];
      if (!nodeId) continue;
      for (const step of adjacency.get(nodeId) ?? []) {
        edgeIds.add(step.edge.id);
        if (nodeIds.has(step.nextNodeId)) continue;
        nodeIds.add(step.nextNodeId);
        queue.push(step.nextNodeId);
      }
    }
    const sortedNodeIds = [...nodeIds].sort();
    return {
      kind,
      roots: roots.map((node) => this.conceptReference(node)),
      nodeIds: sortedNodeIds,
      nodes: sortedNodeIds.map((id) => this.conceptReference(this.requireNode(id))),
      edgeIds: [...edgeIds].sort(),
      relations: [...edgeIds].sort().map((id) => this.relationRecord(this.edgeById.get(id)!))
    };
  }

  private indexEdges(nodeIdFor: (edge: GraphEdge) => string): ReadonlyMap<string, readonly GraphEdge[]> {
    const indexed = new Map<string, GraphEdge[]>();
    for (const edge of this.data.edges) {
      const key = nodeIdFor(edge);
      const edges = indexed.get(key) ?? [];
      edges.push(edge);
      indexed.set(key, edges);
    }
    for (const [key, edges] of indexed) indexed.set(key, sortedEdges(edges));
    return indexed;
  }

  private nodeDomainIds(node: GraphNode): string[] {
    return node.domains.length ? [...node.domains] : [node.primaryDomain];
  }

  private nodeFieldIds(node: GraphNode): string[] {
    if (node.fields?.length) return unique(node.fields);
    return unique(this.nodeDomainIds(node).map((domainId) => this.data.domains[domainId]?.field).filter((id): id is string => Boolean(id)));
  }

  private conceptReference(node: GraphNode): ConceptReference {
    return {
      id: node.id,
      label: node.label,
      kind: node.kind,
      canonicalUrl: canonicalConceptUrl(node),
      interactiveUrl: interactiveConceptUrl(node.id)
    };
  }

  private citationRecords(citationIds: readonly string[]): SourceRecord[] {
    return citationIds.flatMap((id) => {
      const source = this.data.sources[id];
      return source ? [{ id, ...source }] : [];
    });
  }

  private relationRecord(edge: GraphEdge): RelationRecord {
    const type = this.data.edgeTypes[edge.type];
    if (!type) throw new Error(`Relation ${edge.id} references unknown relation type ${edge.type}.`);
    return {
      id: edge.id,
      source: this.conceptReference(this.requireNode(edge.source)),
      target: this.conceptReference(this.requireNode(edge.target)),
      type: {
        id: edge.type,
        label: type.label,
        description: type.description,
        sourceRole: type.endpointLabels.source,
        targetRole: type.endpointLabels.target,
        prerequisiteTraversal: type.prerequisiteTraversal,
        enforcePredecessorLevel: type.enforcePredecessorLevel
      },
      label: edge.label,
      detail: edge.detail,
      canonicalUrl: edgeCanonicalUrl(edge, this.nodeById),
      citations: this.citationRecords(edge.citations)
    };
  }

  private relationTypeFilter(relationTypes: readonly string[] | undefined): (edge: GraphEdge) => boolean {
    if (!relationTypes?.length) return () => true;
    const ids = new Set(relationTypes);
    return (edge) => ids.has(edge.type);
  }

  private traversedEdges(nodeId: string, direction: PathDirection, allowed: (edge: GraphEdge) => boolean): TraversedEdge[] {
    const steps: TraversedEdge[] = [];
    if (direction === 'outgoing' || direction === 'either') {
      for (const edge of this.outgoingByNode.get(nodeId) ?? []) {
        if (allowed(edge)) steps.push({ edge, nextNodeId: edge.target, traversedDirection: 'forward' });
      }
    }
    if (direction === 'incoming' || direction === 'either') {
      for (const edge of this.incomingByNode.get(nodeId) ?? []) {
        if (allowed(edge)) steps.push({ edge, nextNodeId: edge.source, traversedDirection: 'reverse' });
      }
    }
    return steps.sort((left, right) => left.edge.id.localeCompare(right.edge.id)
      || left.traversedDirection.localeCompare(right.traversedDirection));
  }

  private closureAdjacency(kind: ClosureKind, allowed: (edge: GraphEdge) => boolean): ReadonlyMap<string, readonly ClosureStep[]> {
    const adjacency = new Map<string, ClosureStep[]>();
    const add = (from: string, edge: GraphEdge, nextNodeId: string) => {
      const steps = adjacency.get(from) ?? [];
      steps.push({ edge, nextNodeId });
      adjacency.set(from, steps);
    };
    for (const edge of this.data.edges) {
      if (!allowed(edge)) continue;
      const type = this.data.edgeTypes[edge.type];
      if (!type) continue;
      if (kind === 'predecessor') {
        if (type.enforcePredecessorLevel === 'incoming') add(edge.target, edge, edge.source);
        if (type.enforcePredecessorLevel === 'outgoing') add(edge.source, edge, edge.target);
        continue;
      }
      if (type.prerequisiteTraversal === 'incoming' || type.prerequisiteTraversal === 'both') add(edge.target, edge, edge.source);
      if (type.prerequisiteTraversal === 'outgoing' || type.prerequisiteTraversal === 'both') add(edge.source, edge, edge.target);
    }
    for (const [key, steps] of adjacency) {
      steps.sort((left, right) => left.edge.id.localeCompare(right.edge.id) || left.nextNodeId.localeCompare(right.nextNodeId));
      adjacency.set(key, steps);
    }
    return adjacency;
  }

  private neighborNodeIds(nodeId: string): string[] {
    return unique([
      ...(this.outgoingByNode.get(nodeId) ?? []).map((edge) => edge.target),
      ...(this.incomingByNode.get(nodeId) ?? []).map((edge) => edge.source)
    ]);
  }

  private sharedValues(left: readonly string[], right: readonly string[]): string[] {
    const rightSet = new Set(right);
    return unique(left.filter((value) => rightSet.has(value))).sort();
  }

  private requireNode(identifier: string): GraphNode {
    const node = this.nodeById.get(identifier);
    if (!node) throw new Error(`Unknown mAtlas concept or junction ID: ${identifier}.`);
    return node;
  }
}

/**
 * This is intentionally exported for test fixtures and consumers that need a
 * lightweight, stable text rendering of a concept without a graph renderer.
 */
export function searchableConceptText(node: GraphNode): string {
  return recordText(node);
}

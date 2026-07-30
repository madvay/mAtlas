import type { AppState, GraphData, GraphEdge, GraphNode } from '../types.js';
import { buildPrerequisiteAdjacency, prerequisiteClosure, type PrerequisiteAdjacency, type PrerequisiteClosure } from './prerequisite-closure.js';

export class GraphModel {
  readonly fieldOrder: string[];
  readonly domainOrder: string[];
  readonly edgeTypeOrder: string[];
  readonly defaultEdgeTypeIds: string[];
  readonly nodeRecord: ReadonlyMap<string, GraphNode>;
  readonly edgeRecord: ReadonlyMap<string, GraphEdge>;
  readonly prerequisiteAdjacency: PrerequisiteAdjacency;
  readonly allEdges: GraphEdge[];
  readonly knownFieldIds: ReadonlySet<string>;
  readonly knownDomainIds: ReadonlySet<string>;
  readonly knownEdgeTypeIds: ReadonlySet<string>;
  readonly knownNodeIds: ReadonlySet<string>;
  readonly knownEdgeIds: ReadonlySet<string>;
  private readonly collapsedEdgeComponents = new Map<string, readonly [string, string]>();

  constructor(readonly data: GraphData) {
    this.fieldOrder = data.meta.fieldOrder ?? Object.keys(data.fields);
    this.domainOrder = data.meta.domainOrder ?? Object.keys(data.domains);
    this.edgeTypeOrder = data.meta.edgeTypeOrder ?? Object.keys(data.edgeTypes);
    this.defaultEdgeTypeIds = this.edgeTypeOrder.filter((id) => data.edgeTypes[id]?.activeInDataset !== false);
    this.nodeRecord = new Map(data.nodes.map((node) => [node.id, node]));
    const collapsedEdges = this.buildCollapsedConstructionEdges();
    this.allEdges = [...data.edges, ...collapsedEdges];
    this.edgeRecord = new Map(this.allEdges.map((edge) => [edge.id, edge]));
    this.prerequisiteAdjacency = buildPrerequisiteAdjacency(data.edges, data.edgeTypes);
    this.knownFieldIds = new Set(Object.keys(data.fields));
    this.knownDomainIds = new Set(Object.keys(data.domains));
    this.knownEdgeTypeIds = new Set(this.defaultEdgeTypeIds);
    this.knownNodeIds = new Set(this.nodeRecord.keys());
    this.knownEdgeIds = new Set(this.edgeRecord.keys());
  }

  fieldForDomain(domainId: string): string {
    return this.data.domains[domainId]?.field ?? this.data.meta.defaultField ?? this.fieldOrder[0] ?? '';
  }

  nodeDomainIds(node: GraphNode): string[] {
    return node.domains.length ? node.domains : [node.primaryDomain];
  }

  nodeFieldIds(node: GraphNode): string[] {
    if (node.fields?.length) return node.fields;
    return [...new Set(this.nodeDomainIds(node).map((domainId) => this.fieldForDomain(domainId)))];
  }

  nodePrimaryField(node: GraphNode): string {
    return node.primaryField ?? this.fieldForDomain(node.primaryDomain);
  }

  nodeDomainLabels(node: GraphNode): string[] {
    return this.nodeDomainIds(node)
      .map((domainId) => this.data.domains[domainId]?.label)
      .filter((label): label is string => Boolean(label));
  }

  nodeFieldLabels(node: GraphNode): string[] {
    return this.nodeFieldIds(node)
      .map((fieldId) => this.data.fields[fieldId]?.label)
      .filter((label): label is string => Boolean(label));
  }

  nodeMatchesSelectedTaxonomy(node: GraphNode, state: Pick<AppState, 'selectedFields' | 'selectedDomains' | 'showPrimaryOnly'>): boolean {
    const fieldMatch = this.nodeFieldIds(node).some((fieldId) => state.selectedFields.has(fieldId));
    const domainMatch = state.showPrimaryOnly
      ? state.selectedDomains.has(node.primaryDomain)
      : this.nodeDomainIds(node).some((domainId) => state.selectedDomains.has(domainId));
    return fieldMatch && domainMatch;
  }

  nodeExcludedByTaxonomy(
    node: GraphNode,
    state: Pick<AppState, 'selectedDomains' | 'excludedFields' | 'excludedDomains' | 'prohibitedDomains'>
  ): boolean {
    if (state.prohibitedDomains?.has(node.primaryDomain)) return true;
    const primaryField = this.nodePrimaryField(node);
    const excludedFields = state.excludedFields ?? new Set<string>();
    const excludedDomains = state.excludedDomains ?? new Set<string>();
    const primaryExcluded = excludedFields.has(primaryField) || excludedDomains.has(node.primaryDomain);
    if (!primaryExcluded) return false;
    return !this.nodeDomainIds(node).some((domainId) =>
      domainId !== node.primaryDomain
      && state.selectedDomains.has(domainId)
      && !excludedDomains.has(domainId)
      && !excludedFields.has(this.fieldForDomain(domainId)));
  }

  transitivePrerequisiteElementIds(
    rootNodeIds: readonly string[],
    edgeAllowed: (edge: GraphEdge) => boolean,
    nodeAllowed: (nodeId: string) => boolean = () => true
  ): PrerequisiteClosure {
    const closure = prerequisiteClosure(rootNodeIds, this.prerequisiteAdjacency, edgeAllowed, nodeAllowed);
    for (const [edgeId, [inputEdgeId, outputEdgeId]] of this.collapsedEdgeComponents) {
      if (closure.edgeIds.has(inputEdgeId) && closure.edgeIds.has(outputEdgeId)) closure.edgeIds.add(edgeId);
    }
    return closure;
  }

  transitivePrerequisiteNodeIds(
    rootNodeIds: readonly string[],
    edgeAllowed: (edge: GraphEdge) => boolean,
    nodeAllowed: (nodeId: string) => boolean = () => true
  ): Set<string> {
    return this.transitivePrerequisiteElementIds(rootNodeIds, edgeAllowed, nodeAllowed).nodeIds;
  }

  isCrossFieldEdge(edge: GraphEdge): boolean {
    const source = this.nodeRecord.get(edge.source);
    const target = this.nodeRecord.get(edge.target);
    if (!source || !target) return false;
    const targetFields = new Set(this.nodeFieldIds(target));
    return !this.nodeFieldIds(source).some((fieldId) => targetFields.has(fieldId));
  }

  requiredNodeIds(
    state: Pick<AppState, 'selectedFields' | 'selectedDomains' | 'selectedEdgeTypes' | 'excludedFields' | 'excludedDomains' | 'prohibitedDomains' | 'showPrimaryOnly'>,
    edgeAllowed: (edge: GraphEdge) => boolean
  ): Set<string> {
    const roots = this.data.nodes
      .filter((node) => node.kind === 'structure'
        && this.nodeMatchesSelectedTaxonomy(node, state)
        && !this.nodeExcludedByTaxonomy(node, state))
      .map((node) => node.id);
    return this.transitivePrerequisiteNodeIds(
      roots,
      (edge) => state.selectedEdgeTypes.has(edge.type) && edgeAllowed(edge),
      (nodeId) => {
        const node = this.nodeRecord.get(nodeId);
        return !node || !this.nodeExcludedByTaxonomy(node, state);
      }
    );
  }

  private buildCollapsedConstructionEdges(): GraphEdge[] {
    const incomingByJunction = new Map<string, GraphEdge[]>();
    const outgoingByJunction = new Map<string, GraphEdge[]>();

    for (const edge of this.data.edges) {
      if (this.nodeRecord.get(edge.target)?.kind === 'junction') {
        const incoming = incomingByJunction.get(edge.target) ?? [];
        incoming.push(edge);
        incomingByJunction.set(edge.target, incoming);
      }
      if (this.nodeRecord.get(edge.source)?.kind === 'junction') {
        const outgoing = outgoingByJunction.get(edge.source) ?? [];
        outgoing.push(edge);
        outgoingByJunction.set(edge.source, outgoing);
      }
    }

    const collapsed: GraphEdge[] = [];
    for (const junction of this.data.nodes) {
      if (junction.kind !== 'junction' || !junction.combination) continue;
      const inputEdges = incomingByJunction.get(junction.id) ?? [];
      const outputEdge = (outgoingByJunction.get(junction.id) ?? [])
        .find((edge) => edge.target === junction.combination?.output);
      if (!outputEdge) continue;

      for (const inputEdge of inputEdges) {
        const collapsedEdge: GraphEdge = {
          id: `collapsed_${junction.id}_${inputEdge.source}_${outputEdge.target}`,
          source: inputEdge.source,
          target: outputEdge.target,
          type: outputEdge.type,
          label: `jointly: ${inputEdge.label}\n${outputEdge.label}`,
          detail: `${inputEdge.detail} ${outputEdge.detail} This is one branch of a collapsed multi-input construction; every branch associated with ${junction.label} is jointly required.`,
          citations: [...new Set([...inputEdge.citations, ...outputEdge.citations, ...junction.citations])],
          synthetic: true,
          junctionId: junction.id
        };
        collapsed.push(collapsedEdge);
        this.collapsedEdgeComponents.set(collapsedEdge.id, [inputEdge.id, outputEdge.id]);
      }
    }
    return collapsed;
  }
}

import type cytoscape from 'cytoscape';
import { byId, escapeHtml } from '../core/dom.js';
import { buildSemanticMap, type SemanticMapConnection, type SemanticMapData, type SemanticMapGroup, type SemanticMapScale } from '../graph/semantic-map-core.js';
import { isCrossFieldEdgeAllowed } from '../graph/visibility-policy.js';
import type { GraphModel } from '../model/graph-model.js';
import type { AppState, GraphEdge, GraphNode } from '../types.js';
import { renderHtml } from './render.js';

interface StructureOverlayControllerOptions {
  model: GraphModel;
  state: AppState;
  cy: cytoscape.Core;
  openPanel: () => void;
  focusField: (fieldId: string) => void;
  focusDomain: (domainId: string) => void;
  activateNode: (nodeId: string) => void;
  activateEdge: (edgeId: string) => void;
  renderMathText: (value: unknown) => string;
}

type OverlaySelection =
  | { kind: 'group'; id: string }
  | { kind: 'connection'; id: string };

const OVERLAY_SELECTOR = '[semanticOverlay = 1]';

function nodeDimensions(count: number): { width: number; height: number } {
  const factor = Math.log2(count + 1);
  return {
    width: Math.round(Math.min(250, Math.max(176, 158 + factor * 18))),
    height: Math.round(Math.min(104, Math.max(72, 64 + factor * 8)))
  };
}

function edgeWidth(count: number): number {
  return Math.min(14, 2.4 + Math.log2(count + 1) * 1.7);
}

function curveDistance(connection: SemanticMapConnection): number {
  return connection.source.localeCompare(connection.target) <= 0 ? 82 : -82;
}

export class StructureOverlayController {
  private mapData: SemanticMapData = { groups: [], connections: [] };
  private selection: OverlaySelection | null = null;

  constructor(private readonly options: StructureOverlayControllerOptions) {}

  initialize(): void {
    this.options.cy.on('dragfree', 'node', (event) => {
      if (!this.active() || Number(event.target.data('semanticOverlay')) === 1) return;
      this.refresh();
    });
  }

  active(): boolean {
    return this.options.state.layout === 'domains' || this.options.state.layout === 'fields';
  }

  refresh(): void {
    const { cy, model, state } = this.options;
    cy.batch(() => {
      cy.elements(OVERLAY_SELECTOR).remove();
      cy.nodes().removeClass('structure-source-node structure-source-junction');
      cy.edges().removeClass('structure-source-edge');
    });

    if (!this.active()) {
      this.selection = null;
      return;
    }

    const scale: SemanticMapScale = state.layout === 'fields' ? 'fields' : 'domains';
    const visibleNodes = cy.nodes().not('.filter-hidden')
      .map((element) => model.nodeRecord.get(element.id()))
      .filter((node): node is GraphNode => Boolean(node && node.kind === 'structure'));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const semanticEdges = model.allEdges.filter((edge) => this.edgeIncluded(edge, visibleNodeIds));
    this.mapData = buildSemanticMap({
      scale,
      nodes: visibleNodes,
      edges: semanticEdges,
      fields: model.data.fields,
      domains: model.data.domains,
      fieldOrder: model.fieldOrder,
      domainOrder: model.domainOrder,
      fieldForDomain: (domainId) => model.fieldForDomain(domainId),
      primaryFieldForNode: (node) => model.nodePrimaryField(node),
      positionForNode: (nodeId) => {
        const element = cy.getElementById(nodeId);
        return element && !element.empty() ? element.position() : undefined;
      }
    });

    const elements: cytoscape.ElementDefinition[] = [];
    for (const group of this.mapData.groups) {
      const dimensions = nodeDimensions(group.conceptCount);
      const fieldColor = model.data.fields[group.fieldId]?.color ?? group.color;
      elements.push({
        group: 'nodes',
        data: {
          id: this.groupElementId(group.id),
          semanticOverlay: 1,
          semanticGroup: 1,
          semanticGroupId: group.id,
          semanticScale: scale,
          label: `${group.label}\n${group.conceptCount} concept${group.conceptCount === 1 ? '' : 's'}`,
          canvasLabel: `${group.label}\n${group.conceptCount} concept${group.conceptCount === 1 ? '' : 's'}`,
          color: group.color,
          fieldColor,
          nodeWidth: dimensions.width,
          nodeHeight: dimensions.height,
          textWidth: dimensions.width - 28,
          conceptCount: group.conceptCount
        },
        position: group.position,
        locked: true,
        grabbable: false
      });
    }
    for (const connection of this.mapData.connections) {
      const sourceGroup = this.group(connection.source);
      elements.push({
        group: 'edges',
        data: {
          id: this.connectionElementId(connection.id),
          source: this.groupElementId(connection.source),
          target: this.groupElementId(connection.target),
          semanticOverlay: 1,
          semanticConnection: 1,
          semanticConnectionId: connection.id,
          relationCount: connection.count,
          label: String(connection.count),
          canvasLabel: String(connection.count),
          edgeWidth: edgeWidth(connection.count),
          curveDistance: curveDistance(connection),
          structureColor: sourceGroup?.color ?? '#64748b',
          lineStyle: 'solid'
        }
      });
    }

    cy.batch(() => {
      cy.nodes().not('.filter-hidden').forEach((element) => {
        const record = model.nodeRecord.get(element.id());
        if (record?.kind === 'structure') element.addClass('structure-source-node');
        else if (record?.kind === 'junction') element.addClass('structure-source-junction');
      });
      cy.edges().filter((element) => model.edgeRecord.has(element.id())).addClass('structure-source-edge');
      if (elements.length) cy.add(elements);
    });

    this.restoreSelection();
  }

  selectGroupElement(element: cytoscape.SingularElementReturnValue): void {
    const id = String(element.data('semanticGroupId') ?? '');
    if (!id || !this.group(id)) return;
    this.options.cy.elements().unselect();
    element.select();
    this.selection = { kind: 'group', id };
    this.renderGroup(id, true);
  }

  selectConnectionElement(element: cytoscape.SingularElementReturnValue): void {
    const id = String(element.data('semanticConnectionId') ?? '');
    if (!id || !this.connection(id)) return;
    this.options.cy.elements().unselect();
    element.select();
    this.selection = { kind: 'connection', id };
    this.renderConnection(id, true);
  }

  clearSelection(): void {
    this.selection = null;
  }

  private edgeIncluded(edge: GraphEdge, visibleNodeIds: ReadonlySet<string>): boolean {
    const { model, state } = this.options;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return false;
    const source = model.nodeRecord.get(edge.source);
    const target = model.nodeRecord.get(edge.target);
    if (!source || !target || source.kind !== 'structure' || target.kind !== 'structure') return false;
    if (!state.selectedEdgeTypes.has(edge.type)) return false;
    return isCrossFieldEdgeAllowed(edge, model.isCrossFieldEdge(edge), state);
  }

  private restoreSelection(): void {
    if (!this.selection) return;
    const elementId = this.selection.kind === 'group'
      ? this.groupElementId(this.selection.id)
      : this.connectionElementId(this.selection.id);
    const element = this.options.cy.getElementById(elementId);
    if (!element || element.empty()) {
      this.selection = null;
      if (this.structureDetailsVisible()) this.renderIntroduction(false);
      return;
    }
    element.select();
    if (!this.structureDetailsVisible()) return;
    if (this.selection.kind === 'group') this.renderGroup(this.selection.id, false);
    else this.renderConnection(this.selection.id, false);
  }

  private renderIntroduction(open: boolean): void {
    const noun = this.options.state.layout === 'fields' ? 'field' : 'domain';
    const relationCount = this.mapData.connections.reduce((sum, connection) => sum + connection.count, 0);
    renderHtml(byId('detailTitle'), `${noun === 'field' ? 'Field' : 'Domain'} structure`);
    renderHtml(byId('detailEditLink'), '');
    renderHtml(byId('detailBody'), `
      <p>The visible concept graph is grouped by primary ${noun}. Concept nodes remain selectable underneath the overlay; aggregate arrows preserve direction and their width represents relation count.</p>
      <dl class="structure-overlay-stats">
        <div><dt>Visible concepts</dt><dd>${this.mapData.groups.reduce((sum, group) => sum + group.conceptCount, 0)}</dd></div>
        <div><dt>${noun}s</dt><dd>${this.mapData.groups.length}</dd></div>
        <div><dt>Cross-${noun} relations</dt><dd>${relationCount}</dd></div>
        <div><dt>Directed links</dt><dd>${this.mapData.connections.length}</dd></div>
      </dl>
      <p class="muted">Select a centroid or aggregate arrow for its detailed statistics.</p>`);
    this.markStructureDetails();
    if (open) this.options.openPanel();
  }

  private renderGroup(id: string, open: boolean): void {
    const group = this.group(id);
    if (!group) return;
    const noun = this.options.state.layout === 'fields' ? 'field' : 'domain';
    const connected = this.mapData.connections
      .filter((connection) => connection.source === id || connection.target === id)
      .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
      .slice(0, 8);
    const bridges = group.bridgeConcepts.slice(0, 10);
    renderHtml(byId('detailTitle'), `${escapeHtml(group.label)} — ${noun} structure`);
    renderHtml(byId('detailEditLink'), '');
    renderHtml(byId('detailBody'), `
      <p>This centroid is the mean Layered position of the currently visible concepts whose primary ${noun} is <strong>${escapeHtml(group.label)}</strong>.</p>
      <dl class="structure-overlay-stats">
        <div><dt>Concepts</dt><dd>${group.conceptCount}</dd></div>
        <div><dt>Internal relations</dt><dd>${group.internalRelations}</dd></div>
        <div><dt>Outgoing</dt><dd>${group.outgoingRelations}</dd></div>
        <div><dt>Incoming</dt><dd>${group.incomingRelations}</dd></div>
      </dl>
      <section class="structure-overlay-detail-section"><h4>Strongest connections</h4>${connected.length
        ? `<ol>${connected.map((connection) => {
            const otherId = connection.source === id ? connection.target : connection.source;
            const other = this.group(otherId);
            const direction = connection.source === id ? 'outgoing' : 'incoming';
            return `<li><button type="button" class="text-button structure-detail-link" data-structure-connection="${escapeHtml(connection.id)}"><strong>${escapeHtml(other?.label ?? otherId)}</strong><span>${connection.count} ${direction}</span></button></li>`;
          }).join('')}</ol>`
        : '<p class="muted">No cross-area relation survives the current filters.</p>'}</section>
      <section class="structure-overlay-detail-section"><h4>Bridge concepts</h4>${bridges.length
        ? `<ol>${bridges.map((bridge) => {
            const node = this.options.model.nodeRecord.get(bridge.nodeId);
            return `<li><button type="button" class="text-button structure-detail-link" data-structure-node="${escapeHtml(bridge.nodeId)}"><strong>${node ? this.options.renderMathText(node.label) : escapeHtml(bridge.nodeId)}</strong><span>${bridge.count}</span></button></li>`;
          }).join('')}</ol>`
        : '<p class="muted">No bridge concept survives the current filters.</p>'}</section>
      <div class="structure-overlay-actions"><button type="button" class="button primary" data-structure-focus="${escapeHtml(group.id)}">Show only this ${noun}</button></div>`);
    this.markStructureDetails();
    this.bindDetailActions();
    if (open) this.options.openPanel();
  }

  private renderConnection(id: string, open: boolean): void {
    const connection = this.connection(id);
    if (!connection) return;
    const source = this.group(connection.source);
    const target = this.group(connection.target);
    const typeCounts = Object.entries(connection.typeCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const underlying = connection.edgeIds
      .map((edgeId) => this.options.model.edgeRecord.get(edgeId))
      .filter((edge): edge is GraphEdge => Boolean(edge))
      .sort((left, right) => left.label.localeCompare(right.label))
      .slice(0, 12);
    renderHtml(byId('detailTitle'), `${escapeHtml(source?.label ?? connection.source)} → ${escapeHtml(target?.label ?? connection.target)}`);
    renderHtml(byId('detailEditLink'), '');
    renderHtml(byId('detailBody'), `
      <p>This aggregate arrow preserves the direction of every underlying relation. Its thickness and label encode the number of currently visible relations.</p>
      <dl class="structure-overlay-stats">
        <div><dt>Relations</dt><dd>${connection.count}</dd></div>
        <div><dt>Relation types</dt><dd>${typeCounts.length}</dd></div>
        <div><dt>Source concepts</dt><dd>${source?.conceptCount ?? 0}</dd></div>
        <div><dt>Target concepts</dt><dd>${target?.conceptCount ?? 0}</dd></div>
      </dl>
      <section class="structure-overlay-detail-section"><h4>Relation types</h4><ol>${typeCounts.map(([typeId, count]) => {
        const type = this.options.model.data.edgeTypes[typeId];
        return `<li><strong>${escapeHtml(type?.label ?? typeId)}</strong><span>${count}</span></li>`;
      }).join('')}</ol></section>
      <section class="structure-overlay-detail-section"><h4>Underlying relations</h4><ol>${underlying.map((edge) => {
        const sourceNode = this.options.model.nodeRecord.get(edge.source);
        const targetNode = this.options.model.nodeRecord.get(edge.target);
        return `<li><button type="button" class="text-button structure-detail-link" data-structure-edge="${escapeHtml(edge.id)}"><strong>${sourceNode ? this.options.renderMathText(sourceNode.label) : escapeHtml(edge.source)} → ${targetNode ? this.options.renderMathText(targetNode.label) : escapeHtml(edge.target)}</strong><span>${this.options.renderMathText(edge.label)}</span></button></li>`;
      }).join('')}</ol></section>`);
    this.markStructureDetails();
    this.bindDetailActions();
    if (open) this.options.openPanel();
  }

  private bindDetailActions(): void {
    byId('detailBody').querySelectorAll<HTMLElement>('[data-structure-node]').forEach((button) => {
      button.addEventListener('click', () => {
        const nodeId = button.dataset.structureNode;
        if (nodeId) this.options.activateNode(nodeId);
      });
    });
    byId('detailBody').querySelectorAll<HTMLElement>('[data-structure-edge]').forEach((button) => {
      button.addEventListener('click', () => {
        const edgeId = button.dataset.structureEdge;
        if (edgeId) this.options.activateEdge(edgeId);
      });
    });
    byId('detailBody').querySelectorAll<HTMLElement>('[data-structure-connection]').forEach((button) => {
      button.addEventListener('click', () => {
        const connectionId = button.dataset.structureConnection;
        if (!connectionId) return;
        const element = this.options.cy.getElementById(this.connectionElementId(connectionId));
        if (element && !element.empty()) this.selectConnectionElement(element);
      });
    });
    byId('detailBody').querySelectorAll<HTMLElement>('[data-structure-focus]').forEach((button) => {
      button.addEventListener('click', () => {
        const groupId = button.dataset.structureFocus;
        if (!groupId) return;
        if (this.options.state.layout === 'fields') this.options.focusField(groupId);
        else this.options.focusDomain(groupId);
      });
    });
  }

  private markStructureDetails(): void {
    byId('detailBody').dataset.structureOverlay = '1';
  }

  private structureDetailsVisible(): boolean {
    return byId('detailBody').dataset.structureOverlay === '1';
  }

  private group(id: string): SemanticMapGroup | undefined {
    return this.mapData.groups.find((candidate) => candidate.id === id);
  }

  private connection(id: string): SemanticMapConnection | undefined {
    return this.mapData.connections.find((candidate) => candidate.id === id);
  }

  private groupElementId(groupId: string): string {
    return `structure-group:${this.options.state.layout}:${groupId}`;
  }

  private connectionElementId(connectionId: string): string {
    return `structure-connection:${this.options.state.layout}:${connectionId}`;
  }
}

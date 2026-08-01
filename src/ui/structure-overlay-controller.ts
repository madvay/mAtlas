import type cytoscape from 'cytoscape';
import { byId, escapeHtml } from '../core/dom.js';
import { buildSemanticMap, domainLevelAnchor, type SemanticMapConnection, type SemanticMapData, type SemanticMapGroup, type SemanticMapScale } from '../graph/semantic-map-core.js';
import { deconflictStructurePositions, estimateStructureFitZoom, structureEdgeVisualMetrics, structureNodeGap, structureNodeVisualMetrics } from '../graph/structure-overlay-geometry.js';
import { isCrossFieldEdgeAllowed } from '../graph/visibility-policy.js';
import type { GraphModel } from '../model/graph-model.js';
import type { AppState, GraphEdge, GraphNode, HistoryMode, LayoutName, Point, Preferences, SelectionTarget } from '../types.js';
import { renderHtml } from './render.js';
import { stripInlineMathText } from '../core/text.js';

interface StructureOverlayControllerOptions {
  model: GraphModel;
  state: AppState;
  cy: cytoscape.Core;
  preferences: () => Preferences;
  openPanel: () => void;
  focusField: (fieldId: string) => void;
  focusDomain: (domainId: string) => void;
  activateNode: (nodeId: string) => void;
  activateEdge: (edgeId: string) => void;
  onSelectionChange: (target: SelectionTarget | null, mode: Exclude<HistoryMode, null>) => void;
  clearGraphSelection: () => void;
  renderMathText: (value: unknown) => string;
}

type OverlaySelection =
  | { kind: 'group'; id: string }
  | { kind: 'connection'; id: string };

const OVERLAY_SELECTOR = '[semanticOverlay = 1]';
const OVERLAY_PENDING_CLASS = 'structure-overlay-pending';
const CONNECTION_EMPHASIS_CLASS = 'structure-connection-emphasis';
const CONNECTION_HIDDEN_CLASS = 'structure-connection-hidden';
const DOMAIN_NAME_OVERLAY_SELECTOR = 'node[domainNameOverlay = 1]';
const DOMAIN_NAME_OVERLAY_VISIBLE_CLASS = 'domain-name-overlay-visible';
const CONCEPT_NODE_GRAPH_WIDTH = 164;
const LAYERED_DOMAIN_OVERLAY_SHOW_BELOW_WIDTH = 24;
const LAYERED_DOMAIN_OVERLAY_HIDE_ABOVE_WIDTH = 28;
const FIELD_DOMAIN_OVERLAY_HIDE_BELOW_WIDTH = 8;
const FIELD_DOMAIN_OVERLAY_SHOW_ABOVE_WIDTH = 10;

export class StructureOverlayController {
  private mapData: SemanticMapData = { groups: [], connections: [] };
  private selection: OverlaySelection | null = null;
  private layoutTransitionPending = false;
  private domainNamesVisible = false;

  constructor(private readonly options: StructureOverlayControllerOptions) {}

  initialize(): void {
    this.options.cy.on('dragfree', 'node', (event) => {
      if ((!this.active() && !this.domainNamesEnabled()) || Number(event.target.data('semanticOverlay')) === 1) return;
      this.refresh();
    });
    this.options.cy.on('zoom', () => this.syncDomainNameOverlayVisibility());
  }

  active(): boolean {
    return this.options.state.layout === 'domains' || this.options.state.layout === 'fields';
  }

  beginLayoutTransition(layout: LayoutName): void {
    this.layoutTransitionPending = layout === 'domains' || layout === 'fields';
    if (this.layoutTransitionPending) {
      this.options.cy.elements(OVERLAY_SELECTOR).addClass(OVERLAY_PENDING_CLASS);
    } else {
      this.options.cy.elements(OVERLAY_SELECTOR).removeClass(OVERLAY_PENDING_CLASS);
    }
  }

  finishLayoutTransition(): void {
    this.layoutTransitionPending = false;
    this.options.cy.elements(OVERLAY_SELECTOR).removeClass(OVERLAY_PENDING_CLASS);
  }

  prepareForLayout(layout: LayoutName): void {
    const active = layout === 'domains' || layout === 'fields';
    const { cy, model } = this.options;
    if (!active && this.selection) {
      const selected = this.selectedOverlayElement();
      this.selection = null;
      selected?.unselect();
      this.options.onSelectionChange(null, 'replace');
    }
    cy.batch(() => {
      cy.nodes().forEach((element) => {
        const record = model.nodeRecord.get(element.id());
        if (!record) return;
        element.toggleClass('structure-source-node', active && record.kind === 'structure');
        element.toggleClass('structure-source-junction', active && record.kind === 'junction');
      });
      cy.edges().filter((element) => model.edgeRecord.has(element.id()))
        .toggleClass('structure-source-edge', active);
    });
  }

  refresh(): void {
    const { cy, model, state } = this.options;
    const structureActive = this.active();
    const domainNamesEnabled = this.domainNamesEnabled();
    if (!domainNamesEnabled) this.domainNamesVisible = false;
    if (!structureActive && !domainNamesEnabled) {
      cy.batch(() => {
        cy.elements(OVERLAY_SELECTOR).remove();
        cy.nodes().removeClass('structure-source-node structure-source-junction');
        cy.edges().removeClass('structure-source-edge');
      });
      this.mapData = { groups: [], connections: [] };
      this.selection = null;
      this.layoutTransitionPending = false;
      this.domainNamesVisible = false;
      return;
    }

    if (structureActive) {
      // Keep the dimmed substrate classes in place while the overlay is rebuilt.
      // Removing them before the aggregate data is calculated allows Cytoscape to
      // paint one full-opacity frame on layout entry and filter changes.
      this.prepareForLayout(state.layout);
    } else {
      cy.batch(() => {
        cy.nodes().removeClass('structure-source-node structure-source-junction');
        cy.edges().removeClass('structure-source-edge');
      });
      this.mapData = { groups: [], connections: [] };
      this.selection = null;
    }
    cy.elements(OVERLAY_SELECTOR).remove();

    const visibleNodes = cy.nodes().not('.filter-hidden')
      .map((element) => model.nodeRecord.get(element.id()))
      .filter((node): node is GraphNode => Boolean(node && node.kind === 'structure'));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const semanticEdges = model.allEdges.filter((edge) => this.edgeIncluded(edge, visibleNodeIds));
    const sourceElements = cy.nodes().not('.filter-hidden').filter((element) => {
      const record = model.nodeRecord.get(element.id());
      return Boolean(record && record.kind === 'structure');
    });
    const sourceBounds = sourceElements.boundingBox({ includeLabels: false, includeOverlays: false });
    const estimatedFitZoom = estimateStructureFitZoom(sourceBounds, { width: cy.width(), height: cy.height() });

    if (!structureActive) {
      this.addDomainNameOverlays(visibleNodes, semanticEdges, estimatedFitZoom);
      return;
    }

    const scale: SemanticMapScale = state.layout === 'fields' ? 'fields' : 'domains';
    this.mapData = this.buildMap(scale, visibleNodes, semanticEdges);
    const metricsByGroup = new Map(this.mapData.groups.map((group) => [
      group.id,
      structureNodeVisualMetrics(scale, group.conceptCount, stripInlineMathText(group.label), estimatedFitZoom)
    ]));
    const displayPositions = deconflictStructurePositions(
      this.mapData.groups.map((group) => ({
        id: group.id,
        anchor: group.position,
        width: metricsByGroup.get(group.id)?.width ?? 0,
        height: metricsByGroup.get(group.id)?.height ?? 0
      })),
      structureNodeGap(scale, estimatedFitZoom)
    );
    const elements: cytoscape.ElementDefinition[] = [];
    for (const group of this.mapData.groups) {
      const metrics = metricsByGroup.get(group.id);
      if (!metrics) continue;
      elements.push({
        group: 'nodes',
        data: {
          id: this.groupElementId(group.id),
          semanticOverlay: 1,
          semanticGroup: 1,
          semanticGroupId: group.id,
          semanticScale: scale,
          label: group.label,
          canvasLabel: metrics.labelLines.join('\n'),
          color: group.color,
          nodeWidth: metrics.width,
          nodeHeight: metrics.height,
          labelFontSize: metrics.fontSize,
          textOutlineWidth: metrics.textOutlineWidth,
          selectedTextOutlineWidth: metrics.selectedTextOutlineWidth,
          textWidth: metrics.textWidth,
          conceptCount: group.conceptCount
        },
        position: displayPositions.get(group.id) ?? group.position,
        locked: true,
        grabbable: false
      });
    }
    for (const connection of this.mapData.connections) {
      const sourceGroup = this.group(connection.source);
      const metrics = structureEdgeVisualMetrics(scale, connection.count, estimatedFitZoom);
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
          canvasLabel: '',
          edgeWidth: metrics.width,
          selectedEdgeWidth: metrics.selectedWidth,
          arrowSize: metrics.arrowSize,
          curveDistance: metrics.curveDistance,
          structureColor: sourceGroup?.color ?? '#64748b',
          lineStyle: 'solid'
        }
      });
    }

    if (elements.length) {
      const added = cy.add(elements);
      if (this.layoutTransitionPending) added.addClass(OVERLAY_PENDING_CLASS);
    }

    if (domainNamesEnabled) this.addDomainNameOverlays(visibleNodes, semanticEdges, estimatedFitZoom);

    this.restoreSelection();
    this.syncConnectionEmphasis();
    if (!this.selection && this.structureDetailsVisible()) this.renderIntroduction(false);
  }

  selectGroupElement(element: cytoscape.SingularElementReturnValue): void {
    const id = String(element.data('semanticGroupId') ?? '');
    if (!id || !this.group(id)) return;
    this.applyGroupSelection(id, element, true);
    this.options.onSelectionChange(this.selectionTarget(), 'push');
  }

  selectConnectionElement(element: cytoscape.SingularElementReturnValue): void {
    const id = String(element.data('semanticConnectionId') ?? '');
    if (!id || !this.connection(id)) return;
    this.applyConnectionSelection(id, element, true);
    this.options.onSelectionChange(this.selectionTarget(), 'push');
  }

  selectTarget(target: SelectionTarget, open = true): boolean {
    if (!this.active()) return false;
    if (target.kind === this.groupSelectionKind()) {
      const element = this.options.cy.getElementById(this.groupElementId(target.id));
      if (!element || element.empty() || !this.group(target.id)) return false;
      this.applyGroupSelection(target.id, element, open);
      return true;
    }
    if (target.kind === this.connectionSelectionKind()) {
      const element = this.options.cy.getElementById(this.connectionElementId(target.id));
      if (!element || element.empty() || !this.connection(target.id)) return false;
      this.applyConnectionSelection(target.id, element, open);
      return true;
    }
    return false;
  }

  selectionTarget(): SelectionTarget | null {
    if (!this.selection || !this.active()) return null;
    return {
      kind: this.selection.kind === 'group' ? this.groupSelectionKind() : this.connectionSelectionKind(),
      id: this.selection.id
    };
  }

  clearSelection(): void {
    const selected = this.selectedOverlayElement();
    this.selection = null;
    selected?.unselect();
    this.syncConnectionEmphasis();
  }

  showIntroductionForLayout(layout: LayoutName, open = false): void {
    if (layout !== 'domains' && layout !== 'fields') return;
    this.renderIntroduction(open, layout);
  }

  private applyGroupSelection(id: string, element: cytoscape.SingularElementReturnValue, open: boolean): void {
    this.options.clearGraphSelection();
    this.selectedOverlayElement()?.unselect();
    element.select();
    this.selection = { kind: 'group', id };
    this.syncConnectionEmphasis();
    this.renderGroup(id, open);
  }

  private applyConnectionSelection(id: string, element: cytoscape.SingularElementReturnValue, open: boolean): void {
    this.options.clearGraphSelection();
    this.selectedOverlayElement()?.unselect();
    element.select();
    this.selection = { kind: 'connection', id };
    this.syncConnectionEmphasis();
    this.renderConnection(id, open);
  }

  private selectedOverlayElement(): cytoscape.SingularElementReturnValue | null {
    if (!this.selection) return null;
    const elementId = this.selection.kind === 'group'
      ? this.groupElementId(this.selection.id)
      : this.connectionElementId(this.selection.id);
    const element = this.options.cy.getElementById(elementId);
    return element && !element.empty() ? element : null;
  }

  private domainNamesEnabled(): boolean {
    return this.options.preferences().overlayDomains
      && (this.options.state.layout === 'atlas' || this.options.state.layout === 'fields');
  }

  private syncDomainNameOverlayVisibility(force = false): void {
    const renderedConceptWidth = CONCEPT_NODE_GRAPH_WIDTH * this.options.cy.zoom();
    let visible = false;
    if (this.domainNamesEnabled()) {
      visible = this.options.state.layout === 'fields'
        ? (this.domainNamesVisible
          ? renderedConceptWidth > FIELD_DOMAIN_OVERLAY_HIDE_BELOW_WIDTH
          : renderedConceptWidth > FIELD_DOMAIN_OVERLAY_SHOW_ABOVE_WIDTH)
        : (this.domainNamesVisible
          ? renderedConceptWidth < LAYERED_DOMAIN_OVERLAY_HIDE_ABOVE_WIDTH
          : renderedConceptWidth < LAYERED_DOMAIN_OVERLAY_SHOW_BELOW_WIDTH);
    }
    if (!force && visible === this.domainNamesVisible) return;
    this.domainNamesVisible = visible;
    this.options.cy.nodes(DOMAIN_NAME_OVERLAY_SELECTOR)
      .toggleClass(DOMAIN_NAME_OVERLAY_VISIBLE_CLASS, visible);
  }

  private buildMap(
    scale: SemanticMapScale,
    visibleNodes: readonly GraphNode[],
    semanticEdges: readonly GraphEdge[]
  ): SemanticMapData {
    const { cy, model } = this.options;
    return buildSemanticMap({
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
      },
      ...(scale === 'domains'
        ? { anchorForGroup: (groupId: string, conceptIds: readonly string[]) => this.domainLevelAnchor(groupId, conceptIds) }
        : {})
    });
  }

  private addDomainNameOverlays(
    visibleNodes: readonly GraphNode[],
    semanticEdges: readonly GraphEdge[],
    estimatedFitZoom: number
  ): void {
    const domainMap = this.buildMap('domains', visibleNodes, semanticEdges);
    const metricsByGroup = new Map(domainMap.groups.map((group) => [
      group.id,
      structureNodeVisualMetrics('domains', group.conceptCount, stripInlineMathText(group.label), estimatedFitZoom)
    ]));
    const displayPositions = deconflictStructurePositions(
      domainMap.groups.map((group) => ({
        id: group.id,
        anchor: group.position,
        width: metricsByGroup.get(group.id)?.width ?? 0,
        height: metricsByGroup.get(group.id)?.height ?? 0
      })),
      structureNodeGap('domains', estimatedFitZoom)
    );
    const elements: cytoscape.ElementDefinition[] = [];
    for (const group of domainMap.groups) {
      const metrics = metricsByGroup.get(group.id);
      if (!metrics) continue;
      elements.push({
        group: 'nodes',
        data: {
          id: `domain-name-overlay:${group.id}`,
          semanticOverlay: 1,
          domainNameOverlay: 1,
          domainOverlayContext: this.options.state.layout,
          domainId: group.id,
          label: group.label,
          canvasLabel: metrics.labelLines.join('\n'),
          color: group.color,
          nodeWidth: metrics.width,
          nodeHeight: metrics.height,
          labelFontSize: metrics.fontSize,
          textOutlineWidth: metrics.textOutlineWidth,
          textWidth: metrics.textWidth,
          conceptCount: group.conceptCount
        },
        position: displayPositions.get(group.id) ?? group.position,
        locked: true,
        grabbable: false
      });
    }
    if (elements.length) {
      const added = this.options.cy.add(elements);
      if (this.layoutTransitionPending) added.addClass(OVERLAY_PENDING_CLASS);
    }
    this.syncDomainNameOverlayVisibility(true);
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
      this.options.onSelectionChange(null, 'replace');
      return;
    }
    element.select();
    if (!this.structureDetailsVisible()) return;
    if (this.selection.kind === 'group') this.renderGroup(this.selection.id, false);
    else this.renderConnection(this.selection.id, false);
  }

  private syncConnectionEmphasis(): void {
    const edges = this.options.cy.edges('[semanticConnection = 1]');
    // Cytoscape bypass styles outrank stylesheet selectors. Clear any stale
    // opacity/event bypass whenever overlay state is reconciled so the base
    // dim, selected-edge, and incident-edge selectors are authoritative.
    edges.removeStyle('opacity');
    edges.removeStyle('events');
    edges.removeClass(`${CONNECTION_EMPHASIS_CLASS} ${CONNECTION_HIDDEN_CLASS}`);
    if (this.selection?.kind !== 'group') return;
    const selectedGroupElementId = this.groupElementId(this.selection.id);
    edges.forEach((edge) => {
      if (edge.source().id() === selectedGroupElementId || edge.target().id() === selectedGroupElementId) {
        edge.addClass(CONNECTION_EMPHASIS_CLASS);
      } else {
        edge.addClass(CONNECTION_HIDDEN_CLASS);
      }
    });
  }

  private renderIntroduction(open: boolean, layout: LayoutName = this.options.state.layout): void {
    const noun = layout === 'fields' ? 'field' : 'domain';
    const relationCount = this.mapData.connections.reduce((sum, connection) => sum + connection.count, 0);
    renderHtml(byId('detailTitle'), `${noun === 'field' ? 'Field' : 'Domain'} structure`);
    renderHtml(byId('detailEditLink'), '');
    renderHtml(byId('detailBody'), `
      <p>The visible concept graph is grouped by primary ${noun}. Dimmed concept nodes provide positional context but are intentionally non-interactive. Aggregate arrows preserve direction and their width represents relation count; selecting a field or domain label isolates its incident arrows.</p>
      <dl class="structure-overlay-stats">
        <div><dt>Visible concepts</dt><dd>${this.mapData.groups.reduce((sum, group) => sum + group.conceptCount, 0)}</dd></div>
        <div><dt>${noun}s</dt><dd>${this.mapData.groups.length}</dd></div>
        <div><dt>Cross-${noun} relations</dt><dd>${relationCount}</dd></div>
        <div><dt>Directed links</dt><dd>${this.mapData.connections.length}</dd></div>
      </dl>
      <p class="muted">Select a field or domain label to hide unrelated arrows and bring its immediate connection neighborhood to full strength, or select one aggregate arrow for its detailed statistics.</p>`);
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
    this.renderSelectionHeaderActions();
    renderHtml(byId('detailBody'), `
      <p>This label begins at a deterministic Layered anchor for the currently visible concepts whose primary ${noun} is <strong>${escapeHtml(group.label)}</strong>, then moves only as needed to avoid label collisions.</p>
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
    this.renderSelectionHeaderActions();
    renderHtml(byId('detailBody'), `
      <p>This aggregate arrow preserves the direction of every underlying relation. Its thickness encodes the number of currently visible relations.</p>
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
    const shareButton = document.getElementById('detailShareButton');
    shareButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch {
        window.prompt('Copy permalink:', window.location.href);
      }
    });
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

  private renderSelectionHeaderActions(): void {
    renderHtml(byId('detailEditLink'), `<div class="detail-header-actions">
      <a href="#" class="detail-header-action" id="detailShareButton" aria-label="Copy permalink" title="Copy permalink">
        <span class="material-symbols-outlined" aria-hidden="true">link</span>
      </a>
    </div>`);
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

  private groupSelectionKind(): 'domain' | 'field' {
    return this.options.state.layout === 'fields' ? 'field' : 'domain';
  }

  private connectionSelectionKind(): 'domain-edge' | 'field-edge' {
    return this.options.state.layout === 'fields' ? 'field-edge' : 'domain-edge';
  }

  private domainLevelAnchor(groupId: string, conceptIds: readonly string[]): Point | undefined {
    const { cy, model } = this.options;
    const visibleDomains = new Set(cy.nodes().not('.filter-hidden')
      .map((element) => model.nodeRecord.get(element.id()))
      .filter((node): node is GraphNode => Boolean(node && node.kind === 'structure'))
      .map((node) => node.primaryDomain));
    const visibleDomainIds = model.domainOrder.filter((domainId) => visibleDomains.has(domainId));
    const records = conceptIds
      .map((nodeId) => model.nodeRecord.get(nodeId))
      .filter((node): node is GraphNode => Boolean(node && node.kind === 'structure'));
    return domainLevelAnchor(groupId, visibleDomainIds, records, (nodeId) => {
      const element = cy.getElementById(nodeId);
      return element && !element.empty() ? element.position() : undefined;
    }) ?? undefined;
  }

  private groupElementId(groupId: string): string {
    return `structure-group:${this.options.state.layout}:${groupId}`;
  }

  private connectionElementId(connectionId: string): string {
    return `structure-connection:${this.options.state.layout}:${connectionId}`;
  }
}

import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, EventObject, StylesheetJson } from 'cytoscape';
import { byId, escapeHtml } from '../core/dom.js';
import type { GraphModel } from '../model/graph-model.js';
import type { AppState, GraphEdge, GraphNode } from '../types.js';
import { isCrossFieldEdgeAllowed } from '../graph/visibility-policy.js';
import {
  buildSemanticMap,
  type SemanticMapData,
  type SemanticMapScale
} from '../graph/semantic-map-core.js';
import { renderHtml } from './render.js';

interface SemanticMapControllerOptions {
  model: GraphModel;
  state: AppState;
  sourceCy: Core;
  focusField: (fieldId: string) => void;
  focusDomain: (domainId: string) => void;
  renderMathText: (value: unknown) => string;
}

const semanticMapStyles: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      width: 'data(nodeWidth)',
      height: 'data(nodeHeight)',
      'background-color': 'data(color)',
      'background-opacity': 0.92,
      'border-width': 3,
      'border-color': 'data(fieldColor)',
      label: 'data(label)',
      color: '#ffffff',
      'font-size': 14,
      'font-weight': 700,
      'text-wrap': 'wrap',
      'text-max-width': 'data(textWidth)',
      'text-halign': 'center',
      'text-valign': 'center',
      'overlay-opacity': 0
    }
  },
  {
    selector: 'node:selected',
    style: { 'border-width': 6, 'border-color': '#0f172a', 'background-opacity': 1 }
  },
  {
    selector: 'edge',
    style: {
      width: 'data(edgeWidth)',
      'curve-style': 'bezier',
      'line-color': '#64748b',
      'target-arrow-color': '#64748b',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.85,
      label: 'data(label)',
      color: '#334155',
      'font-size': 10,
      'font-weight': 700,
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.9,
      'text-background-padding': '3px',
      'text-border-width': 1,
      'text-border-color': '#cbd5e1',
      'text-border-opacity': 0.9,
      'text-rotation': 'autorotate',
      'overlay-opacity': 0
    }
  },
  {
    selector: 'edge:selected',
    style: { width: 6, 'line-color': '#0f172a', 'target-arrow-color': '#0f172a', 'z-index': 999 }
  }
];

function nodeDimensions(count: number): { width: number; height: number } {
  const factor = Math.log2(count + 1);
  return {
    width: Math.round(Math.min(250, Math.max(176, 158 + factor * 18))),
    height: Math.round(Math.min(104, Math.max(72, 64 + factor * 8)))
  };
}

function edgeWidth(count: number): number {
  return Math.min(10, 1.8 + Math.log2(count + 1) * 1.35);
}

export class SemanticMapController {
  private scale: SemanticMapScale = 'fields';
  private domainFieldFocus: string | null = null;
  private mapCy: Core | null = null;
  private mapData: SemanticMapData = { groups: [], connections: [] };

  constructor(private readonly options: SemanticMapControllerOptions) {}

  initialize(): void {
    byId<HTMLButtonElement>('semanticMapButton').addEventListener('click', () => this.open());
    byId<HTMLButtonElement>('semanticMapFields').addEventListener('click', () => {
      this.scale = 'fields';
      this.domainFieldFocus = null;
      this.refresh();
    });
    byId<HTMLButtonElement>('semanticMapDomains').addEventListener('click', () => {
      this.scale = 'domains';
      this.domainFieldFocus = null;
      this.refresh();
    });
    byId<HTMLButtonElement>('semanticMapBack').addEventListener('click', () => {
      this.scale = 'fields';
      this.domainFieldFocus = null;
      this.refresh();
    });
    document.querySelectorAll<HTMLElement>('[data-semantic-map-close]').forEach((button) => {
      button.addEventListener('click', () => byId<HTMLDialogElement>('semanticMapDialog').close());
    });
  }

  open(): void {
    const dialog = byId<HTMLDialogElement>('semanticMapDialog');
    if (!dialog.open) dialog.showModal();
    this.refresh();
  }

  private ensureMap(): Core {
    if (this.mapCy) return this.mapCy;
    const container = byId<HTMLElement>('semanticMapGraph');
    this.mapCy = cytoscape({
      container,
      elements: [],
      layout: { name: 'preset' },
      minZoom: 0.08,
      maxZoom: 3,
      wheelSensitivity: 0.18,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: semanticMapStyles
    });
    this.mapCy.on('tap', 'node', (event) => this.showGroup(String(event.target.id())));
    this.mapCy.on('tap', 'edge', (event) => this.showConnection(String(event.target.id())));
    this.mapCy.on('dbltap', 'node', (event) => this.activateGroup(String(event.target.id())));
    this.mapCy.on('tap', (event: EventObject) => {
      if (event.target === this.mapCy) this.showIntroduction();
    });
    return this.mapCy;
  }

  private refresh(): void {
    const visibleNodes = this.visibleStructureNodes();
    const scopedNodes = this.scale === 'domains' && this.domainFieldFocus
      ? visibleNodes.filter((node) => this.options.model.nodePrimaryField(node) === this.domainFieldFocus)
      : visibleNodes;
    const visibleNodeIds = new Set(scopedNodes.map((node) => node.id));
    const edges = this.semanticEdges(visibleNodeIds);
    const { model } = this.options;
    this.mapData = buildSemanticMap({
      scale: this.scale,
      nodes: scopedNodes,
      edges,
      fields: model.data.fields,
      domains: model.data.domains,
      fieldOrder: model.fieldOrder,
      domainOrder: model.domainOrder,
      fieldForDomain: (domainId) => model.fieldForDomain(domainId),
      primaryFieldForNode: (node) => model.nodePrimaryField(node)
    });

    const cy = this.ensureMap();
    cy.elements().remove();
    cy.add(this.elements());
    cy.layout({ name: 'preset', fit: true, padding: 72 }).run();
    this.syncControls();
    this.showIntroduction();
    window.requestAnimationFrame(() => {
      cy.resize();
      if (!cy.elements().empty()) cy.fit(cy.elements(), 72);
    });
  }

  private visibleStructureNodes(): GraphNode[] {
    const { model, sourceCy } = this.options;
    return sourceCy.nodes().not('.filter-hidden')
      .map((element) => model.nodeRecord.get(element.id()))
      .filter((node): node is GraphNode => Boolean(node && node.kind === 'structure'));
  }

  private semanticEdges(visibleNodeIds: ReadonlySet<string>): GraphEdge[] {
    const { model, state } = this.options;
    return model.allEdges.filter((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return false;
      const source = model.nodeRecord.get(edge.source);
      const target = model.nodeRecord.get(edge.target);
      if (!source || !target || source.kind !== 'structure' || target.kind !== 'structure') return false;
      if (!state.selectedEdgeTypes.has(edge.type)) return false;
      return isCrossFieldEdgeAllowed(edge, model.isCrossFieldEdge(edge), state);
    });
  }

  private elements(): ElementDefinition[] {
    const { model } = this.options;
    const nodes: ElementDefinition[] = this.mapData.groups.map((group) => {
      const dimensions = nodeDimensions(group.conceptCount);
      const fieldColor = model.data.fields[group.fieldId]?.color ?? group.color;
      return {
        group: 'nodes',
        data: {
          id: group.id,
          label: `${group.label}\n${group.conceptCount} concept${group.conceptCount === 1 ? '' : 's'}`,
          color: group.color,
          fieldColor,
          nodeWidth: dimensions.width,
          nodeHeight: dimensions.height,
          textWidth: dimensions.width - 28
        },
        position: group.position
      };
    });
    const edges: ElementDefinition[] = this.mapData.connections.map((connection) => ({
      group: 'edges',
      data: {
        id: connection.id,
        source: connection.source,
        target: connection.target,
        label: String(connection.count),
        edgeWidth: edgeWidth(connection.count)
      }
    }));
    return [...nodes, ...edges];
  }

  private syncControls(): void {
    byId<HTMLButtonElement>('semanticMapFields').setAttribute('aria-pressed', String(this.scale === 'fields'));
    byId<HTMLButtonElement>('semanticMapDomains').setAttribute('aria-pressed', String(this.scale === 'domains'));
    const back = byId<HTMLButtonElement>('semanticMapBack');
    back.hidden = !(this.scale === 'domains' && this.domainFieldFocus);
    const scope = byId<HTMLElement>('semanticMapScope');
    if (this.scale === 'domains' && this.domainFieldFocus) {
      const label = this.options.model.data.fields[this.domainFieldFocus]?.label ?? this.domainFieldFocus;
      scope.textContent = `${label} domains`;
    } else {
      scope.textContent = this.scale === 'fields' ? 'Field scale' : 'Domain scale';
    }
  }

  private showIntroduction(): void {
    const noun = this.scale === 'fields' ? 'field' : 'domain';
    const relationCount = this.mapData.connections.reduce((sum, edge) => sum + edge.count, 0);
    renderHtml(byId('semanticMapDetails'), `
      <div class="kicker">Semantic overview</div>
      <h3>${this.mapData.groups.length} visible ${noun}${this.mapData.groups.length === 1 ? '' : 's'}</h3>
      <p>The map compresses the current concept and edge filters. Node area reflects visible concept count; arrow width and labels reflect directed relation count.</p>
      <dl class="semantic-map-stats">
        <div><dt>Visible concepts</dt><dd>${this.mapData.groups.reduce((sum, group) => sum + group.conceptCount, 0)}</dd></div>
        <div><dt>Cross-${noun} relations</dt><dd>${relationCount}</dd></div>
      </dl>
      <p class="muted">Select an area to inspect its bridges. Double-click a field to descend to its domains, or a domain to open its concepts in the atlas.</p>`);
  }

  private showGroup(id: string): void {
    const group = this.mapData.groups.find((candidate) => candidate.id === id);
    if (!group) return;
    const connected = this.connectedGroups(group.id).slice(0, 6);
    const bridges = group.bridgeConcepts.slice(0, 6);
    const action = this.scale === 'fields'
      ? `<button type="button" class="button primary" data-semantic-drill="${escapeHtml(group.id)}">Show its domains</button>
         <button type="button" class="button secondary" data-semantic-open="${escapeHtml(group.id)}">Open field in atlas</button>`
      : `<button type="button" class="button primary" data-semantic-open="${escapeHtml(group.id)}">Open domain in atlas</button>`;
    renderHtml(byId('semanticMapDetails'), `
      <div class="kicker">${this.scale === 'fields' ? 'Field' : 'Domain'}</div>
      <h3>${escapeHtml(group.label)}</h3>
      <dl class="semantic-map-stats">
        <div><dt>Visible concepts</dt><dd>${group.conceptCount}</dd></div>
        <div><dt>Internal relations</dt><dd>${group.internalRelations}</dd></div>
        <div><dt>Incoming</dt><dd>${group.incomingRelations}</dd></div>
        <div><dt>Outgoing</dt><dd>${group.outgoingRelations}</dd></div>
      </dl>
      <section class="semantic-map-detail-section"><h4>Strongest connections</h4>${connected.length
        ? `<ol>${connected.map((entry) => `<li><strong>${escapeHtml(entry.label)}</strong><span>${entry.count} relation${entry.count === 1 ? '' : 's'}</span></li>`).join('')}</ol>`
        : '<p class="muted">No cross-area relation is visible under the current edge filters.</p>'}</section>
      <section class="semantic-map-detail-section"><h4>Bridge concepts</h4>${bridges.length
        ? `<ol>${bridges.map((entry) => {
            const node = this.options.model.nodeRecord.get(entry.nodeId);
            return `<li><strong class="math-rich">${this.options.renderMathText(node?.label ?? entry.nodeId)}</strong><span>${entry.count} cross-area relation${entry.count === 1 ? '' : 's'}</span></li>`;
          }).join('')}</ol>`
        : '<p class="muted">No bridge concept is visible under the current edge filters.</p>'}</section>
      <div class="semantic-map-actions">${action}</div>`);
    const details = byId('semanticMapDetails');
    details.querySelector<HTMLElement>('[data-semantic-drill]')?.addEventListener('click', () => this.drillIntoField(group.id));
    details.querySelector<HTMLElement>('[data-semantic-open]')?.addEventListener('click', () => this.openInAtlas(group.id));
  }

  private showConnection(id: string): void {
    const connection = this.mapData.connections.find((candidate) => candidate.id === id);
    if (!connection) return;
    const source = this.mapData.groups.find((group) => group.id === connection.source);
    const target = this.mapData.groups.find((group) => group.id === connection.target);
    const types = Object.entries(connection.typeCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    renderHtml(byId('semanticMapDetails'), `
      <div class="kicker">Aggregated relation</div>
      <h3>${escapeHtml(source?.label ?? connection.source)} → ${escapeHtml(target?.label ?? connection.target)}</h3>
      <p><strong>${connection.count}</strong> visible directed relation${connection.count === 1 ? '' : 's'} connect these areas.</p>
      <section class="semantic-map-detail-section"><h4>Relation types</h4><ol>${types.map(([typeId, count]) => {
        const label = this.options.model.data.edgeTypes[typeId]?.label ?? typeId;
        return `<li><strong>${escapeHtml(label)}</strong><span>${count}</span></li>`;
      }).join('')}</ol></section>`);
  }

  private connectedGroups(groupId: string): Array<{ id: string; label: string; count: number }> {
    const counts = new Map<string, number>();
    for (const connection of this.mapData.connections) {
      if (connection.source === groupId) counts.set(connection.target, (counts.get(connection.target) ?? 0) + connection.count);
      if (connection.target === groupId) counts.set(connection.source, (counts.get(connection.source) ?? 0) + connection.count);
    }
    return [...counts].map(([id, count]) => ({
      id,
      label: this.mapData.groups.find((group) => group.id === id)?.label ?? id,
      count
    })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }

  private activateGroup(id: string): void {
    if (this.scale === 'fields') this.drillIntoField(id);
    else this.openInAtlas(id);
  }

  private drillIntoField(fieldId: string): void {
    if (!this.options.model.knownFieldIds.has(fieldId)) return;
    this.scale = 'domains';
    this.domainFieldFocus = fieldId;
    this.refresh();
  }

  private openInAtlas(id: string): void {
    if (this.scale === 'fields') this.options.focusField(id);
    else this.options.focusDomain(id);
    byId<HTMLDialogElement>('semanticMapDialog').close();
  }
}

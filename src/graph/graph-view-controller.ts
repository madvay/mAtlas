import type cytoscape from 'cytoscape';
import { byId } from '../core/dom.js';
import type { GraphModel } from '../model/graph-model.js';
import type { AppState, AtlasView, GraphEdge, LayoutName, Preferences } from '../types.js';
import type { LabelSizer } from './label-sizer.js';
import { isCrossFieldEdgeAllowed, resolveFilterVisibility } from './visibility-policy.js';
import { renderHtml } from '../ui/render.js';
import { viewCoreNodes, viewRequiredNodeIds } from '../state/view-state.js';
import { edgeInteractionEnabled } from './edge-interaction.js';

function sameNodeIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export interface GraphViewControllerOptions {
  cy: cytoscape.Core;
  model: GraphModel;
  state: AppState;
  labelSizer: LabelSizer;
  runLayout: (name: LayoutName, fitAfter: boolean) => void;
  fitVisible: (elements: cytoscape.CollectionReturnValue, padding?: number) => void;
  scheduleFieldBands: () => void;
  updateFiltersToggleCount: () => void;
  preferences: () => Preferences;
  activeView: () => AtlasView | null;
  selectedElement: () => cytoscape.SingularElementReturnValue | null;
}

export class GraphViewController {
  private lastLabelZoom: number | null = null;
  private lastVisibleNodeIds: ReadonlySet<string> | null = null;
  private neighborhoodDimmed: cytoscape.CollectionReturnValue;
  private neighborhoodEmphasized: cytoscape.CollectionReturnValue;
  private prerequisiteHighlighted: cytoscape.CollectionReturnValue;

  constructor(private readonly options: GraphViewControllerOptions) {
    this.neighborhoodDimmed = options.cy.collection();
    this.neighborhoodEmphasized = options.cy.collection();
    this.prerequisiteHighlighted = options.cy.collection();
  }

  updateSemanticLabelSizes(force = false): void {
    const { cy, model, labelSizer } = this.options;
    const zoom = cy.zoom();
    if (!force && this.lastLabelZoom !== null && Math.abs(zoom - this.lastLabelZoom) < 0.012) return;
    this.lastLabelZoom = zoom;
    cy.batch(() => {
      cy.nodes().forEach((element) => {
        const record = model.nodeRecord.get(element.id());
        if (!record) return;
        element.data('labelFontSize', labelSizer.semanticSize(record, zoom, String(element.data('displayLabel') ?? '')));
      });
    });
  }

  edgeInteractionEnabled(): boolean {
    return edgeInteractionEnabled(this.options.state.edgeZoomActivation, this.options.cy.zoom());
  }

  refreshEdgeStyles(): void {
    // Ordinary edge opacity and event state are stylesheet-driven. Structure
    // overlays are rebuilt dynamically, so clear only their possible stale
    // bypasses rather than rewriting every edge in the graph.
    const structureConnections = this.options.cy.edges('[semanticConnection = 1]');
    structureConnections.removeStyle('opacity');
    structureConnections.removeStyle('events');
  }

  applyFilters({ relayout = false }: { relayout?: boolean } = {}): void {
    const { cy, model, state } = this.options;
    const activeCoreNodeIds = this.activeCoreNodeIds();
    const required = state.hidePrerequisites
      ? new Set<string>()
      : model.requiredNodeIds(
          state,
          (edge) => !model.isCrossFieldEdge(edge) || this.crossFieldEdgeAllowed(edge),
          activeCoreNodeIds
        );
    const visibility = this.resolveVisibility(required, activeCoreNodeIds);
    const visibleNodeIds = new Set<string>();
    for (const [nodeId, nodeVisibility] of visibility.nodeVisibility) {
      if (nodeVisibility !== 'hidden') visibleNodeIds.add(nodeId);
    }
    const compactVisibilityChanged = this.lastVisibleNodeIds !== null
      && !sameNodeIds(this.lastVisibleNodeIds, visibleNodeIds);
    this.lastVisibleNodeIds = visibleNodeIds;

    cy.batch(() => {
      this.clearNeighborhoodClasses();
      this.clearPrerequisiteHighlights();
      cy.elements().removeClass('filter-hidden dependency-faded dependency-context prerequisite-undimmed cross-field-edge');

      cy.nodes().forEach((element) => {
        const nodeVisibility = visibility.nodeVisibility.get(element.id()) ?? 'hidden';
        if (nodeVisibility === 'hidden') {
          element.addClass('filter-hidden');
        } else if (nodeVisibility === 'dependency-context') {
          element.addClass('dependency-faded');
        }
      });

      cy.edges().forEach((element) => {
        const record = model.edgeRecord.get(element.id());
        if (!record) {
          element.addClass('filter-hidden');
          return;
        }
        if (model.isCrossFieldEdge(record)) element.addClass('cross-field-edge');

        if (!visibility.visibleEdgeIds.has(record.id)) {
          element.addClass('filter-hidden');
        } else if (element.source().hasClass('dependency-faded') || element.target().hasClass('dependency-faded')) {
          element.addClass('dependency-context');
        }
        element.toggleClass('edge-labels-off', !state.showEdgeLabels);
      });

      if (!this.options.preferences().dimPrerequisites) {
        cy.elements('.dependency-faded, .dependency-context').addClass('prerequisite-undimmed');
      }

    });

    if (state.neighborhoodActive) this.applyNeighborhoodHighlight(false);
    this.syncSelectedPrerequisiteHighlight();
    this.updateStatus();
    this.options.scheduleFieldBands();
    this.options.updateFiltersToggleCount();
    if (relayout || (state.layout === 'breadthfirst' && compactVisibilityChanged)) {
      this.options.runLayout(state.layout, true);
    }
  }

  preservesView(view: AtlasView): boolean {
    const requiredNodeIds = viewRequiredNodeIds(view);
    if (requiredNodeIds.size === 0) return true;
    const coreIds = viewCoreNodes(view);
    const coreNodeIds = coreIds.length > 0 ? new Set(coreIds) : null;
    const visibility = this.resolveVisibility(new Set(), coreNodeIds);
    for (const nodeId of requiredNodeIds) {
      if ((visibility.nodeVisibility.get(nodeId) ?? 'hidden') === 'hidden') return false;
    }
    return true;
  }

  visibleElements(): cytoscape.CollectionReturnValue {
    return this.options.cy.elements().not('.filter-hidden').filter((element) => element.style('display') !== 'none');
  }

  fitVisible(): void {
    const visible = this.visibleElements();
    if (!visible.empty()) this.options.fitVisible(visible);
  }

  neighborhoodFor(element: cytoscape.SingularElementReturnValue): cytoscape.CollectionReturnValue {
    if (element.isNode()) return element.closedNeighborhood();
    const edge = element as cytoscape.EdgeSingular;
    return edge.union(edge.source()).union(edge.target());
  }

  syncNeighborhoodButton(): void {
    const { state } = this.options;
    const button = byId<HTMLButtonElement>('focusButton');
    const selected = this.options.selectedElement();
    const hasSelection = Boolean(selected && !selected.empty()
      && (this.options.model.nodeRecord.has(selected.id()) || this.options.model.edgeRecord.has(selected.id())));
    button.disabled = !hasSelection;
    button.setAttribute('aria-pressed', String(state.neighborhoodActive));
    button.classList.toggle('active', state.neighborhoodActive);
    button.title = !hasSelection
      ? 'Select a node or edge to highlight its immediate neighborhood'
      : state.neighborhoodActive
        ? 'Remove the neighborhood emphasis without changing the selection'
        : 'Highlight the selected item and its immediate neighbors';
  }

  applyNeighborhoodHighlight(fitAfter = false): void {
    const { cy, state } = this.options;
    if (!state.neighborhoodActive || !state.neighborhoodElementId) {
      cy.batch(() => this.clearNeighborhoodClasses());
      this.syncNeighborhoodButton();
      this.syncNeighborhoodStatusIndicator();
      return;
    }

    const selected = cy.getElementById(state.neighborhoodElementId);
    if (!selected || selected.empty() || selected.hasClass('filter-hidden') || !this.options.model.nodeRecord.has(selected.id())) {
      state.neighborhoodActive = false;
      state.neighborhoodElementId = null;
      cy.batch(() => this.clearNeighborhoodClasses());
      this.syncNeighborhoodButton();
      this.syncNeighborhoodStatusIndicator();
      return;
    }

    const neighborhood = this.neighborhoodFor(selected).not('.filter-hidden');
    cy.batch(() => this.applyNeighborhoodClasses(neighborhood));
    if (fitAfter) this.options.fitVisible(neighborhood, 90);
    this.syncNeighborhoodButton();
    this.syncNeighborhoodStatusIndicator();
  }

  setNeighborhoodHighlight(active: boolean, elementId: string | null = null, fitAfter = false): void {
    const { cy, state } = this.options;
    state.neighborhoodActive = active;
    state.neighborhoodElementId = active ? elementId : null;
    if (state.crossFieldVisibility === 'contextual') {
      this.applyFilters({ relayout: false });
      if (fitAfter && state.neighborhoodElementId) {
        const selected = cy.getElementById(state.neighborhoodElementId);
        if (selected && !selected.empty()) this.options.fitVisible(this.neighborhoodFor(selected).not('.filter-hidden'), 90);
      }
    } else {
      this.applyNeighborhoodHighlight(fitAfter);
      this.syncSelectedPrerequisiteHighlight();
    }
  }

  toggleNeighborhoodHighlight(): void {
    const selected = this.options.selectedElement();
    if (!selected || selected.empty()) return;
    const known = this.options.model.nodeRecord.has(selected.id())
      || this.options.model.edgeRecord.has(selected.id());
    if (!known) return;
    this.setNeighborhoodHighlight(!this.options.state.neighborhoodActive, selected.id(), false);
  }

  clearInteractionHighlights(): void {
    const { cy, state } = this.options;
    state.neighborhoodActive = false;
    state.neighborhoodElementId = null;
    if (state.crossFieldVisibility === 'contextual') {
      this.applyFilters({ relayout: false });
      return;
    }
    cy.batch(() => {
      this.clearNeighborhoodClasses();
      this.clearPrerequisiteHighlights();
    });
    this.syncNeighborhoodButton();
    this.syncNeighborhoodStatusIndicator();
  }

  syncSelectedPrerequisiteHighlight(): void {
    const { cy, model, state } = this.options;
    const next = cy.collection();
    const selected = this.options.selectedElement();

    if (this.options.preferences().highlightPrerequisites
      && selected && !selected.empty() && selected.isNode() && !selected.hasClass('filter-hidden')) {
      const closure = model.transitivePrerequisiteElementIds(
        [selected.id()],
        (edge) => state.selectedEdgeTypes.has(edge.type)
          && (!model.isCrossFieldEdge(edge) || this.crossFieldEdgeAllowed(edge)),
        (nodeId) => {
          const node = model.nodeRecord.get(nodeId);
          return !node || !model.nodeExcludedByTaxonomy(node, state);
        }
      );
      closure.nodeIds.delete(selected.id());
      for (const nodeId of closure.nodeIds) {
        const node = cy.getElementById(nodeId);
        if (node && !node.empty() && !node.hasClass('filter-hidden')) next.merge(node);
      }
      for (const edgeId of closure.edgeIds) {
        const edge = cy.getElementById(edgeId);
        if (edge && !edge.empty() && !edge.hasClass('filter-hidden')) next.merge(edge);
      }
    }

    const diff = this.prerequisiteHighlighted.diff(next);
    cy.batch(() => {
      diff.left.removeClass('prerequisite-highlight');
      diff.right.addClass('prerequisite-highlight');
    });
    this.prerequisiteHighlighted = next;
  }

  updateStatus(): void {
    const { cy, model, state } = this.options;
    const visibleNodes = cy.nodes().not('.filter-hidden').filter((node) => model.nodeRecord.get(node.id())?.kind === 'structure');
    if (state.layout === 'fields' || state.layout === 'domains') {
      const groups = cy.nodes('[semanticGroup = 1]');
      const connections = cy.edges('[semanticConnection = 1]');
      const relationCount = connections.reduce((sum, edge) => sum + Number(edge.data('relationCount') ?? 0), 0);
      const noun = state.layout === 'fields' ? 'fields' : 'domains';
      renderHtml(byId('status'), `
        <a href="#" id="statusFiltersLink" class="status-item status-link" title="Show filters">
          <span class="material-symbols-outlined">layers</span>
          <strong class="status-link-text">${state.selectedDomains.size} of ${model.domainOrder.length} domains</strong>
        </a>
        <span class="status-item" title="Concepts"><span class="material-symbols-outlined">auto_stories</span>${visibleNodes.length}</span>
        <span class="status-item" title="Visible ${noun}"><span class="material-symbols-outlined">hub</span>${groups.length}</span>
        <span class="status-item" title="Aggregate directed links"><span class="material-symbols-outlined">call_split</span>${connections.length}</span>
        <span class="status-item" title="Underlying directed relations"><span class="material-symbols-outlined">account_tree</span>${relationCount}</span>`);
      return;
    }
    const contextNodes = visibleNodes.filter('.dependency-faded');
    const visibleJunctions = cy.nodes().not('.filter-hidden').filter((node) => model.nodeRecord.get(node.id())?.kind === 'junction');
    const visibleEdges = cy.edges().not('.filter-hidden');
    const collapsedConstructions = new Set(
      visibleEdges.filter('[synthetic = 1]').map((edge) => edge.data('junctionId'))
    ).size;
    const contextText = contextNodes.length
      ? `<span class="status-item" title="Faded prerequisites"><span class="material-symbols-outlined">subdirectory_arrow_right</span>${contextNodes.length}</span>`
      : '';
    const junctionText = state.showJunctions
      ? `<span class="status-item" title="Visible junctions"><span class="material-symbols-outlined">change_history</span>${visibleJunctions.length}</span>`
      : `<span class="status-item" title="Collapsed constructions"><span class="material-symbols-outlined">change_history</span>${collapsedConstructions}</span>`;
    const suffix = `<span id="statusNeighborhoodIndicator" class="status-item" title="Neighborhood highlighted"${state.neighborhoodActive ? '' : ' hidden'}><span class="material-symbols-outlined">star</span></span>`;
    const crossFieldCount = visibleEdges.filter('.cross-field-edge').length;
    const crossFieldText = crossFieldCount
      ? `<span class="status-item" title="Cross-field relations"><span class="material-symbols-outlined">swap_horiz</span>${crossFieldCount}</span>`
      : '';
    renderHtml(byId('status'), `
      <a href="#" id="statusFiltersLink" class="status-item status-link" title="Show filters">
        <span class="material-symbols-outlined">layers</span>
        <strong class="status-link-text">${state.selectedDomains.size} of ${model.domainOrder.length} domains</strong>
      </a>
      <span class="status-item" title="Concepts"><span class="material-symbols-outlined">auto_stories</span>${visibleNodes.length}</span>
      ${contextText}${junctionText}
      <span class="status-item" title="Relations"><span class="material-symbols-outlined">call_split</span>${visibleEdges.length}</span>
      ${crossFieldText}${suffix}`);
  }

  private applyNeighborhoodClasses(neighborhood: cytoscape.CollectionReturnValue): void {
    const { cy } = this.options;
    if (this.neighborhoodDimmed.empty() && this.neighborhoodEmphasized.empty()) {
      const dimmed = this.visibleElements()
        .difference(neighborhood)
        .difference(cy.nodes('.search-match'));
      dimmed.addClass('neighborhood-dim');
      neighborhood.addClass('neighborhood-emphasis');
      this.neighborhoodDimmed = dimmed;
      this.neighborhoodEmphasized = neighborhood;
      return;
    }

    const diff = this.neighborhoodEmphasized.diff(neighborhood);
    const newlyDimmed = diff.left.difference(cy.nodes('.search-match'));
    diff.left.removeClass('neighborhood-emphasis');
    newlyDimmed.addClass('neighborhood-dim');
    diff.right.removeClass('neighborhood-dim').addClass('neighborhood-emphasis');
    this.neighborhoodDimmed = this.neighborhoodDimmed.union(newlyDimmed).difference(diff.right);
    this.neighborhoodEmphasized = neighborhood;
  }

  private clearNeighborhoodClasses(): void {
    this.neighborhoodDimmed.removeClass('neighborhood-dim');
    this.neighborhoodEmphasized.removeClass('neighborhood-emphasis');
    this.neighborhoodDimmed = this.options.cy.collection();
    this.neighborhoodEmphasized = this.options.cy.collection();
  }

  private clearPrerequisiteHighlights(): void {
    this.prerequisiteHighlighted.removeClass('prerequisite-highlight');
    this.prerequisiteHighlighted = this.options.cy.collection();
  }

  private syncNeighborhoodStatusIndicator(): void {
    const indicator = document.getElementById('statusNeighborhoodIndicator');
    if (indicator) indicator.hidden = !this.options.state.neighborhoodActive;
  }

  private crossFieldEdgeAllowed(record: GraphEdge): boolean {
    return isCrossFieldEdgeAllowed(record, this.options.model.isCrossFieldEdge(record), this.options.state);
  }

  private activeCoreNodeIds(): ReadonlySet<string> | null {
    const coreIds = viewCoreNodes(this.options.activeView() ?? {});
    return coreIds.length > 0 ? new Set(coreIds) : null;
  }

  private resolveVisibility(
    dependencyNodeIds: ReadonlySet<string>,
    coreNodeIds: ReadonlySet<string> | null
  ) {
    const { model, state } = this.options;
    return resolveFilterVisibility(
      model.data.nodes.map((record) => ({
        id: record.id,
        kind: record.kind,
        taxonomyVisible: (coreNodeIds ? coreNodeIds.has(record.id) : model.nodeMatchesSelectedTaxonomy(record, state))
          && !model.nodeExcludedByTaxonomy(record, state),
        dependencyVisible: dependencyNodeIds.has(record.id)
      })),
      model.allEdges,
      {
        showJunctions: state.showJunctions,
        hideIsolates: state.hideIsolates,
        edgeAllowed: (edge) => state.selectedEdgeTypes.has(edge.type) && this.crossFieldEdgeAllowed(edge)
      }
    );
  }
}

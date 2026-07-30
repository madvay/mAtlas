import type cytoscape from 'cytoscape';
import { byId, escapeHtml, query as $, queryAll as $$ } from '../core/dom.js';
import { GraphModel } from '../model/graph-model.js';
import { createInitialState, readUrlUiStateFromLocation, resolveUrlUiState, sameIdSet } from '../state/ui-state.js';
import { DEFAULT_PREFERENCES, parsePreferences, PREFERENCES_STORAGE_KEY } from '../state/preferences.js';
import { stateMatchesView } from '../state/view-state.js';
import { LabelSizer } from '../graph/label-sizer.js';
import { applyRendererPreferences, createGraph } from '../graph/create-graph.js';
import { LayoutManager } from '../graph/layout-manager.js';
import { GraphViewController } from '../graph/graph-view-controller.js';
import { GraphMathLabelLayer } from '../graph/graph-math-label-layer.js';
import { IdleRenderController } from '../graph/idle-render-controller.js';
import { MathRenderer } from '../ui/math-renderer.js';
import { DetailsController } from '../ui/details-controller.js';
import { SvgExporter } from '../ui/svg-exporter.js';
import { FieldBandController } from '../ui/field-band-controller.js';
import { PanelController } from '../ui/panel-controller.js';
import { TooltipController } from '../ui/tooltip-controller.js';
import { FilterControls } from '../ui/filter-controls.js';
import { ViewsController } from '../ui/views-controller.js';
import { LocationController } from './location-controller.js';
import type { AppState, AtlasViewsData, GraphData, GraphNode, HistoryMode, LayoutName, Preferences, SelectionTarget, ShareCodecConfig, UrlUiState } from '../types.js';
import { renderHtml } from '../ui/render.js';
import { rankNodeMatches } from '../core/search.js';
import { fetchAtlasJson } from './data-loader.js';

export async function startAtlasApp(): Promise<void> {
  'use strict';

  const graphDataUrl = new URL(__GRAPH_DATA_URL__, document.baseURI).toString();
  const viewsDataUrl = new URL(__VIEWS_DATA_URL__, document.baseURI).toString();
  const shareCodecUrl = new URL(__SHARE_CODEC_URL__, document.baseURI).toString();
  const [graphData, viewsData, shareCodec] = await Promise.all([
    fetchAtlasJson<GraphData>(graphDataUrl, 'graph data'),
    fetchAtlasJson<AtlasViewsData>(viewsDataUrl, 'views data'),
    fetchAtlasJson<ShareCodecConfig>(shareCodecUrl, 'share codec')
  ]);
  const viewsById = new Map(viewsData.views.map((view) => [view.id, view]));
  const graphEl = document.getElementById('graph');
  if (!(graphEl instanceof HTMLElement)) throw new Error('Missing #graph element.');

  const model = new GraphModel(graphData);
  const { fieldOrder, domainOrder, edgeTypeOrder, defaultEdgeTypeIds } = model;
  const staticAtlasSvgMode = new URL(window.location.href).searchParams.get('__staticAtlasSvg') === '1'
    || document.querySelector('meta[name="atlas:static-svg-build"][content="1"]') !== null;
  const nodeRecord = model.nodeRecord;
  const nodeFieldIds = (node: GraphNode): string[] => model.nodeFieldIds(node);
  const nodeDomainLabels = (node: GraphNode): string[] => model.nodeDomainLabels(node);
  const nodeFieldLabels = (node: GraphNode): string[] => model.nodeFieldLabels(node);
  const knownStateIds = {
    fieldIds: model.knownFieldIds,
    domainIds: model.knownDomainIds,
    edgeTypeIds: model.knownEdgeTypeIds
  };
  let state: AppState;
  const locationController = new LocationController({
    model,
    getState: () => state,
    views: viewsById,
    fieldOrder,
    domainOrder,
    edgeTypeOrder,
    shareCodec
  });
  const scopedDefaultFieldIds = locationController.scopedDefaultFieldIds();
  const scopedDefaultDomainIds = locationController.scopedDefaultDomainIds();
  const initialView = locationController.resolveViewFromLocation({ includeTemplate: true });

  function readPreferences(): Preferences {
    try {
      return parsePreferences(window.localStorage.getItem(PREFERENCES_STORAGE_KEY));
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  function writePreferences(): void {
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Storage can be unavailable; preference changes should still work for this session.
    }
  }


  let preferences = staticAtlasSvgMode ? { ...DEFAULT_PREFERENCES } : readPreferences();
  const loadedUrlUiState: UrlUiState | null = staticAtlasSvgMode
    ? {
        fields: fieldOrder,
        domains: domainOrder,
        edgeTypes: defaultEdgeTypeIds,
        excludedFields: [],
        excludedDomains: [],
        crossFieldVisibility: 'all',
        showPrimaryOnly: false,
        hideIsolates: false,
        edgeLabels: true,
        junctions: true,
        edgeZoomActivation: false,
        hidePrerequisites: false,
        layout: 'atlas'
      }
    : readUrlUiStateFromLocation(window.location, knownStateIds, shareCodec);
  if (loadedUrlUiState === null) return;
  const urlUiState = loadedUrlUiState;
  const conceptPageDefaults = locationController.conceptPageDefaultTaxonomy();
  const viewDefaults = initialView?.settings;

  state = createInitialState(urlUiState, {
    fields: viewDefaults?.fields ?? conceptPageDefaults?.fields ?? scopedDefaultFieldIds,
    domains: viewDefaults?.domains ?? conceptPageDefaults?.domains ?? scopedDefaultDomainIds,
    edgeTypes: viewDefaults?.edgeTypes ?? defaultEdgeTypeIds,
    excludedFields: viewDefaults?.excludedFields,
    excludedDomains: viewDefaults?.excludedDomains,
    crossFieldVisibility: viewDefaults?.crossFieldVisibility,
    showPrimaryOnly: viewDefaults?.showPrimaryOnly,
    hideIsolates: viewDefaults?.hideIsolates,
    edgeLabels: viewDefaults?.edgeLabels,
    junctions: viewDefaults?.junctions,
    edgeZoomActivation: viewDefaults?.edgeZoomActivation,
    hidePrerequisites: viewDefaults?.hidePrerequisites,
    layout: viewDefaults?.layout
  });
  if (initialView && stateMatchesView(state, initialView)) locationController.setActiveView(initialView.id);

  let viewsController: ViewsController | null = null;
  let currentSelectionTarget = (): SelectionTarget | null => locationController.parseSelection();

  function persistUiState(): void {
    const activeView = locationController.activeView();
    if (activeView && !stateMatchesView(state, activeView)) locationController.deactivateView();
    const selection = currentSelectionTarget();
    locationController.write(selection, 'replace');
    locationController.syncDocumentMetadata(selection);
    viewsController?.syncActiveView();
  }

  const labelSizer = new LabelSizer();
  const mathRenderer = new MathRenderer();
  const renderMathText = (value: unknown): string => mathRenderer.renderText(value);

  const cy = createGraph(graphEl, model, labelSizer, preferences);
  new IdleRenderController(cy, graphEl);
  const graphLabelLayer = new GraphMathLabelLayer(cy, graphEl, mathRenderer, preferences);
  window.cy = cy;
  currentSelectionTarget = () => {
    const selected = cy.$(':selected').first();
    if (selected && !selected.empty()) return { kind: selected.isNode() ? 'node' : 'edge', id: selected.id() };
    return locationController.parseSelection();
  };


  const panelController = new PanelController({
    cy,
    state,
    domainCount: domainOrder.length,
    onPanelStateChange: () => viewsController?.syncPresentation()
  });
  const fieldBandController = new FieldBandController({
    cy,
    model,
    state,
    isMobileLayout: () => panelController.isMobileLayout()
  });
  const scheduleFieldBands = (): void => fieldBandController.schedule();
  const isMobileLayout = (): boolean => panelController.isMobileLayout();
  const syncPanelUi = (): void => panelController.sync();
  const setPanelOpen = (panel: 'filters' | 'details', open: boolean): void => panelController.setOpen(panel, open);
  const togglePanel = (panel: 'filters' | 'details'): void => panelController.toggle(panel);
  const toggleMaximizedGraph = (): void => panelController.toggleMaximized();
  const openDetailsPanel = (): void => panelController.openDetails();
  const updateFiltersToggleCount = (): void => panelController.updateFiltersToggleCount();

  const layoutManager = new LayoutManager({
    cy,
    model,
    state,
    onStateChange: persistUiState,
    onLayoutSettled: scheduleFieldBands
  });

  function runLayout(name: LayoutName = state.layout, fitAfter = true): void {
    layoutManager.run(name, fitAfter);
  }

  const graphView = new GraphViewController({
    cy,
    model,
    state,
    labelSizer,
    runLayout,
    scheduleFieldBands,
    updateFiltersToggleCount,
    preferences: () => preferences
  });
  const updateSemanticLabelSizes = (force = false): void => graphView.updateSemanticLabelSizes(force);
  const scheduleEdgeZoomStyles = (): void => graphView.scheduleEdgeZoomStyles();
  const applyFilters = (options: { relayout?: boolean } = {}): void => graphView.applyFilters(options);
  const visibleGraphElements = (): cytoscape.CollectionReturnValue => graphView.visibleElements();
  const fitVisibleGraph = (): void => graphView.fitVisible();
  const syncNeighborhoodButton = (): void => graphView.syncNeighborhoodButton();
  const setNeighborhoodHighlight = (active: boolean, elementId: string | null = null, fitAfter = false): void =>
    graphView.setNeighborhoodHighlight(active, elementId, fitAfter);
  const toggleNeighborhoodHighlight = (): void => graphView.toggleNeighborhoodHighlight();

  const filterControls = new FilterControls({
    model,
    state,
    fieldPageUrl: (fieldId) => locationController.fieldPageUrl(fieldId),
    domainPageUrl: (domainId) => locationController.domainPageUrl(domainId),
    persist: persistUiState,
    applyFilters,
    runLayout,
    scheduleEdgeZoomStyles,
    preferences: () => preferences,
    setPreferences: (next) => {
      preferences = next;
      writePreferences();
      applyRendererPreferences(cy, preferences);
      graphLabelLayer.setPreferences(preferences);
      graphView.applyFilters({ relayout: false });
    }
  });
  const buildFilters = (): void => filterControls.build();
  const syncPreferenceControls = (): void => filterControls.syncPreferences();
  const updateFieldNavActiveState = (): void => filterControls.updateFieldNavActiveState();

  const parseSelectionLocation = (options: { includeTemplateSelection?: boolean } = {}): SelectionTarget | null =>
    locationController.parseSelection(options);
  const writeLocationState = (target: SelectionTarget | null, mode: Exclude<HistoryMode, null> = 'replace'): void =>
    locationController.write(target, mode);
  const syncDocumentMetadata = (target: SelectionTarget | null): void => locationController.syncDocumentMetadata(target);

  const detailsController = new DetailsController({
    model,
    cy,
    math: mathRenderer,
    conceptPageUrl: (nodeId) => locationController.conceptPageUrl(nodeId),
    fieldPageUrl: (fieldId) => locationController.fieldPageUrl(fieldId),
    domainPageUrl: (domainId) => locationController.domainPageUrl(domainId),
    itemUrl: (itemId, itemKind) => locationController.itemUrl(itemId, itemKind),
    permalinkUrl: (itemId, itemKind) => locationController.itemUrl(itemId, itemKind),
    githubEditUrl: (itemId) => locationController.githubEditUrl(itemId),
    views: viewsData.views,
    viewNodeUrl: (viewId, nodeId) => locationController.viewNodeUrl(viewId, nodeId),
    activateNode: (id) => { activateNode(id, { center: true, zoomIn: true, historyMode: 'push' }); },
    activateEdge: (id) => { activateEdge(id, { center: true, zoomIn: true, historyMode: 'push' }); },
    openPanel: openDetailsPanel,
    navigate: (href) => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) {
        window.location.assign(url.toString());
        return;
      }
      try {
        window.history.pushState({ selection: null, uiStateVersion: 1, viewId: locationController.activeView()?.id ?? null }, '', url.href);
      } catch {
        window.location.assign(url.toString());
        return;
      }
      applyLocationState({ initial: false });
    }
  });

  function showNodeDetails(id: string): void {
    detailsController.showNode(id);
  }

  function showEdgeDetails(id: string): void {
    detailsController.showEdge(id);
  }

  function showEmptyDetails(): void {
    detailsController.showEmpty();
    syncDocumentMetadata(null);
  }

  function ensureNodeVisible(id: string): void {
    const element = cy.getElementById(id);
    if (!element || element.empty() || !element.hasClass('filter-hidden')) return;
    const record = nodeRecord.get(id);
    if (!record) return;
    for (const fieldId of nodeFieldIds(record)) state.selectedFields.add(fieldId);
    state.selectedDomains.add(record.primaryDomain);
    state.excludedFields.delete(model.nodePrimaryField(record));
    state.excludedDomains.delete(record.primaryDomain);
    $<HTMLButtonElement>(`[data-exclude-field="${CSS.escape(model.nodePrimaryField(record))}"]`)?.setAttribute('aria-pressed', 'false');
    $<HTMLButtonElement>(`[data-exclude-domain="${CSS.escape(record.primaryDomain)}"]`)?.setAttribute('aria-pressed', 'false');
    $$<HTMLInputElement>('[data-field]').forEach((input) => { input.checked = state.selectedFields.has(input.dataset.field ?? ''); });
    const checkbox = $<HTMLInputElement>(`[data-domain="${CSS.escape(record.primaryDomain)}"]`);
    if (checkbox) checkbox.checked = true;
    if (record.kind === 'junction') {
      state.showJunctions = true;
      byId<HTMLInputElement>('junctionsToggle').checked = true;
    }
    persistUiState();
    applyFilters({ relayout: false });
  }

  const getDetailsPanelYOffset = (): number => panelController.detailsPanelYOffset();

  function animateElementCenter(element: cytoscape.CollectionReturnValue, targetZoom: number, pointer?: { x: number; y: number }, duration = 260): void {
    const offsetY = getDetailsPanelYOffset();
    const worldPos = element.position();
    if (pointer) {
      const targetPan = {
        x: pointer.x - worldPos.x * targetZoom,
        y: pointer.y - worldPos.y * targetZoom
      };
      cy.animate({ zoom: targetZoom, pan: targetPan }, { duration });
      return;
    }

    const viewportWidth = cy.width();
    const viewportHeight = cy.height();
    const targetPan = {
      x: viewportWidth / 2 - worldPos.x * targetZoom,
      y: viewportHeight / 2 - offsetY - worldPos.y * targetZoom
    };
    cy.animate({ zoom: targetZoom, pan: targetPan }, { duration });
  }

  function animateElementCenterCurrentZoom(element: cytoscape.CollectionReturnValue, pointer?: { x: number; y: number }, duration = 220): void {
    const targetZoom = cy.zoom();
    animateElementCenter(element, targetZoom, pointer, duration);
  }

  function activateNode(id: string, {
    center = false,
    zoomIn = false,
    pointer,
    historyMode = 'push'
  }: { center?: boolean; zoomIn?: boolean; pointer?: { x: number; y: number }; historyMode?: HistoryMode } = {}): boolean {
    const element = cy.getElementById(id);
    if (!element || element.empty()) return false;
    // A second details-panel navigation must replace, rather than queue behind,
    // any viewport animation that is still settling from the previous link.
    cy.stop(true, false);
    ensureNodeVisible(id);
    cy.$(':selected').unselect();
    element.select();
    setNeighborhoodHighlight(true, id, false);
    showNodeDetails(id);
    viewsController?.syncSelection({ kind: 'node', id });
    syncDocumentMetadata({ kind: 'node', id });
    if (historyMode) writeLocationState({ kind: 'node', id }, historyMode);

    if (center) {
      if (zoomIn) {
        const targetZoom = Math.min(1.1, Math.max(cy.zoom(), 0.78));
        animateElementCenter(element, targetZoom, pointer, 260);
      } else {
        animateElementCenterCurrentZoom(element, pointer, 220);
      }
    }
    return true;
  }

  function activateEdge(id: string, {
    center = false,
    zoomIn = false,
    historyMode = 'push'
  }: { center?: boolean; zoomIn?: boolean; pointer?: { x: number; y: number }; historyMode?: HistoryMode } = {}): boolean {
    const element = cy.getElementById(id);
    if (!element || element.empty()) return false;
    cy.stop(true, false);
    cy.$(':selected').unselect();
    element.select();
    setNeighborhoodHighlight(true, id, false);
    showEdgeDetails(id);
    viewsController?.syncSelection({ kind: 'edge', id });
    syncDocumentMetadata({ kind: 'edge', id });
    if (historyMode) writeLocationState({ kind: 'edge', id }, historyMode);
    if (center) {
      if (zoomIn) {
        const targetZoom = Math.min(1.1, Math.max(cy.zoom(), 0.78));
        cy.animate({ center: { eles: element }, zoom: targetZoom }, { duration: 260 });
      } else {
        cy.animate({ center: { eles: element } }, { duration: 220 });
      }
    }
    return true;
  }

  function clearSelection({ historyMode = 'push' }: { historyMode?: HistoryMode } = {}): void {
    cy.$(':selected').unselect();
    setNeighborhoodHighlight(false, null, false);
    showEmptyDetails();
    viewsController?.syncSelection(null);
    if (historyMode) writeLocationState(null, historyMode);
  }

  function selectAndCenter(id: string): void {
    activateNode(id, { center: true, zoomIn: true, historyMode: 'push' });
  }

  function applySelectionFromLocation({ initial = false }: { initial?: boolean } = {}): void {
    const target = parseSelectionLocation({ includeTemplateSelection: initial });
    const selected = cy.$(':selected').first();

    if (!target) {
      if (selected && !selected.empty()) clearSelection({ historyMode: null });
      if (initial) showEmptyDetails();
      return;
    }

    const alreadySelected = selected && !selected.empty()
      && selected.id() === target.id
      && ((target.kind === 'node' && selected.isNode()) || (target.kind === 'edge' && selected.isEdge()));
    if (alreadySelected) return;

    if (target.kind === 'node') {
      activateNode(target.id, { center: true, zoomIn: true, historyMode: null });
    } else {
      activateEdge(target.id, { center: true, historyMode: null });
    }
  }

  function applyUiStateFromLocation(): void {
    const routeView = locationController.resolveViewFromLocation();
    const routeTaxonomy = locationController.taxonomyDefaultsFromLocation();
    const routeConceptDefaults = locationController.conceptPageDefaultTaxonomy();
    const urlState = readUrlUiStateFromLocation(window.location, knownStateIds, shareCodec);
    if (urlState === null) return;
    const viewDefaults = routeView?.settings;
    const next = resolveUrlUiState(urlState, {
      fields: viewDefaults?.fields ?? routeConceptDefaults?.fields ?? routeTaxonomy.fields ?? fieldOrder,
      domains: viewDefaults?.domains ?? routeConceptDefaults?.domains ?? routeTaxonomy.domains ?? domainOrder,
      edgeTypes: viewDefaults?.edgeTypes ?? defaultEdgeTypeIds,
      excludedFields: viewDefaults?.excludedFields,
      excludedDomains: viewDefaults?.excludedDomains,
      crossFieldVisibility: viewDefaults?.crossFieldVisibility,
      showPrimaryOnly: viewDefaults?.showPrimaryOnly,
      hideIsolates: viewDefaults?.hideIsolates,
      edgeLabels: viewDefaults?.edgeLabels,
      junctions: viewDefaults?.junctions,
      edgeZoomActivation: viewDefaults?.edgeZoomActivation,
      hidePrerequisites: viewDefaults?.hidePrerequisites,
      layout: viewDefaults?.layout
    });
    locationController.setActiveView(routeView?.id ?? null);

    const fieldsChanged = !sameIdSet(state.selectedFields, next.fields);
    const domainsChanged = !sameIdSet(state.selectedDomains, next.domains);
    const edgeTypesChanged = !sameIdSet(state.selectedEdgeTypes, next.edgeTypes);
    const excludedFieldsChanged = !sameIdSet(state.excludedFields, next.excludedFields);
    const excludedDomainsChanged = !sameIdSet(state.excludedDomains, next.excludedDomains);
    const crossFieldChanged = state.crossFieldVisibility !== next.crossFieldVisibility;
    const showPrimaryOnlyChanged = state.showPrimaryOnly !== next.showPrimaryOnly;
    const hideIsolatesChanged = state.hideIsolates !== next.hideIsolates;
    const edgeLabelsChanged = state.showEdgeLabels !== next.edgeLabels;
    const junctionsChanged = state.showJunctions !== next.junctions;
    const edgeZoomChanged = state.edgeZoomActivation !== next.edgeZoomActivation;
    const hidePrerequisitesChanged = state.hidePrerequisites !== next.hidePrerequisites;
    const layoutChanged = state.layout !== next.layout;

    if (!fieldsChanged && !domainsChanged && !edgeTypesChanged && !excludedFieldsChanged && !excludedDomainsChanged
      && !crossFieldChanged && !showPrimaryOnlyChanged && !hideIsolatesChanged && !edgeLabelsChanged
      && !junctionsChanged && !edgeZoomChanged && !hidePrerequisitesChanged && !layoutChanged) {
      if (routeView && !stateMatchesView(state, routeView)) locationController.deactivateView();
      viewsController?.syncActiveView();
      return;
    }

    state.selectedFields = new Set(next.fields);
    state.selectedDomains = new Set(next.domains);
    state.selectedEdgeTypes = new Set(next.edgeTypes);
    state.excludedFields = new Set(next.excludedFields);
    state.excludedDomains = new Set(next.excludedDomains);
    state.crossFieldVisibility = next.crossFieldVisibility;
    state.showPrimaryOnly = next.showPrimaryOnly;
    state.hideIsolates = next.hideIsolates;
    state.showEdgeLabels = next.edgeLabels;
    state.showJunctions = next.junctions;
    state.edgeZoomActivation = next.edgeZoomActivation;
    state.hidePrerequisites = next.hidePrerequisites;
    state.layout = next.layout;

    buildFilters();
    syncPreferenceControls();
    updateFieldNavActiveState();
    if (routeView && !stateMatchesView(state, routeView)) locationController.deactivateView();
    applyFilters({ relayout: fieldsChanged || domainsChanged || excludedFieldsChanged || excludedDomainsChanged
      || showPrimaryOnlyChanged || hideIsolatesChanged || junctionsChanged || edgeZoomChanged
      || hidePrerequisitesChanged || layoutChanged });
    viewsController?.syncActiveView();
  }

  function applyLocationState({ initial = false } = {}): void {
    if (!initial) applyUiStateFromLocation();
    const target = parseSelectionLocation({ includeTemplateSelection: initial });
    writeLocationState(target, 'replace');
    applySelectionFromLocation({ initial });
    syncDocumentMetadata(target);
    viewsController?.syncActiveView();
  }

  function clearSearch(clearInput = false): void {
    state.searchQuery = '';
    cy.elements().removeClass('search-match');
    if (clearInput) byId<HTMLInputElement>('searchInput').value = '';
  }

  function performSearch(): void {
    const raw = byId<HTMLInputElement>('searchInput').value.trim();
    clearSearch();
    if (!raw) return;
    state.searchQuery = raw.toLocaleLowerCase();
    const rankedMatches = rankNodeMatches(graphData.nodes, raw, (node) => ({
      fieldLabels: nodeFieldLabels(node),
      domainLabels: nodeDomainLabels(node)
    }));
    const matches = rankedMatches.map((match) => match.node);
    if (!matches.length) {
      byId('status').textContent = `No concept matches “${raw}”.`;
      return;
    }
    const matchIds = new Set(matches.map((node) => node.id));
    cy.nodes().filter((node) => matchIds.has(node.id())).addClass('search-match');
    const exact = matches[0];
    if (!exact) return;
    selectAndCenter(exact.id);
    byId('status').textContent = `${matches.length} search match${matches.length === 1 ? '' : 'es'} for “${raw}”.`;
  }

  const tooltipController = new TooltipController();
  const showTooltip = (html: string, event: cytoscape.EventObject | MouseEvent): void => tooltipController.show(html, event);
  const positionTooltip = (event: cytoscape.EventObject | MouseEvent): void => tooltipController.position(event);

  function clearHover(): void {
    tooltipController.hide();
  }

  function buildHelp(): void {
    const activeTypes = edgeTypeOrder.filter((id) => graphData.edgeTypes[id]?.activeInDataset !== false);
    renderHtml(byId('helpContent'), `
      <p><strong>Vertical direction is meaningful:</strong> the graph begins with minimally structured carriers, especially <em>Set</em>, and generally moves downward as data or axioms are added. Horizontal placement only groups fields.</p>
      <p>Drag to pan · wheel/pinch to zoom · click an item to highlight its neighbors · click blank space to clear</p>
      <div class="edge-explainer">
        ${activeTypes.map((id) => {
          const type = graphData.edgeTypes[id];
          if (!type) return '';
          return `<div><span class="line-swatch ${escapeHtml(type.lineStyle || 'solid')}" style="display:inline-block;border-color:${escapeHtml(type.color)}"></span> <strong>${escapeHtml(type.label)}</strong></div><div>${escapeHtml(type.description)}</div>`;
        }).join('')}
      </div>
      <h3>Domain filtering</h3>
      <p>A structure may belong to several domains without being duplicated. Its full fill color and horizontal lane use its primary domain; colored dots at the bottom right mark its additional domains, with the complete list in its tooltip and details. A node remains fully visible when any of its domains is enabled. Turning off all of its domains hides it unless it is transitively required by another visible structure, in which case it remains as 50% faded context.</p>
      <h3>Construction diamonds</h3>
      <p>A diamond means the result is not obtained by merely adding one axiom to one existing object. Several structures must coexist and satisfy compatibility laws. When diamonds are hidden, each construction is contracted into dashed direct edges from its inputs to its output. Labels beginning with <strong>jointly</strong> mean all of those incoming edges are required together—an AND, not a choice.</p>
      <h3>Search, fit, and neighborhood highlighting</h3>
      <p><strong>Search</strong> marks every matching structure and selects the best match without removing anything from the graph. <strong>Fit</strong> changes only the viewport so every structure allowed by the current filters fits on screen. Selecting a node or edge highlights its immediate neighborhood; <strong>Clear highlight</strong>, or a click on blank graph space, removes that emphasis. Neighborhood highlighting never hides graph elements. The optional <strong>Highlight selected-node prerequisites</strong> preference marks the selected node’s filtered prerequisite closure in light blue using the currently enabled relation types.</p>
      <h3>Panels and maximized graph</h3>
      <p>The atlas starts with both sidebars hidden. Use the filter icon and details icon, or the slim tabs at the graph edges, to animate either sidebar in or out. Selecting a node or edge reopens Details. The fullscreen icon hides both sidebars and remembers their prior state.</p>
      <h3>SVG export</h3>
      <p><strong>SVG</strong> downloads the current filtered graph as a standalone vector document, including curved edges, annotations, multi-domain markers, neighborhood emphasis, and the current selection. It can be opened in a browser or vector editor and printed without rasterizing the graph.</p>
      <h3>Citations</h3>
      <p>Source abbreviations on nodes are off initially to reduce clutter. Enable them under Display, or click any node or edge for citation links and source titles.</p>
      <h3>Keyboard</h3>
      <p><strong>/</strong> focuses search, <strong>F</strong> fits the filtered graph, and <strong>Escape</strong> clears search or closes mobile panels.</p>`);
  }

  const svgExporter = new SvgExporter(cy, model, state, () => preferences);
  const exportVisibleSvg = (): void => svgExporter.exportVisible();
  const publishStaticSvgExporter = (): void => {
    window.__atlasStaticSvgExporter = {
      serializeVisible: () => svgExporter.serializeVisible(),
      serializePrimaryDomain: (domainId: string) => svgExporter.serializePrimaryDomain(domainId)
    };
    document.documentElement.dataset.atlasStaticSvg = 'ready';
  };

  // Controls
  filterControls.initialize();
  viewsController = new ViewsController({
    views: viewsData.views,
    activeView: () => locationController.activeView(),
    currentSelection: () => currentSelectionTarget(),
    activateNode: (nodeId) => activateNode(nodeId, { center: true, zoomIn: true, historyMode: 'push' }),
    nodeLabel: (nodeId) => nodeRecord.get(nodeId)?.label ?? nodeId,
    viewPageUrl: (viewId) => locationController.viewPageUrl(viewId),
    isMobileLayout: () => panelController.isMobileLayout(),
    detailsOpen: () => state.detailsOpen,
    math: mathRenderer
  });
  viewsController.initialize();
  buildHelp();

  byId('fitButton').addEventListener('click', fitVisibleGraph);
  byId('focusButton').addEventListener('click', toggleNeighborhoodHighlight);
  byId('searchButton').addEventListener('click', performSearch);
  byId<HTMLInputElement>('searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') performSearch();
  });
  byId<HTMLInputElement>('searchInput').addEventListener('input', (event) => {
    if (!(event.currentTarget as HTMLInputElement).value) clearSearch();
  });

  byId('helpButton').addEventListener('click', () => byId<HTMLDialogElement>('helpDialog').showModal());
  byId('filtersToggle').addEventListener('click', () => togglePanel('filters'));
  byId('detailsToggle').addEventListener('click', () => togglePanel('details'));
  byId('filtersRailToggle').addEventListener('click', () => togglePanel('filters'));
  byId('detailsRailToggle').addEventListener('click', () => togglePanel('details'));
  byId('maximizeButton').addEventListener('click', toggleMaximizedGraph);
  byId('exportSvgButton').addEventListener('click', exportVisibleSvg);
  byId('detailsClose').addEventListener('click', () => setPanelOpen('details', false));

  document.addEventListener('keydown', (event) => {
    const targetTag = event.target instanceof Element ? event.target.tagName.toLowerCase() : '';
    const typing = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';
    if (event.key === '/' && !typing) {
      event.preventDefault();
      byId<HTMLInputElement>('searchInput').focus();
    } else if ((event.key === 'f' || event.key === 'F') && !typing) {
      fitVisibleGraph();
    } else if (event.key === 'Escape') {
      if (isMobileLayout()) {
        state.filtersOpen = false;
        state.detailsOpen = false;
        syncPanelUi();
      }
      if (state.searchQuery || byId<HTMLInputElement>('searchInput').value) {
        byId<HTMLInputElement>('searchInput').value = '';
        clearSearch();
      }
    }
  });

  // Graph interactions
  cy.on('tap', 'node', (event) => {
    activateNode((event.target as cytoscape.SingularElementReturnValue).id(), { center: false, historyMode: 'push' });
  });
  cy.on('tap', 'edge', (event) => {
    activateEdge((event.target as cytoscape.SingularElementReturnValue).id(), { center: false, historyMode: 'push' });
  });
  cy.on('dbltap', 'node', (event) => {
    const pointer = { x: event.renderedPosition.x, y: event.renderedPosition.y };
    activateNode((event.target as cytoscape.SingularElementReturnValue).id(), { center: true, zoomIn: true, pointer, historyMode: 'push' });
  });
  cy.on('dbltap', 'edge', (event) => {
    const pointer = { x: event.renderedPosition.x, y: event.renderedPosition.y };
    activateEdge((event.target as cytoscape.SingularElementReturnValue).id(), { center: true, zoomIn: true, pointer, historyMode: 'push' });
  });
  cy.on('tap', (event) => {
    if (event.target !== cy) return;
    clearSelection({ historyMode: 'push' });
    clearSearch(true);
    setPanelOpen('details', false);
  });
  byId('status').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#statusFiltersLink')) {
      event.preventDefault();
      setPanelOpen('filters', true);
    }
  });
  cy.on('zoom', () => {
    scheduleFieldBands();
    scheduleEdgeZoomStyles();
  });
  cy.on('pan position', scheduleFieldBands);
  cy.on('mouseover', 'node', (event) => {
    const target = event.target as cytoscape.SingularElementReturnValue;
    const record = nodeRecord.get(target.id());
    if (!record) return;
    //highlightNeighborhood(target);
    const taxonomy = [...nodeFieldLabels(record), ...nodeDomainLabels(record)].join(' · ');
    showTooltip(`<strong>${renderMathText(record.label)}</strong><span class="muted">${escapeHtml(taxonomy)}<br>${renderMathText(record.summary)}</span>`, event);
  });
  /*cy.on('mouseover', 'edge', (event) => {
    const record = edgeRecord.get(event.target.id());
    const type = graphData.edgeTypes[record.type];
    //highlightNeighborhood(event.target);
    const mode = record.synthetic ? 'Collapsed AND-construction' : type.label;
    showTooltip(`<strong>${escapeHtml(record.label)}</strong><span class="muted">${escapeHtml(mode)} · ${escapeHtml(record.detail)}</span>`, event);
  });*/
  cy.on('mousemove', 'node', positionTooltip);
  //cy.on('mousemove', 'edge', positionTooltip);
  cy.on('mouseout', 'node', clearHover);
  //cy.on('mouseout', 'edge', clearHover);

  const graphContainer = byId('graph') as HTMLElement;
  graphContainer.addEventListener('pointerleave', clearHover);


  let locationSyncFrame = 0;
  function scheduleLocationStateSync(): void {
    if (locationSyncFrame) return;
    locationSyncFrame = window.requestAnimationFrame(() => {
      locationSyncFrame = 0;
      applyLocationState({ initial: false });
    });
  }
  window.addEventListener('hashchange', scheduleLocationStateSync);
  window.addEventListener('popstate', scheduleLocationStateSync);
  window.addEventListener('resize', () => { syncPanelUi(); scheduleFieldBands(); });

  const initialSearchQuery = new URL(window.location.href).searchParams.get('q')?.trim() ?? '';
  if (initialSearchQuery) byId<HTMLInputElement>('searchInput').value = initialSearchQuery;

  // Initial view
  syncPanelUi();
  applyFilters({ relayout: false });
  runLayout(state.layout, false);
  window.requestAnimationFrame(() => {
    const visible = visibleGraphElements();
    if (!visible.empty()) cy.fit(visible, 58);
    updateSemanticLabelSizes(true);
    if (staticAtlasSvgMode) {
      window.requestAnimationFrame(publishStaticSvgExporter);
      return;
    }
    applyLocationState({ initial: true });
    if (initialSearchQuery) performSearch();
    syncNeighborhoodButton();
    scheduleFieldBands();
    document.body.classList.remove('atlas-loading');
  });
}

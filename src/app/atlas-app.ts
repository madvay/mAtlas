import type cytoscape from 'cytoscape';
import { byId, escapeHtml, queryAll as $$ } from '../core/dom.js';
import { GraphModel } from '../model/graph-model.js';
import { readCompareStateFromLocation, type CompareState } from '../state/compare-state.js';
import { createInitialState, readUrlUiStateFromLocation, resolveUrlUiState, sameIdSet } from '../state/ui-state.js';
import { DEFAULT_PREFERENCES, parsePreferences, PREFERENCES_STORAGE_KEY } from '../state/preferences.js';
import { viewCoreNodes, viewNodeSequence } from '../state/view-state.js';
import { LabelSizer } from '../graph/label-sizer.js';
import { applyRendererPreferences, createGraph } from '../graph/create-graph.js';
import { LayoutManager } from '../graph/layout-manager.js';
import { GraphViewController } from '../graph/graph-view-controller.js';
import { GraphViewportController } from '../graph/graph-viewport-controller.js';
import { compactLayoutWouldHelp } from '../graph/layout-suggestion.js';
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
import { StructureOverlayController } from '../ui/structure-overlay-controller.js';
import { CompareController } from '../ui/compare-controller.js';
import { LocationController } from './location-controller.js';
import type { AppState, AtlasView, AtlasViewsData, GraphData, GraphNode, HistoryMode, LayoutName, Preferences, SelectionTarget, ShareCodecConfig, UrlUiState } from '../types.js';
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
  let compareState: CompareState | null = readCompareStateFromLocation(window.location, model.nodeRecord);
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
    shareCodec,
    getCompareState: () => compareState
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
        prohibitedDomains: [],
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
  const viewDefaults = initialView ? locationController.viewDefaults(initialView) : null;

  state = createInitialState(urlUiState, {
    fields: viewDefaults?.fields ?? conceptPageDefaults?.fields ?? scopedDefaultFieldIds,
    domains: viewDefaults?.domains ?? conceptPageDefaults?.domains ?? scopedDefaultDomainIds,
    edgeTypes: viewDefaults?.edgeTypes ?? defaultEdgeTypeIds,
    excludedFields: viewDefaults?.excludedFields,
    excludedDomains: viewDefaults?.excludedDomains,
    prohibitedDomains: viewDefaults?.prohibitedDomains,
    crossFieldVisibility: viewDefaults?.crossFieldVisibility,
    showPrimaryOnly: viewDefaults?.showPrimaryOnly,
    hideIsolates: viewDefaults?.hideIsolates,
    edgeLabels: viewDefaults?.edgeLabels,
    junctions: viewDefaults?.junctions,
    edgeZoomActivation: viewDefaults?.edgeZoomActivation,
    hidePrerequisites: viewDefaults?.hidePrerequisites,
    layout: viewDefaults?.layout
  });
  if (initialView) locationController.setActiveView(initialView.id);

  let viewsController: ViewsController | null = null;
  let comparisonController: CompareController | null = null;
  let graphViewPreservesView = (_view: AtlasView): boolean => true;
  let syncFilterViewScope = (): void => {};
  let currentSelectionTarget = (): SelectionTarget | null => locationController.parseSelection();

  function persistUiState(): void {
    const activeView = locationController.activeView();
    if (activeView && !graphViewPreservesView(activeView)) locationController.deactivateView();
    const selection = currentSelectionTarget();
    locationController.write(selection, 'replace');
    locationController.syncDocumentMetadata(selection);
    viewsController?.syncActiveView();
    scheduleLayoutUiUpdate();
    syncFilterViewScope();
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
    if (selected && !selected.empty()) {
      if (selected.isNode() && model.nodeRecord.has(selected.id())) return { kind: 'node', id: selected.id() };
      if (selected.isEdge() && model.edgeRecord.has(selected.id())) return { kind: 'edge', id: selected.id() };
    }
    return locationController.parseSelection();
  };


  const panelController = new PanelController({
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
  const viewportController = new GraphViewportController({
    cy,
    state,
    viewportInsets: () => panelController.viewportInsets()
  });
  const fitGraphElements = (elements: cytoscape.CollectionReturnValue, padding?: number): void => viewportController.fit(elements, padding);

  let layoutUiFrame = 0;
  function syncLayoutToolbar(): void {
    $$<HTMLButtonElement>('[data-toolbar-layout]').forEach((button) => {
      const active = button.dataset.toolbarLayout === state.layout;
      button.setAttribute('aria-pressed', String(active));
    });
    byId<HTMLSelectElement>('layoutSelect').value = state.layout;
  }

  function syncExperimentalToolbarButtons(): void {
    const showExperimental = preferences.experimentalFeatures;
    const compareButton = document.getElementById('compareButton');
    if (compareButton) compareButton.hidden = !showExperimental;
  }

  function updateCompactLayoutSuggestion(): void {
    const compactButton = byId<HTMLButtonElement>('compactLayoutButton');
    let helpful = false;
    if (state.layout === 'atlas' && !locationController.activeView() && !panelController.isMobileLayout()) {
      const visibleNodes = cy.nodes().not('.filter-hidden').filter((element) =>
        model.nodeRecord.get(element.id())?.kind === 'structure');
      if (!visibleNodes.empty()) {
        const levelCounts = new Map<number, number>();
        visibleNodes.forEach((element) => {
          const level = model.nodeRecord.get(element.id())?.level;
          if (level !== undefined) levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
        });
        const box = visibleNodes.boundingBox({ includeLabels: true, includeOverlays: false, includeUnderlays: false });
        helpful = compactLayoutWouldHelp({
          width: box.w,
          height: box.h,
          nodeCount: visibleNodes.length,
          levelCounts: [...levelCounts.values()]
        });
      }
    }
    compactButton.classList.toggle('compact-layout-suggested', helpful);
    compactButton.title = helpful
      ? 'Compact layout may use this wide, sparse space more efficiently'
      : 'Compact layout';
  }

  function scheduleLayoutUiUpdate(): void {
    if (layoutUiFrame) return;
    layoutUiFrame = window.requestAnimationFrame(() => {
      layoutUiFrame = 0;
      syncLayoutToolbar();
      updateCompactLayoutSuggestion();
    });
  }

  let structureOverlayController: StructureOverlayController | null = null;
  let updateGraphStatus = (): void => {};

  const layoutManager = new LayoutManager({
    cy,
    model,
    state,
    onStateChange: persistUiState,
    onLayoutPrepared: () => structureOverlayController?.refresh(),
    onLayoutSettled: () => {
      scheduleFieldBands();
      scheduleLayoutUiUpdate();
    },
    fitVisible: fitGraphElements
  });

  function runLayout(name: LayoutName = state.layout, fitAfter = true): void {
    layoutManager.run(name, fitAfter);
    updateGraphStatus();
  }

  const graphView = new GraphViewController({
    cy,
    model,
    state,
    labelSizer,
    runLayout,
    fitVisible: fitGraphElements,
    scheduleFieldBands,
    updateFiltersToggleCount,
    preferences: () => preferences,
    activeView: () => locationController.activeView()
  });
  graphViewPreservesView = (view) => graphView.preservesView(view);
  updateGraphStatus = () => graphView.updateStatus();
  const updateSemanticLabelSizes = (force = false): void => graphView.updateSemanticLabelSizes(force);
  const scheduleEdgeZoomStyles = (): void => graphView.scheduleEdgeZoomStyles();
  const applyFilters = (options: { relayout?: boolean } = {}): void => {
    graphView.applyFilters(options);
    structureOverlayController?.refresh();
    graphView.updateStatus();
    comparisonController?.refresh();
    scheduleLayoutUiUpdate();
  };
  const visibleGraphElements = (): cytoscape.CollectionReturnValue => graphView.visibleElements();
  const fitVisibleGraph = (): void => graphView.fitVisible();
  const syncNeighborhoodButton = (): void => graphView.syncNeighborhoodButton();
  const setNeighborhoodHighlight = (active: boolean, elementId: string | null = null, fitAfter = false): void =>
    graphView.setNeighborhoodHighlight(active, elementId, fitAfter);
  const toggleNeighborhoodHighlight = (): void => graphView.toggleNeighborhoodHighlight();

  let exitActiveView = (): void => {};
  let exitActiveCoreNodeScope = (): void => {};

  const filterControls = new FilterControls({
    model,
    state,
    fieldPageUrl: (fieldId) => locationController.fieldPageUrl(fieldId),
    domainPageUrl: (domainId) => locationController.domainPageUrl(domainId),
    persist: persistUiState,
    applyFilters,
    runLayout,
    scheduleEdgeZoomStyles,
    activeView: () => locationController.activeView(),
    exitView: () => exitActiveView(),
    exitCoreNodeScope: () => exitActiveCoreNodeScope(),
    renderMathText,
    preferences: () => preferences,
    setPreferences: (next) => {
      const previousPreferences = preferences;
      preferences = next;
      writePreferences();
      applyRendererPreferences(cy, preferences);
      graphLabelLayer.setPreferences(preferences);
      graphView.applyFilters({ relayout: false });
      structureOverlayController?.refresh();
      if (previousPreferences.experimentalFeatures !== preferences.experimentalFeatures) {
        const showExperimental = preferences.experimentalFeatures;
        const compareButton = document.getElementById('compareButton');
        if (compareButton) compareButton.hidden = !showExperimental;
      }
    }
  });
  const buildFilters = (): void => filterControls.build();
  const syncPreferenceControls = (): void => filterControls.syncPreferences();
  const updateFieldNavActiveState = (): void => filterControls.updateFieldNavActiveState();
  syncFilterViewScope = (): void => filterControls.syncViewScope();

  function leaveActiveView(useCorePrimaryDomains: boolean): void {
    const view = locationController.activeView();
    if (!view) return;
    if (useCorePrimaryDomains && viewCoreNodes(view).length > 0) {
      const defaults = locationController.viewDefaults(view);
      state.selectedFields = new Set(defaults.fields);
      state.selectedDomains = new Set(defaults.domains);
    }
    locationController.deactivateView();
    graphLabelLayer.setNodeSequence([]);
    buildFilters();
    syncPreferenceControls();
    updateFieldNavActiveState();
    syncFilterViewScope();
    applyFilters({ relayout: useCorePrimaryDomains || viewCoreNodes(view).length > 0 });
    const selection = currentSelectionTarget();
    locationController.write(selection, 'replace');
    locationController.syncDocumentMetadata(selection);
    viewsController?.syncActiveView();
  }

  exitActiveView = (): void => leaveActiveView(false);
  exitActiveCoreNodeScope = (): void => leaveActiveView(true);

  const parseSelectionLocation = (options: { includeTemplateSelection?: boolean } = {}): SelectionTarget | null =>
    locationController.parseSelection(options);
  const writeLocationState = (target: SelectionTarget | null, mode: Exclude<HistoryMode, null> = 'replace'): void =>
    locationController.write(target, mode);
  const syncDocumentMetadata = (target: SelectionTarget | null): void => locationController.syncDocumentMetadata(target);
  const openConceptComparison = (nodeId?: string): void => comparisonController?.open(nodeId);

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
    compareNode: (id) => openConceptComparison(id),
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

  comparisonController = new CompareController({
    model,
    cy,
    math: mathRenderer,
    selectedEdgeTypes: () => state.selectedEdgeTypes,
    currentSelection: () => currentSelectionTarget(),
    activateNode: (nodeId) => activateNode(nodeId, { center: true, zoomIn: true, historyMode: 'push' }),
    activateEdge: (edgeId) => activateEdge(edgeId, { center: true, zoomIn: true, historyMode: 'push' }),
    openFilters: () => setPanelOpen('filters', true),
    fitElements: fitGraphElements,
    refreshEdgeStyles: () => graphView.refreshEdgeZoomStyles(),
    onCompareStateChange: (nextState, mode) => {
      compareState = nextState;
      writeLocationState(currentSelectionTarget(), mode);
    }
  });
  comparisonController.initialize(compareState);

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
    buildFilters();
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
    structureOverlayController?.clearSelection();
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
    structureOverlayController?.clearSelection();
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
    structureOverlayController?.clearSelection();
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
    const previousView = locationController.activeView();
    const routeView = locationController.resolveViewFromLocation();
    const routeTaxonomy = locationController.taxonomyDefaultsFromLocation();
    const routeConceptDefaults = locationController.conceptPageDefaultTaxonomy();
    const urlState = readUrlUiStateFromLocation(window.location, knownStateIds, shareCodec);
    if (urlState === null) return;
    const viewDefaults = routeView ? locationController.viewDefaults(routeView) : null;
    const next = resolveUrlUiState(urlState, {
      fields: viewDefaults?.fields ?? routeConceptDefaults?.fields ?? routeTaxonomy.fields ?? fieldOrder,
      domains: viewDefaults?.domains ?? routeConceptDefaults?.domains ?? routeTaxonomy.domains ?? domainOrder,
      edgeTypes: viewDefaults?.edgeTypes ?? defaultEdgeTypeIds,
      excludedFields: viewDefaults?.excludedFields,
      excludedDomains: viewDefaults?.excludedDomains,
      prohibitedDomains: viewDefaults?.prohibitedDomains,
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
    const prohibitedDomainsChanged = !sameIdSet(state.prohibitedDomains, next.prohibitedDomains);
    const crossFieldChanged = state.crossFieldVisibility !== next.crossFieldVisibility;
    const showPrimaryOnlyChanged = state.showPrimaryOnly !== next.showPrimaryOnly;
    const hideIsolatesChanged = state.hideIsolates !== next.hideIsolates;
    const edgeLabelsChanged = state.showEdgeLabels !== next.edgeLabels;
    const junctionsChanged = state.showJunctions !== next.junctions;
    const edgeZoomChanged = state.edgeZoomActivation !== next.edgeZoomActivation;
    const hidePrerequisitesChanged = state.hidePrerequisites !== next.hidePrerequisites;
    const layoutChanged = state.layout !== next.layout;

    if (!fieldsChanged && !domainsChanged && !edgeTypesChanged && !excludedFieldsChanged && !excludedDomainsChanged && !prohibitedDomainsChanged
      && !crossFieldChanged && !showPrimaryOnlyChanged && !hideIsolatesChanged && !edgeLabelsChanged
      && !junctionsChanged && !edgeZoomChanged && !hidePrerequisitesChanged && !layoutChanged) {
      if (routeView && !graphView.preservesView(routeView)) locationController.deactivateView();
      const activeView = locationController.activeView();
      const coreScopeChanged = !sameIdSet(
        new Set(viewCoreNodes(previousView ?? {})),
        viewCoreNodes(activeView ?? {})
      );
      if (coreScopeChanged) applyFilters({ relayout: true });
      viewsController?.syncActiveView();
      syncFilterViewScope();
      return;
    }

    state.selectedFields = new Set(next.fields);
    state.selectedDomains = new Set(next.domains);
    state.selectedEdgeTypes = new Set(next.edgeTypes);
    state.excludedFields = new Set(next.excludedFields);
    state.excludedDomains = new Set(next.excludedDomains);
    state.prohibitedDomains = new Set(next.prohibitedDomains);
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
    if (routeView && !graphView.preservesView(routeView)) locationController.deactivateView();
    const activeView = locationController.activeView();
    const coreScopeChanged = !sameIdSet(
      new Set(viewCoreNodes(previousView ?? {})),
      viewCoreNodes(activeView ?? {})
    );
    applyFilters({ relayout: coreScopeChanged || fieldsChanged || domainsChanged || excludedFieldsChanged || excludedDomainsChanged || prohibitedDomainsChanged
      || showPrimaryOnlyChanged || hideIsolatesChanged || junctionsChanged || edgeZoomChanged
      || hidePrerequisitesChanged || layoutChanged });
    viewsController?.syncActiveView();
    syncFilterViewScope();
  }

  function applyLocationState({ initial = false } = {}): void {
    if (!initial) applyUiStateFromLocation();
    compareState = readCompareStateFromLocation(window.location, model.nodeRecord);
    comparisonController?.syncFromLocation(compareState);
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
      <section class="help-intro">
        <h3>What the atlas shows</h3>
        <p>Each solid node is one concept, even when it belongs to several domains. In <strong>Layered</strong> layout, authored vertical levels generally move from less structure to more structure: carriers and primitive objects appear above concepts obtained by adding data, axioms, limits, approximations, or physical assumptions. Horizontal position groups primary domains; field boundaries and titles identify the large mathematics and physics regions. Horizontal distance is organizational, not a quantitative measure.</p>
        <p>A node’s fill and lane use its <strong>primary domain</strong>. Small colored markers show additional domains. The Details panel lists every field and domain membership.</p>
      </section>

      <div class="help-grid">
        <section class="help-card">
          <h3>Move and select</h3>
          <ul>
            <li>Drag the graph to pan; use a wheel, trackpad gesture, or pinch to zoom.</li>
            <li>Tap or click a node or edge to select it, open Details, and emphasize its immediate neighborhood.</li>
            <li>Double-tap or double-click an item to select and center it.</li>
            <li>Tap or click blank graph space to clear the selection, search marks, neighborhood emphasis, and Details.</li>
          </ul>
        </section>
        <section class="help-card">
          <h3>Toolbar</h3>
          <ul>
            <li><strong>Search</strong> marks all matches and selects the best match without filtering the graph.</li>
            <li><strong>Neighborhood</strong> toggles immediate-neighbor emphasis for the selected item.</li>
            <li><strong>Compare</strong> uses one A/B pair for two analyses: Overview contrasts structure, taxonomy, sources, direct relations, and shared neighbors; Connections finds and explains up to three short visible-graph paths while preserving authored edge direction.</li>
            <li><strong>Layered / Compact / Domains / Fields</strong> changes the same layout setting as the Display menu. A brief amber pulse on Compact means the current Layered graph is unusually wide and sparse.</li>
            <li><strong>Domains</strong> and <strong>Fields</strong> preserve Layered concept positions, dim the concept substrate, and overlay taxonomy centroids joined by weighted directed relations. The underlying concepts remain selectable.</li>
            <li><strong>Fit</strong> fits all currently visible graph elements, labels, field boundaries, and field titles into the unobscured viewport.</li>
            <li>The panel, fullscreen, SVG, Views, and Help buttons control the surrounding workspace.</li>
          </ul>
        </section>
      </div>

      <section class="help-card">
        <h3>Fields, domains, and suppression states</h3>
        <p>Field and domain checkboxes choose the concepts of direct interest. A multi-domain concept matches when any enabled membership matches, unless <strong>Show only primary domain matches</strong> is enabled.</p>
        <div class="help-state-key">
          <div><span class="suppression-sample allowed"><span class="material-icons">visibility</span></span><strong>Allowed</strong> — ordinary filtering and prerequisite context.</div>
          <div><span class="suppression-sample excluded"><span class="material-icons">visibility_off</span></span><strong>Excluded</strong> — a primary-domain node is not admitted merely as prerequisite context, but an enabled, non-excluded secondary membership may still select it directly.</div>
          <div><span class="suppression-sample prohibited"><span class="material-icons">block</span></span><strong>Prohibited</strong> — a node with that primary domain is always hidden, including through secondary memberships and prerequisite closure.</div>
        </div>
        <p>Domain visibility buttons cycle gray → yellow → red → gray. Field exclusion remains a two-state gray/red control. Required prerequisite nodes that survive these rules are normally shown as faded context; <strong>Hide prerequisites</strong> removes that closure entirely.</p>
      </section>

      <div class="help-grid">
        <section class="help-card">
          <h3>Relations and isolates</h3>
          <p>Edge checkboxes determine which relation types are drawn and which relation types participate in prerequisite closure. <strong>Hide isolates</strong> removes every node with no incident edge remaining under the current edge-type and visibility filters. <strong>Cross-field links</strong> may show all such edges, hide them, or show only overview and selected-neighborhood context.</p>
          <p>When <strong>Edge interaction only when zoomed in</strong> is active, zoomed-out edges remain visible but do not capture taps or clicks. Edge labels and construction junctions can be toggled independently.</p>
        </section>
        <section class="help-card">
          <h3>Layouts</h3>
          <p><strong>Layered</strong> uses the authored global levels and primary-domain lanes. It preserves the atlas’s editorial hierarchy and displays field boundaries.</p>
          <p><strong>Compact</strong> uses only the nodes currently visible. Empty authored levels consume no rows, and each row is ordered deterministically by primary-domain order and then canonical node order. Changing filters recomputes the same layout for the same visible set.</p>
          <p><strong>Domains</strong> and <strong>Fields</strong> use Layered geometry as a semantic substrate. Concept labels and detailed edges are suppressed while full-opacity centroid nodes summarize the visible primary domains or fields. Curved arrow thickness records the number of visible directed relations; selecting a centroid or aggregate relation opens its statistics in Details.</p>
        </section>
      </div>

      <section class="help-card">
        <h3>Construction diamonds</h3>
        <p>A diamond represents a genuinely multi-input construction: several structures must coexist and satisfy the stated compatibility condition. It is an <strong>AND</strong>, not a choice among incoming branches. When construction junctions are hidden, the atlas contracts each diamond into dashed direct branches. Labels beginning with <strong>jointly</strong> still mean that every associated branch is required.</p>
      </section>

      <section class="help-card">
        <h3>Edge meanings</h3>
        <div class="edge-explainer">
          ${activeTypes.map((id) => {
            const type = graphData.edgeTypes[id];
            if (!type) return '';
            return `<div class="edge-explainer-name"><span class="line-swatch ${escapeHtml(type.lineStyle || 'solid')}" style="border-color:${escapeHtml(type.color)}"></span><strong>${escapeHtml(type.label)}</strong></div><div>${escapeHtml(type.description)}</div>`;
          }).join('')}
        </div>
      </section>

      <div class="help-grid">
        <section class="help-card">
          <h3>Details and sources</h3>
          <p>Details gives the selected item’s summary, data, axioms, induced structures, notes, domain memberships, relations, stories and views, and source links. In a relation such as “Builds toward,” the destination is shown first and the edge annotation follows as <em>via [annotation]</em>. Relation links can navigate to concepts currently hidden by filters without silently changing a prohibited-domain setting.</p>
          <p>The compare action pins a concept into the shared Overview/Connections workspace. Connections can fit an active path and copy its node sequence for Story authoring. The edit action opens the corresponding source file on GitHub. The share action copies a permalink containing the item selection and the current independently versioned <code>filter=</code> and <code>disp=</code> states. SVG export inherits the current layout, including the Domains or Fields overlay exactly as shown.</p>
        </section>
        <section class="help-card">
          <h3>Stories and views</h3>
          <p>A <strong>View</strong> applies a curated graph configuration. A <strong>Story</strong> also numbers an ordered node sequence and provides Previous and Next navigation. Filter or display changes remain attached through <code>filter=</code> and <code>disp=</code> URL overrides while every required sequence/core node remains visible. The top of Filters provides an explicit exit. For a core-node Story or View, the field/domain tree is replaced by its selected-node scope and a <strong>Use primary domains</strong> action.</p>
        </section>
      </div>

      <section class="help-card">
        <h3>Panels, preferences, and export</h3>
        <p>Filters and Details slide over the graph rather than resizing or relaying it during their animation. The fullscreen button hides both and restores their previous open state. On narrow screens, Filters enters from the left and Details rises from the bottom.</p>
        <p>Preferences affect rendering and interaction performance, formula display, domain markers, node movement, and prerequisite emphasis. They are stored only in this browser and are not included in shared URLs. SVG export writes the current visible graph as a standalone vector document with labels, annotations, domain markers, emphasis, metadata, selection state, and active Story sequence badges.</p>
      </section>

      <section class="help-card help-shortcuts">
        <h3>Keyboard</h3>
        <p><kbd>/</kbd> focus search · <kbd>F</kbd> fit the graph · <kbd>Escape</kbd> clear search and close open mobile panels.</p>
      </section>`);

  }

  const svgExporter = new SvgExporter(
    cy, model, state, () => preferences,
    () => {
      const activeView = locationController.activeView();
      return activeView ? viewNodeSequence(activeView) : [];
    }
  );
  const exportVisibleSvg = (): void => svgExporter.exportVisible();
  const publishStaticSvgExporter = (): void => {
    window.__atlasStaticSvgExporter = {
      serializeVisible: () => svgExporter.serializeVisible(),
      serializePrimaryDomain: (domainId: string) => svgExporter.serializePrimaryDomain(domainId)
    };
    document.documentElement.dataset.atlasStaticSvg = 'ready';
  };

  // Controls
  const routedView = locationController.activeView();
  if (routedView && !graphView.preservesView(routedView)) locationController.deactivateView();
  filterControls.initialize();
  syncExperimentalToolbarButtons();
  structureOverlayController = new StructureOverlayController({
    model,
    state,
    cy,
    openPanel: openDetailsPanel,
    focusField: (fieldId) => filterControls.focusField(fieldId),
    focusDomain: (domainId) => filterControls.focusDomain(domainId),
    activateNode: (nodeId) => activateNode(nodeId, { center: true, zoomIn: true, historyMode: 'push' }),
    activateEdge: (edgeId) => activateEdge(edgeId, { center: false, historyMode: 'push' }),
    renderMathText
  });
  structureOverlayController.initialize();
  viewsController = new ViewsController({
    views: viewsData.views,
    activeView: () => locationController.activeView(),
    currentSelection: () => currentSelectionTarget(),
    activateNode: (nodeId) => activateNode(nodeId, { center: true, zoomIn: true, historyMode: 'push' }),
    nodeLabel: (nodeId) => nodeRecord.get(nodeId)?.label ?? nodeId,
    viewPageUrl: (viewId) => locationController.viewPageUrl(viewId),
    isMobileLayout: () => panelController.isMobileLayout(),
    detailsOpen: () => state.detailsOpen,
    math: mathRenderer,
    setNodeSequenceBadges: (nodeIds) => graphLabelLayer.setNodeSequence(nodeIds)
  });
  viewsController.initialize();
  buildHelp();

  byId('fitButton').addEventListener('click', fitVisibleGraph);
  $$<HTMLButtonElement>('[data-toolbar-layout]').forEach((button) => {
    button.addEventListener('click', () => {
      const layout = button.dataset.toolbarLayout;
      if (layout === 'atlas' || layout === 'breadthfirst' || layout === 'domains' || layout === 'fields') runLayout(layout, true);
    });
  });
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
    const target = event.target as cytoscape.SingularElementReturnValue;
    if (Number(target.data('semanticGroup')) === 1) {
      structureOverlayController?.selectGroupElement(target);
      return;
    }
    activateNode(target.id(), { center: false, historyMode: 'push' });
  });
  cy.on('tap', 'edge', (event) => {
    const target = event.target as cytoscape.SingularElementReturnValue;
    if (Number(target.data('semanticConnection')) === 1) {
      structureOverlayController?.selectConnectionElement(target);
      return;
    }
    activateEdge(target.id(), { center: false, historyMode: 'push' });
  });
  cy.on('dbltap', 'node', (event) => {
    const target = event.target as cytoscape.SingularElementReturnValue;
    if (Number(target.data('semanticGroup')) === 1) {
      structureOverlayController?.selectGroupElement(target);
      return;
    }
    const pointer = { x: event.renderedPosition.x, y: event.renderedPosition.y };
    activateNode(target.id(), { center: true, zoomIn: true, pointer, historyMode: 'push' });
  });
  cy.on('dbltap', 'edge', (event) => {
    const target = event.target as cytoscape.SingularElementReturnValue;
    if (Number(target.data('semanticConnection')) === 1) {
      structureOverlayController?.selectConnectionElement(target);
      return;
    }
    const pointer = { x: event.renderedPosition.x, y: event.renderedPosition.y };
    activateEdge(target.id(), { center: true, zoomIn: true, pointer, historyMode: 'push' });
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
  window.addEventListener('resize', () => {
    syncPanelUi();
    cy.resize();
    scheduleFieldBands();
    scheduleLayoutUiUpdate();
  });

  const initialSearchQuery = new URL(window.location.href).searchParams.get('q')?.trim() ?? '';
  if (initialSearchQuery) byId<HTMLInputElement>('searchInput').value = initialSearchQuery;

  // Initial view
  syncPanelUi();
  syncLayoutToolbar();
  applyFilters({ relayout: false });
  runLayout(state.layout, false);
  window.requestAnimationFrame(() => {
    const visible = visibleGraphElements();
    if (!visible.empty()) fitGraphElements(visible);
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

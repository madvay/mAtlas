import type cytoscape from 'cytoscape';
import { byId, escapeHtml, queryAll } from '../core/dom.js';
import { rankNodeMatches } from '../core/search.js';
import { stripInlineMathText } from '../core/text.js';
import { findConnectionPaths, type ConnectionPath } from '../graph/connection-path.js';
import {
  analyzeConceptComparison,
  type ComparisonRelation,
  type ConceptComparisonAnalysis
} from '../model/concept-comparison.js';
import type { GraphModel } from '../model/graph-model.js';
import {
  sameCompareState,
  writeCompareState,
  type CompareMode,
  type CompareState
} from '../state/compare-state.js';
import type { GraphNode, HistoryMode, SelectionTarget } from '../types.js';
import type { MathRenderer } from './math-renderer.js';
import { invalidateRender, renderHtml } from './render.js';

interface CompareControllerOptions {
  model: GraphModel;
  cy: cytoscape.Core;
  math: MathRenderer;
  selectedEdgeTypes: () => ReadonlySet<string>;
  currentSelection: () => SelectionTarget | null;
  activateNode: (nodeId: string) => void;
  activateEdge: (edgeId: string) => void;
  openFilters: () => void;
  fitElements: (elements: cytoscape.CollectionReturnValue, padding?: number) => void;
  refreshEdgeStyles: () => void;
  onCompareStateChange: (state: CompareState | null, mode: Exclude<HistoryMode, null>) => void;
}

type ComparisonSlots = [string | null, string | null];

export class CompareController {
  private slots: ComparisonSlots = [null, null];
  private mode: CompareMode = 'overview';
  private direction: CompareState['direction'] = 'either';
  private pathIndex = 0;
  private paths: ConnectionPath[] = [];
  private readonly displayToId = new Map<string, string>();
  private readonly idToDisplay = new Map<string, string>();
  private readonly nodes: GraphNode[];

  constructor(private readonly options: CompareControllerOptions) {
    this.nodes = options.model.data.nodes
      .filter((node) => node.kind === 'structure')
      .sort((a, b) => stripInlineMathText(a.label).localeCompare(stripInlineMathText(b.label)) || a.id.localeCompare(b.id));
  }

  initialize(initialState: CompareState | null): void {
    this.buildConceptOptions();
    this.bindControls();
    this.syncFromLocation(initialState);
  }

  open(preferredNodeId?: string): void {
    const currentNodeId = preferredNodeId ?? this.currentStructureSelection();
    if (currentNodeId && this.isStructureNode(currentNodeId)) this.includePreferredNode(currentNodeId);
    this.refresh();
    const dialog = byId<HTMLDialogElement>('compareDialog');
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => {
      const input = this.slots[0] ? byId<HTMLInputElement>('compareRightInput') : byId<HTMLInputElement>('compareLeftInput');
      input.focus();
    }, 0);
  }

  syncFromLocation(state: CompareState | null): void {
    if (state) {
      this.slots = [state.nodeIds[0], state.nodeIds[1]];
      this.mode = state.mode;
      this.direction = state.direction;
      this.pathIndex = state.pathIndex;
    } else {
      this.slots = [null, null];
      this.mode = 'overview';
      this.direction = 'either';
      this.pathIndex = 0;
    }
    this.refresh();
  }

  refresh({ fitPath = false }: { fitPath?: boolean } = {}): void {
    this.computePaths();
    this.syncInputs();
    this.syncModeControls();
    this.renderActiveAnalysis();
    this.applyGraphHighlights();
    this.syncToolbarButton();
    this.syncActionButtons();
    if (fitPath) this.fitActivePath();
  }

  private completePair(): readonly [string, string] | null {
    const [left, right] = this.slots;
    return left && right && left !== right ? [left, right] : null;
  }

  private currentState(): CompareState | null {
    const pair = this.completePair();
    return pair ? {
      nodeIds: pair,
      mode: this.mode,
      direction: this.mode === 'connections' ? this.direction : 'either',
      pathIndex: this.mode === 'connections' ? this.pathIndex : 0
    } : null;
  }

  private currentStructureSelection(): string | null {
    const selection = this.options.currentSelection();
    return selection?.kind === 'node' && this.isStructureNode(selection.id) ? selection.id : null;
  }

  private isStructureNode(nodeId: string | null | undefined): nodeId is string {
    return Boolean(nodeId && this.options.model.nodeRecord.get(nodeId)?.kind === 'structure');
  }

  private includePreferredNode(nodeId: string): void {
    const previous = this.currentState();
    if (this.slots[0] === nodeId || this.slots[1] === nodeId) return;
    if (!this.slots[0]) this.slots = [nodeId, this.slots[1]];
    else if (!this.slots[1]) this.slots = [this.slots[0], nodeId];
    else this.slots = [nodeId, this.slots[0]];
    this.pathIndex = 0;
    this.publishStateChange(previous, 'push');
  }

  private buildConceptOptions(): void {
    const datalist = byId<HTMLDataListElement>('compareConceptNames');
    datalist.replaceChildren();
    for (const node of this.nodes) {
      const domain = this.options.model.data.domains[node.primaryDomain];
      const display = `${stripInlineMathText(node.label)} — ${domain?.label ?? node.primaryDomain} [${node.id}]`;
      this.displayToId.set(display.toLocaleLowerCase(), node.id);
      this.idToDisplay.set(node.id, display);
      const option = document.createElement('option');
      option.value = display;
      datalist.appendChild(option);
    }
  }

  private bindControls(): void {
    byId('compareButton').addEventListener('click', () => this.open());
    this.bindInput(byId<HTMLInputElement>('compareLeftInput'), 0);
    this.bindInput(byId<HTMLInputElement>('compareRightInput'), 1);

    byId('compareSwapButton').addEventListener('click', () => {
      const previous = this.currentState();
      this.slots = [this.slots[1], this.slots[0]];
      this.pathIndex = 0;
      this.publishStateChange(previous, 'push');
      this.refresh({ fitPath: this.mode === 'connections' });
    });
    byId('compareClearButton').addEventListener('click', () => {
      const previous = this.currentState();
      this.slots = [null, null];
      this.mode = 'overview';
      this.direction = 'either';
      this.pathIndex = 0;
      this.publishStateChange(previous, 'push');
      this.refresh();
    });

    const modeButtons = queryAll<HTMLButtonElement>('[data-compare-mode]');
    modeButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        const nextMode: CompareMode = button.dataset.compareMode === 'connections' ? 'connections' : 'overview';
        if (nextMode === this.mode) return;
        const previous = this.currentState();
        this.mode = nextMode;
        this.pathIndex = 0;
        this.publishStateChange(previous, 'replace');
        this.refresh({ fitPath: nextMode === 'connections' });
      });
      button.addEventListener('keydown', (event) => {
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % modeButtons.length
          : event.key === 'ArrowLeft' ? (index + modeButtons.length - 1) % modeButtons.length
            : event.key === 'Home' ? 0
              : event.key === 'End' ? modeButtons.length - 1
                : -1;
        if (nextIndex < 0) return;
        event.preventDefault();
        modeButtons[nextIndex]?.focus();
        modeButtons[nextIndex]?.click();
      });
    });

    byId<HTMLSelectElement>('compareDirection').addEventListener('change', (event) => {
      const previous = this.currentState();
      this.direction = (event.currentTarget as HTMLSelectElement).value === 'forward' ? 'forward' : 'either';
      this.pathIndex = 0;
      this.publishStateChange(previous, 'replace');
      this.refresh({ fitPath: true });
    });

    byId('compareFitPathButton').addEventListener('click', () => this.fitActivePath());
    byId('compareCopySequenceButton').addEventListener('click', () => {
      const path = this.activePath();
      if (!path) return;
      const yaml = `nodeSequence:\n${path.nodeIds.map((nodeId) => `  - ${nodeId}`).join('\n')}`;
      void this.copyText(yaml, byId<HTMLButtonElement>('compareCopySequenceButton'), 'Copied sequence');
    });
    byId('compareCopyButton').addEventListener('click', () => {
      const state = this.currentState();
      if (!state) {
        this.setStatus('Choose two concepts before copying a link.', true);
        return;
      }
      const url = new URL(window.location.href);
      writeCompareState(url.searchParams, state);
      void this.copyText(url.toString(), byId<HTMLButtonElement>('compareCopyButton'), 'Copied link');
    });
  }

  private bindInput(input: HTMLInputElement, index: 0 | 1): void {
    const commit = (): void => this.commitInput(index, input.value);
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
    });
  }

  private commitInput(index: 0 | 1, rawValue: string): void {
    const previous = this.currentState();
    const value = rawValue.trim();
    if (!value) {
      this.slots[index] = null;
      this.pathIndex = 0;
      this.publishStateChange(previous, 'push');
      this.refresh();
      return;
    }

    const nodeId = this.resolveNodeId(value);
    if (!nodeId) {
      this.setStatus(`No concept matches “${value}”.`, true);
      this.syncInputs();
      return;
    }
    const otherIndex = index === 0 ? 1 : 0;
    if (this.slots[otherIndex] === nodeId) {
      this.setStatus('Choose two different concepts.', true);
      this.syncInputs();
      return;
    }
    this.slots[index] = nodeId;
    this.pathIndex = 0;
    this.publishStateChange(previous, 'push');
    this.refresh({ fitPath: this.mode === 'connections' });
  }

  private resolveNodeId(value: string): string | null {
    const bracketedId = value.match(/\[([^\]]+)\]\s*$/)?.[1];
    const direct = this.options.model.nodeRecord.get(bracketedId ?? value);
    if (direct?.kind === 'structure') return direct.id;
    const displayId = this.displayToId.get(value.toLocaleLowerCase());
    if (displayId) return displayId;
    const matches = rankNodeMatches(this.nodes, value, (node) => ({
      fieldLabels: this.options.model.nodeFieldLabels(node),
      domainLabels: this.options.model.nodeDomainLabels(node)
    }));
    return matches[0]?.node.id ?? null;
  }

  private publishStateChange(previous: CompareState | null, historyMode: Exclude<HistoryMode, null>): void {
    const next = this.currentState();
    if (sameCompareState(previous, next)) return;
    this.options.onCompareStateChange(next, historyMode);
  }

  private computePaths(): void {
    const pair = this.completePair();
    if (!pair || this.mode !== 'connections') {
      this.paths = [];
      return;
    }
    const visibleNodes = this.options.cy.nodes().not('.filter-hidden');
    const nodeIds = new Set(visibleNodes.map((node) => node.id()));
    const edges = this.options.cy.edges().not('.filter-hidden')
      .map((edge) => this.options.model.edgeRecord.get(edge.id()))
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
    this.paths = findConnectionPaths({
      sourceId: pair[0],
      targetId: pair[1],
      nodeIds,
      edges,
      direction: this.direction,
      maxPaths: 3,
      maxDepth: 12
    });
    if (this.pathIndex >= this.paths.length) {
      const previous = this.currentState();
      this.pathIndex = 0;
      this.publishStateChange(previous, 'replace');
    }
  }

  private activePath(): ConnectionPath | null {
    return this.paths[this.pathIndex] ?? this.paths[0] ?? null;
  }

  private syncInputs(): void {
    byId<HTMLInputElement>('compareLeftInput').value = this.slots[0] ? this.idToDisplay.get(this.slots[0]) ?? this.slots[0] : '';
    byId<HTMLInputElement>('compareRightInput').value = this.slots[1] ? this.idToDisplay.get(this.slots[1]) ?? this.slots[1] : '';
    byId<HTMLButtonElement>('compareSwapButton').disabled = !this.slots[0] && !this.slots[1];
  }

  private syncModeControls(): void {
    queryAll<HTMLButtonElement>('[data-compare-mode]').forEach((button) => {
      const active = button.dataset.compareMode === this.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.setAttribute('tabindex', active ? '0' : '-1');
    });
    const directionControl = byId<HTMLElement>('compareDirectionControl');
    directionControl.hidden = this.mode !== 'connections';
    byId<HTMLSelectElement>('compareDirection').value = this.direction;
  }

  private syncToolbarButton(): void {
    const button = byId<HTMLButtonElement>('compareButton');
    const active = Boolean(this.completePair());
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Open the active concept analysis' : 'Compare or connect two concepts';
  }

  private syncActionButtons(): void {
    const pair = this.completePair();
    const path = this.activePath();
    byId<HTMLButtonElement>('compareClearButton').disabled = !this.slots[0] && !this.slots[1];
    byId<HTMLButtonElement>('compareCopyButton').disabled = !pair;
    byId<HTMLButtonElement>('compareFitPathButton').hidden = this.mode !== 'connections';
    byId<HTMLButtonElement>('compareFitPathButton').disabled = !path;
    byId<HTMLButtonElement>('compareCopySequenceButton').hidden = this.mode !== 'connections';
    byId<HTMLButtonElement>('compareCopySequenceButton').disabled = !path;
  }

  private applyGraphHighlights(): void {
    const { cy } = this.options;
    cy.elements().removeClass('comparison-a comparison-b comparison-shared comparison-direct connection-dim connection-emphasis connection-endpoint');
    const pair = this.completePair();
    if (!pair) {
      this.options.refreshEdgeStyles();
      return;
    }

    if (this.mode === 'overview') {
      cy.getElementById(pair[0]).addClass('comparison-a');
      cy.getElementById(pair[1]).addClass('comparison-b');
      const analysis = analyzeConceptComparison(this.options.model, pair[0], pair[1], this.options.selectedEdgeTypes());
      if (analysis) {
        for (const neighbor of analysis.sharedNeighbors) cy.getElementById(neighbor.nodeId).addClass('comparison-shared');
        for (const relation of analysis.directRelations) cy.getElementById(relation.edgeId).addClass('comparison-direct');
      }
      this.options.refreshEdgeStyles();
      return;
    }

    const path = this.activePath();
    if (!path) {
      this.options.refreshEdgeStyles();
      return;
    }
    const nodeIds = new Set(path.nodeIds);
    const edgeIds = new Set(path.steps.map((step) => step.edgeId));
    const visible = cy.elements().not('.filter-hidden');
    visible.addClass('connection-dim');
    const pathElements = visible.filter((element) => element.isNode() ? nodeIds.has(element.id()) : edgeIds.has(element.id()));
    pathElements.removeClass('connection-dim').addClass('connection-emphasis');
    cy.getElementById(path.nodeIds[0] ?? '').addClass('connection-endpoint');
    cy.getElementById(path.nodeIds[path.nodeIds.length - 1] ?? '').addClass('connection-endpoint');
    this.options.refreshEdgeStyles();
  }

  private fitActivePath(): void {
    if (this.mode !== 'connections') return;
    const path = this.activePath();
    if (!path) return;
    const nodeIds = new Set(path.nodeIds);
    const edgeIds = new Set(path.steps.map((step) => step.edgeId));
    const elements = this.options.cy.elements().not('.filter-hidden').filter((element) =>
      element.isNode() ? nodeIds.has(element.id()) : edgeIds.has(element.id()));
    if (!elements.empty()) this.options.fitElements(elements, 110);
  }

  private renderActiveAnalysis(): void {
    const pair = this.completePair();
    if (!pair) {
      this.setStatus('Choose two concepts to compare or connect.');
      renderHtml(byId('compareContent'), `
        <div class="compare-empty">
          <span class="material-icons" aria-hidden="true">compare_arrows</span>
          <h3>Choose two concepts</h3>
          <p>Overview contrasts their recorded structure and neighborhood. Connections finds short paths through the currently visible graph.</p>
        </div>`);
      return;
    }

    if (this.mode === 'connections') {
      this.renderConnections(pair);
      return;
    }
    const analysis = analyzeConceptComparison(this.options.model, pair[0], pair[1], this.options.selectedEdgeTypes());
    if (!analysis) return;
    this.setStatus('Overview uses the relation types currently enabled in Filters.');
    renderHtml(byId('compareContent'), this.renderAnalysis(analysis));
    this.bindAnalysisLinks();
  }

  private bindAnalysisLinks(): void {
    queryAll<HTMLButtonElement>('[data-compare-node-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const nodeId = button.dataset.compareNodeId;
        if (!nodeId) return;
        byId<HTMLDialogElement>('compareDialog').close();
        this.options.activateNode(nodeId);
      });
    });
  }

  private renderConnections(pair: readonly [string, string]): void {
    const sourceElement = this.options.cy.getElementById(pair[0]);
    const targetElement = this.options.cy.getElementById(pair[1]);
    const sourceVisible = !sourceElement.empty() && !sourceElement.hasClass('filter-hidden');
    const targetVisible = !targetElement.empty() && !targetElement.hasClass('filter-hidden');
    if (!sourceVisible || !targetVisible) {
      this.setStatus('One or both concepts are hidden by the current filters.', true);
      renderHtml(byId('compareContent'), `<section class="connection-summary">
        <p>Connections use only concepts and relations admitted by the current field, domain, relation, and display filters.</p>
        <button type="button" class="button connection-open-filters">Open filters</button>
      </section>`);
      this.bindConnectionActions();
      return;
    }

    if (!this.paths.length) {
      const directed = this.direction === 'forward' ? ' while following authored arrows only' : '';
      this.setStatus('No visible path of twelve or fewer relations was found.', true);
      renderHtml(byId('compareContent'), `<section class="connection-summary">
        <p>No path was found${directed}. The search does not silently re-enable hidden concepts or relation types.</p>
        <div class="connection-empty-actions">
          ${this.direction === 'forward' ? '<button type="button" class="button connection-use-either">Search either direction</button>' : ''}
          <button type="button" class="button connection-open-filters">Open filters</button>
        </div>
      </section>`);
      this.bindConnectionActions();
      return;
    }

    const activePath = this.activePath();
    if (!activePath) return;
    this.setStatus(`${this.paths.length} path${this.paths.length === 1 ? '' : 's'} found · showing path ${this.pathIndex + 1}.`);
    const alternatives = this.paths.length > 1 ? `<div class="connection-alternatives" role="group" aria-label="Alternative connection paths">
      ${this.paths.map((path, index) => `<button type="button" class="connection-alternative${index === this.pathIndex ? ' active' : ''}" data-connection-path="${index}" aria-pressed="${index === this.pathIndex}">Path ${index + 1}<span>${path.steps.length} relation${path.steps.length === 1 ? '' : 's'}</span></button>`).join('')}
    </div>` : '';

    const sequence = activePath.nodeIds.map((nodeId, index) => {
      const node = this.options.model.nodeRecord.get(nodeId);
      if (!node) return '';
      const incoming = index > 0 ? activePath.steps[index - 1] : null;
      const relation = incoming ? this.options.model.edgeRecord.get(incoming.edgeId) : null;
      const type = relation ? this.options.model.data.edgeTypes[relation.type] : null;
      const relationHtml = relation && type ? `<li class="connection-relation">
        <button type="button" class="connection-edge-link" data-connection-edge="${escapeHtml(relation.id)}">
          <span class="connection-direction-symbol" aria-hidden="true">${incoming?.followsArrow ? '↓' : '↑'}</span>
          <span><strong>${this.options.math.renderText(type.label)}</strong><span>${this.options.math.renderText(relation.label)}</span></span>
        </button>
        <span class="connection-direction-note">${incoming?.followsArrow ? 'authored direction' : 'opposite the authored arrow'}</span>
      </li>` : '';
      return `${relationHtml}<li class="connection-node${index === 0 || index === activePath.nodeIds.length - 1 ? ' endpoint' : ''}">
        <button type="button" class="text-button connection-node-link" data-connection-node="${escapeHtml(node.id)}">${this.options.math.renderText(node.label)}</button>
        <span>${this.options.math.renderText(node.summary)}</span>
      </li>`;
    }).join('');

    renderHtml(byId('compareContent'), `<section class="connection-summary">
      <p>${activePath.steps.length} visible relation${activePath.steps.length === 1 ? '' : 's'} · ${this.direction === 'forward' ? 'following authored arrows' : 'either traversal direction'}</p>
      ${alternatives}
    </section>
    <ol class="connection-path">${sequence}</ol>
    <p class="connection-method muted">Paths are ranked first by relation count, then deterministically by concept and edge identifiers. Traversing an edge backwards does not invert its authored meaning and does not imply logical derivation.</p>`);
    this.bindConnectionActions();
  }

  private bindConnectionActions(): void {
    queryAll<HTMLElement>('[data-connection-path]').forEach((button) => {
      button.addEventListener('click', () => {
        const previous = this.currentState();
        this.pathIndex = Number.parseInt(button.dataset.connectionPath ?? '0', 10) || 0;
        this.publishStateChange(previous, 'replace');
        this.refresh({ fitPath: true });
      });
    });
    queryAll<HTMLElement>('[data-connection-node]').forEach((button) => {
      button.addEventListener('click', () => {
        byId<HTMLDialogElement>('compareDialog').close();
        this.options.activateNode(button.dataset.connectionNode ?? '');
      });
    });
    queryAll<HTMLElement>('[data-connection-edge]').forEach((button) => {
      button.addEventListener('click', () => {
        byId<HTMLDialogElement>('compareDialog').close();
        this.options.activateEdge(button.dataset.connectionEdge ?? '');
      });
    });
    document.querySelector('.connection-open-filters')?.addEventListener('click', () => {
      byId<HTMLDialogElement>('compareDialog').close();
      this.options.openFilters();
    });
    document.querySelector('.connection-use-either')?.addEventListener('click', () => {
      const previous = this.currentState();
      this.direction = 'either';
      this.pathIndex = 0;
      this.publishStateChange(previous, 'replace');
      this.refresh({ fitPath: true });
    });
  }

  private renderAnalysis(analysis: ConceptComparisonAnalysis): string {
    const commonFields = analysis.commonFieldIds.map((id) => this.taxonomyBadge(id, 'field')).join('');
    const commonDomains = analysis.commonDomainIds.map((id) => this.taxonomyBadge(id, 'domain')).join('');
    const commonSources = analysis.commonCitationIds.map((id) => this.sourceBadge(id)).join('');
    const commonContext = commonFields || commonDomains || commonSources
      ? `<div class="compare-common-grid">
          <div><h4>Shared fields and domains</h4><div class="domain-badges">${commonFields}${commonDomains || '<span class="muted">No shared domain</span>'}</div></div>
          <div><h4>Shared sources</h4><div class="citation-badges">${commonSources || '<span class="muted">No identical source records</span>'}</div></div>
        </div>`
      : '<p class="muted">They have no shared field, domain, or identical source record.</p>';

    return `
      <div class="compare-columns">
        ${this.renderConceptCard(analysis.left, 'A')}
        ${this.renderConceptCard(analysis.right, 'B')}
      </div>
      <section class="compare-section">
        <h3>Common context</h3>
        ${commonContext}
      </section>
      <section class="compare-section">
        <h3>Direct relations</h3>
        ${this.renderDirectRelations(analysis)}
      </section>
      <section class="compare-section">
        <h3>Relation profile</h3>
        <p class="compare-note">Counts use the relation types currently enabled in Filters.</p>
        ${this.renderRelationProfile(analysis)}
      </section>
      <section class="compare-section">
        <h3>Shared adjacent concepts</h3>
        ${this.renderSharedNeighbors(analysis)}
      </section>`;
  }

  private renderConceptCard(node: GraphNode, marker: 'A' | 'B'): string {
    const fields = this.options.model.nodeFieldIds(node).map((id) => this.taxonomyBadge(id, 'field')).join('');
    const domains = this.options.model.nodeDomainIds(node).map((id) => this.taxonomyBadge(id, 'domain')).join('');
    const metadata: Array<[string, string]> = [];
    if (node.conceptType) metadata.push(['Type', node.conceptType]);
    if (node.scale) metadata.push(['Scale', node.scale]);
    if (node.status) metadata.push(['Status', node.status]);
    const definingRows = [
      ['Carrier(s)', node.carriers],
      ['Data', node.data],
      ['Axioms / constraints', node.axioms]
    ].filter((entry): entry is [string, string[]] => Boolean(entry[1]?.length));

    return `<article class="compare-card compare-card-${marker.toLocaleLowerCase()}">
      <div class="compare-card-heading">
        <span class="compare-marker" aria-label="Concept ${marker}">${marker}</span>
        <h3>${this.options.math.renderText(node.label)}</h3>
        <button type="button" class="text-button" data-compare-node-id="${escapeHtml(node.id)}">Show in atlas</button>
      </div>
      <p class="math-rich concept-summary">${this.options.math.renderText(node.summary)}</p>
      <div class="domain-badges">${fields}${domains}</div>
      ${metadata.length ? `<dl class="concept-metadata">${metadata.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}
      ${definingRows.length ? `<div class="compare-defining-features">${definingRows.map(([label, values]) => `<div><h4>${escapeHtml(label)}</h4><ul>${values.map((value) => `<li class="math-rich">${this.options.math.renderText(value)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
      <p class="compare-source-count"><span class="material-icons" aria-hidden="true">menu_book</span>${node.citations.length} source record${node.citations.length === 1 ? '' : 's'}</p>
    </article>`;
  }

  private renderDirectRelations(analysis: ConceptComparisonAnalysis): string {
    if (!analysis.directRelations.length) return '<p class="muted">No direct relation of an enabled type is recorded between these concepts.</p>';
    return `<div class="compare-relation-list">${analysis.directRelations.map((relation) => {
      const source = this.options.model.nodeRecord.get(relation.sourceId);
      const target = this.options.model.nodeRecord.get(relation.targetId);
      return `<div class="compare-relation-row">
        <span>${source ? this.options.math.renderText(source.label) : escapeHtml(relation.sourceId)}</span>
        <span class="compare-relation-arrow">→</span>
        <span>${target ? this.options.math.renderText(target.label) : escapeHtml(relation.targetId)}</span>
        <span class="type-pill">${this.options.math.renderText(relation.edgeTypeLabel)}</span>
        <strong>${this.options.math.renderText(relation.edgeLabel)}</strong>
        ${relation.synthetic ? '<span class="compare-synthetic-note">collapsed multi-input construction</span>' : ''}
      </div>`;
    }).join('')}</div>`;
  }

  private renderRelationProfile(analysis: ConceptComparisonAnalysis): string {
    if (!analysis.relationTypeCounts.length) return '<p class="muted">Neither concept has a relation of an enabled type.</p>';
    return `<div class="compare-table-wrap"><table class="compare-table">
      <thead><tr><th>Relation type</th><th>${this.options.math.renderText(analysis.left.label)}</th><th>${this.options.math.renderText(analysis.right.label)}</th></tr></thead>
      <tbody>${analysis.relationTypeCounts.map((row) => `<tr><th>${this.options.math.renderText(row.edgeTypeLabel)}</th><td>${row.leftCount}</td><td>${row.rightCount}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  private renderSharedNeighbors(analysis: ConceptComparisonAnalysis): string {
    if (!analysis.sharedNeighbors.length) return '<p class="muted">No shared adjacent concept is connected by the enabled relation types.</p>';
    return `<div class="compare-neighbor-list">${analysis.sharedNeighbors.map((neighbor) => {
      const node = this.options.model.nodeRecord.get(neighbor.nodeId);
      return `<article class="compare-neighbor-row">
        <button type="button" class="text-button compare-neighbor-name" data-compare-node-id="${escapeHtml(neighbor.nodeId)}">${node ? this.options.math.renderText(node.label) : escapeHtml(neighbor.nodeId)}</button>
        <div>${this.renderNeighborRelations(neighbor.leftRelations)}</div>
        <div>${this.renderNeighborRelations(neighbor.rightRelations)}</div>
      </article>`;
    }).join('')}</div>`;
  }

  private renderNeighborRelations(relations: readonly ComparisonRelation[]): string {
    return relations.map((relation) => `<span class="compare-neighbor-relation"><strong>${this.options.math.renderText(relation.endpointLabel)}:</strong> ${this.options.math.renderText(relation.edgeLabel)}</span>`).join('');
  }

  private taxonomyBadge(id: string, kind: 'field' | 'domain'): string {
    const record = kind === 'field' ? this.options.model.data.fields[id] : this.options.model.data.domains[id];
    if (!record) return '';
    return `<span class="domain-badge ${kind === 'field' ? 'field-badge' : ''}" style="--domain-color:${escapeHtml(record.color)}"><span class="domain-dot"></span>${escapeHtml(record.label)}</span>`;
  }

  private sourceBadge(id: string): string {
    const source = this.options.model.data.sources[id];
    if (!source) return '';
    return `<a class="citation-badge" href="${escapeHtml(source.url)}" target="_blank" rel="noopener" title="${escapeHtml(source.title)}">${escapeHtml(source.label)}</a>`;
  }

  private setStatus(message: string, error = false): void {
    const status = byId('compareStatus');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  private async copyText(text: string, button: HTMLButtonElement, confirmation: string): Promise<void> {
    const originalHtml = button.innerHTML;
    try {
      await navigator.clipboard.writeText(text);
      invalidateRender(button);
      button.textContent = confirmation;
    } catch {
      window.prompt('Copy:', text);
    } finally {
      window.setTimeout(() => renderHtml(button, originalHtml), 1200);
    }
  }
}

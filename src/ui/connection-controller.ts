import type cytoscape from 'cytoscape';
import { byId, escapeHtml, queryAll } from '../core/dom.js';
import { rankNodeMatches } from '../core/search.js';
import { findConnectionPaths, type ConnectionPath } from '../graph/connection-path.js';
import type { GraphModel } from '../model/graph-model.js';
import {
  readConnectionQueryState,
  writeConnectionQueryState,
  type ConnectionQueryState
} from '../state/connection-state.js';
import type { SelectionTarget } from '../types.js';
import type { MathRenderer } from './math-renderer.js';
import { renderHtml } from './render.js';

export interface ConnectionControllerOptions {
  cy: cytoscape.Core;
  model: GraphModel;
  math: MathRenderer;
  currentSelection: () => SelectionTarget | null;
  openDetails: () => void;
  openFilters: () => void;
  fitElements: (elements: cytoscape.CollectionReturnValue, padding?: number) => void;
  prepareHighlight: () => void;
  refreshEdgeStyles: () => void;
  activateNode: (nodeId: string) => void;
  activateEdge: (edgeId: string) => void;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export class ConnectionController {
  private activeState: ConnectionQueryState | null = null;
  private paths: ConnectionPath[] = [];

  constructor(private readonly options: ConnectionControllerOptions) {}

  initialize(): void {
    byId('connectionButton').addEventListener('click', () => this.openDialog());
    queryAll<HTMLElement>('[data-connection-close]').forEach((button) => {
      button.addEventListener('click', () => byId<HTMLDialogElement>('connectionDialog').close());
    });
    byId('connectionSwap').addEventListener('click', () => {
      const source = byId<HTMLInputElement>('connectionFrom');
      const target = byId<HTMLInputElement>('connectionTo');
      [source.value, target.value] = [target.value, source.value];
    });
    byId<HTMLFormElement>('connectionForm').addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitDialog();
    });
  }

  isActive(): boolean {
    return this.activeState !== null;
  }

  openDialog(): void {
    const selected = this.options.currentSelection();
    const selectedNode = selected?.kind === 'node' ? this.options.model.nodeRecord.get(selected.id) : null;
    const source = this.activeState?.sourceId ?? selectedNode?.id ?? '';
    const target = this.activeState?.targetId ?? '';
    byId<HTMLInputElement>('connectionFrom').value = source ? this.nodeInputValue(source) : '';
    byId<HTMLInputElement>('connectionTo').value = target ? this.nodeInputValue(target) : '';
    byId<HTMLSelectElement>('connectionDirection').value = this.activeState?.direction ?? 'either';
    byId('connectionError').textContent = '';
    byId<HTMLDialogElement>('connectionDialog').showModal();
    window.setTimeout(() => byId<HTMLInputElement>(source ? 'connectionTo' : 'connectionFrom').focus(), 0);
  }

  syncFromLocation({ fit = false }: { fit?: boolean } = {}): void {
    const next = readConnectionQueryState(new URL(window.location.href).searchParams, this.options.model.knownNodeIds);
    if (!next) {
      if (this.activeState) this.clearVisuals();
      this.activeState = null;
      this.paths = [];
      byId('connectionButton').classList.remove('active');
      byId('connectionButton').setAttribute('aria-pressed', 'false');
      return;
    }
    const changed = !this.activeState
      || this.activeState.sourceId !== next.sourceId
      || this.activeState.targetId !== next.targetId
      || this.activeState.direction !== next.direction;
    this.activeState = next;
    if (changed) this.options.prepareHighlight();
    this.refresh({ fit });
  }

  refresh({ fit = false }: { fit?: boolean } = {}): void {
    const state = this.activeState;
    if (!state) return;
    const visibleNodes = this.options.cy.nodes().not('.filter-hidden');
    const nodeIds = new Set(visibleNodes.map((node) => node.id()));
    const edges = this.options.cy.edges().not('.filter-hidden')
      .map((edge) => this.options.model.edgeRecord.get(edge.id()))
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));

    this.paths = findConnectionPaths({
      sourceId: state.sourceId,
      targetId: state.targetId,
      nodeIds,
      edges,
      direction: state.direction,
      maxPaths: 3,
      maxDepth: 12
    });
    if (state.pathIndex >= this.paths.length) {
      state.pathIndex = 0;
      this.writeLocation(state, 'replace');
    }
    this.renderDetails();
    this.applyHighlight(fit);
    byId('connectionButton').classList.add('active');
    byId('connectionButton').setAttribute('aria-pressed', 'true');
  }

  clear({ updateLocation = true }: { updateLocation?: boolean } = {}): void {
    if (!this.activeState) return;
    this.activeState = null;
    this.paths = [];
    this.clearVisuals();
    byId('connectionButton').classList.remove('active');
    byId('connectionButton').setAttribute('aria-pressed', 'false');
    if (updateLocation) this.writeLocation(null, 'replace');
  }

  private submitDialog(): void {
    const source = this.resolveNode(byId<HTMLInputElement>('connectionFrom').value);
    const target = this.resolveNode(byId<HTMLInputElement>('connectionTo').value);
    const error = byId('connectionError');
    if (!source || !target) {
      error.textContent = 'Choose two recognized concepts or enter their identifiers.';
      return;
    }
    if (source.id === target.id) {
      error.textContent = 'Choose two different concepts.';
      return;
    }
    const direction = byId<HTMLSelectElement>('connectionDirection').value === 'forward' ? 'forward' : 'either';
    this.activeState = { sourceId: source.id, targetId: target.id, direction, pathIndex: 0 };
    this.options.prepareHighlight();
    this.writeLocation(this.activeState, 'push');
    byId<HTMLDialogElement>('connectionDialog').close();
    this.refresh({ fit: true });
  }

  private resolveNode(raw: string) {
    const value = raw.trim();
    if (!value) return null;
    const bracketedId = value.match(/\[([^\]]+)\]\s*$/)?.[1];
    const direct = this.options.model.nodeRecord.get(bracketedId ?? value);
    if (direct?.kind === 'structure') return direct;
    const exact = this.options.model.data.nodes.filter((node) =>
      node.kind === 'structure' && normalize(node.label) === normalize(value));
    if (exact.length === 1) return exact[0] ?? null;
    return rankNodeMatches(
      this.options.model.data.nodes.filter((node) => node.kind === 'structure'),
      value,
      (node) => ({
        fieldLabels: this.options.model.nodeFieldLabels(node),
        domainLabels: this.options.model.nodeDomainLabels(node)
      })
    )[0]?.node ?? null;
  }

  private nodeInputValue(nodeId: string): string {
    const node = this.options.model.nodeRecord.get(nodeId);
    return node ? `${node.label} [${node.id}]` : nodeId;
  }

  private renderDetails(): void {
    const state = this.activeState;
    if (!state) return;
    const source = this.options.model.nodeRecord.get(state.sourceId);
    const target = this.options.model.nodeRecord.get(state.targetId);
    if (!source || !target) return;
    renderHtml(byId('detailTitle'), `${this.options.math.renderText(source.label)} <span class="connection-title-arrow" aria-hidden="true">↔</span> ${this.options.math.renderText(target.label)}`);
    renderHtml(byId('detailEditLink'), `<div class="connection-actions">
      <button type="button" class="detail-header-action connection-copy-link" title="Copy connection permalink" aria-label="Copy connection permalink"><span class="material-icons" aria-hidden="true">link</span></button>
      <button type="button" class="detail-header-action connection-copy-sequence" title="Copy node sequence as YAML" aria-label="Copy node sequence as YAML"><span class="material-icons" aria-hidden="true">content_copy</span></button>
      <button type="button" class="detail-header-action connection-exit" title="Exit connection explorer" aria-label="Exit connection explorer"><span class="material-icons" aria-hidden="true">close</span></button>
    </div>`);

    const sourceElement = this.options.cy.getElementById(state.sourceId);
    const targetElement = this.options.cy.getElementById(state.targetId);
    const sourceVisible = !sourceElement.empty() && !sourceElement.hasClass('filter-hidden');
    const targetVisible = !targetElement.empty() && !targetElement.hasClass('filter-hidden');
    if (!sourceVisible || !targetVisible) {
      renderHtml(byId('detailBody'), `<section class="connection-summary">
        <div class="kicker">Connection explorer</div>
        <p>One or both endpoints are hidden by the current field, domain, or display filters.</p>
        <button type="button" class="button connection-open-filters">Open filters</button>
      </section>`);
      this.bindDetailsActions();
      this.options.openDetails();
      return;
    }

    if (!this.paths.length) {
      const directed = state.direction === 'forward'
        ? ' while following relation arrows only'
        : '';
      renderHtml(byId('detailBody'), `<section class="connection-summary">
        <div class="kicker">Connection explorer</div>
        <p>No path of twelve or fewer visible relations was found${directed}. The result uses only nodes and edge types admitted by the current filters.</p>
        <div class="connection-empty-actions">
          ${state.direction === 'forward' ? '<button type="button" class="button connection-use-either">Search either direction</button>' : ''}
          <button type="button" class="button connection-open-filters">Open filters</button>
        </div>
      </section>`);
      this.bindDetailsActions();
      this.options.openDetails();
      return;
    }

    const activePath = this.paths[state.pathIndex] ?? this.paths[0];
    if (!activePath) return;
    const alternatives = this.paths.length > 1 ? `<div class="connection-alternatives" role="group" aria-label="Alternative connection paths">
      ${this.paths.map((path, index) => `<button type="button" class="connection-alternative${index === state.pathIndex ? ' active' : ''}" data-connection-path="${index}" aria-pressed="${index === state.pathIndex}">Path ${index + 1}<span>${path.steps.length} relation${path.steps.length === 1 ? '' : 's'}</span></button>`).join('')}
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

    renderHtml(byId('detailBody'), `<section class="connection-summary">
      <div class="kicker">Connection explorer</div>
      <p>${activePath.steps.length} visible relation${activePath.steps.length === 1 ? '' : 's'} · ${state.direction === 'forward' ? 'following authored arrows' : 'either traversal direction'}</p>
      ${alternatives}
    </section>
    <ol class="connection-path">${sequence}</ol>
    <p class="connection-method muted">Paths are ranked first by relation count, then deterministically by concept and edge identifiers. They use the current visible graph and do not claim that every traversal direction is a logical derivation.</p>`);
    this.bindDetailsActions();
    this.options.openDetails();
  }

  private bindDetailsActions(): void {
    queryAll<HTMLElement>('[data-connection-path]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.activeState) return;
        this.activeState.pathIndex = Number.parseInt(button.dataset.connectionPath ?? '0', 10) || 0;
        this.writeLocation(this.activeState, 'replace');
        this.renderDetails();
        this.applyHighlight(true);
      });
    });
    queryAll<HTMLElement>('[data-connection-node]').forEach((button) => {
      button.addEventListener('click', () => this.options.activateNode(button.dataset.connectionNode ?? ''));
    });
    queryAll<HTMLElement>('[data-connection-edge]').forEach((button) => {
      button.addEventListener('click', () => this.options.activateEdge(button.dataset.connectionEdge ?? ''));
    });
    document.querySelector('.connection-open-filters')?.addEventListener('click', () => this.options.openFilters());
    document.querySelector('.connection-use-either')?.addEventListener('click', () => {
      if (!this.activeState) return;
      this.activeState.direction = 'either';
      this.activeState.pathIndex = 0;
      this.writeLocation(this.activeState, 'replace');
      this.refresh({ fit: true });
    });
    document.querySelector('.connection-exit')?.addEventListener('click', () => {
      this.clear();
      renderHtml(byId('detailTitle'), 'Select a concept');
      renderHtml(byId('detailEditLink'), '');
      renderHtml(byId('detailBody'), '<p>Click any concept, construction junction, or annotated edge.</p>');
    });
    document.querySelector('.connection-copy-link')?.addEventListener('click', () => this.copyText(window.location.href, '.connection-copy-link'));
    document.querySelector('.connection-copy-sequence')?.addEventListener('click', () => {
      const path = this.activeState ? this.paths[this.activeState.pathIndex] ?? this.paths[0] : null;
      if (!path) return;
      const yaml = `nodeSequence:\n${path.nodeIds.map((nodeId) => `  - ${nodeId}`).join('\n')}`;
      this.copyText(yaml, '.connection-copy-sequence');
    });
  }

  private async copyText(text: string, selector: string): Promise<void> {
    const button = document.querySelector<HTMLElement>(selector);
    if (!button) return;
    try {
      await navigator.clipboard.writeText(text);
      button.classList.add('copied');
      window.setTimeout(() => button.classList.remove('copied'), 900);
    } catch {
      window.prompt('Copy:', text);
    }
  }

  private applyHighlight(fit: boolean): void {
    this.clearVisuals();
    const state = this.activeState;
    const path = state ? this.paths[state.pathIndex] ?? this.paths[0] : null;
    if (!path) return;
    const { cy } = this.options;
    const nodeIds = new Set(path.nodeIds);
    const edgeIds = new Set(path.steps.map((step) => step.edgeId));
    const visible = cy.elements().not('.filter-hidden');
    visible.addClass('connection-dim');
    const pathElements = visible.filter((element) =>
      element.isNode() ? nodeIds.has(element.id()) : edgeIds.has(element.id()));
    pathElements.removeClass('connection-dim').addClass('connection-emphasis');
    cy.getElementById(path.nodeIds[0] ?? '').addClass('connection-endpoint');
    cy.getElementById(path.nodeIds[path.nodeIds.length - 1] ?? '').addClass('connection-endpoint');
    this.options.refreshEdgeStyles();
    if (fit && !pathElements.empty()) this.options.fitElements(pathElements, 110);
  }

  private clearVisuals(): void {
    this.options.cy.elements().removeClass('connection-dim connection-emphasis connection-endpoint');
    this.options.refreshEdgeStyles();
  }

  private writeLocation(state: ConnectionQueryState | null, mode: 'push' | 'replace'): void {
    const url = new URL(window.location.href);
    writeConnectionQueryState(url.searchParams, state);
    if (state) {
      url.searchParams.delete('node');
      url.searchParams.delete('edge');
      url.searchParams.set('selection', 'none');
    } else if (url.searchParams.get('selection') === 'none') {
      url.searchParams.delete('selection');
    }
    if (url.href === window.location.href) return;
    const historyState = { ...(window.history.state ?? {}), connection: state };
    if (mode === 'push') window.history.pushState(historyState, '', url.href);
    else window.history.replaceState(historyState, '', url.href);
  }
}

import type cytoscape from 'cytoscape';
import { byId, escapeHtml, queryAll } from '../core/dom.js';
import { rankNodeMatches } from '../core/search.js';
import { stripInlineMathText } from '../core/text.js';
import {
  analyzeConceptComparison,
  setComparisonParam,
  type ComparisonRelation,
  type ConceptComparisonAnalysis
} from '../model/concept-comparison.js';
import type { GraphModel } from '../model/graph-model.js';
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
  onComparisonChange: (nodeIds: readonly string[], mode: Exclude<HistoryMode, null>) => void;
}

type ComparisonSlots = [string | null, string | null];

function samePair(left: readonly string[] | null, right: readonly string[] | null): boolean {
  return Boolean(left && right && left.length === 2 && right.length === 2 && left[0] === right[0] && left[1] === right[1]);
}

export class CompareController {
  private slots: ComparisonSlots = [null, null];
  private readonly displayToId = new Map<string, string>();
  private readonly idToDisplay = new Map<string, string>();
  private readonly nodes: GraphNode[];

  constructor(private readonly options: CompareControllerOptions) {
    this.nodes = options.model.data.nodes
      .filter((node) => node.kind === 'structure')
      .sort((a, b) => stripInlineMathText(a.label).localeCompare(stripInlineMathText(b.label)) || a.id.localeCompare(b.id));
  }

  initialize(initialNodeIds: readonly string[]): void {
    this.buildConceptOptions();
    this.bindControls();
    this.syncFromLocation(initialNodeIds);
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

  syncFromLocation(nodeIds: readonly string[]): void {
    this.slots = nodeIds.length === 2 && this.isStructureNode(nodeIds[0]) && this.isStructureNode(nodeIds[1]) && nodeIds[0] !== nodeIds[1]
      ? [nodeIds[0], nodeIds[1]]
      : [null, null];
    this.setStatus(this.completePair() ? 'Comparison ready.' : 'Choose two concepts to compare.');
    this.refresh();
  }

  refresh(): void {
    this.syncInputs();
    this.renderComparison();
    this.applyGraphHighlights();
    this.syncToolbarButton();
  }

  private completePair(): readonly [string, string] | null {
    const [left, right] = this.slots;
    return left && right && left !== right ? [left, right] : null;
  }

  private currentStructureSelection(): string | null {
    const selection = this.options.currentSelection();
    return selection?.kind === 'node' && this.isStructureNode(selection.id) ? selection.id : null;
  }

  private isStructureNode(nodeId: string | null | undefined): nodeId is string {
    return Boolean(nodeId && this.options.model.nodeRecord.get(nodeId)?.kind === 'structure');
  }

  private includePreferredNode(nodeId: string): void {
    const previous = this.completePair();
    if (this.slots[0] === nodeId || this.slots[1] === nodeId) return;
    if (!this.slots[0]) this.slots = [nodeId, this.slots[1]];
    else if (!this.slots[1]) this.slots = [this.slots[0], nodeId];
    else this.slots = [nodeId, this.slots[0]];
    this.publishComparisonChange(previous);
    this.setStatus(this.completePair() ? 'Comparison ready.' : 'Choose the second concept.');
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
      const previous = this.completePair();
      this.slots = [this.slots[1], this.slots[0]];
      this.publishComparisonChange(previous);
      this.refresh();
    });
    byId('compareClearButton').addEventListener('click', () => {
      const previous = this.completePair();
      this.slots = [null, null];
      this.publishComparisonChange(previous);
      this.setStatus('Comparison cleared.');
      this.refresh();
    });
    byId('compareCopyButton').addEventListener('click', async () => {
      const pair = this.completePair();
      if (!pair) {
        this.setStatus('Choose two concepts before copying a comparison link.', true);
        return;
      }
      const url = new URL(window.location.href);
      setComparisonParam(url.searchParams, pair);
      const button = byId<HTMLButtonElement>('compareCopyButton');
      const originalHtml = button.innerHTML;
      try {
        await navigator.clipboard.writeText(url.toString());
        invalidateRender(button);
        button.textContent = 'Copied';
      } catch {
        window.prompt('Copy comparison link:', url.toString());
      } finally {
        window.setTimeout(() => renderHtml(button, originalHtml), 1200);
      }
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
    const previous = this.completePair();
    const value = rawValue.trim();
    if (!value) {
      this.slots[index] = null;
      this.publishComparisonChange(previous);
      this.setStatus('Choose two concepts to compare.');
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
    this.publishComparisonChange(previous);
    this.setStatus(this.completePair() ? 'Comparison ready.' : 'Choose the second concept.');
    this.refresh();
  }

  private resolveNodeId(value: string): string | null {
    const directId = this.options.model.nodeRecord.get(value);
    if (directId?.kind === 'structure') return directId.id;
    const displayId = this.displayToId.get(value.toLocaleLowerCase());
    if (displayId) return displayId;
    const matches = rankNodeMatches(this.nodes, value, (node) => ({
      fieldLabels: this.options.model.nodeFieldLabels(node),
      domainLabels: this.options.model.nodeDomainLabels(node)
    }));
    return matches[0]?.node.id ?? null;
  }

  private publishComparisonChange(previous: readonly string[] | null): void {
    const next = this.completePair();
    if (samePair(previous, next) || (!previous && !next)) return;
    this.options.onComparisonChange(next ?? [], 'push');
  }

  private syncInputs(): void {
    byId<HTMLInputElement>('compareLeftInput').value = this.slots[0] ? this.idToDisplay.get(this.slots[0]) ?? this.slots[0] : '';
    byId<HTMLInputElement>('compareRightInput').value = this.slots[1] ? this.idToDisplay.get(this.slots[1]) ?? this.slots[1] : '';
    byId<HTMLButtonElement>('compareSwapButton').disabled = !this.slots[0] && !this.slots[1];
    byId<HTMLButtonElement>('compareClearButton').disabled = !this.slots[0] && !this.slots[1];
    byId<HTMLButtonElement>('compareCopyButton').disabled = !this.completePair();
  }

  private syncToolbarButton(): void {
    const button = byId<HTMLButtonElement>('compareButton');
    const pair = this.completePair();
    button.classList.toggle('active', Boolean(pair));
    button.setAttribute('aria-pressed', String(Boolean(pair)));
    button.title = pair ? 'Open the active concept comparison' : 'Compare two concepts';
  }

  private applyGraphHighlights(): void {
    const { cy } = this.options;
    cy.elements().removeClass('comparison-a comparison-b comparison-shared comparison-direct');
    const [leftId, rightId] = this.slots;
    if (leftId) cy.getElementById(leftId).addClass('comparison-a');
    if (rightId) cy.getElementById(rightId).addClass('comparison-b');
    const pair = this.completePair();
    if (!pair) return;
    const analysis = analyzeConceptComparison(this.options.model, pair[0], pair[1], this.options.selectedEdgeTypes());
    if (!analysis) return;
    for (const neighbor of analysis.sharedNeighbors) cy.getElementById(neighbor.nodeId).addClass('comparison-shared');
    for (const relation of analysis.directRelations) cy.getElementById(relation.edgeId).addClass('comparison-direct');
  }

  private renderComparison(): void {
    const pair = this.completePair();
    if (!pair) {
      renderHtml(byId('compareContent'), `
        <div class="compare-empty">
          <span class="material-icons" aria-hidden="true">compare_arrows</span>
          <h3>Choose two concepts</h3>
          <p>The comparison uses the currently enabled relation types and remains shareable in the URL once both concepts are chosen.</p>
        </div>`);
      return;
    }
    const analysis = analyzeConceptComparison(this.options.model, pair[0], pair[1], this.options.selectedEdgeTypes());
    if (!analysis) return;
    renderHtml(byId('compareContent'), this.renderAnalysis(analysis));
    queryAll<HTMLButtonElement>('[data-compare-node-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const nodeId = button.dataset.compareNodeId;
        if (!nodeId) return;
        byId<HTMLDialogElement>('compareDialog').close();
        this.options.activateNode(nodeId);
      });
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
}

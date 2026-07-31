import type cytoscape from 'cytoscape';
import { byId, escapeHtml, queryAll } from '../core/dom.js';
import { shortenSourceLabel } from '../core/text.js';
import type { AtlasView, DetailSection, GraphNode, RelationGroup } from '../types.js';
import type { GraphModel } from '../model/graph-model.js';
import { viewsContainingNode } from '../state/view-sequence.js';
import type { MathRenderer } from './math-renderer.js';
import { invalidateRender, renderHtml } from './render.js';

interface DetailsControllerOptions {
  model: GraphModel;
  cy: cytoscape.Core;
  math: MathRenderer;
  conceptPageUrl: (nodeId: string) => string;
  fieldPageUrl: (fieldId: string) => string;
  domainPageUrl: (domainId: string) => string;
  itemUrl: (itemId: string, itemKind: 'node' | 'edge') => string;
  permalinkUrl: (itemId: string, itemKind: 'node' | 'edge') => string;
  githubEditUrl: (itemId: string) => string;
  views: readonly AtlasView[];
  viewNodeUrl: (viewId: string, nodeId: string) => string;
  activateNode: (nodeId: string) => void;
  activateEdge: (edgeId: string) => void;
  compareNode: (nodeId: string) => void;
  experimentalFeatures: () => boolean;
  openPanel: () => void;
  navigate: (href: string) => void;
}

export class DetailsController {
  constructor(private readonly options: DetailsControllerOptions) {}

  showNode(id: string): void {
    delete byId('detailBody').dataset.structureOverlay;
    const { model, cy } = this.options;
    const record = model.nodeRecord.get(id);
    if (!record) return;
    renderHtml(byId('detailTitle'), this.options.math.renderText(record.label));

    let html = `<p class="math-rich concept-summary">${this.options.math.renderText(record.summary)}</p>${this.renderTaxonomyBadges(record)}${this.renderConceptMetadata(record)}${this.renderCitations(record.citations, record.label)}`;
    if (record.kind === 'junction' && record.combination) {
      const combination = record.combination;
      html += `
        <section class="detail-section">
          <h3>Inputs</h3>
          <p>${combination.inputs.map((nodeId) => this.nodeButton(nodeId)).join(' + ')}</p>
        </section>
        <section class="detail-section compatibility-box">
          <h3>Compatibility condition</h3>
          <p class="math-rich">${this.options.math.renderText(combination.compatibility)}</p>
        </section>
        <section class="detail-section">
          <h3>Result</h3>
          <p>${this.nodeButton(combination.output)}</p>
        </section>`;
    } else {
      html += this.renderListSection('Carrier(s)', record.carriers);
      html += this.renderListSection('Data', record.data);
      html += this.renderListSection('Axioms / constraints', record.axioms);
      html += this.renderListSection('Canonically induces', record.induces);
      for (const section of record.sections ?? []) html += this.renderGenericSection(section);
      if (record.notes) html += `<section class="detail-section math-rich"><h3>Notes</h3><p>${this.options.math.renderText(record.notes)}</p></section>`;

      const relationGroups = this.nodeRelationGroups(cy.getElementById(id));
      if (relationGroups.length) {
        html += '<section class="detail-section"><h3>Relations</h3>';
        for (const group of relationGroups) {
          const items = group.relations.map((relation) => {
            const edgeLabel = `<a class="relation-label relation-link" data-edge-id="${escapeHtml(relation.edgeId)}" href="${escapeHtml(this.options.itemUrl(relation.edgeId, 'edge'))}">[${this.options.math.renderText(relation.edgeLabel)}]</a>`;
            return relation.direction === 'source'
              ? `${this.relationLink(relation.nodeId)} ${edgeLabel}`
              : `${this.relationLink(relation.nodeId)} <span class="relation-via">via</span> ${edgeLabel}`;
          });
          html += items.length === 1
            ? `<p><span class="muted">${escapeHtml(group.label)}:</span> ${items[0]}</p>`
            : `<div class="relation-block"><div class="muted">${escapeHtml(group.label)}:</div>${items.map((item) => `<div class="relation-item">${item}</div>`).join('')}</div>`;
        }
        html += '</section>';
      }
    }

    html += this.renderViewsSection(id);
    renderHtml(byId('detailBody'), html);
    renderHtml(byId('detailEditLink'), this.renderHeaderActions(id, 'node'));
    this.bindHeaderActions();
    this.bindRelationLinks();
    this.bindTaxonomyLinks();
    this.options.openPanel();
  }

  showEdge(id: string): void {
    delete byId('detailBody').dataset.structureOverlay;
    const { model } = this.options;
    const record = model.edgeRecord.get(id);
    if (!record) return;
    const type = model.data.edgeTypes[record.type];
    const source = model.nodeRecord.get(record.source);
    const target = model.nodeRecord.get(record.target);
    if (!type || !source || !target) return;

    renderHtml(byId('detailEditLink'), this.renderHeaderActions(id, 'edge'));
    this.bindHeaderActions();

    if (record.synthetic) {
      const junction = record.junctionId ? model.nodeRecord.get(record.junctionId) : undefined;
      const combination = junction?.combination;
      if (!combination) return;
      const title = `${source.label} → ${target.label}`;
      renderHtml(byId('detailTitle'), this.options.math.renderText(title));
      renderHtml(byId('detailBody'), `
        <p><span class="type-pill" style="background:${escapeHtml(type.color)}">${escapeHtml(type.label)}</span></p>
        <p>${this.nodeButton(source.id)} <strong>→</strong> ${this.nodeButton(target.id)}</p>
        <section class="detail-section compatibility-box">
          <h3>Joint construction</h3>
          <p>This direct edge replaces a hidden construction junction. It is an <strong>AND</strong> relation: every listed input is required, not an alternative route.</p>
          <p>${combination.inputs.map((nodeId) => this.nodeButton(nodeId)).join(' + ')}</p>
        </section>
        <section class="detail-section math-rich"><h3>Compatibility condition</h3><p>${this.options.math.renderText(combination.compatibility)}</p></section>
        <section class="detail-section math-rich"><h3>This branch</h3><p>${this.options.math.renderText(record.detail)}</p></section>
        <section class="detail-section"><h3>Sources</h3>${this.renderCitations(record.citations, title)}</section>`);
    } else {
      renderHtml(byId('detailTitle'), this.options.math.renderText(record.label));
      renderHtml(byId('detailBody'), `
        <p><span class="type-pill" style="background:${escapeHtml(type.color)}">${escapeHtml(type.label)}</span></p>
        <p>${this.nodeButton(source.id)} <strong>→</strong> ${this.nodeButton(target.id)}</p>
        <section class="detail-section math-rich"><h3>What changes</h3><p>${this.options.math.renderText(record.detail)}</p></section>
        <section class="detail-section math-rich"><h3>How to interpret this edge type</h3><p>${this.options.math.renderText(type.description)}</p></section>
        <section class="detail-section"><h3>Sources</h3>${this.renderCitations(record.citations, record.label)}</section>`);
    }
    this.bindRelationLinks();
    this.options.openPanel();
  }

  showEmpty(): void {
    delete byId('detailBody').dataset.structureOverlay;
    byId('detailTitle').textContent = 'Select a concept';
    renderHtml(byId('detailEditLink'), '');
    renderHtml(byId('detailBody'), `
      <p>Click any concept, construction junction, or annotated edge.</p>
      <p class="muted">Construction junctions are diamonds. They show where multiple structures must coexist on the same carrier and satisfy compatibility conditions.</p>`);
  }

  private renderViewsSection(nodeId: string): string {
    const matches = viewsContainingNode(this.options.views, nodeId);
    if (!matches.length) return '';
    return `<section class="detail-section"><h3>Stories</h3><div class="detail-view-list">${matches.map(({ view, sequenceIndex }) => `
      <a class="detail-view-link" href="${escapeHtml(this.options.viewNodeUrl(view.id, nodeId))}">
        <span class="material-symbols-outlined" aria-hidden="true">library_books</span>
        <span class="detail-view-copy"><strong>${this.options.math.renderText(view.title)}</strong><span>Start at step ${sequenceIndex + 1} of ${view.nodeSequence?.length ?? 0}</span></span>
      </a>`).join('')}</div></section>`;
  }

  private renderTaxonomyBadges(node: GraphNode): string {
    const { model } = this.options;
    const fieldBadges = model.nodeFieldIds(node).map((fieldId) => {
      const field = model.data.fields[fieldId];
      if (!field) return '';
      const primaryClass = fieldId === model.nodePrimaryField(node) ? ' primary' : '';
      return `<a class="domain-badge field-badge${primaryClass}" href="${escapeHtml(this.options.fieldPageUrl(fieldId))}" style="--domain-color:${escapeHtml(field.color)}"><span class="domain-dot"></span>${escapeHtml(field.label)}</a>`;
    }).join('');
    const domainBadges = model.nodeDomainIds(node).map((domainId) => {
      const domain = model.data.domains[domainId];
      if (!domain) return '';
      const primaryClass = domainId === node.primaryDomain ? ' primary' : '';
      const title = domainId === node.primaryDomain ? `${domain.label} — primary layout domain` : domain.label;
      return `<a class="domain-badge${primaryClass}" href="${escapeHtml(this.options.domainPageUrl(domainId))}" style="--domain-color:${escapeHtml(domain.color)}" title="${escapeHtml(title)}"><span class="domain-dot"></span>${escapeHtml(domain.label)}</a>`;
    }).join('');
    return `<div class="domain-badges" aria-label="Fields and domains">${fieldBadges}${domainBadges}</div>`;
  }

  private renderConceptMetadata(node: GraphNode): string {
    const entries: Array<[string, string]> = [];
    if (node.conceptType) entries.push(['Type', node.conceptType]);
    if (node.scale) entries.push(['Scale', node.scale]);
    if (node.status) entries.push(['Status', node.status]);
    if (!entries.length) return '';
    return `<dl class="concept-metadata">${entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
  }

  private renderCitations(ids: readonly string[], recordLabel: string): string {
    if (!ids.length) return '<span class="muted">No citation attached.</span>';
    const { model } = this.options;
    return `<div class="citations"><span class="citation-prefix">See:&nbsp;</span>${ids.map((id) => {
      const source = model.data.sources[id];
      if (!source) return '';
      const label = shortenSourceLabel(source.label, recordLabel, model.data.citationLegend);
      return `<a class="citation-badge" href="${escapeHtml(source.url)}" target="_blank" rel="noopener" title="${escapeHtml(source.title)}">${this.options.math.renderText(label)}</a>`;
    }).join('')}</div>`;
  }

  private renderListSection(title: string, items?: readonly string[]): string {
    if (!items?.length) return '';
    return `<section class="detail-section math-rich"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${this.options.math.renderText(item)}</li>`).join('')}</ul></section>`;
  }

  private renderGenericSection(section: DetailSection): string {
    const body = section.body ? `<p>${this.options.math.renderText(section.body)}</p>` : '';
    const items = section.items?.length ? `<ul>${section.items.map((item) => `<li>${this.options.math.renderText(item)}</li>`).join('')}</ul>` : '';
    return `<section class="detail-section math-rich"><h3>${escapeHtml(section.title)}</h3>${body}${items}</section>`;
  }

  private nodeButton(id: string): string {
    const record = this.options.model.nodeRecord.get(id);
    if (!record) return escapeHtml(id);
    return `<a class="text-button relation-link" data-node-id="${escapeHtml(id)}" href="${escapeHtml(this.options.conceptPageUrl(id))}">${this.options.math.renderText(record.label)}</a>`;
  }

  private relationLink(id: string): string {
    const record = this.options.model.nodeRecord.get(id);
    if (!record) return escapeHtml(id);
    const hidden = this.options.cy.getElementById(id).hasClass('filter-hidden');
    const className = hidden ? 'relation-link filtered-relation-link' : 'relation-link';
    return `<a class="text-button ${className}" data-node-id="${escapeHtml(id)}" href="${escapeHtml(this.options.conceptPageUrl(id))}">${this.options.math.renderText(record.label)}</a>`;
  }

  private nodeRelationGroups(element: cytoscape.CollectionReturnValue): RelationGroup[] {
    const groups = new Map<string, RelationGroup['relations']>();
    const add = (label: string, nodeId: string, edgeId: string, edgeLabel: string, direction: 'source' | 'target'): void => {
      const relations = groups.get(label) ?? [];
      if (!relations.some((relation) => relation.nodeId === nodeId && relation.edgeId === edgeId)) {
        relations.push({ nodeId, edgeId, edgeLabel, direction });
        groups.set(label, relations);
      }
    };

    element.incomers('edge').forEach((edge) => {
      const endpointLabels = this.options.model.data.edgeTypes[String(edge.data('type'))]?.endpointLabels;
      if (endpointLabels) add(endpointLabels.target, edge.source().id(), edge.id(), String(edge.data('label') ?? ''), 'source');
    });
    element.outgoers('edge').forEach((edge) => {
      const endpointLabels = this.options.model.data.edgeTypes[String(edge.data('type'))]?.endpointLabels;
      if (endpointLabels) add(endpointLabels.source, edge.target().id(), edge.id(), String(edge.data('label') ?? ''), 'target');
    });
    return Array.from(groups, ([label, relations]) => ({ label, relations }));
  }

  private renderHeaderActions(itemId: string, itemKind: 'node' | 'edge'): string {
    const permalink = this.options.permalinkUrl(itemId, itemKind);
    const compareHref = itemKind === 'node' ? this.options.itemUrl(itemId, 'node') : '#';
    return `<div class="detail-header-actions" data-item-id="${escapeHtml(itemId)}" data-item-kind="${itemKind}">
      <a href="${escapeHtml(permalink)}" class="detail-header-action" id="detailShareButton" aria-label="Copy permalink" title="Copy permalink">
        <span class="material-symbols-outlined" aria-hidden="true">link</span>
      </a>
      ${itemKind === 'node' ? `<a href="${escapeHtml(compareHref)}" class="detail-header-action" id="detailCompareButton"${this.options.experimentalFeatures() ? '' : ' hidden'} aria-label="Compare concept" title="Compare concept">
        <span class="material-symbols-outlined" aria-hidden="true">compare_arrows</span>
      </a>` : ''}
      <a href="${escapeHtml(this.options.githubEditUrl(itemId))}" class="detail-header-action" id="detailEditButton" aria-label="Edit item" title="Edit item" target="_blank" rel="noopener">
        <span class="material-symbols-outlined" aria-hidden="true">edit</span>
      </a>
    </div>`;
  }

  private bindHeaderActions(): void {
    const container = document.querySelector<HTMLDivElement>('.detail-header-actions');
    if (!container) return;
    const itemId = container.dataset.itemId;
    const itemKind = container.dataset.itemKind;
    if (!itemId || (itemKind !== 'node' && itemKind !== 'edge')) return;
    const compareButton = document.getElementById('detailCompareButton');
    compareButton?.addEventListener('click', (event) => {
      event.preventDefault();
      if (itemKind === 'node') this.options.compareNode(itemId);
    });
    const shareButton = document.getElementById('detailShareButton');
    if (!shareButton) return;
    shareButton.addEventListener('click', async (event) => {
      event.preventDefault();
      const originalHtml = shareButton.innerHTML;
      const permalink = this.options.permalinkUrl(itemId, itemKind);
      try {
        await navigator.clipboard.writeText(permalink);
        invalidateRender(shareButton);
        shareButton.textContent = '✓';
      } catch {
        window.prompt('Copy permalink:', permalink);
      } finally {
        window.setTimeout(() => { renderHtml(shareButton, originalHtml); }, 1200);
      }
    });
  }

  private bindRelationLinks(): void {
    queryAll<HTMLAnchorElement>('.relation-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.button !== 0 || mouseEvent.metaKey || mouseEvent.ctrlKey || mouseEvent.shiftKey || mouseEvent.altKey) return;
        event.preventDefault();
        if (link.dataset.edgeId) this.options.activateEdge(link.dataset.edgeId);
        else if (link.dataset.nodeId) this.options.activateNode(link.dataset.nodeId);
      });
    });
  }

  private bindTaxonomyLinks(): void {
    queryAll<HTMLAnchorElement>('.domain-badge').forEach((link) => {
      link.addEventListener('click', (event) => {
        const mouseEvent = event as MouseEvent;
        if (mouseEvent.button !== 0 || mouseEvent.metaKey || mouseEvent.ctrlKey || mouseEvent.shiftKey || mouseEvent.altKey) return;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (!href) return;
        this.options.navigate(href);
      });
    });
  }
}

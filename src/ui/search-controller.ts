import { escapeHtml } from '../core/dom.js';
import type { NodeSearchIndex, NodeSearchResult, RankedNodeMatch } from '../core/search.js';
import { stripInlineMathText, summarizePlainText } from '../core/text.js';
import { renderHtml } from './render.js';

interface SearchControllerOptions {
  root: HTMLElement;
  input: HTMLInputElement;
  results: HTMLElement;
  button: HTMLButtonElement;
  index: NodeSearchIndex;
  resultLimit?: number;
  onSearch: (query: string, result: NodeSearchResult, preferredNodeId: string | null) => void;
  onClear: () => void;
}

export class SearchController {
  private activeIndex = -1;
  private currentResult: NodeSearchResult = { normalizedQuery: '', matches: [], total: 0 };
  private currentRawQuery = '';
  private updateScheduled = false;
  private composing = false;

  constructor(private readonly options: SearchControllerOptions) {}

  initialize(): void {
    const { input, results, button, root } = this.options;
    input.addEventListener('input', () => {
      this.options.onClear();
      this.queueSuggestions();
    });
    input.addEventListener('search', () => {
      this.options.onClear();
      this.queueSuggestions();
    });
    input.addEventListener('focus', () => this.queueSuggestions());
    input.addEventListener('compositionstart', () => { this.composing = true; });
    input.addEventListener('compositionend', () => {
      this.composing = false;
      this.queueSuggestions();
    });
    input.addEventListener('keydown', (event) => this.handleKeydown(event));
    input.addEventListener('blur', () => window.setTimeout(() => this.close(), 0));
    button.addEventListener('click', () => this.submit());

    results.addEventListener('pointerdown', (event) => event.preventDefault());
    results.addEventListener('pointermove', (event) => {
      const option = this.resultOptionFromEvent(event);
      if (!option) return;
      const index = Number(option.dataset.searchResultIndex);
      if (Number.isInteger(index)) this.setActiveIndex(index);
    });
    results.addEventListener('click', (event) => {
      const option = this.resultOptionFromEvent(event);
      const nodeId = option?.dataset.searchNodeId;
      if (nodeId) this.submit(nodeId);
    });
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && !root.contains(event.target)) this.close();
    });
  }

  focus(): void {
    this.options.input.focus();
    this.options.input.select();
  }

  clear(): void {
    this.options.input.value = '';
    this.currentRawQuery = '';
    this.currentResult = { normalizedQuery: '', matches: [], total: 0 };
    this.options.onClear();
    this.close();
  }

  close(): void {
    this.activeIndex = -1;
    this.options.results.hidden = true;
    this.options.input.setAttribute('aria-expanded', 'false');
    this.options.input.removeAttribute('aria-activedescendant');
  }

  submit(preferredNodeId: string | null = null): void {
    const query = this.options.input.value.trim();
    if (!query) {
      this.clear();
      return;
    }
    const result = this.resultForQuery(query);
    const preferred = preferredNodeId ?? this.activeMatch()?.node.id ?? null;
    this.options.onSearch(query, result, preferred);
    this.close();
  }

  private queueSuggestions(): void {
    if (this.composing || this.updateScheduled) return;
    this.updateScheduled = true;
    window.requestAnimationFrame(() => {
      this.updateScheduled = false;
      this.updateSuggestions();
    });
  }

  private updateSuggestions(): void {
    const query = this.options.input.value.trim();
    if (!query) {
      this.currentRawQuery = '';
      this.currentResult = { normalizedQuery: '', matches: [], total: 0 };
      this.options.onClear();
      this.close();
      return;
    }

    this.currentRawQuery = query;
    this.currentResult = this.options.index.search(query, { limit: this.options.resultLimit ?? 8 });
    this.activeIndex = this.currentResult.matches.length ? 0 : -1;
    this.renderResults();
    this.options.results.hidden = false;
    this.options.input.setAttribute('aria-expanded', 'true');
    this.syncActiveOption();
  }

  private resultForQuery(query: string): NodeSearchResult {
    if (query === this.currentRawQuery) {
      if (this.currentResult.total === this.currentResult.matches.length) return this.currentResult;
      return this.options.index.search(query);
    }
    return this.options.index.search(query);
  }

  private activeMatch(): RankedNodeMatch | null {
    return this.currentResult.matches[this.activeIndex] ?? null;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.composing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.options.results.hidden) this.updateSuggestions();
      const count = this.currentResult.matches.length;
      if (!count) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const start = this.activeIndex < 0 ? (delta > 0 ? -1 : 0) : this.activeIndex;
      this.setActiveIndex((start + delta + count) % count);
      return;
    }
    if (event.key === 'Home' && !this.options.results.hidden && this.currentResult.matches.length) {
      event.preventDefault();
      this.setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && !this.options.results.hidden && this.currentResult.matches.length) {
      event.preventDefault();
      this.setActiveIndex(this.currentResult.matches.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submit();
      return;
    }
    if (event.key === 'Escape' && !this.options.results.hidden) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  private renderResults(): void {
    const matches = this.currentResult.matches;
    const html = matches.length
      ? `${matches.map((match, index) => this.renderMatch(match, index)).join('')}${this.renderFooter()}`
      : '<div class="search-results-empty" role="status">No matching concepts</div>';
    renderHtml(this.options.results, html);
  }

  private renderMatch(match: RankedNodeMatch, index: number): string {
    const label = stripInlineMathText(match.node.label);
    const taxonomy = match.context.domainLabels.length
      ? match.context.domainLabels.slice(0, 2).join(' · ')
      : match.context.fieldLabels.slice(0, 2).join(' · ');
    const summary = summarizePlainText(match.node.summary, 120);
    return `<div id="searchResult${index}" class="search-result-option" role="option" aria-selected="false" data-search-result-index="${index}" data-search-node-id="${escapeHtml(match.node.id)}">
      <div class="search-result-heading"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(taxonomy)}</span></div>
      <div class="search-result-summary">${escapeHtml(summary)}</div>
      <code>${escapeHtml(match.node.id)}</code>
    </div>`;
  }

  private renderFooter(): string {
    const shown = this.currentResult.matches.length;
    const total = this.currentResult.total;
    const count = total === shown ? `${total} match${total === 1 ? '' : 'es'}` : `${shown} of ${total} matches`;
    return `<div class="search-results-footer" role="status">${count}<span><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> open</span></div>`;
  }

  private setActiveIndex(index: number): void {
    if (!this.currentResult.matches[index]) return;
    this.activeIndex = index;
    this.syncActiveOption();
  }

  private syncActiveOption(): void {
    const options = Array.from(this.options.results.querySelectorAll<HTMLElement>('[data-search-result-index]'));
    for (const [index, option] of options.entries()) {
      const active = index === this.activeIndex;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
      if (active) option.scrollIntoView({ block: 'nearest' });
    }
    if (this.activeIndex >= 0) this.options.input.setAttribute('aria-activedescendant', `searchResult${this.activeIndex}`);
    else this.options.input.removeAttribute('aria-activedescendant');
  }

  private resultOptionFromEvent(event: Event): HTMLElement | null {
    return event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-search-node-id]')
      : null;
  }
}

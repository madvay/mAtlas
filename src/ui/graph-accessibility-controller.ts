import type cytoscape from 'cytoscape';
import { stripInlineMathText, summarizePlainText } from '../core/text.js';
import type { GraphModel } from '../model/graph-model.js';

type GraphElement = cytoscape.NodeSingular | cytoscape.EdgeSingular;

export type GraphNavigationMode = 'nodes' | 'edges';
export type GraphNavigationDirection = 'left' | 'right' | 'up' | 'down';

export interface PositionedGraphItem {
  id: string;
  x: number;
  y: number;
}

interface GraphAccessibilityControllerOptions {
  cy: cytoscape.Core;
  model: GraphModel;
  graph: HTMLElement;
  activeItem: HTMLElement;
  status: HTMLElement;
  activateNode: (id: string, center: boolean) => void;
  activateEdge: (id: string, center: boolean) => void;
  activateSemanticNode: (element: cytoscape.NodeSingular) => void;
  activateSemanticEdge: (element: cytoscape.EdgeSingular) => void;
  clearSelection: () => void;
  fitVisible: () => void;
  zoomBy: (factor: number) => void;
}

export function nextSpatialItemIndex(
  items: readonly PositionedGraphItem[],
  currentIndex: number,
  direction: GraphNavigationDirection
): number {
  const current = items[currentIndex];
  if (!current || items.length < 2) return currentIndex;
  let bestIndex = currentIndex;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [index, candidate] of items.entries()) {
    if (index === currentIndex) continue;
    const dx = candidate.x - current.x;
    const dy = candidate.y - current.y;
    const primary = direction === 'left' ? -dx
      : direction === 'right' ? dx
      : direction === 'up' ? -dy
      : dy;
    if (primary <= 0) continue;
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.25;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex !== currentIndex) return bestIndex;
  const delta = direction === 'left' || direction === 'up' ? -1 : 1;
  return (currentIndex + delta + items.length) % items.length;
}

export class GraphAccessibilityController {
  private mode: GraphNavigationMode = 'nodes';
  private activeId: string | null = null;
  private items: GraphElement[] = [];

  constructor(private readonly options: GraphAccessibilityControllerOptions) {}

  initialize(): void {
    const { graph, cy } = this.options;
    graph.addEventListener('focus', () => this.refresh(true));
    graph.addEventListener('keydown', (event) => this.handleKeydown(event));
    cy.on('select unselect', () => {
      if (document.activeElement === graph) this.refresh(false);
    });
    this.refresh(false);
  }

  refresh(announce = false): void {
    const structureMode = this.options.cy.nodes('[semanticGroup = 1]').length > 0;
    const selector = this.mode === 'nodes'
      ? (structureMode ? 'node[semanticGroup = 1]' : 'node')
      : (structureMode ? 'edge[semanticConnection = 1]' : 'edge');
    this.items = this.options.cy.elements(selector)
      .not('.filter-hidden')
      .filter((element) => element.visible())
      .toArray()
      .sort((left, right) => {
        const a = this.elementPosition(left);
        const b = this.elementPosition(right);
        return a.y - b.y || a.x - b.x || left.id().localeCompare(right.id());
      });

    if (!this.items.length) {
      this.activeId = null;
      this.options.activeItem.textContent = `No visible ${this.mode === 'nodes' ? 'concepts' : 'relations'}.`;
      this.options.activeItem.setAttribute('aria-selected', 'false');
      if (announce) this.announce(this.options.activeItem.textContent);
      return;
    }

    const selected = this.items.find((element) => element.selected());
    const retained = this.items.find((element) => element.id() === this.activeId);
    this.activeId = (selected ?? retained ?? this.items[0])?.id() ?? null;
    this.syncActiveItem(announce);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (key === 'n' || key === 'N') {
      this.consume(event);
      this.setMode('nodes');
      return;
    }
    if (key === 'e' || key === 'E') {
      this.consume(event);
      this.setMode('edges');
      return;
    }
    if (key === 'Home' || key === 'End') {
      this.consume(event);
      if (!this.items.length) return;
      this.activeId = this.items[key === 'Home' ? 0 : this.items.length - 1]?.id() ?? null;
      this.syncActiveItem(true);
      return;
    }
    const direction = this.directionForKey(key);
    if (direction) {
      this.consume(event);
      this.move(direction);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      this.consume(event);
      this.activate(event.shiftKey);
      return;
    }
    if (key === '+' || key === '=') {
      this.consume(event);
      this.options.zoomBy(1.24);
      this.announce('Zoomed graph in.');
      return;
    }
    if (key === '-' || key === '_') {
      this.consume(event);
      this.options.zoomBy(1 / 1.24);
      this.announce('Zoomed graph out.');
      return;
    }
    if (key === '0') {
      this.consume(event);
      this.options.fitVisible();
      this.announce('Fit visible graph to the viewport.');
      return;
    }
    if (key === 'Escape') {
      this.consume(event);
      this.options.clearSelection();
      this.refresh(true);
    }
  }

  private setMode(mode: GraphNavigationMode): void {
    if (this.mode === mode && this.items.length) {
      this.syncActiveItem(true);
      return;
    }
    this.mode = mode;
    this.activeId = null;
    this.refresh(true);
  }

  private move(direction: GraphNavigationDirection): void {
    if (!this.items.length) {
      this.refresh(true);
      return;
    }
    const currentIndex = Math.max(0, this.items.findIndex((element) => element.id() === this.activeId));
    const positioned = this.items.map((element) => ({ id: element.id(), ...this.elementPosition(element) }));
    const nextIndex = nextSpatialItemIndex(positioned, currentIndex, direction);
    this.activeId = this.items[nextIndex]?.id() ?? this.activeId;
    this.syncActiveItem(true);
  }

  private activate(center: boolean): void {
    const element = this.items.find((candidate) => candidate.id() === this.activeId);
    if (!element) return;
    if (element.isNode()) {
      if (Number(element.data('semanticGroup')) === 1) this.options.activateSemanticNode(element);
      else this.options.activateNode(element.id(), center);
    } else if (Number(element.data('semanticConnection')) === 1) {
      this.options.activateSemanticEdge(element);
    } else {
      this.options.activateEdge(element.id(), center);
    }
    this.syncActiveItem(true);
  }

  private syncActiveItem(announce: boolean): void {
    const index = this.items.findIndex((element) => element.id() === this.activeId);
    const element = this.items[index];
    if (!element) return;
    const description = this.describe(element, index, this.items.length);
    this.options.activeItem.textContent = description;
    this.options.activeItem.setAttribute('aria-selected', String(element.selected()));
    if (announce) this.announce(description);
  }

  private describe(element: GraphElement, index: number, total: number): string {
    if (Number(element.data('semanticGroup')) === 1) {
      const label = stripInlineMathText(String(element.data('label') ?? 'Group'));
      const count = Number(element.data('conceptCount') ?? 0);
      return `Group ${index + 1} of ${total}: ${label}. ${count} concept${count === 1 ? '' : 's'}.${element.selected() ? ' Selected.' : ''}`;
    }
    if (Number(element.data('semanticConnection')) === 1) {
      const edge = element as cytoscape.EdgeSingular;
      const source = stripInlineMathText(String(edge.source().data('label') ?? 'source'));
      const target = stripInlineMathText(String(edge.target().data('label') ?? 'target'));
      const count = Number(edge.data('relationCount') ?? 0);
      return `Connection ${index + 1} of ${total}: ${source} to ${target}. ${count} relation${count === 1 ? '' : 's'}.${element.selected() ? ' Selected.' : ''}`;
    }
    if (element.isNode()) {
      const record = this.options.model.nodeRecord.get(element.id());
      if (!record) return `Graph item ${index + 1} of ${total}.`;
      const taxonomy = this.options.model.nodeDomainLabels(record).join(', ');
      const summary = summarizePlainText(record.summary, 160);
      const kind = record.kind === 'junction' ? 'Construction junction' : 'Concept';
      return `${kind} ${index + 1} of ${total}: ${stripInlineMathText(record.label)}. ${taxonomy}. ${summary}${element.selected() ? ' Selected.' : ''}`;
    }
    const record = this.options.model.edgeRecord.get(element.id());
    if (!record) return `Relation ${index + 1} of ${total}.`;
    const source = this.options.model.nodeRecord.get(record.source);
    const target = this.options.model.nodeRecord.get(record.target);
    const type = this.options.model.data.edgeTypes[record.type]?.label ?? record.type;
    return `Relation ${index + 1} of ${total}: ${stripInlineMathText(source?.label ?? record.source)} to ${stripInlineMathText(target?.label ?? record.target)}. ${type}. ${stripInlineMathText(record.label)}. ${summarizePlainText(record.detail, 140)}${element.selected() ? ' Selected.' : ''}`;
  }

  private consume(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private elementPosition(element: GraphElement): cytoscape.Position {
    return element.isNode() ? element.renderedPosition() : element.renderedMidpoint();
  }

  private directionForKey(key: string): GraphNavigationDirection | null {
    if (key === 'ArrowLeft') return 'left';
    if (key === 'ArrowRight') return 'right';
    if (key === 'ArrowUp') return 'up';
    if (key === 'ArrowDown') return 'down';
    return null;
  }

  private announce(message: string): void {
    this.options.status.textContent = '';
    window.requestAnimationFrame(() => { this.options.status.textContent = message; });
  }
}

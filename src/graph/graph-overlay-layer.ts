import type cytoscape from 'cytoscape';

interface SequenceBadgeEntry {
  element: cytoscape.NodeSingular;
  badge: HTMLDivElement;
}

const VIEWPORT_DIRTY = 1;
const GEOMETRY_DIRTY = 2;
const STATE_DIRTY = 4;
const ALL_DIRTY = VIEWPORT_DIRTY | GEOMETRY_DIRTY | STATE_DIRTY;

function numericOpacity(element: cytoscape.NodeSingular, fallback: number): number {
  const value = Number(element.style('opacity'));
  return Number.isFinite(value) ? value : fallback;
}

/** DOM overlays for decorations that Cytoscape cannot express natively, currently Story sequence badges. */
export class GraphOverlayLayer {
  private readonly layer = document.createElement('div');
  private readonly viewport = document.createElement('div');
  private readonly sequenceBadges: SequenceBadgeEntry[] = [];
  private frame = 0;
  private dirty = 0;

  constructor(
    private readonly cy: cytoscape.Core,
    graphContainer: HTMLElement
  ) {
    this.layer.className = 'graph-overlay-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.viewport.className = 'graph-overlay-viewport';
    this.layer.appendChild(this.viewport);
    graphContainer.insertAdjacentElement('afterend', this.layer);

    // Pan and zoom are the hot path: one compositor transform updates every Story badge.
    this.cy.on('pan zoom resize', () => this.schedule(VIEWPORT_DIRTY));
    this.cy.on('position', () => this.schedule(GEOMETRY_DIRTY));
    this.cy.on('style data', () => this.schedule(GEOMETRY_DIRTY | STATE_DIRTY));
    this.schedule(ALL_DIRTY);
  }

  setNodeSequence(nodeIds: readonly string[]): void {
    for (const { badge } of this.sequenceBadges) badge.remove();
    this.sequenceBadges.length = 0;
    nodeIds.forEach((nodeId, index) => {
      const element = this.cy.getElementById(nodeId);
      if (!element || element.empty() || !element.isNode()) return;
      const badge = document.createElement('div');
      badge.className = 'graph-sequence-badge';
      badge.textContent = String(index + 1);
      this.viewport.appendChild(badge);
      this.sequenceBadges.push({ element: element as cytoscape.NodeSingular, badge });
    });
    this.schedule(GEOMETRY_DIRTY | STATE_DIRTY);
  }

  schedule(dirty = ALL_DIRTY): void {
    this.dirty |= dirty;
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      const pending = this.dirty;
      this.dirty = 0;
      if (pending & VIEWPORT_DIRTY) this.syncViewport();
      if (pending & GEOMETRY_DIRTY) this.syncGeometry();
      if (pending & STATE_DIRTY) this.syncState();
    });
  }

  private syncViewport(): void {
    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    this.viewport.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  }

  private syncGeometry(): void {
    for (const { element, badge } of this.sequenceBadges) {
      if (element.hasClass('filter-hidden') || element.style('display') === 'none') continue;
      const bounds = element.boundingBox({ includeLabels: false, includeOverlays: false });
      badge.style.left = `${bounds.x1}px`;
      badge.style.top = `${bounds.y2}px`;
    }
  }

  private syncState(): void {
    for (const { element, badge } of this.sequenceBadges) {
      const hidden = element.hasClass('filter-hidden')
        || element.hasClass('structure-source-node')
        || element.style('display') === 'none';
      badge.hidden = hidden;
      if (!hidden) badge.style.opacity = String(numericOpacity(element, 1));
    }
  }
}

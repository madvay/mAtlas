import type cytoscape from 'cytoscape';
import type { Preferences } from '../types.js';
import { DEFAULT_PREFERENCES } from '../state/preferences.js';

interface DomainMarkerEntry {
  element: cytoscape.NodeSingular;
  marker: HTMLDivElement;
}

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

/** DOM overlays that complement, but never replace, Cytoscape's lightweight text labels. */
export class GraphOverlayLayer {
  private readonly layer = document.createElement('div');
  private readonly viewport = document.createElement('div');
  private readonly domainMarkers: DomainMarkerEntry[] = [];
  private readonly sequenceBadges: SequenceBadgeEntry[] = [];
  private frame = 0;
  private dirty = 0;
  private preferences: Preferences;

  constructor(
    private readonly cy: cytoscape.Core,
    graphContainer: HTMLElement,
    preferences: Preferences = { ...DEFAULT_PREFERENCES }
  ) {
    this.preferences = preferences;
    this.layer.className = 'graph-overlay-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.viewport.className = 'graph-overlay-viewport';
    this.layer.appendChild(this.viewport);
    graphContainer.insertAdjacentElement('afterend', this.layer);
    this.buildDomainMarkers();

    // Pan and zoom are the hot path: one compositor transform updates every overlay.
    this.cy.on('pan zoom resize', () => this.schedule(VIEWPORT_DIRTY));
    this.cy.on('position', () => this.schedule(GEOMETRY_DIRTY));
    this.cy.on('style data', () => this.schedule(GEOMETRY_DIRTY | STATE_DIRTY));
    this.schedule(ALL_DIRTY);
  }

  setPreferences(preferences: Preferences): void {
    this.preferences = preferences;
    this.schedule(STATE_DIRTY);
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

  private buildDomainMarkers(): void {
    this.cy.nodes().forEach((node: cytoscape.NodeSingular) => {
      if (Number(node.data('multiDomain')) !== 1) return;
      const colors = node.data('domainColors');
      if (!Array.isArray(colors) || colors.length < 2) return;
      const marker = document.createElement('div');
      marker.className = 'graph-domain-markers';
      marker.style.transform = 'translate(-100%, -100%)';
      for (const color of colors.slice(1)) {
        const dot = document.createElement('span');
        dot.style.backgroundColor = String(color);
        marker.appendChild(dot);
      }
      this.viewport.appendChild(marker);
      this.domainMarkers.push({ element: node, marker });
    });
  }

  private syncViewport(): void {
    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    this.viewport.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  }

  private syncGeometry(): void {
    for (const { element, marker } of this.domainMarkers) {
      if (element.hasClass('filter-hidden') || element.style('display') === 'none') continue;
      const position = element.position();
      marker.style.left = `${position.x + 76}px`;
      marker.style.top = `${position.y + 25}px`;
    }
    for (const { element, badge } of this.sequenceBadges) {
      if (element.hasClass('filter-hidden') || element.style('display') === 'none') continue;
      const bounds = element.boundingBox({ includeLabels: false, includeOverlays: false });
      badge.style.left = `${bounds.x1}px`;
      badge.style.top = `${bounds.y2}px`;
    }
  }

  private syncState(): void {
    for (const { element, marker } of this.domainMarkers) {
      const hidden = !this.preferences.indicateOtherDomains
        || element.hasClass('filter-hidden')
        || element.hasClass('structure-source-node')
        || element.style('display') === 'none';
      marker.hidden = hidden;
      if (!hidden) marker.style.opacity = String(numericOpacity(element, 1));
    }
    for (const { element, badge } of this.sequenceBadges) {
      const hidden = element.hasClass('filter-hidden')
        || element.hasClass('structure-source-node')
        || element.style('display') === 'none';
      badge.hidden = hidden;
      if (!hidden) badge.style.opacity = String(numericOpacity(element, 1));
    }
  }
}

import type cytoscape from 'cytoscape';
import type { Preferences } from '../types.js';
import { DEFAULT_PREFERENCES } from '../state/preferences.js';
import {
  DOMAIN_MARKER_RADIUS,
  DOMAIN_MARKER_STEP,
  domainMarkerTopLeft
} from './domain-marker-geometry.js';

interface DomainMarkerEntry {
  element: cytoscape.NodeSingular;
  colors: readonly string[];
  visible: boolean;
  opacity: number;
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

/** A single canvas for secondary-domain dots plus a tiny DOM layer for Story badges. */
export class GraphOverlayLayer {
  private readonly layer = document.createElement('div');
  private readonly markerCanvas = document.createElement('canvas');
  private readonly markerContext = this.markerCanvas.getContext('2d');
  private readonly viewport = document.createElement('div');
  private readonly domainMarkers: DomainMarkerEntry[] = [];
  private readonly sequenceBadges: SequenceBadgeEntry[] = [];
  private frame = 0;
  private dirty = 0;
  private visibleDomainMarkerCount = 0;
  private visibleSequenceBadgeCount = 0;
  private preferences: Preferences;

  constructor(
    private readonly cy: cytoscape.Core,
    private readonly graphContainer: HTMLElement,
    preferences: Preferences = { ...DEFAULT_PREFERENCES }
  ) {
    this.preferences = preferences;
    this.layer.className = 'graph-overlay-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.markerCanvas.className = 'graph-domain-marker-canvas';
    this.viewport.className = 'graph-overlay-viewport';
    this.layer.appendChild(this.markerCanvas);
    this.layer.appendChild(this.viewport);
    graphContainer.insertAdjacentElement('afterend', this.layer);
    this.buildDomainMarkers();

    // Position animation is coalesced to one canvas redraw per browser frame.
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
      const stateChanged = Boolean(pending & STATE_DIRTY);
      if (stateChanged) this.syncState();
      if (this.visibleSequenceBadgeCount > 0 && (stateChanged || (pending & VIEWPORT_DIRTY))) {
        this.syncBadgeViewport();
      }
      if (this.visibleSequenceBadgeCount > 0 && (stateChanged || (pending & GEOMETRY_DIRTY))) {
        this.syncBadgeGeometry();
      }
      if (this.visibleDomainMarkerCount > 0 && (pending & ALL_DIRTY)) this.drawDomainMarkers();
    });
  }

  private buildDomainMarkers(): void {
    this.cy.nodes().forEach((node: cytoscape.NodeSingular) => {
      if (Number(node.data('multiDomain')) !== 1) return;
      const colors = node.data('domainColors');
      if (!Array.isArray(colors) || colors.length < 2) return;
      this.domainMarkers.push({
        element: node,
        colors: colors.slice(1).map(String),
        visible: false,
        opacity: 1
      });
    });
    this.markerCanvas.setAttribute('data-domain-marker-nodes', String(this.domainMarkers.length));
  }

  private syncBadgeViewport(): void {
    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    this.viewport.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  }

  private syncBadgeGeometry(): void {
    for (const { element, badge } of this.sequenceBadges) {
      if (element.hasClass('filter-hidden') || element.style('display') === 'none') continue;
      const bounds = element.boundingBox({ includeLabels: false, includeOverlays: false });
      badge.style.left = `${bounds.x1}px`;
      badge.style.top = `${bounds.y2}px`;
    }
  }

  private syncState(): void {
    const previouslyVisibleDomainMarkerCount = this.visibleDomainMarkerCount;
    let visibleDomainMarkerCount = 0;
    for (const entry of this.domainMarkers) {
      const { element } = entry;
      entry.visible = this.preferences.indicateOtherDomains
        && !element.hasClass('filter-hidden')
        && !element.hasClass('structure-source-node')
        && element.style('display') !== 'none';
      entry.opacity = entry.visible ? numericOpacity(element, 1) : 0;
      if (entry.visible && entry.opacity > 0) visibleDomainMarkerCount += 1;
    }
    this.visibleDomainMarkerCount = visibleDomainMarkerCount;
    this.markerCanvas.hidden = visibleDomainMarkerCount === 0;
    if (visibleDomainMarkerCount === 0 && previouslyVisibleDomainMarkerCount > 0) {
      this.clearDomainMarkers();
    }

    let visibleSequenceBadgeCount = 0;
    for (const { element, badge } of this.sequenceBadges) {
      const hidden = element.hasClass('filter-hidden')
        || element.hasClass('structure-source-node')
        || element.style('display') === 'none';
      badge.hidden = hidden;
      if (!hidden) {
        badge.style.opacity = String(numericOpacity(element, 1));
        visibleSequenceBadgeCount += 1;
      }
    }
    this.visibleSequenceBadgeCount = visibleSequenceBadgeCount;
    this.viewport.hidden = visibleSequenceBadgeCount === 0;
  }


  private clearDomainMarkers(): void {
    const context = this.markerContext;
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.markerCanvas.width, this.markerCanvas.height);
  }

  private drawDomainMarkers(): void {
    const context = this.markerContext;
    if (!context) return;
    const pixelRatio = Math.max(1, Number(window.devicePixelRatio) || 1);
    const width = Math.max(1, this.graphContainer.clientWidth);
    const height = Math.max(1, this.graphContainer.clientHeight);
    const backingWidth = Math.max(1, Math.round(width * pixelRatio));
    const backingHeight = Math.max(1, Math.round(height * pixelRatio));
    if (this.markerCanvas.width !== backingWidth) this.markerCanvas.width = backingWidth;
    if (this.markerCanvas.height !== backingHeight) this.markerCanvas.height = backingHeight;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, backingWidth, backingHeight);

    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    context.setTransform(
      pixelRatio * zoom,
      0,
      0,
      pixelRatio * zoom,
      pixelRatio * pan.x,
      pixelRatio * pan.y
    );

    for (const { element, colors, visible, opacity } of this.domainMarkers) {
      if (!visible || opacity <= 0) continue;
      const position = element.position();
      const origin = domainMarkerTopLeft(position, colors.length);
      context.globalAlpha = Math.max(0, Math.min(1, opacity));
      colors.forEach((color, index) => {
        context.fillStyle = color;
        context.beginPath();
        context.arc(
          origin.x + DOMAIN_MARKER_RADIUS + index * DOMAIN_MARKER_STEP,
          origin.y + DOMAIN_MARKER_RADIUS,
          DOMAIN_MARKER_RADIUS,
          0,
          Math.PI * 2
        );
        context.fill();
      });
    }
    context.globalAlpha = 1;
  }
}

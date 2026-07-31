import type cytoscape from 'cytoscape';
import type { AppState } from '../types.js';
import {
  ABSOLUTE_MIN_ZOOM,
  DEFAULT_INTERACTIVE_MIN_ZOOM,
  FIT_SAFETY_SCALE,
  calculateFitViewport,
  minimumZoomForFit,
  type FitMargins,
  type ViewportInsets
} from './viewport-fit-core.js';

const DEFAULT_FIT_PADDING = 58;
const FIT_ANIMATION_DURATION = 420;
const FIT_ZOOM_EPSILON = 0.01;
const FIT_PAN_EPSILON = 1;
const NO_MARGINS: FitMargins = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const FIELD_BAND_MARGINS: FitMargins = Object.freeze({ top: 52, right: 28, bottom: 34, left: 28 });

export interface GraphViewportControllerOptions {
  cy: cytoscape.Core;
  state: AppState;
  viewportInsets: () => ViewportInsets;
  animate?: () => boolean;
}

interface ActiveViewportAnimation {
  id: number;
  animation: cytoscape.AnimationManipulation;
  complete: () => void;
}

export function viewportChangeIsMeaningful(
  current: { zoom: number; pan: cytoscape.Position },
  target: { zoom: number; pan: cytoscape.Position }
): boolean {
  if (Math.abs(current.zoom - target.zoom) > FIT_ZOOM_EPSILON) return true;
  return Math.hypot(current.pan.x - target.pan.x, current.pan.y - target.pan.y) > FIT_PAN_EPSILON;
}

export class GraphViewportController {
  private activeAnimation: ActiveViewportAnimation | null = null;
  private nextAnimationId = 1;

  constructor(private readonly options: GraphViewportControllerOptions) {}

  fit(
    elements: cytoscape.CollectionReturnValue,
    padding = DEFAULT_FIT_PADDING,
    onComplete: () => void = () => {},
    applyViewport = true
  ): void {
    this.cancel();
    if (elements.empty()) {
      onComplete();
      return;
    }

    const { cy, state } = this.options;
    const box = elements.boundingBox({ includeLabels: true, includeOverlays: false, includeUnderlays: false });
    const viewport = calculateFitViewport(
      box,
      { width: cy.width(), height: cy.height() },
      this.options.viewportInsets(),
      state.layout === 'breadthfirst' ? NO_MARGINS : FIELD_BAND_MARGINS,
      padding,
      ABSOLUTE_MIN_ZOOM,
      cy.maxZoom(),
      FIT_SAFETY_SCALE
    );
    if (!viewport) {
      onComplete();
      return;
    }

    const fitMinZoom = minimumZoomForFit(viewport.zoom, DEFAULT_INTERACTIVE_MIN_ZOOM, ABSOLUTE_MIN_ZOOM);
    if (cy.minZoom() !== fitMinZoom) cy.minZoom(fitMinZoom);

    if (!applyViewport) {
      onComplete();
      return;
    }

    const animate = this.options.animate?.() === true;
    if (!animate || !viewportChangeIsMeaningful(
      { zoom: cy.zoom(), pan: cy.pan() },
      viewport
    )) {
      cy.viewport(viewport);
      onComplete();
      return;
    }

    const id = this.nextAnimationId++;
    let completed = false;
    const complete = (): void => {
      if (completed) return;
      completed = true;
      if (this.activeAnimation?.id === id) this.activeAnimation = null;
      onComplete();
    };
    const animation = cy.animation({
      zoom: viewport.zoom,
      pan: viewport.pan,
      duration: FIT_ANIMATION_DURATION,
      easing: 'ease-in-out'
    });
    this.activeAnimation = { id, animation, complete };
    animation.promise('complete').then(() => {
      if (this.activeAnimation?.id !== id) return;
      complete();
    });
    animation.play();
  }

  cancel(): void {
    const active = this.activeAnimation;
    if (!active) return;
    this.activeAnimation = null;
    active.animation.stop();
    active.complete();
  }
}

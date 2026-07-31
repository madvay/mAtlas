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
const NO_MARGINS: FitMargins = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const FIELD_BAND_MARGINS: FitMargins = Object.freeze({ top: 52, right: 28, bottom: 34, left: 28 });

export interface GraphViewportControllerOptions {
  cy: cytoscape.Core;
  state: AppState;
  viewportInsets: () => ViewportInsets;
}

export class GraphViewportController {
  constructor(private readonly options: GraphViewportControllerOptions) {}

  fit(elements: cytoscape.CollectionReturnValue, padding = DEFAULT_FIT_PADDING): void {
    if (elements.empty()) return;
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
    if (!viewport) return;

    const fitMinZoom = minimumZoomForFit(viewport.zoom, DEFAULT_INTERACTIVE_MIN_ZOOM, ABSOLUTE_MIN_ZOOM);
    if (cy.minZoom() !== fitMinZoom) cy.minZoom(fitMinZoom);
    cy.viewport(viewport);
  }
}

import type cytoscape from 'cytoscape';
import { escapeHtml } from '../core/dom.js';
import type { AppState } from '../types.js';
import type { GraphModel } from '../model/graph-model.js';
import { renderHtml } from './render.js';

export interface FieldBandControllerOptions {
  cy: cytoscape.Core;
  model: GraphModel;
  state: AppState;
  isMobileLayout: () => boolean;
  containerId?: string;
}

export class FieldBandController {
  private timer = 0;
  private readonly containerId: string;

  constructor(private readonly options: FieldBandControllerOptions) {
    this.containerId = options.containerId ?? 'fieldBands';
  }

  clear(): void {
    const container = document.getElementById(this.containerId);
    if (container instanceof HTMLElement) {
      container.replaceChildren();
      container.hidden = true;
    }
  }

  update(): void {
    const { cy, model, state } = this.options;
    if (state.layout === 'breadthfirst' || state.layout === 'domains' || state.layout === 'fields') {
      this.clear();
      return;
    }

    const container = document.getElementById(this.containerId);
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();

    for (const fieldId of model.fieldOrder) {
      const nodes = cy.nodes().not('.filter-hidden').filter((element) => {
        const record = model.nodeRecord.get(element.id());
        return record ? model.nodePrimaryField(record) === fieldId : false;
      });
      if (nodes.empty()) continue;

      const field = model.data.fields[fieldId];
      if (!field) continue;
      const box = nodes.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
      const band = document.createElement('div');
      band.className = 'field-band';
      band.style.left = `${box.x1 - 28}px`;
      band.style.top = `${box.y1 - 52}px`;
      band.style.width = `${box.w + 56}px`;
      band.style.height = `${box.h + 86}px`;
      band.style.setProperty('--field-color', field.color);
      renderHtml(band, `<span>${escapeHtml(field.label)}</span>`);
      container.appendChild(band);
    }
    container.hidden = false;
  }

  schedule(): void {
    if (this.options.state.layout === 'breadthfirst'
      || this.options.state.layout === 'domains'
      || this.options.state.layout === 'fields') {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = 0;
      this.clear();
      return;
    }
    // renderedBoundingBox() forces Cytoscape geometry reads and rebuilding the
    // bands forces DOM layout. Coalesce a whole pan/zoom gesture instead of doing
    // both jobs on every animation frame.
    const container = document.getElementById(this.containerId);
    if (container instanceof HTMLElement) container.hidden = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.options.isMobileLayout()) this.clear();
      else this.update();
    }, 100);
  }
}

import { byId } from '../core/dom.js';
import type { ViewportInsets } from '../graph/viewport-fit-core.js';
import type { AppState } from '../types.js';
import { renderHtml } from './render.js';

export type PanelName = 'filters' | 'details';

export interface PanelControllerOptions {
  state: AppState;
  domainCount: number;
  mobileMediaQuery?: string;
  onPanelStateChange?: () => void;
}

export class PanelController {
  private restoreState = { filtersOpen: true, detailsOpen: true };
  private readonly mobileMediaQuery: string;

  constructor(private readonly options: PanelControllerOptions) {
    this.mobileMediaQuery = options.mobileMediaQuery ?? '(max-width: 900px)';
  }

  isMobileLayout(): boolean {
    return window.matchMedia(this.mobileMediaQuery).matches;
  }

  detailsPanelYOffset(): number {
    if (!this.isMobileLayout() || !this.options.state.detailsOpen) return 0;
    const detailsPanel = document.getElementById('detailsPanel');
    return detailsPanel instanceof HTMLElement ? detailsPanel.getBoundingClientRect().height / 2 : 0;
  }

  viewportInsets(): ViewportInsets {
    const { state } = this.options;
    const filtersPanel = document.getElementById('filtersPanel');
    const detailsPanel = document.getElementById('detailsPanel');
    const filtersWidth = state.filtersOpen && filtersPanel instanceof HTMLElement
      ? filtersPanel.getBoundingClientRect().width
      : 0;
    const detailsRect = state.detailsOpen && detailsPanel instanceof HTMLElement
      ? detailsPanel.getBoundingClientRect()
      : null;
    if (this.isMobileLayout()) {
      return { top: 0, right: 0, bottom: detailsRect?.height ?? 0, left: filtersWidth };
    }
    return { top: 0, right: detailsRect?.width ?? 0, bottom: 0, left: filtersWidth };
  }

  sync(): void {
    const { state } = this.options;
    const mobile = this.isMobileLayout();
    const workspace = byId('workspace');
    const filtersPanel = byId('filtersPanel');
    const detailsPanel = byId('detailsPanel');

    workspace.classList.toggle('filters-collapsed', !state.filtersOpen);
    workspace.classList.toggle('details-collapsed', !state.detailsOpen);
    filtersPanel.classList.toggle('open', mobile && state.filtersOpen);
    detailsPanel.classList.toggle('open', mobile && state.detailsOpen);
    filtersPanel.setAttribute('aria-hidden', String(!state.filtersOpen));
    detailsPanel.setAttribute('aria-hidden', String(!state.detailsOpen));

    const filtersToggle = byId<HTMLButtonElement>('filtersToggle');
    const detailsToggle = byId<HTMLButtonElement>('detailsToggle');
    const maximizeButton = byId<HTMLButtonElement>('maximizeButton');
    this.updateFiltersToggleCount();
    filtersToggle.setAttribute('aria-pressed', String(state.filtersOpen));
    detailsToggle.setAttribute('aria-pressed', String(state.detailsOpen));
    maximizeButton.setAttribute('aria-pressed', String(!state.filtersOpen && !state.detailsOpen));
    maximizeButton.classList.toggle('active', !state.filtersOpen && !state.detailsOpen);
    renderHtml(maximizeButton, !state.filtersOpen && !state.detailsOpen
      ? '<span class="material-icons" aria-hidden="true">fullscreen_exit</span>'
      : '<span class="material-icons" aria-hidden="true">fullscreen</span>');

    const leftRail = byId<HTMLButtonElement>('filtersRailToggle');
    const rightRail = byId<HTMLButtonElement>('detailsRailToggle');
    leftRail.textContent = state.filtersOpen ? '‹' : '›';
    rightRail.textContent = state.detailsOpen ? '›' : '‹';
    leftRail.setAttribute('aria-expanded', String(state.filtersOpen));
    rightRail.setAttribute('aria-expanded', String(state.detailsOpen));
    this.options.onPanelStateChange?.();
  }

  setOpen(panel: PanelName, open: boolean): void {
    if (panel === 'filters') this.options.state.filtersOpen = open;
    else this.options.state.detailsOpen = open;
    this.sync();
  }

  toggle(panel: PanelName): void {
    const { state } = this.options;
    this.setOpen(panel, panel === 'filters' ? !state.filtersOpen : !state.detailsOpen);
  }

  toggleMaximized(): void {
    const { state } = this.options;
    const maximized = !state.filtersOpen && !state.detailsOpen;
    if (maximized) {
      state.filtersOpen = this.restoreState.filtersOpen;
      state.detailsOpen = this.restoreState.detailsOpen;
      if (!state.filtersOpen && !state.detailsOpen) {
        state.filtersOpen = true;
        state.detailsOpen = true;
      }
    } else {
      this.restoreState = { filtersOpen: state.filtersOpen, detailsOpen: state.detailsOpen };
      state.filtersOpen = false;
      state.detailsOpen = false;
    }
    this.sync();
  }

  openDetails(): void {
    if (!this.options.state.detailsOpen) this.setOpen('details', true);
  }

  updateFiltersToggleCount(): void {
    const filtersToggle = byId<HTMLButtonElement>('filtersToggle');
    const selectedDomainCount = this.options.state.selectedDomains.size;
    const displayCount = selectedDomainCount === this.options.domainCount ? '0' : String(selectedDomainCount);
    filtersToggle.dataset.count = displayCount;
    filtersToggle.setAttribute('data-count', displayCount);
    const badge = filtersToggle.querySelector<HTMLSpanElement>('.panel-count');
    if (badge) badge.textContent = displayCount === '0' ? '' : displayCount;
  }
}

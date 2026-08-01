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
    if (mobile && state.filtersOpen && state.detailsOpen) state.filtersOpen = false;
    const workspace = byId('workspace');
    const filtersPanel = byId('filtersPanel');
    const detailsPanel = byId('detailsPanel');
    const graphShell = workspace.querySelector<HTMLElement>('.graph-shell');
    const topbar = document.querySelector<HTMLElement>('.topbar');
    const skipLinks = document.querySelector<HTMLElement>('.skip-links');

    workspace.classList.toggle('filters-collapsed', !state.filtersOpen);
    workspace.classList.toggle('details-collapsed', !state.detailsOpen);
    filtersPanel.classList.toggle('open', mobile && state.filtersOpen);
    detailsPanel.classList.toggle('open', mobile && state.detailsOpen);
    this.syncPanelAccessibility(filtersPanel, state.filtersOpen, mobile);
    this.syncPanelAccessibility(detailsPanel, state.detailsOpen, mobile);

    const mobilePanelOpen = mobile && (state.filtersOpen || state.detailsOpen);
    document.body.classList.toggle('mobile-panel-open', mobilePanelOpen);
    if (topbar) topbar.inert = mobilePanelOpen;
    if (graphShell) graphShell.inert = mobilePanelOpen;
    if (skipLinks) skipLinks.inert = mobilePanelOpen;
    if (mobile) {
      filtersPanel.inert = !state.filtersOpen;
      detailsPanel.inert = !state.detailsOpen;
    }

    const filtersToggle = byId<HTMLButtonElement>('filtersToggle');
    const detailsToggle = byId<HTMLButtonElement>('detailsToggle');
    const maximizeButton = byId<HTMLButtonElement>('maximizeButton');
    this.updateFiltersToggleCount();
    this.syncToggle(filtersToggle, 'filters', state.filtersOpen);
    this.syncToggle(detailsToggle, 'details', state.detailsOpen);
    const maximized = !state.filtersOpen && !state.detailsOpen;
    maximizeButton.setAttribute('aria-pressed', String(maximized));
    maximizeButton.setAttribute('aria-label', maximized ? 'Restore side panels' : 'Maximize graph');
    maximizeButton.title = maximized ? 'Restore side panels' : 'Maximize graph';
    maximizeButton.classList.toggle('active', maximized);
    renderHtml(maximizeButton, maximized
      ? '<span class="material-symbols-outlined" aria-hidden="true">fullscreen_exit</span>'
      : '<span class="material-symbols-outlined" aria-hidden="true">fullscreen</span>');

    const leftRail = byId<HTMLButtonElement>('filtersRailToggle');
    const rightRail = byId<HTMLButtonElement>('detailsRailToggle');
    leftRail.textContent = state.filtersOpen ? '‹' : '›';
    rightRail.textContent = state.detailsOpen ? '›' : '‹';
    this.syncToggle(leftRail, 'filters', state.filtersOpen, false);
    this.syncToggle(rightRail, 'details', state.detailsOpen, false);
    this.options.onPanelStateChange?.();
  }

  setOpen(panel: PanelName, open: boolean): void {
    if (open && this.isMobileLayout()) {
      this.options.state.filtersOpen = panel === 'filters';
      this.options.state.detailsOpen = panel === 'details';
    } else if (panel === 'filters') {
      this.options.state.filtersOpen = open;
    } else {
      this.options.state.detailsOpen = open;
    }
    this.sync();
  }

  toggle(panel: PanelName): void {
    const { state } = this.options;
    this.setOpen(panel, panel === 'filters' ? !state.filtersOpen : !state.detailsOpen);
  }

  focusPanel(panel: PanelName): void {
    const element = byId(panel === 'filters' ? 'filtersPanel' : 'detailsPanel');
    window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
  }

  focusToggle(panel: PanelName): void {
    const element = byId<HTMLButtonElement>(panel === 'filters' ? 'filtersToggle' : 'detailsToggle');
    window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
  }

  toggleMaximized(): void {
    const { state } = this.options;
    const maximized = !state.filtersOpen && !state.detailsOpen;
    if (maximized) {
      state.filtersOpen = this.restoreState.filtersOpen;
      state.detailsOpen = this.restoreState.detailsOpen;
      if (!state.filtersOpen && !state.detailsOpen) state.filtersOpen = true;
      if (this.isMobileLayout() && state.filtersOpen && state.detailsOpen) state.filtersOpen = false;
    } else {
      this.restoreState = { filtersOpen: state.filtersOpen, detailsOpen: state.detailsOpen };
      state.filtersOpen = false;
      state.detailsOpen = false;
    }
    this.sync();
  }

  openDetails(): void {
    if (!this.options.state.detailsOpen) this.setOpen('details', true);
    if (this.isMobileLayout()) this.focusPanel('details');
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

  private syncPanelAccessibility(panel: HTMLElement, open: boolean, mobile: boolean): void {
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    if (mobile && open) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
    }
  }

  private syncToggle(button: HTMLButtonElement, panel: PanelName, open: boolean, pressed = true): void {
    const label = `${open ? 'Hide' : 'Show'} ${panel}`;
    button.setAttribute('aria-expanded', String(open));
    if (pressed) button.setAttribute('aria-pressed', String(open));
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

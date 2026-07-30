import { byId, escapeHtml } from '../core/dom.js';
import { viewStepNarrative } from '../state/custom-view.js';
import { moveSequenceIndex, sequenceIndexForNode } from '../state/view-sequence.js';
import { publicViewKind, viewNodeSequence } from '../state/view-state.js';
import type { AtlasView, SelectionTarget } from '../types.js';
import type { MathRenderer } from './math-renderer.js';
import { renderHtml } from './render.js';
import { resolveViewSurface } from './view-surface.js';

const WELCOME_STORAGE_KEY = 'human-knowledge-atlas:views-welcome-dismissed:v1';

export interface ViewsControllerOptions {
  views: () => readonly AtlasView[];
  activeView: () => AtlasView | null;
  currentSelection: () => SelectionTarget | null;
  activateNode: (nodeId: string) => boolean;
  nodeLabel: (nodeId: string) => string;
  viewPageUrl: (viewId: string) => string;
  navigate: (href: string) => void;
  isPersonalView: (viewId: string) => boolean;
  createView: () => void;
  duplicateView: (view: AtlasView) => void;
  editView: (view: AtlasView) => void;
  deleteView: (viewId: string) => void;
  isMobileLayout: () => boolean;
  detailsOpen: () => boolean;
  math: MathRenderer;
  setNodeSequenceBadges: (nodeIds: readonly string[]) => void;
}

export class ViewsController {
  private activeViewId: string | null = null;
  private sequenceIndex = 0;
  private bannerDetailsOpen = true;

  constructor(private readonly options: ViewsControllerOptions) {}

  initialize(): void {
    this.buildDialog();
    this.syncActiveView();
    this.bindEvents();
    this.maybeShowWelcome();
  }

  syncActiveView(): void {
    const view = this.options.activeView();
    const selection = this.options.currentSelection();
    if (!view) {
      this.activeViewId = null;
      this.sequenceIndex = 0;
      this.options.setNodeSequenceBadges([]);
    } else {
      const sequence = viewNodeSequence(view);
      const baseIndex = this.activeViewId === view.id ? this.sequenceIndex : 0;
      this.activeViewId = view.id;
      this.sequenceIndex = sequenceIndexForNode(
        sequence,
        selection?.kind === 'node' ? selection.id : null,
        baseIndex
      );
      this.options.setNodeSequenceBadges(sequence);
    }

    const button = byId<HTMLButtonElement>('viewsButton');
    const label = button.querySelector<HTMLElement>('.views-button-label');
    button.classList.toggle('active', Boolean(view));
    const kind = view ? publicViewKind(view) : null;
    button.setAttribute('aria-label', view ? `Current ${kind?.toLowerCase()}: ${view.title}. Browse stories and views` : 'Browse stories and views');
    button.title = view ? `Current ${kind?.toLowerCase()}: ${view.title}` : 'Browse stories and views';
    if (label) label.textContent = view ? view.title : 'Stories & Views';

    const banner = byId<HTMLElement>('viewBanner');
    const detailsContext = byId<HTMLElement>('mobileViewContext');
    if (!view) {
      banner.replaceChildren();
      detailsContext.replaceChildren();
      this.buildDialog();
      this.syncPresentation();
      return;
    }

    renderHtml(banner, this.renderActiveBanner(view));
    renderHtml(detailsContext, this.renderMobileDetailsContext(view));
    this.buildDialog();
    this.syncPresentation();
  }

  syncSelection(target: SelectionTarget | null): void {
    const view = this.options.activeView();
    if (!view || target?.kind !== 'node') return;
    const nextIndex = viewNodeSequence(view).indexOf(target.id);
    if (nextIndex < 0 || nextIndex === this.sequenceIndex) return;
    this.sequenceIndex = nextIndex;
    renderHtml(byId<HTMLElement>('viewBanner'), this.renderActiveBanner(view));
    renderHtml(byId<HTMLElement>('mobileViewContext'), this.renderMobileDetailsContext(view));
    this.syncPresentation();
  }

  syncPresentation(): void {
    const view = this.options.activeView();
    const visibility = resolveViewSurface({
      active: Boolean(view),
      mobile: this.options.isMobileLayout(),
      detailsOpen: this.options.detailsOpen()
    });
    byId<HTMLElement>('viewBanner').hidden = !visibility.graphIntroduction;
    byId<HTMLElement>('mobileViewContext').hidden = !visibility.detailsContext;
  }

  open(): void {
    this.buildDialog();
    const dialog = byId<HTMLDialogElement>('viewsDialog');
    if (!dialog.open) dialog.showModal();
  }

  private bindEvents(): void {
    byId('viewsButton').addEventListener('click', () => this.open());
    byId('viewsContent').addEventListener('click', (event) => this.handleDialogClick(event));
    byId('viewBanner').addEventListener('click', (event) => this.handleViewSurfaceClick(event));
    byId('viewBanner').addEventListener('toggle', (event) => this.handleViewBannerToggle(event as Event));
    byId('mobileViewContext').addEventListener('click', (event) => this.handleViewSurfaceClick(event));
    byId('viewsWelcome').addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-welcome-explore]')) {
        this.dismissWelcome();
        this.open();
      } else if (target.closest('[data-welcome-dismiss]')) {
        this.dismissWelcome();
      }
    });
  }

  private handleDialogClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-create-view]')) {
      this.closeDialog();
      this.options.createView();
      return;
    }
    const open = target.closest<HTMLAnchorElement>('[data-open-view]');
    if (open?.href) {
      event.preventDefault();
      this.closeDialog();
      this.options.navigate(open.href);
      return;
    }
    const duplicate = target.closest<HTMLElement>('[data-duplicate-view]');
    const edit = target.closest<HTMLElement>('[data-edit-view]');
    const remove = target.closest<HTMLElement>('[data-delete-view]');
    const viewId = duplicate?.dataset.duplicateView ?? edit?.dataset.editView ?? remove?.dataset.deleteView;
    const view = viewId ? this.options.views().find((candidate) => candidate.id === viewId) : null;
    if (!view) return;
    if (duplicate) {
      this.closeDialog();
      this.options.duplicateView(view);
    } else if (edit) {
      this.closeDialog();
      this.options.editView(view);
    } else if (remove && window.confirm(`Delete the local ${publicViewKind(view).toLowerCase()} “${view.title}”?`)) {
      this.options.deleteView(view.id);
      this.buildDialog();
    }
  }

  private closeDialog(): void {
    const dialog = byId<HTMLDialogElement>('viewsDialog');
    if (dialog.open) dialog.close();
  }

  private handleViewSurfaceClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-view-prev]')) {
      this.navigateSequence(-1);
    } else if (target.closest('[data-view-next]')) {
      this.navigateSequence(1);
    } else if (target.closest('[data-open-views]')) {
      this.open();
    } else if (target.closest('[data-duplicate-active-view]')) {
      const view = this.options.activeView();
      if (view) this.options.duplicateView(view);
    }
  }

  private handleViewBannerToggle(event: Event): void {
    const details = (event.target as HTMLElement).closest('details.view-context-details') as HTMLDetailsElement | null;
    if (details) this.bannerDetailsOpen = details.open;
  }

  private navigateSequence(direction: -1 | 1): void {
    const view = this.options.activeView();
    if (!view) return;
    const sequence = viewNodeSequence(view);
    const nextIndex = moveSequenceIndex(sequence, this.sequenceIndex, direction);
    if (nextIndex === null) return;
    const nodeId = sequence[nextIndex];
    if (!nodeId || !this.options.activateNode(nodeId)) return;
    this.sequenceIndex = nextIndex;
    this.syncSelection({ kind: 'node', id: nodeId });
  }

  private buildDialog(): void {
    const active = this.options.activeView();
    const views = this.options.views();
    const personal = views.filter((view) => this.options.isPersonalView(view.id));
    const authored = views.filter((view) => !this.options.isPersonalView(view.id));
    const featured = authored.filter((view) => view.featured);
    const other = authored.filter((view) => !view.featured);
    renderHtml(byId('viewsContent'), `
      <div class="views-dialog-toolbar">
        <p>Construct a view from the current graph, or duplicate an existing item while retaining its credit and rights metadata.</p>
        <button type="button" class="button primary" data-create-view><span class="material-icons" aria-hidden="true">add</span> Create</button>
      </div>
      <p class="views-intro"><strong>Views</strong> apply a curated graph configuration. <strong>Stories</strong> add a numbered sequence, optional step narration, and Previous/Next navigation.</p>
      ${personal.length ? this.renderViewSection('My views and stories', personal, active) : ''}
      ${this.renderViewSection('Featured stories and views', featured, active)}
      ${other.length ? this.renderViewSection('More stories and views', other, active) : ''}`);
  }

  private renderViewSection(title: string, views: readonly AtlasView[], active: AtlasView | null): string {
    return `<section class="views-section"><h3>${escapeHtml(title)}</h3><div class="views-grid">${views.map((view) => this.renderCard(view, active?.id === view.id)).join('')}</div></section>`;
  }

  private renderCard(view: AtlasView, active: boolean): string {
    const sequence = viewNodeSequence(view);
    const kind = publicViewKind(view);
    const personal = this.options.isPersonalView(view.id);
    const image = view.image
      ? `<img class="view-card-image" src="${escapeHtml(view.image.src)}" alt="${escapeHtml(view.image.alt)}" loading="lazy">`
      : '';
    const credit = this.renderCreditSummary(view);
    return `<article class="view-card${active ? ' active' : ''}">
      ${image}
      <div class="view-card-body">
        <div class="view-card-heading"><h4 class="math-rich">${this.options.math.renderText(view.title)}</h4>${active ? '<span class="current-view-badge">Current</span>' : ''}</div>
        <p class="math-rich">${this.options.math.renderText(view.summary)}</p>
        <div class="view-tags">${view.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="view-card-meta">${kind}${sequence.length ? ` · ${sequence.length} steps` : ' · curated configuration'}${personal ? ' · local' : ''}</div>
        ${credit}
        <div class="view-card-actions">
          <a class="button view-open-button${active ? ' secondary' : ' primary'}" data-open-view href="${escapeHtml(this.options.viewPageUrl(view.id))}">${active ? (sequence.length ? 'Restart story' : 'Reset view') : `Open ${kind.toLowerCase()}`}</a>
          ${personal ? `<button type="button" class="text-button" data-edit-view="${escapeHtml(view.id)}">Edit</button>` : ''}
          <button type="button" class="text-button" data-duplicate-view="${escapeHtml(view.id)}">Duplicate and edit</button>
          ${personal ? `<button type="button" class="text-button danger" data-delete-view="${escapeHtml(view.id)}">Delete</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  private renderActiveBanner(view: AtlasView): string {
    const kind = publicViewKind(view);
    const permalink = escapeHtml(this.options.viewPageUrl(view.id));
    return `<div class="view-banner-desktop view-banner-copy">
      <details class="view-context-details"${this.bannerDetailsOpen ? ' open' : ''}>
        <summary>
          <span class="material-icons view-context-icon" aria-hidden="true">explore</span>
          <span class="view-context-heading"><span class="kicker">${kind}</span><strong>${this.options.math.renderText(view.title)}</strong></span>
          <span class="material-icons view-context-chevron" aria-hidden="true">expand_more</span>
        </summary>
        <div class="view-context-body">
          <p class="math-rich">${this.options.math.renderText(view.narrative)}</p>
          ${this.renderCreditSummary(view, true)}
          ${this.renderStepNarrative(view)}
          ${this.renderSequenceControls(view)}
          <div class="view-banner-actions"><button type="button" class="text-button" data-open-views>Browse stories and views</button><button type="button" class="text-button" data-duplicate-active-view>Duplicate and edit</button><a href="${permalink}">Permalink</a></div>
        </div>
      </details>
    </div>
    ${this.renderCompactViewDetails(view, 'view-banner-mobile')}`;
  }

  private renderMobileDetailsContext(view: AtlasView): string {
    return this.renderCompactViewDetails(view, 'mobile-view-details');
  }

  private renderCompactViewDetails(view: AtlasView, className: string): string {
    const kind = publicViewKind(view);
    return `<div class="view-compact-context ${className}">
      <details class="view-context-details">
        <summary>
          <span class="material-icons view-context-icon" aria-hidden="true">explore</span>
          <span class="view-context-heading"><span class="kicker">${kind}</span><strong>${this.options.math.renderText(view.title)}</strong></span>
          <span class="material-icons view-context-chevron" aria-hidden="true">expand_more</span>
        </summary>
        <div class="view-context-body">
          <p class="math-rich">${this.options.math.renderText(view.narrative)}</p>
          ${this.renderCreditSummary(view, true)}
          ${this.renderStepNarrative(view)}
          <div class="view-banner-actions"><button type="button" class="text-button" data-open-views>Browse stories and views</button><button type="button" class="text-button" data-duplicate-active-view>Duplicate and edit</button><a href="${escapeHtml(this.options.viewPageUrl(view.id))}">Permalink</a></div>
        </div>
      </details>
      ${this.renderSequenceControls(view, true)}
    </div>`;
  }

  private renderCreditSummary(view: AtlasView, compact = false): string {
    if (!view.metadata.credits.length) return compact ? '' : '<div class="view-card-credit">No credit record</div>';
    const records = view.metadata.credits.map((credit) => {
      const rights = credit.license ?? credit.copyright ?? credit.attribution;
      return `${escapeHtml(credit.creators.join(', '))}${rights ? ` · ${escapeHtml(rights)}` : ''}`;
    });
    return `<div class="view-card-credit${compact ? ' compact' : ''}">${records.join('<span aria-hidden="true">; </span>')}</div>`;
  }

  private renderStepNarrative(view: AtlasView): string {
    const sequence = viewNodeSequence(view);
    const nodeId = sequence[this.sequenceIndex];
    if (!nodeId) return '';
    const narrative = viewStepNarrative(view, nodeId);
    return narrative ? `<p class="view-step-narrative math-rich">${this.options.math.renderText(narrative)}</p>` : '';
  }

  private renderSequenceControls(view: AtlasView, compact = false): string {
    const sequence = viewNodeSequence(view);
    const count = sequence.length;
    if (count === 0) return '';
    const safeIndex = sequenceIndexForNode(sequence, null, this.sequenceIndex);
    const nodeId = sequence[safeIndex] ?? '';
    const nodeLabel = this.options.nodeLabel(nodeId) || nodeId;
    const previousDisabled = safeIndex <= 0 ? ' disabled' : '';
    const nextDisabled = safeIndex >= count - 1 ? ' disabled' : '';
    return `<div class="view-sequence-controls${compact ? ' compact' : ''}" role="group" aria-label="Guided sequence navigation">
      <button type="button" class="view-sequence-button" data-view-prev aria-label="Previous step" title="Previous step"${previousDisabled}><span class="material-icons" aria-hidden="true">chevron_left</span><span class="view-sequence-button-label">Previous</span></button>
      <div class="view-sequence-position" aria-live="polite"><span>Step ${safeIndex + 1} of ${count}</span><strong title="${escapeHtml(nodeLabel)}">${this.options.math.renderText(nodeLabel)}</strong></div>
      <button type="button" class="view-sequence-button" data-view-next aria-label="Next step" title="Next step"${nextDisabled}><span class="view-sequence-button-label">Next</span><span class="material-icons" aria-hidden="true">chevron_right</span></button>
    </div>`;
  }

  private maybeShowWelcome(): void {
    if (this.options.activeView()) return;
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(WELCOME_STORAGE_KEY) === '1'; } catch { /* ignore */ }
    if (!dismissed) byId<HTMLElement>('viewsWelcome').hidden = false;
  }

  private dismissWelcome(): void {
    byId<HTMLElement>('viewsWelcome').hidden = true;
    try { window.localStorage.setItem(WELCOME_STORAGE_KEY, '1'); } catch { /* ignore */ }
  }
}

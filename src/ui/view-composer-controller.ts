import { byId, escapeHtml } from '../core/dom.js';
import {
  CUSTOM_VIEW_URL_MAX_LENGTH,
  CUSTOM_VIEW_URL_WARNING_LENGTH,
  cloneView,
  createViewDraft,
  duplicateView,
  serializeAtlasViewYaml,
  settingsFromState,
  viewScopeMode,
  type ViewScopeMode
} from '../state/custom-view.js';
import type { AppState, AtlasView, AtlasViewCredit, SelectionTarget } from '../types.js';
import { renderHtml } from './render.js';

interface ComposerSnapshot {
  view: AtlasView;
  scopeMode: ViewScopeMode;
  protectedCreditCount: number;
}

export interface ViewComposerControllerOptions {
  state: AppState;
  currentSelection: () => SelectionTarget | null;
  nodeLabel: (nodeId: string) => string;
  visibleDirectNodeIds: () => string[];
  createId: (title: string) => string;
  now: () => string;
  openDetailsPanel: () => void;
  savePersonalView: (view: AtlasView) => void;
  sharedViewUrl: (view: AtlasView) => string;
  navigate: (href: string) => void;
  onLibraryChanged: () => void;
}

export class ViewComposerController {
  private draft: AtlasView | null = null;
  private scopeMode: ViewScopeMode = 'taxonomy';
  private protectedCreditCount = 0;
  private recording = false;
  private history: ComposerSnapshot[] = [];
  private pendingCredit: AtlasViewCredit = { creators: [] };
  private draggedStepIndex: number | null = null;

  constructor(private readonly options: ViewComposerControllerOptions) {}

  initialize(): void {
    byId('detailsTabButton').addEventListener('click', () => this.showDetailsTab());
    byId('composeTabButton').addEventListener('click', () => this.showComposeTab());
    const composer = byId('viewComposer');
    composer.addEventListener('click', (event) => this.handleClick(event));
    composer.addEventListener('input', (event) => this.handleInput(event));
    composer.addEventListener('change', (event) => this.handleChange(event));
    composer.addEventListener('dragstart', (event) => this.handleDragStart(event as DragEvent));
    composer.addEventListener('dragover', (event) => event.preventDefault());
    composer.addEventListener('drop', (event) => this.handleDrop(event as DragEvent));
  }

  startNew(): void {
    const now = this.options.now();
    this.draft = createViewDraft(this.options.createId('Untitled view'), this.options.state, now);
    this.scopeMode = 'taxonomy';
    this.protectedCreditCount = 0;
    this.recording = false;
    this.history = [];
    this.pendingCredit = { creators: [] };
    this.openComposer();
  }

  startDuplicate(source: AtlasView): void {
    const now = this.options.now();
    this.draft = duplicateView(source, this.options.createId(source.title), now);
    this.scopeMode = viewScopeMode(source);
    this.protectedCreditCount = source.metadata.credits.length;
    this.recording = false;
    this.history = [];
    this.pendingCredit = { creators: [] };
    this.openComposer();
  }

  startEdit(source: AtlasView): void {
    this.draft = cloneView(source);
    this.scopeMode = viewScopeMode(source);
    this.protectedCreditCount = source.metadata.inheritedCreditCount ?? 0;
    this.recording = false;
    this.history = [];
    this.pendingCredit = { creators: [] };
    this.openComposer();
  }

  syncSelection(target: SelectionTarget | null): void {
    if (!this.draft || !this.recording || target?.kind !== 'node') return;
    const sequence = this.draft.nodeSequence ?? [];
    if (sequence.includes(target.id)) return;
    this.pushHistory();
    this.addStoryStep(target.id);
    this.render();
  }

  showDetailsTab(): void {
    byId<HTMLElement>('detailsSurface').hidden = false;
    byId<HTMLElement>('viewComposer').hidden = true;
    this.syncTabs(false);
  }

  showComposeTab(): void {
    byId<HTMLElement>('detailsSurface').hidden = true;
    byId<HTMLElement>('viewComposer').hidden = false;
    this.syncTabs(true);
    if (this.draft) this.render();
    else this.renderEmpty();
  }

  private openComposer(): void {
    this.options.openDetailsPanel();
    this.showComposeTab();
    this.render();
  }

  private syncTabs(composeActive: boolean): void {
    const detailsButton = byId<HTMLButtonElement>('detailsTabButton');
    const composeButton = byId<HTMLButtonElement>('composeTabButton');
    detailsButton.setAttribute('aria-selected', String(!composeActive));
    composeButton.setAttribute('aria-selected', String(composeActive));
    detailsButton.classList.toggle('active', !composeActive);
    composeButton.classList.toggle('active', composeActive);
  }

  private snapshot(): ComposerSnapshot | null {
    return this.draft ? {
      view: cloneView(this.draft),
      scopeMode: this.scopeMode,
      protectedCreditCount: this.protectedCreditCount
    } : null;
  }

  private pushHistory(): void {
    const snapshot = this.snapshot();
    if (!snapshot) return;
    this.history.push(snapshot);
    if (this.history.length > 50) this.history.shift();
  }

  private undo(): void {
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.draft = snapshot.view;
    this.scopeMode = snapshot.scopeMode;
    this.protectedCreditCount = snapshot.protectedCreditCount;
    this.render();
  }

  private renderEmpty(): void {
    renderHtml(byId('viewComposer'), `<div class="composer-empty">
      <span class="material-icons" aria-hidden="true">edit_note</span>
      <h2>Create a view or story</h2>
      <p>Start from the current graph, or duplicate an existing item from Stories &amp; Views.</p>
      <button type="button" class="button primary" data-composer-new>Create from current graph</button>
    </div>`);
  }

  private render(): void {
    const view = this.draft;
    if (!view) {
      this.renderEmpty();
      return;
    }
    const selection = this.options.currentSelection();
    const selectedNodeId = selection?.kind === 'node' ? selection.id : null;
    const selectedLabel = selectedNodeId ? this.options.nodeLabel(selectedNodeId) : '';
    const coreNodes = view.coreNodes ?? [];
    const sequence = view.nodeSequence ?? [];
    const inheritedCredits = view.metadata.credits.slice(0, this.protectedCreditCount);
    const addedCredits = view.metadata.credits.slice(this.protectedCreditCount);
    renderHtml(byId('viewComposer'), `<div class="composer-header">
      <div><div class="kicker">View/story composer</div><h2>${escapeHtml(view.title || 'Untitled view')}</h2></div>
      <div class="composer-header-actions">
        <button type="button" class="button" data-composer-undo${this.history.length ? '' : ' disabled'} title="Undo last structural change"><span class="material-icons" aria-hidden="true">undo</span> Undo</button>
        <button type="button" class="icon-button" data-composer-close aria-label="Show concept details" title="Show concept details">×</button>
      </div>
    </div>
    <div class="composer-scroll">
      <section class="composer-section">
        <h3>Identity</h3>
        <label class="composer-field">Title<input data-composer-field="title" value="${escapeHtml(view.title)}" maxlength="1000"></label>
        <label class="composer-field">Summary<textarea data-composer-field="summary" rows="2">${escapeHtml(view.summary)}</textarea></label>
        <label class="composer-field">Introduction<textarea data-composer-field="narrative" rows="3">${escapeHtml(view.narrative)}</textarea></label>
        <label class="composer-field">Tags <span class="muted">comma-separated</span><input data-composer-field="tags" value="${escapeHtml(view.tags.join(', '))}"></label>
      </section>

      <section class="composer-section">
        <div class="composer-section-heading"><h3>Graph scope</h3><button type="button" class="text-button" data-capture-settings>Capture current filters/display</button></div>
        <div class="composer-scope-options" role="radiogroup" aria-label="View scope">
          <label><input type="radio" name="composerScope" value="taxonomy"${this.scopeMode === 'taxonomy' ? ' checked' : ''}> Current fields and domains</label>
          <label><input type="radio" name="composerScope" value="core-nodes"${this.scopeMode === 'core-nodes' ? ' checked' : ''}> Selected concepts</label>
        </div>
        ${this.scopeMode === 'taxonomy'
          ? `<p class="composer-note">The draft contains ${view.settings.fields?.length ?? 0} field(s), ${view.settings.domains?.length ?? 0} domain(s), and its captured relation/display settings. Use Capture current filters/display to replace them.</p>`
          : `<div class="composer-node-tools">
              <button type="button" class="button" data-add-core${selectedNodeId ? '' : ' disabled'}>Add selected${selectedLabel ? `: ${escapeHtml(selectedLabel)}` : ''}</button>
              <button type="button" class="button" data-use-visible-core>Use visible direct-interest nodes</button>
              <button type="button" class="text-button" data-clear-core${coreNodes.length ? '' : ' disabled'}>Clear</button>
            </div>
            ${this.renderCoreNodes(coreNodes)}`}
      </section>

      <section class="composer-section">
        <div class="composer-section-heading"><h3>Story sequence <span class="composer-count">${sequence.length}</span></h3>
          <label class="composer-record-toggle"><input type="checkbox" data-record-steps${this.recording ? ' checked' : ''}> Record steps</label>
        </div>
        <p class="composer-note">A view becomes a Story when it has one or more ordered steps. Selecting nodes while recording appends them once.</p>
        <div class="composer-node-tools">
          <button type="button" class="button" data-add-step${selectedNodeId ? '' : ' disabled'}>Add selected as next step${selectedLabel ? `: ${escapeHtml(selectedLabel)}` : ''}</button>
          <button type="button" class="text-button" data-clear-steps${sequence.length ? '' : ' disabled'}>Clear sequence</button>
        </div>
        ${this.renderSteps(sequence)}
      </section>

      <section class="composer-section">
        <h3>Credit and rights</h3>
        <p class="composer-note">Inherited credit records are retained unchanged in duplicates, local saves, shared links, and exports. Additive credits can be appended.</p>
        ${inheritedCredits.length ? `<div class="composer-credit-group"><h4>Inherited</h4>${inheritedCredits.map((credit, index) => this.renderCredit(credit, index, true)).join('')}</div>` : ''}
        ${addedCredits.length ? `<div class="composer-credit-group"><h4>Added</h4>${addedCredits.map((credit, offset) => this.renderCredit(credit, this.protectedCreditCount + offset, false)).join('')}</div>` : ''}
        <div class="composer-credit-form">
          <label class="composer-field">Creator(s)<input data-credit-field="creators" value="${escapeHtml(this.pendingCredit.creators.join(', '))}" placeholder="Names, comma-separated"></label>
          <label class="composer-field">Attribution<input data-credit-field="attribution" value="${escapeHtml(this.pendingCredit.attribution ?? '')}"></label>
          <label class="composer-field">Copyright<input data-credit-field="copyright" value="${escapeHtml(this.pendingCredit.copyright ?? '')}"></label>
          <label class="composer-field">License<input data-credit-field="license" value="${escapeHtml(this.pendingCredit.license ?? '')}"></label>
          <label class="composer-field">License URL<input data-credit-field="licenseUrl" type="url" value="${escapeHtml(this.pendingCredit.licenseUrl ?? '')}"></label>
          <button type="button" class="button" data-add-credit>Add credit record</button>
        </div>
      </section>

      <section class="composer-section composer-output-section">
        <h3>Save and share</h3>
        <div id="composerStatus" class="composer-status" role="status" aria-live="polite"></div>
        <div class="composer-output-actions">
          <button type="button" class="button primary" data-save-view>Save locally</button>
          <button type="button" class="button" data-save-open>Save &amp; open</button>
          <button type="button" class="button" data-copy-view-link>Copy self-contained link</button>
          <button type="button" class="button" data-export-view>Download YAML</button>
        </div>
      </section>
    </div>`);
  }

  private renderCoreNodes(nodeIds: readonly string[]): string {
    if (!nodeIds.length) return '<p class="composer-empty-list">No core nodes yet.</p>';
    return `<ol class="composer-node-list">${nodeIds.map((nodeId) => `<li>
      <span title="${escapeHtml(nodeId)}">${escapeHtml(this.options.nodeLabel(nodeId) || nodeId)}</span>
      <button type="button" class="icon-button" data-remove-core="${escapeHtml(nodeId)}" aria-label="Remove ${escapeHtml(this.options.nodeLabel(nodeId) || nodeId)}">×</button>
    </li>`).join('')}</ol>`;
  }

  private renderSteps(nodeIds: readonly string[]): string {
    if (!nodeIds.length) return '<p class="composer-empty-list">No story steps yet.</p>';
    return `<ol class="composer-step-list">${nodeIds.map((nodeId, index) => `<li draggable="true" data-step-index="${index}">
      <div class="composer-step-heading">
        <span class="material-icons composer-drag-handle" aria-hidden="true">drag_indicator</span>
        <strong><span>${index + 1}.</span> ${escapeHtml(this.options.nodeLabel(nodeId) || nodeId)}</strong>
        <div class="composer-step-actions">
          <button type="button" class="icon-button" data-move-step="up" data-step-index="${index}" aria-label="Move step up"${index === 0 ? ' disabled' : ''}><span class="material-icons" aria-hidden="true">arrow_upward</span></button>
          <button type="button" class="icon-button" data-move-step="down" data-step-index="${index}" aria-label="Move step down"${index === nodeIds.length - 1 ? ' disabled' : ''}><span class="material-icons" aria-hidden="true">arrow_downward</span></button>
          <button type="button" class="icon-button" data-remove-step="${index}" aria-label="Remove step">×</button>
        </div>
      </div>
      <label>Step narration<textarea data-step-narrative="${escapeHtml(nodeId)}" rows="2" placeholder="Optional text shown at this step">${escapeHtml(this.draft?.stepNarratives?.[nodeId] ?? '')}</textarea></label>
    </li>`).join('')}</ol>`;
  }

  private renderCredit(credit: AtlasViewCredit, index: number, inherited: boolean): string {
    const rows = [
      credit.attribution ? `<div><dt>Attribution</dt><dd>${escapeHtml(credit.attribution)}</dd></div>` : '',
      credit.copyright ? `<div><dt>Copyright</dt><dd>${escapeHtml(credit.copyright)}</dd></div>` : '',
      credit.license ? `<div><dt>License</dt><dd>${escapeHtml(credit.license)}</dd></div>` : '',
      credit.licenseUrl ? `<div><dt>License URL</dt><dd><a href="${escapeHtml(credit.licenseUrl)}" target="_blank" rel="noopener">${escapeHtml(credit.licenseUrl)}</a></dd></div>` : ''
    ].join('');
    return `<article class="composer-credit${inherited ? ' inherited' : ''}">
      <div class="composer-credit-heading"><strong>${escapeHtml(credit.creators.join(', '))}</strong>${inherited ? '<span>Retained</span>' : `<button type="button" class="text-button" data-remove-credit="${index}">Remove</button>`}</div>
      ${rows ? `<dl>${rows}</dl>` : ''}
    </article>`;
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || !this.draft) return;
    const field = target.dataset.composerField;
    if (field === 'title') this.draft.title = target.value;
    else if (field === 'summary') this.draft.summary = target.value;
    else if (field === 'narrative') this.draft.narrative = target.value;
    else if (field === 'tags') this.draft.tags = this.parseCommaList(target.value);
    const stepNodeId = target.dataset.stepNarrative;
    if (stepNodeId) {
      this.draft.stepNarratives ??= {};
      if (target.value) this.draft.stepNarratives[stepNodeId] = target.value;
      else delete this.draft.stepNarratives[stepNodeId];
    }
    const creditField = target.dataset.creditField as keyof AtlasViewCredit | undefined;
    if (creditField === 'creators') this.pendingCredit.creators = this.parseCommaList(target.value);
    else if (creditField === 'attribution' || creditField === 'copyright' || creditField === 'license' || creditField === 'licenseUrl') {
      if (target.value) this.pendingCredit[creditField] = target.value;
      else delete this.pendingCredit[creditField];
    }
  }

  private handleChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !this.draft) return;
    if (target.name === 'composerScope' && (target.value === 'taxonomy' || target.value === 'core-nodes')) {
      this.pushHistory();
      this.scopeMode = target.value;
      if (this.scopeMode === 'taxonomy') {
        delete this.draft.coreNodes;
        this.draft.settings = settingsFromState(this.options.state, 'taxonomy');
      } else {
        this.draft.coreNodes = [...new Set(this.draft.nodeSequence ?? [])];
        this.draft.settings = settingsFromState(this.options.state, 'core-nodes');
      }
      this.render();
    } else if (target.dataset.recordSteps !== undefined) {
      this.recording = target.checked;
    }
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-composer-new]')) {
      this.startNew();
      return;
    }
    if (!this.draft) return;
    if (target.closest('[data-composer-close]')) this.showDetailsTab();
    else if (target.closest('[data-composer-undo]')) this.undo();
    else if (target.closest('[data-capture-settings]')) {
      this.pushHistory();
      this.draft.settings = settingsFromState(this.options.state, this.scopeMode);
      this.render();
      this.setStatus('Captured the current filter and display settings.');
    } else if (target.closest('[data-add-core]')) this.addSelectedCoreNode();
    else if (target.closest('[data-use-visible-core]')) this.useVisibleCoreNodes();
    else if (target.closest('[data-clear-core]')) {
      this.pushHistory();
      this.draft.coreNodes = [];
      this.render();
    } else if (target.closest('[data-add-step]')) this.addSelectedStep();
    else if (target.closest('[data-clear-steps]')) {
      this.pushHistory();
      delete this.draft.nodeSequence;
      delete this.draft.stepNarratives;
      this.render();
    } else {
      const removeCore = target.closest<HTMLElement>('[data-remove-core]');
      const removeStep = target.closest<HTMLElement>('[data-remove-step]');
      const moveStep = target.closest<HTMLElement>('[data-move-step]');
      const removeCredit = target.closest<HTMLElement>('[data-remove-credit]');
      if (removeCore?.dataset.removeCore) this.removeCoreNode(removeCore.dataset.removeCore);
      else if (removeStep?.dataset.removeStep) this.removeStep(Number(removeStep.dataset.removeStep));
      else if (moveStep?.dataset.moveStep && moveStep.dataset.stepIndex) {
        this.moveStep(Number(moveStep.dataset.stepIndex), moveStep.dataset.moveStep === 'up' ? -1 : 1);
      } else if (removeCredit?.dataset.removeCredit) this.removeCredit(Number(removeCredit.dataset.removeCredit));
      else if (target.closest('[data-add-credit]')) this.addCredit();
      else if (target.closest('[data-save-view]')) this.save(false);
      else if (target.closest('[data-save-open]')) this.save(true);
      else if (target.closest('[data-copy-view-link]')) void this.copyLink();
      else if (target.closest('[data-export-view]')) this.exportYaml();
    }
  }

  private handleDragStart(event: DragEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-step-index]');
    if (!row?.dataset.stepIndex) return;
    this.draggedStepIndex = Number(row.dataset.stepIndex);
    event.dataTransfer?.setData('text/plain', row.dataset.stepIndex);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  private handleDrop(event: DragEvent): void {
    event.preventDefault();
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-step-index]');
    if (!row?.dataset.stepIndex || this.draggedStepIndex === null) return;
    const targetIndex = Number(row.dataset.stepIndex);
    const sourceIndex = this.draggedStepIndex;
    this.draggedStepIndex = null;
    if (sourceIndex === targetIndex) return;
    this.reorderStep(sourceIndex, targetIndex);
  }

  private addSelectedCoreNode(): void {
    const selection = this.options.currentSelection();
    if (selection?.kind !== 'node' || !this.draft) return;
    this.pushHistory();
    this.draft.coreNodes = [...new Set([...(this.draft.coreNodes ?? []), selection.id])];
    this.render();
  }

  private useVisibleCoreNodes(): void {
    if (!this.draft) return;
    this.pushHistory();
    const requiredSteps = this.draft.nodeSequence ?? [];
    this.draft.coreNodes = [...new Set([...this.options.visibleDirectNodeIds(), ...requiredSteps])];
    this.render();
  }

  private removeCoreNode(nodeId: string): void {
    if (!this.draft) return;
    if (this.draft.nodeSequence?.includes(nodeId)) {
      this.setStatus('Remove this node from the story sequence before removing it from the core set.', true);
      return;
    }
    this.pushHistory();
    this.draft.coreNodes = (this.draft.coreNodes ?? []).filter((id) => id !== nodeId);
    this.render();
  }

  private addSelectedStep(): void {
    const selection = this.options.currentSelection();
    if (selection?.kind !== 'node' || !this.draft) return;
    if (this.draft.nodeSequence?.includes(selection.id)) {
      this.setStatus('That node is already in the story sequence.', true);
      return;
    }
    this.pushHistory();
    this.addStoryStep(selection.id);
    this.render();
  }

  private addStoryStep(nodeId: string): void {
    if (!this.draft) return;
    this.draft.nodeSequence = [...(this.draft.nodeSequence ?? []), nodeId];
    if (this.scopeMode === 'core-nodes') {
      this.draft.coreNodes = [...new Set([...(this.draft.coreNodes ?? []), nodeId])];
    }
  }

  private removeStep(index: number): void {
    if (!this.draft?.nodeSequence?.[index]) return;
    this.pushHistory();
    const [removed] = this.draft.nodeSequence.splice(index, 1);
    if (removed && this.draft.stepNarratives) delete this.draft.stepNarratives[removed];
    if (this.draft.nodeSequence.length === 0) delete this.draft.nodeSequence;
    this.render();
  }

  private moveStep(index: number, delta: -1 | 1): void {
    this.reorderStep(index, index + delta);
  }

  private reorderStep(sourceIndex: number, targetIndex: number): void {
    const sequence = this.draft?.nodeSequence;
    if (!sequence || sourceIndex < 0 || sourceIndex >= sequence.length || targetIndex < 0 || targetIndex >= sequence.length) return;
    this.pushHistory();
    const [nodeId] = sequence.splice(sourceIndex, 1);
    if (nodeId) sequence.splice(targetIndex, 0, nodeId);
    this.render();
  }

  private addCredit(): void {
    if (!this.draft) return;
    if (!this.pendingCredit.creators.length) {
      this.setStatus('Enter at least one creator before adding a credit record.', true);
      return;
    }
    this.pushHistory();
    this.draft.metadata.credits.push({
      creators: [...this.pendingCredit.creators],
      ...(this.pendingCredit.attribution ? { attribution: this.pendingCredit.attribution } : {}),
      ...(this.pendingCredit.copyright ? { copyright: this.pendingCredit.copyright } : {}),
      ...(this.pendingCredit.license ? { license: this.pendingCredit.license } : {}),
      ...(this.pendingCredit.licenseUrl ? { licenseUrl: this.pendingCredit.licenseUrl } : {})
    });
    this.pendingCredit = { creators: [] };
    this.render();
  }

  private removeCredit(index: number): void {
    if (!this.draft || index < this.protectedCreditCount || index >= this.draft.metadata.credits.length) return;
    this.pushHistory();
    this.draft.metadata.credits.splice(index, 1);
    this.render();
  }

  private materialize(): AtlasView | null {
    if (!this.draft) return null;
    const view = cloneView(this.draft);
    view.title = view.title.trim();
    view.summary = view.summary.trim();
    view.narrative = view.narrative.trim();
    view.tags = [...new Set(view.tags.map((tag) => tag.trim()).filter(Boolean))];
    if (this.scopeMode === 'taxonomy') {
      delete view.coreNodes;
    } else {
      delete view.settings.fields;
      delete view.settings.domains;
      view.coreNodes = [...new Set(view.coreNodes ?? [])];
    }
    if (!view.nodeSequence?.length) {
      delete view.nodeSequence;
      delete view.stepNarratives;
    } else if (view.stepNarratives) {
      for (const nodeId of Object.keys(view.stepNarratives)) {
        if (!view.nodeSequence.includes(nodeId) || !view.stepNarratives[nodeId]?.trim()) delete view.stepNarratives[nodeId];
        else view.stepNarratives[nodeId] = view.stepNarratives[nodeId]!.trim();
      }
      if (Object.keys(view.stepNarratives).length === 0) delete view.stepNarratives;
    }
    if (this.protectedCreditCount > 0) view.metadata.inheritedCreditCount = this.protectedCreditCount;
    else delete view.metadata.inheritedCreditCount;
    view.metadata.updatedAt = this.options.now();
    return view;
  }

  private localValidation(view: AtlasView): string[] {
    const errors: string[] = [];
    if (!view.title) errors.push('title');
    if (!view.settings.edgeTypes.length) errors.push('at least one relation type');
    if (this.scopeMode === 'taxonomy' && (!view.settings.fields?.length || !view.settings.domains?.length)) errors.push('selected fields and domains');
    if (this.scopeMode === 'core-nodes' && !view.coreNodes?.length) errors.push('at least one core node');
    if (view.nodeSequence && this.scopeMode === 'core-nodes' && view.nodeSequence.some((nodeId) => !view.coreNodes?.includes(nodeId))) {
      errors.push('all story steps in the core node set');
    }
    return errors;
  }

  private publicationValidation(view: AtlasView): string[] {
    const missing = this.localValidation(view);
    if (!view.summary) missing.push('summary');
    if (!view.narrative) missing.push('introduction');
    if (!view.tags.length) missing.push('at least one tag');
    if (!view.metadata.credits.length) missing.push('at least one credit record');
    return [...new Set(missing)];
  }

  private save(open: boolean): void {
    const view = this.materialize();
    if (!view) return;
    const errors = this.localValidation(view);
    if (errors.length) {
      this.setStatus(`Cannot save: add ${errors.join(', ')}.`, true);
      return;
    }
    this.draft = cloneView(view);
    this.options.savePersonalView(view);
    this.options.onLibraryChanged();
    const href = this.options.sharedViewUrl(view);
    this.setStatus(open ? 'Saved locally and opened.' : 'Saved locally.');
    if (open) this.options.navigate(href);
  }

  private async copyLink(): Promise<void> {
    const view = this.materialize();
    if (!view) return;
    const errors = this.localValidation(view);
    if (errors.length) {
      this.setStatus(`Cannot share: add ${errors.join(', ')}.`, true);
      return;
    }
    const href = this.options.sharedViewUrl(view);
    if (href.length > CUSTOM_VIEW_URL_MAX_LENGTH) {
      this.setStatus(`The self-contained URL is ${href.length.toLocaleString()} characters, above the ${CUSTOM_VIEW_URL_MAX_LENGTH.toLocaleString()}-character safety limit. Export YAML instead.`, true);
      return;
    }
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      window.prompt('Copy self-contained view link:', href);
    }
    this.setStatus(href.length > CUSTOM_VIEW_URL_WARNING_LENGTH
      ? `Copied a ${href.length.toLocaleString()}-character link. Some messaging systems may truncate it; YAML export is safer.`
      : `Copied self-contained link (${href.length.toLocaleString()} characters).`);
  }

  private exportYaml(): void {
    const view = this.materialize();
    if (!view) return;
    const missing = this.publicationValidation(view);
    if (missing.length) {
      this.setStatus(`YAML export requires publication metadata: ${missing.join(', ')}.`, true);
      return;
    }
    const blob = new Blob([serializeAtlasViewYaml(view)], { type: 'application/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.slug(view.title) || view.id}.yaml`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setStatus('Downloaded repository-ready YAML.');
  }

  private setStatus(message: string, error = false): void {
    const status = document.getElementById('composerStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  private parseCommaList(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }

  private slug(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
}

import { byId, escapeHtml, queryAll } from '../core/dom.js';
import { isCrossFieldVisibility, isLayoutName } from '../state/ui-state.js';
import {
  cycleDomainSuppression,
  domainSuppression,
  selectExclusiveDomain,
  selectExclusiveEdgeType,
  selectExclusiveField,
  type DomainSuppression
} from '../state/taxonomy-selection.js';
import type { GraphModel } from '../model/graph-model.js';
import type { AppState, AtlasView, LayoutName, Preferences, ThemePreference } from '../types.js';
import { DEFAULT_PREFERENCES } from '../state/preferences.js';
import { renderHtml } from './render.js';
import { publicViewKind, viewCoreNodes } from '../state/view-state.js';

export function fieldNavScopeLabel(
  fieldLabel: string,
  selectedDomainCount: number,
  totalDomainCount: number,
  active: boolean
): string {
  return active && selectedDomainCount < totalDomainCount
    ? `${fieldLabel} (${selectedDomainCount} of ${totalDomainCount})`
    : fieldLabel;
}

export function fieldNavActiveScopeId(
  selectedDomains: ReadonlySet<string>,
  domainOrder: readonly string[],
  fieldForDomain: (domainId: string) => string
): string | null {
  if (selectedDomains.size === domainOrder.length
    && domainOrder.every((domainId) => selectedDomains.has(domainId))) return 'global';
  if (selectedDomains.size === 0) return null;

  const [firstDomainId] = selectedDomains;
  if (!firstDomainId) return null;
  const fieldId = fieldForDomain(firstDomainId);
  return [...selectedDomains].every((domainId) => fieldForDomain(domainId) === fieldId)
    ? fieldId
    : null;
}

export interface FilterControlsOptions {
  model: GraphModel;
  state: AppState;
  fieldPageUrl: (fieldId: string) => string;
  domainPageUrl: (domainId: string) => string;
  persist: () => void;
  applyFilters: (options?: { relayout?: boolean }) => void;
  runLayout: (name: LayoutName, fitAfter: boolean) => void;
  preferences: () => Preferences;
  setPreferences: (preferences: Preferences) => void;
  activeView: () => AtlasView | null;
  exitView: () => void;
  exitCoreNodeScope: () => void;
  renderMathText: (value: unknown) => string;
}

export class FilterControls {
  constructor(private readonly options: FilterControlsOptions) {}

  initialize(): void {
    this.build();
    this.syncPreferences();
    this.updateFieldAllButtonLabel();
    this.updateEdgeAllButtonLabel();
    this.updateFieldNavActiveState();
    this.syncViewScope();
    this.bindEvents();
  }

  focusField(fieldId: string): void {
    if (!this.options.model.knownFieldIds.has(fieldId)) return;
    if (this.options.activeView()) this.options.exitView();
    this.selectOnlyField(fieldId);
  }

  focusDomain(domainId: string): void {
    if (!this.options.model.knownDomainIds.has(domainId)) return;
    if (this.options.activeView()) this.options.exitView();
    this.selectOnlyDomain(domainId);
  }

  syncViewScope(): void {
    const view = this.options.activeView();
    const context = byId<HTMLElement>('activeViewFilterContext');
    const taxonomy = byId<HTMLElement>('taxonomyFilterSection');
    if (!view) {
      context.hidden = true;
      context.replaceChildren();
      taxonomy.hidden = false;
      return;
    }

    const kind = publicViewKind(view);
    const coreNodeCount = viewCoreNodes(view).length;
    taxonomy.hidden = coreNodeCount > 0;
    context.hidden = false;
    renderHtml(context, `
      <div class="kicker">Current ${kind.toLowerCase()}</div>
      <strong class="math-rich">${this.options.renderMathText(view.title)}</strong>
      <p>${coreNodeCount > 0
        ? `This ${kind.toLowerCase()} directly selects ${coreNodeCount} node${coreNodeCount === 1 ? '' : 's'} instead of domains.`
        : `Filter and display changes remain attached to this ${kind.toLowerCase()} while its required nodes stay visible.`}</p>
      <div class="active-view-filter-actions">
        ${coreNodeCount > 0 ? '<button type="button" class="button secondary" data-exit-core-node-scope>Use primary domains</button>' : ''}
        <button type="button" class="button secondary" data-exit-view>Exit ${kind.toLowerCase()}</button>
      </div>`);
  }

  build(): void {
    const { model, state } = this.options;
    const fieldContainer = byId('fieldFilters');
    fieldContainer.replaceChildren();

    for (const fieldId of model.fieldOrder) {
      const field = model.data.fields[fieldId];
      if (!field) continue;
      const fieldDomains = model.domainOrder.filter((domainId) => model.fieldForDomain(domainId) === fieldId);
      const memberCount = model.data.nodes.filter((node) =>
        node.kind === 'structure' && model.nodeFieldIds(node).includes(fieldId)).length;
      const group = document.createElement('div');
      group.className = 'field-filter-group';
      group.dataset.fieldGroup = fieldId;

      const fieldItem = document.createElement('div');
      fieldItem.className = 'filter-item field-filter-item';
      fieldItem.title = field.description;
      const fieldExcluded = state.excludedFields.has(fieldId);
      renderHtml(fieldItem, `
        <label class="filter-checkbox-target"><input id="fieldFilter-${escapeHtml(fieldId)}" type="checkbox" data-field="${escapeHtml(fieldId)}" aria-label="Include ${escapeHtml(field.label)} field" ${state.selectedFields.has(fieldId) ? 'checked' : ''}></label>
        <button type="button" class="exclude-toggle" data-exclude-field="${escapeHtml(fieldId)}" aria-pressed="${fieldExcluded}" title="${escapeHtml(this.fieldSuppressionAction(field.label, fieldExcluded))}" aria-label="${escapeHtml(this.fieldSuppressionAction(field.label, fieldExcluded))}"><span class="material-symbols-outlined" aria-hidden="true">visibility_off</span></button>
        <span class="swatch" style="background:${escapeHtml(field.color)}" aria-hidden="true"></span>
        <span class="filter-item-copy"><a href="${escapeHtml(this.options.fieldPageUrl(fieldId))}" class="filter-link filter-field-link" data-field-link="${escapeHtml(fieldId)}" aria-label="Toggle exclusive ${escapeHtml(field.label)} field filter">${escapeHtml(field.label)}</a> <span class="filter-count" aria-label="${memberCount} concepts">${memberCount}</span></span>`);
      group.appendChild(fieldItem);

      const domainList = document.createElement('div');
      domainList.className = 'domain-list';
      for (const domainId of fieldDomains) {
        const domain = model.data.domains[domainId];
        if (!domain) continue;
        const domainMemberCount = model.data.nodes.filter((node) =>
          node.kind === 'structure' && model.nodeDomainIds(node).includes(domainId)).length;
        const primaryCount = model.data.nodes.filter((node) =>
          node.kind === 'structure' && node.primaryDomain === domainId).length;
        const suppression = domainSuppression(domainId, state.excludedDomains, state.prohibitedDomains);
        const item = document.createElement('div');
        item.className = 'filter-item domain-filter-item';
        item.title = `${domainMemberCount} concepts belong to this domain; ${primaryCount} use it as their primary layout domain.`;
        renderHtml(item, `
          <label class="filter-checkbox-target"><input id="domainFilter-${escapeHtml(domainId)}" type="checkbox" data-domain="${escapeHtml(domainId)}" aria-label="Include ${escapeHtml(domain.label)} domain" ${state.selectedDomains.has(domainId) ? 'checked' : ''}></label>
          ${this.domainSuppressionButton(domainId, domain.label, suppression)}
          <span class="swatch" style="background:${escapeHtml(domain.color)}" aria-hidden="true"></span>
          <span class="filter-item-copy"><a href="${escapeHtml(this.options.domainPageUrl(domainId))}" class="filter-link filter-domain-link" data-domain-link="${escapeHtml(domainId)}" aria-label="Toggle exclusive ${escapeHtml(domain.label)} domain filter">${escapeHtml(domain.label)}</a> <span class="filter-count" aria-label="${domainMemberCount} concepts">${domainMemberCount}</span></span>`);
        domainList.appendChild(item);
      }
      group.appendChild(domainList);
      fieldContainer.appendChild(group);
    }

    const edgeContainer = byId('edgeFilters');
    renderHtml(edgeContainer, model.edgeTypeOrder
      .filter((id) => model.data.edgeTypes[id]?.activeInDataset !== false)
      .map((id) => {
        const type = model.data.edgeTypes[id];
        if (!type) return '';
        const edgeTypeCount = model.data.edges.filter((edge) => edge.type === id).length;
        return `<div class="filter-item" title="${escapeHtml(type.description)}">
          <label class="filter-checkbox-target"><input id="edgeFilter-${escapeHtml(id)}" type="checkbox" data-edge-type="${escapeHtml(id)}" aria-label="Show ${escapeHtml(type.label)} relations" ${state.selectedEdgeTypes.has(id) ? 'checked' : ''}></label>
          <span class="line-swatch ${escapeHtml(type.lineStyle ?? 'solid')}" style="border-color:${escapeHtml(type.color)}" aria-hidden="true"></span>
          <span class="filter-item-copy"><a href="#" class="filter-link filter-edge-link" data-edge-link="${escapeHtml(id)}" aria-label="Toggle exclusive ${escapeHtml(type.label)} relation filter">${escapeHtml(type.label)}</a> <span class="filter-count" aria-label="${edgeTypeCount} relations">${edgeTypeCount}</span></span>
        </div>`;
      }).join(''));
  }

  syncPreferences(): void {
    const { state } = this.options;
    byId<HTMLInputElement>('edgeLabelsToggle').checked = state.showEdgeLabels;
    byId<HTMLInputElement>('junctionsToggle').checked = state.showJunctions;
    byId<HTMLInputElement>('hidePrerequisitesToggle').checked = state.hidePrerequisites;
    byId<HTMLInputElement>('showPrimaryOnlyToggle').checked = state.showPrimaryOnly;
    byId<HTMLInputElement>('hideIsolatesToggle').checked = state.hideIsolates;
    byId<HTMLInputElement>('edgeZoomToggle').checked = state.edgeZoomActivation;
    byId<HTMLSelectElement>('crossFieldSelect').value = state.crossFieldVisibility;
    byId<HTMLSelectElement>('layoutSelect').value = state.layout;
    const preferences = this.options.preferences();
    byId<HTMLSelectElement>('themeSelect').value = preferences.theme;
    byId<HTMLInputElement>('compactControlsToggle').checked = preferences.compactControls;
    byId<HTMLInputElement>('highResolutionToggle').checked = preferences.highResolution;
    byId<HTMLInputElement>('transitionsToggle').checked = preferences.transitions;
    byId<HTMLInputElement>('animateGraphToggle').checked = preferences.animateGraph;
    byId<HTMLInputElement>('refitOnChangeToggle').checked = preferences.refitOnChange;
    byId<HTMLInputElement>('motionBlurToggle').checked = preferences.motionBlur;
    byId<HTMLInputElement>('indicateOtherDomainsToggle').checked = preferences.indicateOtherDomains;
    byId<HTMLInputElement>('overlayDomainsToggle').checked = preferences.overlayDomains;
    byId<HTMLInputElement>('hideEdgesWhileMovingToggle').checked = preferences.hideEdgesWhileMoving;
    byId<HTMLInputElement>('allowNodeMovementToggle').checked = preferences.allowNodeMovement;
    byId<HTMLInputElement>('dimPrerequisitesToggle').checked = preferences.dimPrerequisites;
    byId<HTMLInputElement>('highlightPrerequisitesToggle').checked = preferences.highlightPrerequisites;
    byId<HTMLInputElement>('experimentalFeaturesToggle').checked = preferences.experimentalFeatures;
    byId<HTMLElement>('experimentalPreferenceOptions').hidden = !preferences.experimentalFeatures;
  }

  updateFieldAllButtonLabel(): void {
    const { model, state } = this.options;
    const allSelected = state.selectedFields.size === model.fieldOrder.length
      && state.selectedDomains.size === model.domainOrder.length;
    const button = byId<HTMLButtonElement>('fieldsAll');
    button.textContent = allSelected ? 'none' : 'all';
    button.setAttribute('aria-label', allSelected ? 'Clear all field and domain selections' : 'Select all fields and domains');
    button.title = button.getAttribute('aria-label') ?? '';
  }

  updateFieldNavActiveState(): void {
    const { model, state } = this.options;
    const activeScope = this.activeScopeLinkId();
    queryAll<HTMLAnchorElement>('[data-scope-link]').forEach((link) => {
      const scopeId = link.dataset.scopeLink ?? '';
      const active = scopeId === activeScope;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');

      if (scopeId === 'global') {
        link.textContent = 'All fields';
        return;
      }
      const field = model.data.fields[scopeId];
      if (!field) return;
      const fieldDomains = model.domainOrder.filter((domainId) => model.fieldForDomain(domainId) === scopeId);
      const selectedDomainCount = fieldDomains.filter((domainId) => state.selectedDomains.has(domainId)).length;
      link.textContent = fieldNavScopeLabel(field.label, selectedDomainCount, fieldDomains.length, active);
    });
    const exclusiveDomainId = this.exclusiveDomainId();
    queryAll<HTMLAnchorElement>('[data-domain-link]').forEach((link) => {
      const active = link.dataset.domainLink === exclusiveDomainId;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    queryAll<HTMLAnchorElement>('[data-field-link]').forEach((link) => {
      const active = link.dataset.fieldLink === activeScope && exclusiveDomainId === null;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  private bindEvents(): void {
    byId('fieldFilters').addEventListener('change', (event) => this.handleFieldOrDomainChange(event));
    byId('fieldFilters').addEventListener('click', (event) => this.handleTaxonomyLink(event));
    byId('edgeFilters').addEventListener('change', (event) => this.handleEdgeTypeChange(event));
    byId('edgeFilters').addEventListener('click', (event) => this.handleEdgeTypeLink(event));
    byId('fieldsAll').addEventListener('click', () => this.toggleAllFields());
    byId('edgesAll').addEventListener('click', () => this.toggleAllEdges());
    byId('preferencesReset').addEventListener('click', () => {
      this.options.setPreferences({ ...DEFAULT_PREFERENCES });
      this.syncPreferences();
    });
    byId<HTMLSelectElement>('themeSelect').addEventListener('change', (event) => {
      const theme = (event.currentTarget as HTMLSelectElement).value as ThemePreference;
      if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return;
      this.options.setPreferences({ ...this.options.preferences(), theme });
    });
    for (const id of ['compactControls', 'highResolution', 'transitions', 'animateGraph', 'refitOnChange', 'motionBlur', 'indicateOtherDomains', 'overlayDomains', 'hideEdgesWhileMoving', 'allowNodeMovement', 'dimPrerequisites', 'highlightPrerequisites', 'experimentalFeatures'] as const) {
      byId<HTMLInputElement>(`${id}Toggle`).addEventListener('change', (event) => {
        this.options.setPreferences({ ...this.options.preferences(), [id]: (event.currentTarget as HTMLInputElement).checked });
        if (id === 'experimentalFeatures') this.syncPreferences();
      });
    }

    byId('filtersPanel').addEventListener('click', (event) => this.handleSectionToggle(event));
    byId('activeViewFilterContext').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-exit-core-node-scope]')) this.options.exitCoreNodeScope();
      else if (target.closest('[data-exit-view]')) this.options.exitView();
    });

    byId<HTMLSelectElement>('crossFieldSelect').addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (!isCrossFieldVisibility(value)) return;
      this.options.state.crossFieldVisibility = value;
      this.commit(false);
    });
    byId<HTMLInputElement>('edgeLabelsToggle').addEventListener('change', (event) => {
      this.options.state.showEdgeLabels = (event.currentTarget as HTMLInputElement).checked;
      this.commit(false);
    });
    byId<HTMLInputElement>('edgeZoomToggle').addEventListener('change', (event) => {
      this.options.state.edgeZoomActivation = (event.currentTarget as HTMLInputElement).checked;
      this.commit(false);
    });
    byId<HTMLInputElement>('showPrimaryOnlyToggle').addEventListener('change', (event) => {
      this.options.state.showPrimaryOnly = (event.currentTarget as HTMLInputElement).checked;
      this.commit(true);
    });
    byId<HTMLInputElement>('hideIsolatesToggle').addEventListener('change', (event) => {
      this.options.state.hideIsolates = (event.currentTarget as HTMLInputElement).checked;
      this.commit(false);
    });
    byId<HTMLInputElement>('junctionsToggle').addEventListener('change', (event) => {
      this.options.state.showJunctions = (event.currentTarget as HTMLInputElement).checked;
      this.commit(true);
    });
    byId<HTMLInputElement>('hidePrerequisitesToggle').addEventListener('change', (event) => {
      this.options.state.hidePrerequisites = (event.currentTarget as HTMLInputElement).checked;
      this.commit(true);
    });
    byId<HTMLSelectElement>('layoutSelect').addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isLayoutName(value)) this.options.runLayout(value, true);
    });
  }

  private handleSectionToggle(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-filter-section-toggle]');
    if (!button) return;
    const bodyId = button.getAttribute('aria-controls');
    if (!bodyId) return;
    const body = document.getElementById(bodyId);
    if (!body) return;
    const expanded = button.getAttribute('aria-expanded') !== 'false';
    button.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
  }

  private handleFieldOrDomainChange(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const fieldId = input.dataset.field;
    if (fieldId) {
      const fieldDomains = this.options.model.domainOrder.filter((domainId) =>
        this.options.model.fieldForDomain(domainId) === fieldId);
      this.setMembership(this.options.state.selectedFields, fieldId, input.checked);
      fieldDomains.forEach((domainId) => this.setMembership(this.options.state.selectedDomains, domainId, input.checked));
      this.syncTaxonomyCheckboxes();
      this.commit(true);
      return;
    }

    const domainId = input.dataset.domain;
    if (!domainId) return;
    if (input.checked) {
      this.options.state.selectedDomains.add(domainId);
      this.options.state.selectedFields.add(this.options.model.fieldForDomain(domainId));
    } else {
      this.options.state.selectedDomains.delete(domainId);
    }
    this.syncTaxonomyCheckboxes();
    this.commit(true);
  }

  private handleTaxonomyLink(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const exclude = target.closest<HTMLButtonElement>('[data-exclude-field], [data-exclude-domain]');
    if (exclude) {
      event.preventDefault();
      event.stopPropagation();
      const fieldId = exclude.dataset.excludeField;
      const domainId = exclude.dataset.excludeDomain;
      if (fieldId) {
        const set = this.options.state.excludedFields;
        this.setMembership(set, fieldId, !set.has(fieldId));
        const excluded = set.has(fieldId);
        exclude.setAttribute('aria-pressed', String(excluded));
        const fieldLabel = this.options.model.data.fields[fieldId]?.label ?? fieldId;
        const action = this.fieldSuppressionAction(fieldLabel, excluded);
        exclude.setAttribute('aria-label', action);
        exclude.title = action;
      } else if (domainId) {
        const suppression = cycleDomainSuppression(
          domainId,
          this.options.state.excludedDomains,
          this.options.state.prohibitedDomains
        );
        this.syncDomainSuppressionButton(exclude, domainId, suppression);
      } else {
        return;
      }
      this.commit(true);
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[data-field-link], a[data-domain-link]');
    if (!link) return;
    if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    const fieldId = link.dataset.fieldLink;
    const domainId = link.dataset.domainLink;
    if (!fieldId && !domainId) return;
    event.preventDefault();
    event.stopPropagation();
    if (fieldId) this.selectOnlyField(fieldId);
    else if (domainId) this.selectOnlyDomain(domainId);
  }

  private handleEdgeTypeChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const edgeTypeId = event.target.dataset.edgeType;
    if (!edgeTypeId) return;
    this.setMembership(this.options.state.selectedEdgeTypes, edgeTypeId, event.target.checked);
    this.commit(false);
  }

  private handleEdgeTypeLink(event: Event): void {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    const edgeTypeId = event.target.dataset.edgeLink;
    if (!edgeTypeId) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectOnlyEdgeType(edgeTypeId);
  }

  private selectOnlyEdgeType(edgeTypeId: string): void {
    const { model, state } = this.options;
    const activeEdgeTypes = model.edgeTypeOrder.filter((id) => model.data.edgeTypes[id]?.activeInDataset !== false);
    state.selectedEdgeTypes = selectExclusiveEdgeType(state.selectedEdgeTypes, edgeTypeId, activeEdgeTypes);
    this.syncEdgeCheckboxes();
    this.commit(false);
  }

  private selectOnlyField(fieldId: string): void {
    const { model, state } = this.options;
    const selection = selectExclusiveField(state.selectedFields, state.selectedDomains, fieldId, {
      fieldOrder: model.fieldOrder,
      domainOrder: model.domainOrder,
      fieldForDomain: (domainId) => model.fieldForDomain(domainId)
    });
    state.selectedFields = selection.fields;
    state.selectedDomains = selection.domains;
    this.syncTaxonomyCheckboxes();
    this.commit(true);
  }

  private selectOnlyDomain(domainId: string): void {
    const { model, state } = this.options;
    const selection = selectExclusiveDomain(state.selectedDomains, domainId, {
      fieldOrder: model.fieldOrder,
      domainOrder: model.domainOrder,
      fieldForDomain: (id) => model.fieldForDomain(id)
    });
    state.selectedFields = selection.fields;
    state.selectedDomains = selection.domains;
    this.syncTaxonomyCheckboxes();
    this.commit(true);
  }

  private toggleAllFields(): void {
    const { model, state } = this.options;
    const allSelected = state.selectedFields.size === model.fieldOrder.length
      && state.selectedDomains.size === model.domainOrder.length;
    state.selectedFields = new Set(allSelected ? [] : model.fieldOrder);
    state.selectedDomains = new Set(allSelected ? [] : model.domainOrder);
    this.syncTaxonomyCheckboxes();
    this.commit(true);
  }

  private updateEdgeAllButtonLabel(): void {
    const { model, state } = this.options;
    const active = model.edgeTypeOrder.filter((id) => model.data.edgeTypes[id]?.activeInDataset !== false);
    const allSelected = state.selectedEdgeTypes.size === active.length;
    const button = byId<HTMLButtonElement>('edgesAll');
    button.textContent = allSelected ? 'none' : 'all';
    button.setAttribute('aria-label', allSelected ? 'Hide all relation types' : 'Show all relation types');
    button.title = button.getAttribute('aria-label') ?? '';
  }

  private syncEdgeCheckboxes(): void {
    const { state } = this.options;
    queryAll<HTMLInputElement>('[data-edge-type]').forEach((input) => {
      input.checked = state.selectedEdgeTypes.has(input.dataset.edgeType ?? '');
    });
  }

  private toggleAllEdges(): void {
    const { model, state } = this.options;
    const active = model.edgeTypeOrder.filter((id) => model.data.edgeTypes[id]?.activeInDataset !== false);
    const allSelected = state.selectedEdgeTypes.size === active.length;
    state.selectedEdgeTypes = new Set(allSelected ? [] : active);
    queryAll<HTMLInputElement>('[data-edge-type]').forEach((input) => {
      input.checked = state.selectedEdgeTypes.has(input.dataset.edgeType ?? '');
    });
    this.updateEdgeAllButtonLabel();
    this.commit(false);
  }

  private syncTaxonomyCheckboxes(): void {
    const { state } = this.options;
    queryAll<HTMLInputElement>('[data-field]').forEach((input) => {
      input.checked = state.selectedFields.has(input.dataset.field ?? '');
    });
    queryAll<HTMLInputElement>('[data-domain]').forEach((input) => {
      input.checked = state.selectedDomains.has(input.dataset.domain ?? '');
    });
  }

  private commit(relayout: boolean): void {
    this.options.persist();
    this.updateFieldAllButtonLabel();
    this.updateEdgeAllButtonLabel();
    this.updateFieldNavActiveState();
    this.options.applyFilters({ relayout });
  }

  private activeScopeLinkId(): string | null {
    const { model, state } = this.options;
    return fieldNavActiveScopeId(
      state.selectedDomains,
      model.domainOrder,
      (domainId) => model.fieldForDomain(domainId)
    );
  }

  private exclusiveDomainId(): string | null {
    const { model, state } = this.options;
    if (state.selectedDomains.size !== 1) return null;
    const domainId = state.selectedDomains.values().next().value as string | undefined;
    return domainId && model.knownDomainIds.has(domainId) ? domainId : null;
  }


  private fieldSuppressionAction(fieldLabel: string, excluded: boolean): string {
    return excluded
      ? `Allow prerequisite concepts whose primary field is ${fieldLabel}`
      : `Exclude prerequisite concepts whose primary field is ${fieldLabel}`;
  }

  private domainSuppressionButton(domainId: string, domainLabel: string, suppression: DomainSuppression): string {
    const ariaPressed = suppression === 'included' ? 'false' : suppression === 'excluded' ? 'mixed' : 'true';
    const icon = suppression === 'included' ? 'visibility' : suppression === 'excluded' ? 'visibility_off' : 'block';
    const action = suppression === 'included'
      ? `Activate to exclude prerequisite concepts whose primary domain is ${domainLabel}`
      : suppression === 'excluded'
        ? `${domainLabel} is excluded from prerequisite context; activate again to prohibit it completely`
        : `${domainLabel} is prohibited completely; activate again to allow it`;
    return `<button type="button" class="exclude-toggle domain-suppression-toggle" data-exclude-domain="${escapeHtml(domainId)}" data-suppression="${suppression}" aria-pressed="${ariaPressed}" title="${escapeHtml(action)}" aria-label="${escapeHtml(action)}"><span class="material-symbols-outlined" aria-hidden="true">${icon}</span></button>`;
  }

  private syncDomainSuppressionButton(button: HTMLButtonElement, domainId: string, suppression: DomainSuppression): void {
    const domainLabel = this.options.model.data.domains[domainId]?.label ?? domainId;
    const replacement = document.createElement('span');
    renderHtml(replacement, this.domainSuppressionButton(domainId, domainLabel, suppression));
    const next = replacement.firstElementChild;
    if (next instanceof HTMLButtonElement) button.replaceWith(next);
  }

  private setMembership(set: Set<string>, id: string, enabled: boolean): void {
    if (enabled) set.add(id);
    else set.delete(id);
  }
}

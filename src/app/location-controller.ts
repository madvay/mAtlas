import { addShareUiStateToParams, addViewUiStateOverridesToParams, resolveUrlUiState, type ResolvedUrlUiState } from '../state/ui-state.js';
import {
  viewIdFromPath,
  viewIdFromTemplate,
  viewNodeSequence,
  viewPagePath,
  viewSettingsAsUrlState,
  viewTaxonomyDefaults
} from '../state/view-state.js';
import { stripInlineMathText, summarizePlainText } from '../core/text.js';
import type { GraphModel } from '../model/graph-model.js';
import type { AppState, AtlasView, HistoryMode, SelectionTarget, ShareCodecConfig, UrlUiState } from '../types.js';

export interface LocationControllerOptions {
  model: GraphModel;
  getState: () => AppState;
  views: ReadonlyMap<string, AtlasView>;
  fieldOrder: readonly string[];
  domainOrder: readonly string[];
  edgeTypeOrder: readonly string[];
  shareCodec: ShareCodecConfig;
}

export interface TaxonomyScope {
  fieldId: string | null;
  domainId: string | null;
}

function normalizedPath(pathname: string): string {
  return pathname
    .replace(/\/index\.html$/i, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function taxonomyScopeFromPath(pathname: string, model: GraphModel, fieldOrder: readonly string[]): TaxonomyScope {
  const path = normalizedPath(pathname);
  for (const fieldId of fieldOrder) {
    const fieldPath = model.data.fields[fieldId]?.path?.replace(/^\/+|\/+$/g, '');
    if (!fieldPath) continue;
    if (path === fieldPath) return { fieldId, domainId: null };
    if (!path.startsWith(`${fieldPath}/`)) continue;
    const encodedDomainId = path.slice(fieldPath.length + 1);
    if (!encodedDomainId || encodedDomainId.includes('/')) continue;
    let domainId: string;
    try {
      domainId = decodeURIComponent(encodedDomainId);
    } catch {
      continue;
    }
    if (model.knownDomainIds.has(domainId) && model.fieldForDomain(domainId) === fieldId) {
      return { fieldId, domainId };
    }
  }
  return { fieldId: null, domainId: null };
}

export function selectionFromPath(pathname: string, nodeIds: ReadonlySet<string>): SelectionTarget | null {
  const match = pathname.match(/\/concepts\/([^/]+)(?:\/index\.html)?\/?$/);
  const encodedNodeId = match?.[1];
  if (!encodedNodeId) return null;
  const nodeId = decodeURIComponent(encodedNodeId);
  return nodeIds.has(nodeId) ? { kind: 'node', id: nodeId } : null;
}

export function selectionFromParams(
  params: URLSearchParams,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>
): SelectionTarget | null {
  const nodeId = params.get('node');
  if (nodeId && nodeIds.has(nodeId)) return { kind: 'node', id: nodeId };
  const edgeId = params.get('edge');
  if (edgeId && edgeIds.has(edgeId)) return { kind: 'edge', id: edgeId };
  return null;
}

export function selectionFromTemplate(
  content: string | null | undefined,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>
): SelectionTarget | null {
  const normalized = content?.trim();
  if (!normalized) return null;
  const separator = normalized.indexOf(':');
  if (separator <= 0) return null;
  const kind = normalized.slice(0, separator);
  const id = normalized.slice(separator + 1);
  if (kind === 'node' && nodeIds.has(id)) return { kind: 'node', id };
  if (kind === 'edge' && edgeIds.has(id)) return { kind: 'edge', id };
  return null;
}

export class LocationController {
  readonly scopedFieldId: string | null;
  readonly scopedDomainId: string | null;
  readonly runtimeGlobalRootUrl: string;
  readonly canonicalRootUrl: string;
  private activeViewId: string | null = null;

  constructor(private readonly options: LocationControllerOptions) {
    this.runtimeGlobalRootUrl = new URL('./', document.baseURI).toString();
    const scope = this.resolveTaxonomyScope({ includeTemplate: true });
    this.scopedFieldId = scope.fieldId;
    this.scopedDomainId = scope.domainId;
    this.canonicalRootUrl = document.querySelector<HTMLMetaElement>('meta[name="atlas:root"]')?.content?.trim()
      || 'https://atlas.madvay.com/';
  }

  scopedDefaultFieldIds(): string[] {
    return this.scopedFieldId ? [this.scopedFieldId] : [...this.options.fieldOrder];
  }

  scopedDefaultDomainIds(): string[] {
    if (this.scopedDomainId) return [this.scopedDomainId];
    const fields = new Set(this.scopedDefaultFieldIds());
    return this.options.domainOrder.filter((domainId) => fields.has(this.options.model.fieldForDomain(domainId)));
  }

  taxonomyDefaultsFromLocation(): Pick<UrlUiState, 'fields' | 'domains'> {
    const scope = this.resolveTaxonomyScope();
    if (scope.domainId && scope.fieldId) return { fields: [scope.fieldId], domains: [scope.domainId] };
    if (scope.fieldId) {
      return {
        fields: [scope.fieldId],
        domains: this.options.domainOrder.filter((domainId) => this.options.model.fieldForDomain(domainId) === scope.fieldId)
      };
    }
    if (normalizedPath(window.location.pathname) === '') {
      return { fields: [...this.options.fieldOrder], domains: [...this.options.domainOrder] };
    }
    return {};
  }

  conceptPageDefaultTaxonomy(): { fields: string[]; domains: string[] } | null {
    const selection = this.parseSelectionPath();
    if (!selection || selection.kind !== 'node') return null;
    const node = this.options.model.nodeRecord.get(selection.id);
    if (!node || node.kind !== 'structure') return null;
    const domainId = node.primaryDomain;
    return { fields: [this.options.model.fieldForDomain(domainId)], domains: [domainId] };
  }

  resolveViewFromLocation({ includeTemplate = false }: { includeTemplate?: boolean } = {}): AtlasView | null {
    const ids = new Set(this.options.views.keys());
    const pathId = viewIdFromPath(window.location.pathname, ids);
    if (pathId) return this.options.views.get(pathId) ?? null;
    if (!includeTemplate) return null;
    const templateId = viewIdFromTemplate(
      document.querySelector<HTMLMetaElement>('meta[name="atlas:view"]')?.content,
      ids
    );
    return this.options.views.get(templateId ?? '') ?? null;
  }

  setActiveView(viewId: string | null): void {
    this.activeViewId = viewId && this.options.views.has(viewId) ? viewId : null;
  }

  deactivateView(): void {
    this.activeViewId = null;
  }

  activeView(): AtlasView | null {
    return this.activeViewId ? this.options.views.get(this.activeViewId) ?? null : null;
  }

  viewDefaults(view: AtlasView): ResolvedUrlUiState {
    const taxonomy = viewTaxonomyDefaults(
      view,
      this.options.model.nodeRecord,
      (domainId) => this.options.model.fieldForDomain(domainId)
    );
    const defaults = viewSettingsAsUrlState(view.settings, taxonomy);
    return resolveUrlUiState({}, {
      fields: defaults.fields ?? [],
      domains: defaults.domains ?? [],
      edgeTypes: defaults.edgeTypes ?? [],
      excludedFields: defaults.excludedFields,
      excludedDomains: defaults.excludedDomains,
      prohibitedDomains: defaults.prohibitedDomains,
      crossFieldVisibility: defaults.crossFieldVisibility,
      showPrimaryOnly: defaults.showPrimaryOnly,
      hideIsolates: defaults.hideIsolates,
      edgeLabels: defaults.edgeLabels,
      junctions: defaults.junctions,
      edgeZoomActivation: defaults.edgeZoomActivation,
      hidePrerequisites: defaults.hidePrerequisites,
      layout: defaults.layout
    });
  }

  viewPageUrl(viewId: string): string {
    return new URL(viewPagePath(viewId), this.runtimeGlobalRootUrl).toString();
  }

  viewNodeUrl(viewId: string, nodeId: string): string {
    const url = new URL(this.viewPageUrl(viewId));
    url.searchParams.set('node', nodeId);
    return url.toString();
  }

  scopedDefaultViewSelection(): SelectionTarget | null {
    const view = this.activeView();
    const firstNodeId = view ? viewNodeSequence(view)[0] : undefined;
    return firstNodeId ? { kind: 'node', id: firstNodeId } : null;
  }

  parseSelectionPath(): SelectionTarget | null {
    return selectionFromPath(window.location.pathname, this.options.model.knownNodeIds);
  }

  parseSelectionQuery(): SelectionTarget | null {
    return selectionFromParams(
      new URL(window.location.href).searchParams,
      this.options.model.knownNodeIds,
      this.options.model.knownEdgeIds
    );
  }

  parseTemplateSelection(): SelectionTarget | null {
    const content = document.querySelector<HTMLMetaElement>('meta[name="atlas:selection"]')?.content;
    return selectionFromTemplate(content, this.options.model.knownNodeIds, this.options.model.knownEdgeIds);
  }

  parseSelection({ includeTemplateSelection = false }: { includeTemplateSelection?: boolean } = {}): SelectionTarget | null {
    const params = new URL(window.location.href).searchParams;
    if (params.get('selection') === 'none') return null;
    const pathTarget = this.parseSelectionPath();
    if (pathTarget) return pathTarget;
    const queryTarget = this.parseSelectionQuery();
    if (queryTarget) return queryTarget;
    if (includeTemplateSelection) {
      const templateTarget = this.parseTemplateSelection();
      if (templateTarget) return templateTarget;
      const viewTarget = this.scopedDefaultViewSelection();
      if (viewTarget && this.options.model.knownNodeIds.has(viewTarget.id)) return viewTarget;
    }
    return selectionFromParams(
      new URLSearchParams(window.location.hash.slice(1)),
      this.options.model.knownNodeIds,
      this.options.model.knownEdgeIds
    );
  }

  addUiState(url: URL): void {
    addShareUiStateToParams(url.searchParams, this.options.getState(), this.options.shareCodec);
  }

  githubEditUrl(itemId: string): string {
    const textFragment = encodeURIComponent(`id: ${itemId}`);
    const node = this.options.model.nodeRecord.get(itemId);
    if (node?.kind === 'structure' && typeof node.primaryDomain === 'string') {
      const fieldId = node.primaryField ?? this.options.model.fieldForDomain(node.primaryDomain);
      return `https://github.com/madvay/mAtlas/blob/main/content/concepts/${fieldId}/${node.primaryDomain}.yaml#:~:text=${textFragment}`;
    }
    return `https://github.com/madvay/mAtlas/search?q=repo%3Amadvay%2FmAtlas+%22id%22+%22${encodeURIComponent(itemId)}%22+path%3Acontent%2Fconcepts&type=code`;
  }

  conceptPageUrl(nodeId: string): string {
    return new URL(`concepts/${encodeURIComponent(nodeId)}/`, this.runtimeGlobalRootUrl).toString();
  }

  fieldPageUrl(fieldId: string): string {
    const fieldPath = this.options.model.data.fields[fieldId]?.path ?? fieldId;
    return new URL(`${fieldPath}/`, this.runtimeGlobalRootUrl).toString();
  }

  domainPageUrl(domainId: string): string {
    const fieldId = this.options.model.fieldForDomain(domainId);
    const fieldPath = this.options.model.data.fields[fieldId]?.path ?? fieldId;
    return new URL(`${fieldPath}/${encodeURIComponent(domainId)}/`, this.runtimeGlobalRootUrl).toString();
  }

  itemUrl(itemId: string, itemKind: SelectionTarget['kind']): string {
    const view = this.activeView();
    if (view) {
      return this.urlForActiveViewSelection({ kind: itemKind, id: itemId }).toString();
    }

    const { model } = this.options;
    if (itemKind === 'node' && model.nodeRecord.get(itemId)?.kind === 'structure') {
      const url = new URL(this.conceptPageUrl(itemId));
      this.addUiState(url);
      return url.toString();
    }

    const scope = this.scopeForSelection(this.namedScopeForState());
    const url = this.scopeUrl(scope, this.runtimeGlobalRootUrl);
    this.addUiState(url);
    url.searchParams.set(itemKind, itemId);
    url.searchParams.delete(itemKind === 'node' ? 'edge' : 'node');
    url.hash = '';
    return url.toString();
  }

  write(target: SelectionTarget | null, mode: Exclude<HistoryMode, null> = 'replace'): void {
    const activeView = this.activeView();
    let url: URL;
    if (activeView) {
      url = this.urlForActiveViewSelection(target);
    } else {
      const { model } = this.options;
      const namedScope = this.namedScopeForState();
      const conceptSelected = target?.kind === 'node' && model.nodeRecord.get(target.id)?.kind === 'structure';
      if (conceptSelected) {
        url = new URL(this.conceptPageUrl(target.id));
        this.addUiState(url);
      } else {
        const scope = target ? this.scopeForSelection(namedScope) : namedScope;
        url = this.scopeUrl(scope, this.runtimeGlobalRootUrl);
        this.addUiState(url);
        url.searchParams.delete('node');
        url.searchParams.delete('edge');
        url.searchParams.delete('selection');
        if (target?.kind === 'node') url.searchParams.set('node', target.id);
        if (target?.kind === 'edge') url.searchParams.set('edge', target.id);
        url.hash = '';
      }
    }
    if (url.href === window.location.href) return;

    try {
      const historyState = { selection: target, uiStateVersion: 1, viewId: this.activeViewId };
      if (mode === 'replace') window.history.replaceState(historyState, '', url.href);
      else window.history.pushState(historyState, '', url.href);
    } catch {
      if (mode === 'replace') window.location.replace(url.href);
      else window.location.assign(url.href);
    }
  }

  syncDocumentMetadata(target: SelectionTarget | null): void {
    const { model } = this.options;
    const activeView = this.activeView();
    const defaultMetadata = this.scopeMetadata(this.namedScopeForState());
    let title = activeView ? `${activeView.title} — ${model.data.meta.title}` : defaultMetadata.title;
    let description = activeView ? activeView.summary : defaultMetadata.description;

    if (target?.kind === 'node') {
      const node = model.nodeRecord.get(target.id);
      if (node) {
        title = activeView
          ? `${stripInlineMathText(node.label)} — ${activeView.title} — ${model.data.meta.title}`
          : `${stripInlineMathText(node.label)} - ${model.data.meta.title}`;
        description = summarizePlainText(node.summary || description);
        if (!activeView) {
          const canonicalUrl = this.selectionCanonicalUrl(target);
          this.setDynamicEntityJsonLd({
            '@context': 'https://schema.org',
            '@type': 'DefinedTerm',
            '@id': canonicalUrl,
            name: stripInlineMathText(node.label),
            description,
            url: canonicalUrl,
            identifier: node.id,
            termCode: node.id,
            inDefinedTermSet: `${this.canonicalRootUrl}concepts/`
          });
        } else {
          this.setDynamicEntityJsonLd(null);
        }
      }
    } else if (target?.kind === 'edge') {
      const edge = model.edgeRecord.get(target.id);
      if (edge) {
        title = activeView
          ? `${stripInlineMathText(edge.label)} — ${activeView.title} — ${model.data.meta.title}`
          : `${stripInlineMathText(edge.label)} - ${model.data.meta.title}`;
        description = summarizePlainText(edge.detail || description);
      }
      this.setDynamicEntityJsonLd(null);
    } else {
      this.setDynamicEntityJsonLd(null);
    }

    const canonicalUrl = this.selectionCanonicalUrl(target);
    this.setViewPageJsonLd(activeView);
    document.title = title;
    this.setCanonicalHref(canonicalUrl);
    this.setHeadMeta('meta[name="description"]', 'name', 'description', description);
    this.setHeadMeta('meta[property="og:title"]', 'property', 'og:title', title);
    this.setHeadMeta('meta[property="og:description"]', 'property', 'og:description', description);
    this.setHeadMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    this.setHeadMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    this.setHeadMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
  }

  private urlForActiveViewSelection(target: SelectionTarget | null): URL {
    const view = this.activeView();
    if (!view) return this.scopeUrl(this.namedScopeForState(), this.runtimeGlobalRootUrl);
    const url = new URL(this.viewPageUrl(view.id));
    addViewUiStateOverridesToParams(
      url.searchParams,
      this.options.getState(),
      this.viewDefaults(view),
      this.options.shareCodec
    );
    const sequence = viewNodeSequence(view);
    if (!target) {
      if (sequence.length > 0) url.searchParams.set('selection', 'none');
    } else if (!(target.kind === 'node' && target.id === sequence[0])) {
      url.searchParams.set(target.kind, target.id);
    }
    return url;
  }

  private resolveTaxonomyScope({ includeTemplate = false }: { includeTemplate?: boolean } = {}): TaxonomyScope {
    const { model, fieldOrder } = this.options;
    const fromPath = taxonomyScopeFromPath(window.location.pathname, model, fieldOrder);
    if (fromPath.fieldId) return fromPath;
    if (!includeTemplate) return fromPath;
    const explicitDomain = document.querySelector<HTMLMetaElement>('meta[name="atlas:domain"]')?.content?.trim();
    if (explicitDomain && model.knownDomainIds.has(explicitDomain)) {
      return { fieldId: model.fieldForDomain(explicitDomain), domainId: explicitDomain };
    }
    const explicitField = document.querySelector<HTMLMetaElement>('meta[name="atlas:scope"]')?.content?.trim();
    if (explicitField && model.knownFieldIds.has(explicitField)) return { fieldId: explicitField, domainId: null };
    return fromPath;
  }

  private selectionCanonicalUrl(target: SelectionTarget | null): string {
    const activeView = this.activeView();
    if (activeView) return new URL(viewPagePath(activeView.id), this.canonicalRootUrl).toString();
    const { model } = this.options;
    if (!target) {
      return this.scopeUrl(this.namedScopeForState(), this.canonicalRootUrl).toString();
    }
    if (target.kind === 'node') {
      if (model.nodeRecord.get(target.id)?.kind === 'structure') {
        return new URL(`concepts/${encodeURIComponent(target.id)}/`, this.canonicalRootUrl).toString();
      }
      return `${this.canonicalRootUrl}?node=${encodeURIComponent(target.id)}`;
    }
    return `${this.canonicalRootUrl}?edge=${encodeURIComponent(target.id)}`;
  }

  private namedScopeForState(): TaxonomyScope & { named: boolean } {
    const { model } = this.options;
    const selectedDomains = this.options.getState().selectedDomains;
    if (selectedDomains.size === 1) {
      const domainId = selectedDomains.values().next().value as string | undefined;
      if (domainId && model.knownDomainIds.has(domainId)) {
        return { fieldId: model.fieldForDomain(domainId), domainId, named: true };
      }
    }
    if (selectedDomains.size === this.options.domainOrder.length) {
      return { fieldId: null, domainId: null, named: true };
    }
    for (const fieldId of this.options.fieldOrder) {
      const fieldDomains = this.options.domainOrder.filter((domainId) => model.fieldForDomain(domainId) === fieldId);
      if (fieldDomains.length === selectedDomains.size && fieldDomains.every((domainId) => selectedDomains.has(domainId))) {
        return { fieldId, domainId: null, named: true };
      }
    }
    return { fieldId: null, domainId: null, named: false };
  }

  private scopeForSelection(scope: TaxonomyScope & { named: boolean }): TaxonomyScope & { named: boolean } {
    return scope.domainId
      ? { fieldId: null, domainId: null, named: false }
      : scope;
  }

  private scopeUrl(scope: TaxonomyScope, rootUrl: string): URL {
    if (scope.domainId) {
      const fieldId = scope.fieldId ?? this.options.model.fieldForDomain(scope.domainId);
      const fieldPath = this.options.model.data.fields[fieldId]?.path ?? fieldId;
      return new URL(`${fieldPath}/${encodeURIComponent(scope.domainId)}/`, rootUrl);
    }
    if (scope.fieldId) {
      const fieldPath = this.options.model.data.fields[scope.fieldId]?.path ?? scope.fieldId;
      return new URL(`${fieldPath}/`, rootUrl);
    }
    return new URL(rootUrl);
  }

  private scopeMetadata(scope: TaxonomyScope): { title: string; description: string } {
    const { model } = this.options;
    if (scope.domainId) {
      const domain = model.data.domains[scope.domainId];
      const field = scope.fieldId ? model.data.fields[scope.fieldId] : undefined;
      return {
        title: `${domain?.label ?? scope.domainId} — ${model.data.meta.title}`,
        description: `Explore ${domain?.label ?? scope.domainId} concepts and relations in ${field?.label ?? 'the atlas'}.`
      };
    }
    if (scope.fieldId) {
      const field = model.data.fields[scope.fieldId];
      return {
        title: `${field?.label ?? scope.fieldId} — ${model.data.meta.title}`,
        description: field?.description ?? model.data.meta.description
      };
    }
    return { title: model.data.meta.title, description: model.data.meta.description };
  }

  private setHeadMeta(
    selector: string,
    attributeName: 'name' | 'property',
    attributeValue: string,
    content: string
  ): void {
    let meta = document.head.querySelector<HTMLMetaElement>(selector);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attributeName, attributeValue);
      document.head.appendChild(meta);
    }
    meta.content = content;
  }

  private setCanonicalHref(href: string): void {
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = href;
  }

  private setViewPageJsonLd(view: AtlasView | null): void {
    const scriptId = 'view-page-jsonld';
    const existing = document.head.querySelector<HTMLScriptElement>(`script#${scriptId}`);
    if (!view) {
      existing?.remove();
      return;
    }
    const canonicalUrl = new URL(viewPagePath(view.id), this.canonicalRootUrl).toString();
    const sequence = viewNodeSequence(view);
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': canonicalUrl,
      name: view.title,
      description: view.summary,
      url: canonicalUrl,
      isPartOf: { '@type': 'WebSite', name: this.options.model.data.meta.title, url: this.canonicalRootUrl },
      about: view.tags,
      ...(sequence.length ? {
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: sequence.map((nodeId, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
              '@type': 'DefinedTerm',
              '@id': new URL(`concepts/${encodeURIComponent(nodeId)}/`, this.canonicalRootUrl).toString()
            }
          }))
        }
      } : {})
    };
    const script = existing ?? document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    script.text = JSON.stringify(payload);
    if (!existing) document.head.appendChild(script);
  }

  private setDynamicEntityJsonLd(payload: object | null): void {
    const scriptId = 'dynamic-entity-jsonld';
    const existing = document.head.querySelector<HTMLScriptElement>(`script#${scriptId}`);
    if (!payload) {
      existing?.remove();
      return;
    }
    const script = existing ?? document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    script.text = JSON.stringify(payload);
    if (!existing) document.head.appendChild(script);
  }
}

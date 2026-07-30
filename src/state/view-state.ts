import type {
  AppState,
  AtlasView,
  AtlasViewSettings,
  GraphNode,
  UrlUiState
} from '../types.js';
import type { ResolvedUrlUiState } from './ui-state.js';

export function viewIdFromPath(pathname: string, knownViewIds: ReadonlySet<string>): string | null {
  const match = pathname.match(/\/views\/([^/]+)(?:\/index\.html)?\/?$/);
  const encodedViewId = match?.[1];
  if (!encodedViewId) return null;
  try {
    const viewId = decodeURIComponent(encodedViewId);
    return knownViewIds.has(viewId) ? viewId : null;
  } catch {
    return null;
  }
}

export function viewIdFromTemplate(content: string | null | undefined, knownViewIds: ReadonlySet<string>): string | null {
  const viewId = content?.trim();
  return viewId && knownViewIds.has(viewId) ? viewId : null;
}

export function viewNodeSequence(view: Pick<AtlasView, 'nodeSequence'>): readonly string[] {
  return view.nodeSequence ?? [];
}

export function viewCoreNodes(view: Pick<AtlasView, 'coreNodes'>): readonly string[] {
  return view.coreNodes ?? [];
}

export function viewRequiredNodeIds(view: Pick<AtlasView, 'coreNodes' | 'nodeSequence'>): Set<string> {
  return new Set([...viewCoreNodes(view), ...viewNodeSequence(view)]);
}

export function isStory(view: Pick<AtlasView, 'nodeSequence'>): boolean {
  return viewNodeSequence(view).length > 0;
}

export function publicViewKind(view: Pick<AtlasView, 'nodeSequence'>): 'Story' | 'View' {
  return isStory(view) ? 'Story' : 'View';
}

export interface ViewTaxonomyDefaults {
  fields: string[];
  domains: string[];
}

export function viewTaxonomyDefaults(
  view: AtlasView,
  nodeRecord: ReadonlyMap<string, GraphNode>,
  fieldForDomain: (domainId: string) => string
): ViewTaxonomyDefaults {
  const configuredDomains = view.settings.domains ?? [];
  if (configuredDomains.length > 0) {
    return {
      fields: [...(view.settings.fields ?? [])],
      domains: [...configuredDomains]
    };
  }

  const domains: string[] = [];
  const domainSet = new Set<string>();
  for (const nodeId of viewCoreNodes(view)) {
    const domainId = nodeRecord.get(nodeId)?.primaryDomain;
    if (!domainId || domainSet.has(domainId)) continue;
    domainSet.add(domainId);
    domains.push(domainId);
  }

  const fields: string[] = [];
  const fieldSet = new Set<string>();
  for (const domainId of domains) {
    const fieldId = fieldForDomain(domainId);
    if (!fieldId || fieldSet.has(fieldId)) continue;
    fieldSet.add(fieldId);
    fields.push(fieldId);
  }
  return { fields, domains };
}

export function viewSettingsAsUrlState(
  settings: AtlasViewSettings,
  taxonomy: ViewTaxonomyDefaults = {
    fields: settings.fields ?? [],
    domains: settings.domains ?? []
  }
): UrlUiState {
  return {
    fields: [...taxonomy.fields],
    domains: [...taxonomy.domains],
    edgeTypes: [...settings.edgeTypes],
    excludedFields: [...(settings.excludedFields ?? [])],
    excludedDomains: [...(settings.excludedDomains ?? [])],
    prohibitedDomains: [...(settings.prohibitedDomains ?? [])],
    crossFieldVisibility: settings.crossFieldVisibility,
    showPrimaryOnly: settings.showPrimaryOnly ?? false,
    hideIsolates: settings.hideIsolates ?? false,
    edgeLabels: settings.edgeLabels,
    junctions: settings.junctions,
    edgeZoomActivation: settings.edgeZoomActivation,
    hidePrerequisites: settings.hidePrerequisites ?? false,
    layout: settings.layout
  };
}

function sameIds(current: ReadonlySet<string> | undefined, expected: readonly string[] | undefined): boolean {
  const currentIds = current ?? new Set<string>();
  const expectedIds = expected ?? [];
  return currentIds.size === expectedIds.length && expectedIds.every((id) => currentIds.has(id));
}

export function stateMatchesViewFilter(state: AppState, defaults: ResolvedUrlUiState): boolean {
  return sameIds(state.selectedFields, defaults.fields)
    && sameIds(state.selectedDomains, defaults.domains)
    && sameIds(state.selectedEdgeTypes, defaults.edgeTypes)
    && sameIds(state.excludedFields, defaults.excludedFields)
    && sameIds(state.excludedDomains, defaults.excludedDomains)
    && sameIds(state.prohibitedDomains, defaults.prohibitedDomains);
}

export function stateMatchesViewDisplay(state: AppState, defaults: ResolvedUrlUiState): boolean {
  return state.crossFieldVisibility === defaults.crossFieldVisibility
    && state.showPrimaryOnly === defaults.showPrimaryOnly
    && state.hideIsolates === defaults.hideIsolates
    && state.showEdgeLabels === defaults.edgeLabels
    && state.showJunctions === defaults.junctions
    && state.edgeZoomActivation === defaults.edgeZoomActivation
    && state.hidePrerequisites === defaults.hidePrerequisites
    && state.layout === defaults.layout;
}

export function stateMatchesView(state: AppState, defaults: ResolvedUrlUiState): boolean {
  return stateMatchesViewFilter(state, defaults) && stateMatchesViewDisplay(state, defaults);
}

export function viewPagePath(viewId: string): string {
  return `views/${encodeURIComponent(viewId)}/`;
}

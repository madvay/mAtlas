import type { AppState, AtlasView, AtlasViewSettings, UrlUiState } from '../types.js';

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

export function viewSettingsAsUrlState(settings: AtlasViewSettings): UrlUiState {
  return {
    fields: [...settings.fields],
    domains: [...settings.domains],
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

function sameIds(current: ReadonlySet<string>, expected: readonly string[]): boolean {
  return current.size === expected.length && expected.every((id) => current.has(id));
}

export function stateMatchesView(state: AppState, view: AtlasView): boolean {
  const settings = view.settings;
  return sameIds(state.selectedFields, settings.fields)
    && sameIds(state.selectedDomains, settings.domains)
    && sameIds(state.selectedEdgeTypes, settings.edgeTypes)
    && sameIds(state.excludedFields ?? new Set(), settings.excludedFields ?? [])
    && sameIds(state.excludedDomains ?? new Set(), settings.excludedDomains ?? [])
    && sameIds(state.prohibitedDomains ?? new Set(), settings.prohibitedDomains ?? [])
    && state.crossFieldVisibility === settings.crossFieldVisibility
    && state.showPrimaryOnly === (settings.showPrimaryOnly ?? false)
    && state.hideIsolates === (settings.hideIsolates ?? false)
    && state.showEdgeLabels === settings.edgeLabels
    && state.showJunctions === settings.junctions
    && state.edgeZoomActivation === settings.edgeZoomActivation
    && (state.hidePrerequisites ?? false) === (settings.hidePrerequisites ?? false)
    && state.layout === settings.layout;
}

export function viewPagePath(viewId: string): string {
  return `views/${encodeURIComponent(viewId)}/`;
}

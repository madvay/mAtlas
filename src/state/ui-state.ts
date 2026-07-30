import type {
  AppState,
  CrossFieldVisibility,
  LayoutName,
  ShareCodecConfig,
  UrlUiState
} from '../types.js';
import { decodeDisplayToken, encodeDisplayToken } from './display-token.js';
import { decodeFilterToken, encodeFilterToken } from './filter-token.js';

export const VALID_LAYOUTS: ReadonlySet<LayoutName> = new Set(['atlas', 'breadthfirst']);
export const SHARE_FILTER_STATE_PARAM = 'filter';
export const SHARE_DISPLAY_STATE_PARAM = 'disp';
export const VALID_CROSS_FIELD_VISIBILITIES: ReadonlySet<CrossFieldVisibility> = new Set(['contextual', 'all', 'hidden']);

export function isLayoutName(value: unknown): value is LayoutName {
  return typeof value === 'string' && VALID_LAYOUTS.has(value as LayoutName);
}

export function isCrossFieldVisibility(value: unknown): value is CrossFieldVisibility {
  return typeof value === 'string'
    && VALID_CROSS_FIELD_VISIBILITIES.has(value as CrossFieldVisibility);
}

export interface UiStateKnowledge {
  fieldIds: ReadonlySet<string>;
  domainIds: ReadonlySet<string>;
  edgeTypeIds: ReadonlySet<string>;
}

export interface InitialStateDefaults {
  fields: string[];
  domains: string[];
  edgeTypes: string[];
  excludedFields?: string[] | undefined;
  excludedDomains?: string[] | undefined;
  prohibitedDomains?: string[] | undefined;
  crossFieldVisibility?: CrossFieldVisibility | undefined;
  showPrimaryOnly?: boolean | undefined;
  hideIsolates?: boolean | undefined;
  edgeLabels?: boolean | undefined;
  junctions?: boolean | undefined;
  edgeZoomActivation?: boolean | undefined;
  hidePrerequisites?: boolean | undefined;
  layout?: LayoutName | undefined;
}

export function isKnownIdArray(value: unknown, knownIds: ReadonlySet<string>): value is string[] {
  return Array.isArray(value)
    && value.every((id) => typeof id === 'string' && knownIds.has(id))
    && new Set(value).size === value.length;
}

export function readUrlIdList(params: URLSearchParams, name: string, knownIds: ReadonlySet<string>): string[] | undefined {
  if (!params.has(name)) return undefined;
  const raw = params.get(name) ?? '';
  const ids = raw ? raw.split(',').filter(Boolean) : [];
  const uniqueIds = [...new Set(ids)];
  const known = uniqueIds.filter((id) => knownIds.has(id));
  return known.length > 0 ? known : undefined;
}

export function readUrlBoolean(params: URLSearchParams, name: string): boolean | undefined {
  if (!params.has(name)) return undefined;
  const value = params.get(name);
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
}

function hasCompactState(params: URLSearchParams): boolean {
  return params.has(SHARE_FILTER_STATE_PARAM) || params.has(SHARE_DISPLAY_STATE_PARAM);
}

function decodeCompactState(params: URLSearchParams, codec: ShareCodecConfig): UrlUiState {
  const result: UrlUiState = {};
  const filterToken = params.get(SHARE_FILTER_STATE_PARAM);
  const displayToken = params.get(SHARE_DISPLAY_STATE_PARAM);
  if (filterToken !== null) Object.assign(result, decodeFilterToken(filterToken, codec));
  if (displayToken !== null) Object.assign(result, decodeDisplayToken(displayToken));
  return result;
}

export function readUrlUiStateFromParams(
  params: URLSearchParams,
  known: UiStateKnowledge,
  codec: ShareCodecConfig
): UrlUiState {
  return hasCompactState(params) ? decodeCompactState(params, codec) : parseUrlUiState(params, known);
}

export interface ShareUiStateLocation {
  href: string;
  replace(url: string): void;
}

export function readUrlUiStateFromLocation(
  location: ShareUiStateLocation,
  known: UiStateKnowledge,
  codec: ShareCodecConfig
): UrlUiState | null {
  const url = new URL(location.href);
  if (!hasCompactState(url.searchParams)) return parseUrlUiState(url.searchParams, known);

  const result: UrlUiState = {};
  let invalid = false;
  const filterToken = url.searchParams.get(SHARE_FILTER_STATE_PARAM);
  if (filterToken !== null) {
    try {
      Object.assign(result, decodeFilterToken(filterToken, codec));
    } catch {
      url.searchParams.delete(SHARE_FILTER_STATE_PARAM);
      invalid = true;
    }
  }

  const displayToken = url.searchParams.get(SHARE_DISPLAY_STATE_PARAM);
  if (displayToken !== null) {
    try {
      Object.assign(result, decodeDisplayToken(displayToken));
    } catch {
      url.searchParams.delete(SHARE_DISPLAY_STATE_PARAM);
      invalid = true;
    }
  }

  if (invalid) {
    location.replace(url.toString());
    return null;
  }
  return result;
}

export function parseUrlUiState(params: URLSearchParams, known: UiStateKnowledge): UrlUiState {
  const result: UrlUiState = {};
  const fields = readUrlIdList(params, 'fields', known.fieldIds);
  const domains = readUrlIdList(params, 'domains', known.domainIds);
  const edgeTypes = readUrlIdList(params, 'edges', known.edgeTypeIds);
  const excludedFields = readUrlIdList(params, 'excludeFields', known.fieldIds);
  const excludedDomains = readUrlIdList(params, 'excludeDomains', known.domainIds);
  const prohibitedDomains = readUrlIdList(params, 'prohibitDomains', known.domainIds);
  const crossFieldValue = params.get('crossField');
  const edgeLabels = readUrlBoolean(params, 'edgeLabels');
  const junctions = readUrlBoolean(params, 'junctions');
  const showPrimaryOnly = readUrlBoolean(params, 'showPrimaryOnly');
  const hideIsolates = readUrlBoolean(params, 'hideIsolates');
  const edgeZoomActivation = readUrlBoolean(params, 'edgeZoomActivation');
  const hidePrerequisites = readUrlBoolean(params, 'hidePrereqs');
  const layoutValue = params.get('layout');
  const normalizedLayout = layoutValue === 'cose' || layoutValue === 'cose-bilkent' || layoutValue === 'organic'
    ? 'breadthfirst'
    : layoutValue;

  if (fields !== undefined) result.fields = fields;
  if (domains !== undefined) result.domains = domains;
  if (edgeTypes !== undefined) result.edgeTypes = edgeTypes;
  if (excludedFields !== undefined) result.excludedFields = excludedFields;
  if (excludedDomains !== undefined) result.excludedDomains = excludedDomains;
  if (prohibitedDomains !== undefined) result.prohibitedDomains = prohibitedDomains;
  if (isCrossFieldVisibility(crossFieldValue)) result.crossFieldVisibility = crossFieldValue;
  if (edgeLabels !== undefined) result.edgeLabels = edgeLabels;
  if (junctions !== undefined) result.junctions = junctions;
  if (showPrimaryOnly !== undefined) result.showPrimaryOnly = showPrimaryOnly;
  if (hideIsolates !== undefined) result.hideIsolates = hideIsolates;
  if (edgeZoomActivation !== undefined) result.edgeZoomActivation = edgeZoomActivation;
  if (hidePrerequisites !== undefined) result.hidePrerequisites = hidePrerequisites;
  if (isLayoutName(normalizedLayout)) result.layout = normalizedLayout;
  return result;
}

export interface ResolvedUrlUiState {
  fields: string[];
  domains: string[];
  edgeTypes: string[];
  excludedFields: string[];
  excludedDomains: string[];
  prohibitedDomains: string[];
  crossFieldVisibility: CrossFieldVisibility;
  showPrimaryOnly: boolean;
  hideIsolates: boolean;
  edgeLabels: boolean;
  junctions: boolean;
  edgeZoomActivation: boolean;
  hidePrerequisites: boolean;
  layout: LayoutName;
}

export function resolveUrlUiState(
  url: UrlUiState,
  defaults: InitialStateDefaults
): ResolvedUrlUiState {
  const prohibitedDomains = url.prohibitedDomains ?? defaults.prohibitedDomains ?? [];
  const prohibitedDomainSet = new Set(prohibitedDomains);
  return {
    fields: url.fields ?? defaults.fields,
    domains: url.domains ?? defaults.domains,
    edgeTypes: url.edgeTypes ?? defaults.edgeTypes,
    excludedFields: url.excludedFields ?? defaults.excludedFields ?? [],
    excludedDomains: (url.excludedDomains ?? defaults.excludedDomains ?? [])
      .filter((domainId) => !prohibitedDomainSet.has(domainId)),
    prohibitedDomains,
    crossFieldVisibility: url.crossFieldVisibility ?? defaults.crossFieldVisibility ?? 'all',
    showPrimaryOnly: url.showPrimaryOnly ?? defaults.showPrimaryOnly ?? false,
    hideIsolates: url.hideIsolates ?? defaults.hideIsolates ?? false,
    edgeLabels: url.edgeLabels ?? defaults.edgeLabels ?? true,
    junctions: url.junctions ?? defaults.junctions ?? true,
    edgeZoomActivation: url.edgeZoomActivation ?? defaults.edgeZoomActivation ?? true,
    hidePrerequisites: url.hidePrerequisites ?? defaults.hidePrerequisites ?? false,
    layout: url.layout ?? defaults.layout ?? 'atlas'
  };
}

export function createInitialState(
  url: UrlUiState,
  defaults: InitialStateDefaults
): AppState {
  const resolved = resolveUrlUiState(url, defaults);
  return {
    selectedFields: new Set(resolved.fields),
    selectedDomains: new Set(resolved.domains),
    selectedEdgeTypes: new Set(resolved.edgeTypes),
    excludedFields: new Set(resolved.excludedFields),
    excludedDomains: new Set(resolved.excludedDomains),
    prohibitedDomains: new Set(resolved.prohibitedDomains),
    crossFieldVisibility: resolved.crossFieldVisibility,
    showPrimaryOnly: resolved.showPrimaryOnly,
    hideIsolates: resolved.hideIsolates,
    showEdgeLabels: resolved.edgeLabels,
    showJunctions: resolved.junctions,
    edgeZoomActivation: resolved.edgeZoomActivation,
    hidePrerequisites: resolved.hidePrerequisites,
    neighborhoodActive: false,
    neighborhoodElementId: null,
    layout: resolved.layout,
    searchQuery: '',
    filtersOpen: false,
    detailsOpen: false
  };
}

const LEGACY_UI_STATE_PARAMS = Object.freeze([
  's',
  'fields',
  'domains',
  'edges',
  'excludeFields',
  'excludeDomains',
  'prohibitDomains',
  'crossField',
  'showPrimaryOnly',
  'hideIsolates',
  'edgeLabels',
  'junctions',
  'edgeZoomActivation',
  'hidePrereqs',
  'layout'
]);

export function addShareUiStateToParams(
  params: URLSearchParams,
  state: AppState,
  codec: ShareCodecConfig
): void {
  params.set(SHARE_FILTER_STATE_PARAM, encodeFilterToken(state, codec));
  params.set(SHARE_DISPLAY_STATE_PARAM, encodeDisplayToken(state));
  for (const name of LEGACY_UI_STATE_PARAMS) params.delete(name);
}

export function addUiStateToParams(
  params: URLSearchParams,
  state: AppState,
  fieldOrder: readonly string[],
  domainOrder: readonly string[],
  edgeTypeOrder: readonly string[]
): void {
  const writeIds = (name: string, ids: readonly string[], selected: ReadonlySet<string>): void => {
    params.set(name, ids.filter((id) => selected.has(id)).join(','));
  };
  writeIds('fields', fieldOrder, state.selectedFields);
  writeIds('domains', domainOrder, state.selectedDomains);
  writeIds('edges', edgeTypeOrder, state.selectedEdgeTypes);
  writeIds('excludeFields', fieldOrder, state.excludedFields ?? new Set());
  writeIds('excludeDomains', domainOrder, state.excludedDomains ?? new Set());
  writeIds('prohibitDomains', domainOrder, state.prohibitedDomains ?? new Set());
  params.set('crossField', state.crossFieldVisibility);
  params.set('showPrimaryOnly', state.showPrimaryOnly ? '1' : '0');
  params.set('hideIsolates', state.hideIsolates ? '1' : '0');
  params.set('edgeLabels', state.showEdgeLabels ? '1' : '0');
  params.set('junctions', state.showJunctions ? '1' : '0');
  params.set('edgeZoomActivation', state.edgeZoomActivation ? '1' : '0');
  params.set('hidePrereqs', state.hidePrerequisites ? '1' : '0');
  params.set('layout', state.layout);
}

export function sameIdSet(current: ReadonlySet<string>, next: readonly string[]): boolean {
  return current.size === next.length && next.every((id) => current.has(id));
}

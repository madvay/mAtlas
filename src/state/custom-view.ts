import type {
  AppState,
  AtlasView,
  AtlasViewCredit,
  AtlasViewMetadata,
  AtlasViewSettings,
  GraphNode
} from '../types.js';
import { base64UrlToBytes, bytesToBase64Url, UrlTokenError } from './binary-token.js';

export const CUSTOM_VIEW_TOKEN_VERSION = 1;
export const LOCAL_VIEWS_STORAGE_KEY = 'human-knowledge-atlas:personal-views:v1';
export const CUSTOM_VIEW_URL_WARNING_LENGTH = 8_000;
export const CUSTOM_VIEW_URL_MAX_LENGTH = 24_000;

export interface CustomViewKnownIds {
  nodeIds: ReadonlySet<string>;
  fieldIds: ReadonlySet<string>;
  domainIds: ReadonlySet<string>;
  edgeTypeIds: ReadonlySet<string>;
}

export type ViewScopeMode = 'taxonomy' | 'core-nodes';

interface CustomViewEnvelope {
  v: number;
  view: AtlasView;
}

interface LocalViewsEnvelope {
  version: 1;
  views: AtlasView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maxLength = 20_000): string {
  if (typeof value !== 'string' || !value.trim()) throw new UrlTokenError(`${label} must be a non-empty string.`);
  if (value.length > maxLength) throw new UrlTokenError(`${label} is too long.`);
  return value;
}

function optionalString(value: unknown, label: string, maxLength = 20_000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new UrlTokenError(`${label} must be a string.`);
  if (value.length > maxLength) throw new UrlTokenError(`${label} is too long.`);
  return value;
}

function stringArray(
  value: unknown,
  label: string,
  options: { required?: boolean; known?: ReadonlySet<string>; maxItems?: number; nonEmpty?: boolean } = {}
): string[] | undefined {
  if (value === undefined && !options.required) return undefined;
  if (!Array.isArray(value)) throw new UrlTokenError(`${label} must be an array.`);
  if (options.nonEmpty && value.length === 0) throw new UrlTokenError(`${label} must not be empty.`);
  if (value.length > (options.maxItems ?? 5_000)) throw new UrlTokenError(`${label} has too many items.`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const item = requiredString(entry, `${label}[${index}]`, 500);
    if (seen.has(item)) throw new UrlTokenError(`${label} contains duplicate value "${item}".`);
    if (options.known && !options.known.has(item)) throw new UrlTokenError(`${label} references unknown identifier "${item}".`);
    seen.add(item);
    result.push(item);
  }
  return result;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new UrlTokenError(`${label} must be Boolean.`);
  return value;
}

function parseCredit(value: unknown, label: string): AtlasViewCredit {
  if (!isRecord(value)) throw new UrlTokenError(`${label} must be an object.`);
  const creators = stringArray(value.creators, `${label}.creators`, { required: true, nonEmpty: true, maxItems: 50 }) ?? [];
  const attribution = optionalString(value.attribution, `${label}.attribution`, 4_000);
  const copyright = optionalString(value.copyright, `${label}.copyright`, 4_000);
  const license = optionalString(value.license, `${label}.license`, 1_000);
  const licenseUrl = optionalString(value.licenseUrl, `${label}.licenseUrl`, 2_000);
  return {
    creators,
    ...(attribution !== undefined ? { attribution } : {}),
    ...(copyright !== undefined ? { copyright } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(licenseUrl !== undefined ? { licenseUrl } : {})
  };
}

function parseMetadata(value: unknown): AtlasViewMetadata {
  if (!isRecord(value)) throw new UrlTokenError('view.metadata must be an object.');
  if (!Array.isArray(value.credits)) throw new UrlTokenError('view.metadata.credits must be an array.');
  if (value.credits.length > 100) throw new UrlTokenError('view.metadata.credits has too many entries.');
  const credits = value.credits.map((entry, index) => parseCredit(entry, `view.metadata.credits[${index}]`));
  const inheritedCreditCountValue = value.inheritedCreditCount;
  let inheritedCreditCount: number | undefined;
  if (inheritedCreditCountValue !== undefined) {
    if (typeof inheritedCreditCountValue !== 'number' || !Number.isInteger(inheritedCreditCountValue)
      || inheritedCreditCountValue < 0 || inheritedCreditCountValue > credits.length) {
      throw new UrlTokenError('view.metadata.inheritedCreditCount must be an integer between zero and the number of credit records.');
    }
    inheritedCreditCount = inheritedCreditCountValue;
  }
  const createdAt = optionalString(value.createdAt, 'view.metadata.createdAt', 100);
  const updatedAt = optionalString(value.updatedAt, 'view.metadata.updatedAt', 100);
  let derivedFrom: AtlasViewMetadata['derivedFrom'];
  if (value.derivedFrom !== undefined) {
    if (!Array.isArray(value.derivedFrom)) throw new UrlTokenError('view.metadata.derivedFrom must be an array.');
    derivedFrom = value.derivedFrom.map((entry, index) => {
      if (!isRecord(entry)) throw new UrlTokenError(`view.metadata.derivedFrom[${index}] must be an object.`);
      return {
        id: requiredString(entry.id, `view.metadata.derivedFrom[${index}].id`, 500),
        title: requiredString(entry.title, `view.metadata.derivedFrom[${index}].title`, 1_000)
      };
    });
  }
  return {
    credits,
    ...(inheritedCreditCount !== undefined ? { inheritedCreditCount } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(derivedFrom !== undefined ? { derivedFrom } : {})
  };
}

function parseSettings(value: unknown, known: CustomViewKnownIds): AtlasViewSettings {
  if (!isRecord(value)) throw new UrlTokenError('view.settings must be an object.');
  const fields = stringArray(value.fields, 'view.settings.fields', { known: known.fieldIds, nonEmpty: true });
  const domains = stringArray(value.domains, 'view.settings.domains', { known: known.domainIds, nonEmpty: true });
  const edgeTypes = stringArray(value.edgeTypes, 'view.settings.edgeTypes', {
    required: true,
    known: known.edgeTypeIds,
    nonEmpty: true
  }) ?? [];
  const excludedFields = stringArray(value.excludedFields, 'view.settings.excludedFields', { known: known.fieldIds });
  const excludedDomains = stringArray(value.excludedDomains, 'view.settings.excludedDomains', { known: known.domainIds });
  const prohibitedDomains = stringArray(value.prohibitedDomains, 'view.settings.prohibitedDomains', { known: known.domainIds });
  const showPrimaryOnly = optionalBoolean(value.showPrimaryOnly, 'view.settings.showPrimaryOnly');
  const hideIsolates = optionalBoolean(value.hideIsolates, 'view.settings.hideIsolates');
  const hidePrerequisites = optionalBoolean(value.hidePrerequisites, 'view.settings.hidePrerequisites');
  const crossFieldVisibility = value.crossFieldVisibility;
  if (crossFieldVisibility !== 'contextual' && crossFieldVisibility !== 'all' && crossFieldVisibility !== 'hidden') {
    throw new UrlTokenError('view.settings.crossFieldVisibility is invalid.');
  }
  const layout = value.layout;
  if (layout !== 'atlas' && layout !== 'breadthfirst') throw new UrlTokenError('view.settings.layout is invalid.');
  if (typeof value.edgeLabels !== 'boolean' || typeof value.junctions !== 'boolean' || typeof value.edgeZoomActivation !== 'boolean') {
    throw new UrlTokenError('view.settings must define Boolean edgeLabels, junctions, and edgeZoomActivation settings.');
  }
  return {
    ...(fields ? { fields } : {}),
    ...(domains ? { domains } : {}),
    edgeTypes,
    ...(excludedFields ? { excludedFields } : {}),
    ...(excludedDomains ? { excludedDomains } : {}),
    ...(prohibitedDomains ? { prohibitedDomains } : {}),
    crossFieldVisibility,
    ...(showPrimaryOnly !== undefined ? { showPrimaryOnly } : {}),
    ...(hideIsolates !== undefined ? { hideIsolates } : {}),
    edgeLabels: value.edgeLabels,
    junctions: value.junctions,
    edgeZoomActivation: value.edgeZoomActivation,
    ...(hidePrerequisites !== undefined ? { hidePrerequisites } : {}),
    layout
  };
}

export function parseCustomView(value: unknown, known: CustomViewKnownIds): AtlasView {
  if (!isRecord(value)) throw new UrlTokenError('Shared view must be an object.');
  const coreNodes = stringArray(value.coreNodes, 'view.coreNodes', { known: known.nodeIds, nonEmpty: true });
  const nodeSequence = stringArray(value.nodeSequence, 'view.nodeSequence', { known: known.nodeIds });
  const settings = parseSettings(value.settings, known);
  const hasTaxonomy = Boolean(settings.domains?.length);
  const hasCoreNodes = Boolean(coreNodes?.length);
  if (hasTaxonomy === hasCoreNodes) throw new UrlTokenError('Shared view must define exactly one of taxonomy domains or core nodes.');
  if (hasTaxonomy && !settings.fields?.length) throw new UrlTokenError('Taxonomy-scoped views must define fields.');
  if (hasCoreNodes && settings.fields !== undefined) throw new UrlTokenError('Core-node views must omit settings.fields.');
  if (coreNodes && nodeSequence?.some((nodeId) => !coreNodes.includes(nodeId))) {
    throw new UrlTokenError('Every story step must also appear in coreNodes.');
  }
  let stepNarratives: Record<string, string> | undefined;
  if (value.stepNarratives !== undefined) {
    if (!isRecord(value.stepNarratives)) throw new UrlTokenError('view.stepNarratives must be an object.');
    stepNarratives = {};
    for (const [nodeId, narrative] of Object.entries(value.stepNarratives)) {
      if (!known.nodeIds.has(nodeId)) throw new UrlTokenError(`view.stepNarratives references unknown node "${nodeId}".`);
      if (!nodeSequence?.includes(nodeId)) throw new UrlTokenError(`view.stepNarratives key "${nodeId}" is not a story step.`);
      const text = optionalString(narrative, `view.stepNarratives.${nodeId}`, 20_000) ?? '';
      if (text) stepNarratives[nodeId] = text;
    }
  }
  let image: AtlasView['image'];
  if (value.image !== undefined) {
    if (!isRecord(value.image)) throw new UrlTokenError('view.image must be an object.');
    image = {
      src: requiredString(value.image.src, 'view.image.src', 2_000),
      alt: requiredString(value.image.alt, 'view.image.alt', 2_000)
    };
  }
  return {
    id: requiredString(value.id, 'view.id', 500),
    title: requiredString(value.title, 'view.title', 1_000),
    summary: typeof value.summary === 'string' ? value.summary : '',
    narrative: typeof value.narrative === 'string' ? value.narrative : '',
    tags: stringArray(value.tags, 'view.tags', { required: true, maxItems: 100 }) ?? [],
    metadata: parseMetadata(value.metadata),
    ...(value.featured === true ? { featured: true } : {}),
    ...(coreNodes ? { coreNodes } : {}),
    ...(nodeSequence && nodeSequence.length ? { nodeSequence } : {}),
    ...(stepNarratives && Object.keys(stepNarratives).length ? { stepNarratives } : {}),
    ...(image ? { image } : {}),
    settings
  };
}

export function encodeCustomViewToken(view: AtlasView): string {
  const envelope: CustomViewEnvelope = { v: CUSTOM_VIEW_TOKEN_VERSION, view };
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
}

export function decodeCustomViewToken(token: string, known: CustomViewKnownIds): AtlasView {
  if (token.length > 100_000) throw new UrlTokenError('Shared view token is too long.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(token));
  } catch (error) {
    if (error instanceof UrlTokenError) throw error;
    throw new UrlTokenError('Shared view token is not valid UTF-8.');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new UrlTokenError('Shared view token does not contain valid JSON.');
  }
  if (!isRecord(envelope) || envelope.v !== CUSTOM_VIEW_TOKEN_VERSION) {
    throw new UrlTokenError(`Unsupported shared view format; this atlas supports version ${CUSTOM_VIEW_TOKEN_VERSION}.`);
  }
  return parseCustomView(envelope.view, known);
}

export function loadLocalViews(storage: Storage, known: CustomViewKnownIds): AtlasView[] {
  const raw = storage.getItem(LOCAL_VIEWS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const envelope = JSON.parse(raw) as unknown;
    if (!isRecord(envelope) || envelope.version !== 1 || !Array.isArray(envelope.views)) return [];
    return envelope.views.flatMap((value) => {
      try { return [parseCustomView(value, known)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

export function saveLocalViews(storage: Storage, views: readonly AtlasView[]): void {
  const envelope: LocalViewsEnvelope = { version: 1, views: [...views] };
  storage.setItem(LOCAL_VIEWS_STORAGE_KEY, JSON.stringify(envelope));
}

export function settingsFromState(state: AppState, scopeMode: ViewScopeMode): AtlasViewSettings {
  return {
    ...(scopeMode === 'taxonomy' ? {
      fields: [...state.selectedFields],
      domains: [...state.selectedDomains]
    } : {}),
    edgeTypes: [...state.selectedEdgeTypes],
    excludedFields: [...state.excludedFields],
    excludedDomains: [...state.excludedDomains],
    prohibitedDomains: [...state.prohibitedDomains],
    crossFieldVisibility: state.crossFieldVisibility,
    showPrimaryOnly: state.showPrimaryOnly,
    hideIsolates: state.hideIsolates,
    edgeLabels: state.showEdgeLabels,
    junctions: state.showJunctions,
    edgeZoomActivation: state.edgeZoomActivation,
    hidePrerequisites: state.hidePrerequisites,
    layout: state.layout
  };
}

function cloneCredit(credit: AtlasViewCredit): AtlasViewCredit {
  return {
    creators: [...credit.creators],
    ...(credit.attribution !== undefined ? { attribution: credit.attribution } : {}),
    ...(credit.copyright !== undefined ? { copyright: credit.copyright } : {}),
    ...(credit.license !== undefined ? { license: credit.license } : {}),
    ...(credit.licenseUrl !== undefined ? { licenseUrl: credit.licenseUrl } : {})
  };
}

export function cloneView(view: AtlasView): AtlasView {
  return {
    ...view,
    tags: [...view.tags],
    metadata: {
      credits: view.metadata.credits.map(cloneCredit),
      ...(view.metadata.inheritedCreditCount !== undefined ? { inheritedCreditCount: view.metadata.inheritedCreditCount } : {}),
      ...(view.metadata.createdAt !== undefined ? { createdAt: view.metadata.createdAt } : {}),
      ...(view.metadata.updatedAt !== undefined ? { updatedAt: view.metadata.updatedAt } : {}),
      ...(view.metadata.derivedFrom ? { derivedFrom: view.metadata.derivedFrom.map((item) => ({ ...item })) } : {})
    },
    ...(view.coreNodes ? { coreNodes: [...view.coreNodes] } : {}),
    ...(view.nodeSequence ? { nodeSequence: [...view.nodeSequence] } : {}),
    ...(view.stepNarratives ? { stepNarratives: { ...view.stepNarratives } } : {}),
    ...(view.image ? { image: { ...view.image } } : {}),
    settings: {
      ...view.settings,
      ...(view.settings.fields ? { fields: [...view.settings.fields] } : {}),
      ...(view.settings.domains ? { domains: [...view.settings.domains] } : {}),
      edgeTypes: [...view.settings.edgeTypes],
      ...(view.settings.excludedFields ? { excludedFields: [...view.settings.excludedFields] } : {}),
      ...(view.settings.excludedDomains ? { excludedDomains: [...view.settings.excludedDomains] } : {}),
      ...(view.settings.prohibitedDomains ? { prohibitedDomains: [...view.settings.prohibitedDomains] } : {})
    }
  };
}

export function duplicateView(view: AtlasView, id: string, now: string): AtlasView {
  const duplicate = cloneView(view);
  duplicate.id = id;
  duplicate.title = `Copy of ${view.title}`;
  duplicate.featured = false;
  duplicate.metadata.inheritedCreditCount = duplicate.metadata.credits.length;
  duplicate.metadata.createdAt = now;
  duplicate.metadata.updatedAt = now;
  duplicate.metadata.derivedFrom = [
    ...(duplicate.metadata.derivedFrom ?? []),
    { id: view.id, title: view.title }
  ];
  return duplicate;
}

export function createViewDraft(id: string, state: AppState, now: string): AtlasView {
  return {
    id,
    title: 'Untitled view',
    summary: '',
    narrative: '',
    tags: [],
    metadata: { credits: [], createdAt: now, updatedAt: now },
    settings: settingsFromState(state, 'taxonomy')
  };
}

export function viewScopeMode(view: AtlasView): ViewScopeMode {
  return view.coreNodes?.length ? 'core-nodes' : 'taxonomy';
}

export function viewStepNarrative(view: Pick<AtlasView, 'stepNarratives'>, nodeId: string): string {
  return view.stepNarratives?.[nodeId] ?? '';
}

export function directInterestNodeIds(
  nodes: readonly GraphNode[],
  visible: (nodeId: string) => boolean,
  dependencyContext: (nodeId: string) => boolean
): string[] {
  return nodes.filter((node) => visible(node.id) && !dependencyContext(node.id)).map((node) => node.id);
}

function yamlScalar(value: string): string {
  if (value.includes('\n')) return '';
  if (/^[A-Za-z0-9][A-Za-z0-9 _./:+()–—-]*$/u.test(value)
    && !/^(?:true|false|null|yes|no|on|off|[-+]?\d+(?:\.\d+)?)$/iu.test(value)) return value;
  return JSON.stringify(value);
}

function yamlLines(value: unknown, indent = 0): string[] {
  const pad = ' '.repeat(indent);
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      return [`${pad}|-`, ...value.split('\n').map((line) => `${' '.repeat(indent + 2)}${line}`)];
    }
    return [`${pad}${yamlScalar(value)}`];
  }
  if (typeof value === 'boolean' || typeof value === 'number') return [`${pad}${String(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    return value.flatMap((entry) => {
      if (entry !== null && typeof entry === 'object') {
        const nested = yamlLines(entry, indent + 2);
        const first = nested[0]?.slice(indent + 2) ?? '{}';
        return [`${pad}- ${first}`, ...nested.slice(1)];
      }
      const scalar = yamlLines(entry, 0)[0] ?? 'null';
      return [`${pad}- ${scalar}`];
    });
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (entries.length === 0) return [`${pad}{}`];
    return entries.flatMap(([key, entry]) => {
      if (typeof entry === 'string' && entry.includes('\n')) {
        return [`${pad}${key}: |-`, ...entry.split('\n').map((line) => `${' '.repeat(indent + 2)}${line}`)];
      }
      if (entry !== null && typeof entry === 'object') {
        const nested = yamlLines(entry, indent + 2);
        if (nested.length === 1 && (nested[0]?.trim() === '[]' || nested[0]?.trim() === '{}')) {
          return [`${pad}${key}: ${nested[0]?.trim()}`];
        }
        return [`${pad}${key}:`, ...nested];
      }
      return [`${pad}${key}: ${yamlLines(entry, 0)[0] ?? 'null'}`];
    });
  }
  return [`${pad}null`];
}

export function serializeAtlasViewYaml(view: AtlasView): string {
  return `${yamlLines(view).join('\n')}\n`;
}

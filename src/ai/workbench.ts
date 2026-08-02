import { Atlas } from './atlas-operations.js';

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (arguments_: Record<string, unknown>) => Promise<string>;
}

interface ModelContext {
  registerTool(tool: ModelContextTool): Promise<unknown>;
}

interface ModelContextDocument extends Document {
  modelContext?: ModelContext;
}

interface WorkbenchElements {
  root: HTMLElement;
  status: HTMLOutputElement;
  result: HTMLPreElement;
  copyButton: HTMLButtonElement;
}

const script = document.querySelector<HTMLScriptElement>('script[data-atlas-url]');
const atlasUrl = script?.dataset.atlasUrl;
const elements: WorkbenchElements = {
  root: requireElement<HTMLElement>('main[aria-busy]'),
  status: requireElement<HTMLOutputElement>('#workbench-status'),
  result: requireElement<HTMLPreElement>('#workbench-result'),
  copyButton: requireElement<HTMLButtonElement>('#copy-result')
};

let atlas: Atlas | null = null;
let currentResult = '{}';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`mAtlas workbench is missing ${selector}.`);
  return element;
}

function inputValue(id: string): string {
  return requireElement<HTMLInputElement>(`#${id}`).value.trim();
}

function selectedValues(id: string): string[] {
  return [...requireElement<HTMLSelectElement>(`#${id}`).selectedOptions]
    .map((option) => option.value)
    .filter(Boolean);
}

function splitIds(value: string): string[] {
  return [...new Set(value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean))];
}

function integerValue(id: string, fallback: number): number {
  const parsed = Number.parseInt(inputValue(id), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(message: string, state: 'ready' | 'error' = 'ready'): void {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function dataFor(operation: string, arguments_: Record<string, unknown>, result: unknown): string {
  if (!atlas) throw new Error('mAtlas data is not loaded.');
  return JSON.stringify({
    operation,
    contentVersion: atlas.metadata().contentVersion,
    canonicalDatasetUrl: atlas.metadata().canonicalDatasetUrl,
    arguments: arguments_,
    result
  }, null, 2);
}

function renderResult(operation: string, arguments_: Record<string, unknown>, result: unknown): string {
  currentResult = dataFor(operation, arguments_, result);
  elements.result.textContent = currentResult;
  elements.result.focus({ preventScroll: true });
  setStatus(`Completed ${operation.replaceAll('_', ' ')}. Result is available below as JSON.`);
  return currentResult;
}

function requireAtlas(): Atlas {
  if (!atlas) throw new Error('The mAtlas data is still loading.');
  return atlas;
}

async function runForm(formId: string, operation: () => void): Promise<void> {
  const form = requireElement<HTMLFormElement>(`#${formId}-form`);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      operation();
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    }
  });
}

function bindForms(): void {
  void runForm('search', () => {
    const query = inputValue('search-query');
    const limit = integerValue('search-limit', 10);
    renderResult('search_concepts', { query, limit }, requireAtlas().searchConcepts(query, { limit }));
  });
  void runForm('neighbors', () => {
    const conceptId = inputValue('neighbors-concept');
    const direction = requireElement<HTMLSelectElement>('#neighbors-direction').value;
    const relationTypes = selectedValues('neighbors-types');
    renderResult('get_neighbors', { conceptId, direction, relationTypes }, requireAtlas().getNeighbors(conceptId, { direction: direction as 'incoming' | 'outgoing' | 'either', relationTypes }));
  });
  void runForm('path', () => {
    const sourceId = inputValue('path-source');
    const targetId = inputValue('path-target');
    const direction = requireElement<HTMLSelectElement>('#path-direction').value;
    const maxDepth = integerValue('path-depth', 8);
    const maxPaths = integerValue('path-count', 5);
    renderResult('find_paths', { sourceId, targetId, direction, maxDepth, maxPaths }, requireAtlas().findPaths(sourceId, targetId, {
      direction: direction as 'incoming' | 'outgoing' | 'either', maxDepth, maxPaths
    }));
  });
  void runForm('closure', () => {
    const rootIds = splitIds(inputValue('closure-concepts'));
    const kind = requireElement<HTMLSelectElement>('#closure-kind').value;
    const result = kind === 'predecessor'
      ? requireAtlas().getPredecessorClosure(rootIds)
      : requireAtlas().getPrerequisiteClosure(rootIds);
    renderResult(kind === 'predecessor' ? 'get_predecessor_closure' : 'get_prerequisite_closure', { rootIds, kind }, result);
  });
  void runForm('connect', () => {
    const rootIds = splitIds(inputValue('connect-concepts'));
    const direction = requireElement<HTMLSelectElement>('#connect-direction').value;
    const maxDepth = integerValue('connect-depth', 8);
    renderResult('connect_concepts', { rootIds, direction, maxDepth }, requireAtlas().connectConcepts(rootIds, {
      direction: direction as 'incoming' | 'outgoing' | 'either', maxDepth
    }));
  });
  void runForm('subgraph', () => {
    const rootIds = splitIds(inputValue('subgraph-concepts'));
    const direction = requireElement<HTMLSelectElement>('#subgraph-direction').value;
    const hops = integerValue('subgraph-hops', 1);
    renderResult('build_subgraph', { rootIds, direction, hops }, requireAtlas().buildSubgraph(rootIds, {
      direction: direction as 'incoming' | 'outgoing' | 'either', hops
    }));
  });
  void runForm('compare', () => {
    const leftId = inputValue('compare-left');
    const rightId = inputValue('compare-right');
    renderResult('compare_concepts', { leftId, rightId }, requireAtlas().compareConcepts(leftId, rightId));
  });
  void runForm('permalink', () => {
    const conceptId = inputValue('permalink-concept');
    renderResult('create_permalink', { conceptId }, requireAtlas().createPermalink(conceptId));
  });
}

function stringArgument(arguments_: Record<string, unknown>, key: string): string {
  const value = arguments_[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string.`);
  return value.trim();
}

function stringArrayArgument(arguments_: Record<string, unknown>, key: string): string[] {
  const value = arguments_[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${key} must be an array of non-empty strings.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function optionalStringArrayArgument(arguments_: Record<string, unknown>, key: string): string[] | undefined {
  if (arguments_[key] === undefined) return undefined;
  return stringArrayArgument(arguments_, key);
}

function optionalIntegerArgument(arguments_: Record<string, unknown>, key: string): number | undefined {
  if (arguments_[key] === undefined) return undefined;
  const value = arguments_[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
  return Math.floor(value);
}

function directionArgument(arguments_: Record<string, unknown>): 'incoming' | 'outgoing' | 'either' {
  const direction = arguments_.direction;
  if (direction === undefined) return 'either';
  if (direction === 'incoming' || direction === 'outgoing' || direction === 'either') return direction;
  throw new Error('direction must be incoming, outgoing, or either.');
}

function operationSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

async function registerWebMcpTools(): Promise<void> {
  const context = (document as ModelContextDocument).modelContext;
  if (!context || !atlas) return;
  const readOnly = { readOnlyHint: true, untrustedContentHint: true };
  const register = async (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    execute: (arguments_: Record<string, unknown>) => unknown
  ) => {
    await context.registerTool({
      name,
      description,
      inputSchema,
      annotations: readOnly,
      execute: async (arguments_) => {
        try {
          return renderResult(name, arguments_, execute(arguments_));
        } catch (error) {
          const message = errorMessage(error);
          setStatus(message, 'error');
          return JSON.stringify({ operation: name, error: message });
        }
      }
    });
  };
  const relationTypes = { type: 'array', items: { type: 'string' }, description: 'Optional relation type IDs.' };
  const direction = { type: 'string', enum: ['incoming', 'outgoing', 'either'], default: 'either' };
  try {
    await register('search_concepts', 'Resolve a query to canonical mAtlas concept IDs and return source-ready concept metadata.', operationSchema({
      query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, includeJunctions: { type: 'boolean' }
    }, ['query']), (arguments_) => atlas!.searchConcepts(stringArgument(arguments_, 'query'), {
      limit: optionalIntegerArgument(arguments_, 'limit'),
      includeJunctions: arguments_.includeJunctions === true
    }));
    await register('get_concept', 'Return a canonical mAtlas concept or construction-junction record with its attached sources.', operationSchema({ conceptId: { type: 'string', minLength: 1 } }, ['conceptId']), (arguments_) => {
      const conceptId = stringArgument(arguments_, 'conceptId');
      const result = atlas!.getConcept(conceptId);
      if (!result) throw new Error(`Unknown mAtlas concept or junction ID: ${conceptId}.`);
      return result;
    });
    await register('get_neighbors', 'Return direct typed authored relations for a canonical mAtlas concept.', operationSchema({ conceptId: { type: 'string', minLength: 1 }, direction, relationTypes }, ['conceptId']), (arguments_) => atlas!.getNeighbors(stringArgument(arguments_, 'conceptId'), {
      direction: directionArgument(arguments_), relationTypes: optionalStringArrayArgument(arguments_, 'relationTypes')
    }));
    await register('find_paths', 'Find shortest paths through existing authored mAtlas relations. Preserve each edge’s authored source-to-target direction.', operationSchema({
      sourceId: { type: 'string', minLength: 1 }, targetId: { type: 'string', minLength: 1 }, direction, relationTypes,
      maxDepth: { type: 'integer', minimum: 0, maximum: 20 }, maxPaths: { type: 'integer', minimum: 1, maximum: 25 }
    }, ['sourceId', 'targetId']), (arguments_) => atlas!.findPaths(stringArgument(arguments_, 'sourceId'), stringArgument(arguments_, 'targetId'), {
      direction: directionArgument(arguments_), relationTypes: optionalStringArrayArgument(arguments_, 'relationTypes'),
      maxDepth: optionalIntegerArgument(arguments_, 'maxDepth'), maxPaths: optionalIntegerArgument(arguments_, 'maxPaths')
    }));
    await register('get_predecessor_closure', 'Compute the closure over only relation types that enforce predecessor levels.', operationSchema({ rootIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, relationTypes }, ['rootIds']), (arguments_) => atlas!.getPredecessorClosure(stringArrayArgument(arguments_, 'rootIds'), {
      relationTypes: optionalStringArrayArgument(arguments_, 'relationTypes')
    }));
    await register('get_prerequisite_closure', 'Compute the closure using each relation type’s authored prerequisiteTraversal policy.', operationSchema({ rootIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, relationTypes }, ['rootIds']), (arguments_) => atlas!.getPrerequisiteClosure(stringArrayArgument(arguments_, 'rootIds'), {
      relationTypes: optionalStringArrayArgument(arguments_, 'relationTypes')
    }));
    await register('connect_concepts', 'Connect several canonical concepts with a deterministic shortest-path heuristic over authored relations.', operationSchema({
      rootIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, direction, relationTypes, maxDepth: { type: 'integer', minimum: 0, maximum: 20 }
    }, ['rootIds']), (arguments_) => atlas!.connectConcepts(stringArrayArgument(arguments_, 'rootIds'), {
      direction: directionArgument(arguments_), relationTypes: optionalStringArrayArgument(arguments_, 'relationTypes'), maxDepth: optionalIntegerArgument(arguments_, 'maxDepth')
    }));
    await register('build_subgraph', 'Build a bounded direct-neighbor subgraph for canonical concept IDs.', operationSchema({
      rootIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, direction, relationTypes, hops: { type: 'integer', minimum: 0, maximum: 10 }
    }, ['rootIds']), (arguments_) => atlas!.buildSubgraph(stringArrayArgument(arguments_, 'rootIds'), {
      direction: directionArgument(arguments_), relationTypes: optionalStringArrayArgument(arguments_, 'relationTypes'), hops: optionalIntegerArgument(arguments_, 'hops')
    }));
    await register('compare_concepts', 'Compare two canonical mAtlas records, including shared context and direct authored relations.', operationSchema({
      leftId: { type: 'string', minLength: 1 }, rightId: { type: 'string', minLength: 1 }
    }, ['leftId', 'rightId']), (arguments_) => atlas!.compareConcepts(stringArgument(arguments_, 'leftId'), stringArgument(arguments_, 'rightId')));
    await register('create_permalink', 'Return canonical and interactive mAtlas URLs for a canonical concept ID.', operationSchema({ conceptId: { type: 'string', minLength: 1 } }, ['conceptId']), (arguments_) => atlas!.createPermalink(stringArgument(arguments_, 'conceptId')));
    setStatus(`Loaded mAtlas content version ${atlas.metadata().contentVersion}. WebMCP read-only tools are registered for this browser.`, 'ready');
  } catch (error) {
    // WebMCP is an optional browser capability. The ordinary accessible forms remain available.
    setStatus(`Loaded mAtlas content version ${atlas.metadata().contentVersion}. WebMCP registration is unavailable: ${errorMessage(error)}`, 'ready');
  }
}

async function copyResult(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentResult);
    setStatus('Copied the current JSON result to the clipboard.');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = currentResult;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    setStatus('Copied the current JSON result to the clipboard.');
  }
}

async function load(): Promise<void> {
  if (!atlasUrl) throw new Error('The workbench is missing its published atlas URL.');
  const response = await fetch(atlasUrl, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Unable to load mAtlas graph data (${response.status}).`);
  atlas = Atlas.fromData(await response.json());
  bindForms();
  elements.copyButton.addEventListener('click', () => { void copyResult(); });
  elements.root.setAttribute('aria-busy', 'false');
  setStatus(`Loaded mAtlas content version ${atlas.metadata().contentVersion}. Choose an operation to produce a source-aware JSON result.`);
  await registerWebMcpTools();
}

void load().catch((error: unknown) => {
  elements.root.setAttribute('aria-busy', 'false');
  setStatus(errorMessage(error), 'error');
});

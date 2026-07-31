import type { GraphNode } from '../types.js';

export interface SearchableNodeContext {
  fieldLabels: readonly string[];
  domainLabels: readonly string[];
}

export interface RankedNodeMatch {
  node: GraphNode;
  context: SearchableNodeContext;
  score: number;
}

export interface NodeSearchOptions {
  limit?: number;
  predicate?: (node: GraphNode) => boolean;
}

export interface NodeSearchResult {
  normalizedQuery: string;
  matches: RankedNodeMatch[];
  total: number;
}

interface IndexedNode {
  node: GraphNode;
  context: SearchableNodeContext;
  id: string;
  label: string;
  taxonomy: string;
  body: string;
  haystack: string;
  labelWords: readonly string[];
  idWords: readonly string[];
}

const EMPTY_CONTEXT: SearchableNodeContext = Object.freeze({ fieldLabels: [], domainLabels: [] });

export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\\(?:mathrm|mathbf|mathbb|mathcal|operatorname|text)\b/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, ' $1 ')
    .replace(/[${}_^]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

function searchableBodyParts(node: GraphNode): unknown[] {
  return [
    node.summary,
    ...(node.carriers ?? []),
    ...(node.data ?? []),
    ...(node.axioms ?? []),
    ...(node.induces ?? []),
    node.notes ?? '',
    ...(node.sections ?? []).flatMap((section) => [section.title, section.body ?? '', ...(section.items ?? [])]),
    node.conceptType ?? '',
    node.scale ?? '',
    node.status ?? ''
  ];
}

function wordMatchScore(words: readonly string[], tokens: readonly string[]): number {
  return tokens.reduce((score, token) => {
    if (words.some((word) => word === token)) return score + 120;
    if (words.some((word) => word.startsWith(token))) return score + 80;
    if (words.some((word) => word.includes(token))) return score + 35;
    return score;
  }, 0);
}

function rankIndexedNode(record: IndexedNode, query: string, queryTokens: readonly string[]): number | null {
  if (!queryTokens.every((token) => record.haystack.includes(token))) return null;

  let score = 0;
  if (record.label === query) score += 4000;
  else if (record.id === query) score += 3800;
  else if (record.label.startsWith(query)) score += 2400;
  else if (record.id.startsWith(query)) score += 2200;
  else if (record.label.includes(query)) score += 1500;
  else if (record.id.includes(query)) score += 1300;
  else if (record.taxonomy.includes(query)) score += 500;
  else if (record.body.includes(query)) score += 250;

  if (queryTokens.every((token) => record.label.includes(token))) score += 700;
  else if (queryTokens.every((token) => record.id.includes(token))) score += 600;
  else if (queryTokens.every((token) => record.taxonomy.includes(token))) score += 220;

  score += wordMatchScore(record.labelWords, queryTokens);
  score += Math.floor(wordMatchScore(record.idWords, queryTokens) * 0.8);
  score += Math.max(0, 120 - record.label.length);
  return score;
}

/**
 * Immutable, pre-normalized search data for the lifetime of the loaded atlas.
 * Building the index performs all expensive text extraction and normalization
 * once; individual queries only scan compact normalized strings.
 */
export class NodeSearchIndex {
  private readonly records: readonly IndexedNode[];

  constructor(
    nodes: readonly GraphNode[],
    contextForNode: (node: GraphNode) => SearchableNodeContext = () => EMPTY_CONTEXT
  ) {
    this.records = nodes.map((node): IndexedNode => {
      const rawContext = contextForNode(node);
      const context: SearchableNodeContext = {
        fieldLabels: [...rawContext.fieldLabels],
        domainLabels: [...rawContext.domainLabels]
      };
      const id = normalizeSearchText(node.id);
      const label = normalizeSearchText(node.label);
      const taxonomy = normalizeSearchText([...context.fieldLabels, ...context.domainLabels].join(' '));
      const body = normalizeSearchText(searchableBodyParts(node).join(' '));
      return {
        node,
        context,
        id,
        label,
        taxonomy,
        body,
        haystack: `${id} ${label} ${taxonomy} ${body}`,
        labelWords: label.split(' ').filter(Boolean),
        idWords: id.split(' ').filter(Boolean)
      };
    });
  }

  search(rawQuery: string, options: NodeSearchOptions = {}): NodeSearchResult {
    const normalizedQuery = normalizeSearchText(rawQuery);
    if (!normalizedQuery) return { normalizedQuery, matches: [], total: 0 };
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    const matches: RankedNodeMatch[] = [];

    for (const record of this.records) {
      if (options.predicate && !options.predicate(record.node)) continue;
      const score = rankIndexedNode(record, normalizedQuery, queryTokens);
      if (score === null) continue;
      matches.push({ node: record.node, context: record.context, score });
    }

    matches.sort((a, b) => b.score - a.score
      || a.node.label.localeCompare(b.node.label)
      || a.node.id.localeCompare(b.node.id));
    const total = matches.length;
    const limit = options.limit === undefined ? total : Math.max(0, Math.floor(options.limit));
    return {
      normalizedQuery,
      matches: limit < total ? matches.slice(0, limit) : matches,
      total
    };
  }
}

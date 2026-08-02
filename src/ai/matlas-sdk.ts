/**
 * mAtlas browser and Node ESM SDK.
 *
 * License: https://github.com/madvay/mAtlas/blob/main/LICENSE
 * Graph data loaded through this SDK is CC BY-SA 4.0.
 * Attribution: mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/
 */
export {
  Atlas,
  canonicalConceptUrl,
  interactiveConceptUrl,
  searchableConceptText
} from './atlas-operations.js';

export type {
  AtlasOperationMeta,
  ClosureKind,
  ClosureOptions,
  ConceptRecord,
  ConceptReference,
  NeighborOptions,
  PathDirection,
  PathOptions,
  RelationRecord,
  SearchConceptOptions,
  SourceRecord,
  SubgraphOptions
} from './atlas-operations.js';

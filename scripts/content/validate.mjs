import { createValidationContext } from './context.mjs';
import * as schema from './validators/schema.mjs';
import * as references from './validators/references.mjs';
import * as semantic from './validators/semantic.mjs';
import * as editorial from './validators/editorial.mjs';
import * as chemistry from './validators/chemistry.mjs';
import * as rendererCompatibility from './validators/renderer-compatibility.mjs';
import * as shareCodec from './validators/share-codec.mjs';

export const validationLayers = Object.freeze([
  schema,
  shareCodec,
  references,
  semantic,
  editorial,
  chemistry,
  rendererCompatibility
]);

export function validateContent(content, requestedLayer = null) {
  const context = createValidationContext(content);
  const layers = requestedLayer
    ? validationLayers.filter((layer) => layer.name === requestedLayer)
    : validationLayers;
  if (requestedLayer && layers.length === 0) {
    throw new Error(`Unknown validation layer ${requestedLayer}. Expected one of: ${validationLayers.map((layer) => layer.name).join(', ')}.`);
  }
  return layers.map((layer) => ({ name: layer.name, errors: layer.validate(context) }));
}

export function validationSummary(content) {
  const graph = content.graph;
  const viewsData = content.viewsData;
  const multiDomainCount = Array.isArray(graph?.nodes)
    ? graph.nodes.filter((node) => node?.kind === 'structure' && Array.isArray(node?.domains) && node.domains.length > 1).length
    : 0;
  return `${Object.keys(graph?.fields ?? {}).length} fields, ${graph?.nodes?.length ?? 0} nodes, ${graph?.edges?.length ?? 0} edges, ${Object.keys(graph?.sources ?? {}).length} sources, ${viewsData?.views?.length ?? 0} views, and ${multiDomainCount} multi-domain concepts`;
}

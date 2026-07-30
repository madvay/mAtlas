import { CONTENT_BUILD_FORMAT_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '../contract.mjs';
import {
  arrayOrEmpty,
  entriesOrEmpty,
  requireBoolean,
  requireInteger,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray
} from '../validation-helpers.mjs';

export const name = 'schema';

const allowedPrerequisiteTraversals = new Set(['incoming', 'outgoing', 'both']);

export function validate(context) {
  const { graph, manifest, schema, viewsData } = context;
  const errors = [];

  requireObject(errors, manifest, 'content manifest');
  if (manifest?.formatVersion !== CONTENT_BUILD_FORMAT_VERSION) {
    errors.push(`manifest.formatVersion must be ${CONTENT_BUILD_FORMAT_VERSION}.`);
  }
  requireString(errors, manifest?.schemaVersion, 'manifest.schemaVersion');
  requireString(errors, manifest?.contentVersion, 'manifest.contentVersion');
  requireObject(errors, manifest?.files, 'manifest.files');
  for (const key of ['graph', 'schema', 'views', 'shareCodec']) requireString(errors, manifest?.files?.[key], `manifest.files.${key}`);
  if (typeof manifest?.schemaVersion === 'string' && !SUPPORTED_SCHEMA_VERSIONS.has(manifest.schemaVersion)) {
    errors.push(`manifest.schemaVersion ${manifest.schemaVersion} is not supported by this renderer.`);
  }
  if (typeof manifest?.contentVersion === 'string' && graph?.meta?.version !== manifest.contentVersion) {
    errors.push(`manifest.contentVersion ${manifest.contentVersion} must match graph.meta.version ${String(graph?.meta?.version)}.`);
  }

  requireObject(errors, schema, 'schema');
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema') errors.push('schema.$schema must declare JSON Schema draft 2020-12.');
  requireString(errors, schema?.$id, 'schema.$id');
  if (schema?.['x-matlas-schema-version'] !== manifest?.schemaVersion) {
    errors.push(`schema.x-matlas-schema-version must match manifest.schemaVersion ${String(manifest?.schemaVersion)}.`);
  }
  if (schema?.type !== 'object') errors.push('schema.type must be object.');

  requireObject(errors, graph, 'graph');
  requireObject(errors, graph?.meta, 'graph.meta');
  for (const key of ['title', 'version', 'description', 'direction', 'scope', 'license', 'attribution']) {
    requireString(errors, graph?.meta?.[key], `graph.meta.${key}`);
  }
  requireObject(errors, graph?.fields, 'graph.fields');
  requireObject(errors, graph?.domains, 'graph.domains');
  requireObject(errors, graph?.edgeTypes, 'graph.edgeTypes');
  requireObject(errors, graph?.sources, 'graph.sources');
  if (!Array.isArray(graph?.nodes)) errors.push('graph.nodes must be an array.');
  if (!Array.isArray(graph?.edges)) errors.push('graph.edges must be an array.');

  for (const [id, field] of entriesOrEmpty(graph?.fields)) {
    const path = `graph.fields.${id}`;
    requireObject(errors, field, path);
    requireString(errors, field?.label, `${path}.label`);
    if (field?.shortLabel !== undefined) requireString(errors, field.shortLabel, `${path}.shortLabel`);
    requireString(errors, field?.color, `${path}.color`);
    requireNumber(errors, field?.order, `${path}.order`);
    requireString(errors, field?.path, `${path}.path`);
    requireString(errors, field?.description, `${path}.description`);
  }

  for (const [id, domain] of entriesOrEmpty(graph?.domains)) {
    const path = `graph.domains.${id}`;
    requireObject(errors, domain, path);
    requireString(errors, domain?.label, `${path}.label`);
    requireString(errors, domain?.color, `${path}.color`);
    requireNumber(errors, domain?.order, `${path}.order`);
    requireString(errors, domain?.field, `${path}.field`);
  }

  for (const [id, edgeType] of entriesOrEmpty(graph?.edgeTypes)) {
    const path = `graph.edgeTypes.${id}`;
    requireObject(errors, edgeType, path);
    for (const key of ['label', 'short', 'description', 'color', 'prerequisiteTraversal']) requireString(errors, edgeType?.[key], `${path}.${key}`);
    if (!allowedPrerequisiteTraversals.has(edgeType?.prerequisiteTraversal)) {
      errors.push(`${path}.prerequisiteTraversal must be incoming, outgoing, or both.`);
    }
    requireObject(errors, edgeType?.endpointLabels, `${path}.endpointLabels`);
    requireString(errors, edgeType?.endpointLabels?.source, `${path}.endpointLabels.source`);
    requireString(errors, edgeType?.endpointLabels?.target, `${path}.endpointLabels.target`);
    if (edgeType?.activeInDataset !== undefined) requireBoolean(errors, edgeType.activeInDataset, `${path}.activeInDataset`);
    if (edgeType?.defaultVisible !== undefined) requireBoolean(errors, edgeType.defaultVisible, `${path}.defaultVisible`);
  }

  for (const [id, source] of entriesOrEmpty(graph?.sources)) {
    const path = `graph.sources.${id}`;
    requireObject(errors, source, path);
    for (const key of ['label', 'title', 'url', 'kind']) requireString(errors, source?.[key], `${path}.${key}`);
  }

  for (const [index, node] of arrayOrEmpty(graph?.nodes).entries()) {
    const path = `graph.nodes[${index}]`;
    requireObject(errors, node, path);
    for (const key of ['id', 'label', 'primaryDomain', 'kind', 'summary']) requireString(errors, node?.[key], `${path}.${key}`);
    if (node?.primaryField !== undefined) requireString(errors, node.primaryField, `${path}.primaryField`);
    if (node?.fields !== undefined) requireStringArray(errors, node.fields, `${path}.fields`, { nonEmpty: true, unique: true });
    requireStringArray(errors, node?.domains, `${path}.domains`, { nonEmpty: true, unique: true });
    requireInteger(errors, node?.level, `${path}.level`);
    requireStringArray(errors, node?.citations, `${path}.citations`);
    if (node?.root !== undefined) requireBoolean(errors, node.root, `${path}.root`);
    for (const key of ['conceptType', 'scale', 'status']) if (node?.[key] !== undefined) requireString(errors, node[key], `${path}.${key}`);
    if (node?.notes !== undefined && typeof node.notes !== 'string') errors.push(`${path}.notes must be a string.`);
    for (const key of ['carriers', 'data', 'axioms', 'induces']) {
      if (node?.[key] !== undefined) requireStringArray(errors, node[key], `${path}.${key}`);
    }
    for (const [sectionIndex, section] of arrayOrEmpty(node?.sections).entries()) {
      const sectionPath = `${path}.sections[${sectionIndex}]`;
      requireObject(errors, section, sectionPath);
      requireString(errors, section?.title, `${sectionPath}.title`);
      if (section?.body !== undefined) requireString(errors, section.body, `${sectionPath}.body`);
      if (section?.items !== undefined) requireStringArray(errors, section.items, `${sectionPath}.items`);
      if (section?.body === undefined && section?.items === undefined) errors.push(`${sectionPath} must include body or items.`);
    }
    if (node?.combination !== undefined) {
      requireObject(errors, node.combination, `${path}.combination`);
      requireStringArray(errors, node.combination?.inputs, `${path}.combination.inputs`, { nonEmpty: true, unique: true });
      requireString(errors, node.combination?.compatibility, `${path}.combination.compatibility`);
      requireString(errors, node.combination?.output, `${path}.combination.output`);
    }
  }

  for (const [index, edge] of arrayOrEmpty(graph?.edges).entries()) {
    const path = `graph.edges[${index}]`;
    requireObject(errors, edge, path);
    for (const key of ['id', 'source', 'target', 'type', 'label', 'detail']) requireString(errors, edge?.[key], `${path}.${key}`);
    requireStringArray(errors, edge?.citations, `${path}.citations`);
    for (const key of ['overview', 'synthetic']) if (edge?.[key] !== undefined) requireBoolean(errors, edge[key], `${path}.${key}`);
    if (edge?.junctionId !== undefined) requireString(errors, edge.junctionId, `${path}.junctionId`);
  }

  requireObject(errors, viewsData, 'views');
  if (!Array.isArray(viewsData?.views) || viewsData.views.length === 0) errors.push('views.views must be a non-empty array.');
  for (const [index, view] of arrayOrEmpty(viewsData?.views).entries()) {
    const path = `views.views[${index}]`;
    requireObject(errors, view, path);
    for (const key of ['id', 'title', 'summary', 'narrative']) requireString(errors, view?.[key], `${path}.${key}`);
    requireStringArray(errors, view?.tags, `${path}.tags`, { nonEmpty: true, unique: true });
    requireObject(errors, view?.metadata, `${path}.metadata`);
    if (!Array.isArray(view?.metadata?.credits)) errors.push(`${path}.metadata.credits must be an array.`);
    for (const [creditIndex, credit] of arrayOrEmpty(view?.metadata?.credits).entries()) {
      const creditPath = `${path}.metadata.credits[${creditIndex}]`;
      requireObject(errors, credit, creditPath);
      requireStringArray(errors, credit?.creators, `${creditPath}.creators`, { nonEmpty: true, unique: true });
      for (const key of ['attribution', 'copyright', 'license', 'licenseUrl']) {
        if (credit?.[key] !== undefined) requireString(errors, credit[key], `${creditPath}.${key}`);
      }
    }
    if (view?.metadata?.inheritedCreditCount !== undefined) {
      const count = view.metadata.inheritedCreditCount;
      if (!Number.isInteger(count) || count < 0 || count > arrayOrEmpty(view.metadata.credits).length) {
        errors.push(`${path}.metadata.inheritedCreditCount must be an integer between zero and metadata.credits.length.`);
      }
    }
    for (const key of ['createdAt', 'updatedAt']) if (view?.metadata?.[key] !== undefined) requireString(errors, view.metadata[key], `${path}.metadata.${key}`);
    if (view?.metadata?.derivedFrom !== undefined) {
      if (!Array.isArray(view.metadata.derivedFrom)) errors.push(`${path}.metadata.derivedFrom must be an array.`);
      for (const [derivedIndex, derived] of arrayOrEmpty(view.metadata.derivedFrom).entries()) {
        const derivedPath = `${path}.metadata.derivedFrom[${derivedIndex}]`;
        requireObject(errors, derived, derivedPath);
        requireString(errors, derived?.id, `${derivedPath}.id`);
        requireString(errors, derived?.title, `${derivedPath}.title`);
      }
    }
    if (view?.coreNodes !== undefined) requireStringArray(errors, view.coreNodes, `${path}.coreNodes`, { nonEmpty: true, unique: true });
    if (view?.nodeSequence !== undefined) requireStringArray(errors, view.nodeSequence, `${path}.nodeSequence`, { unique: true });
    if (view?.stepNarratives !== undefined) {
      requireObject(errors, view.stepNarratives, `${path}.stepNarratives`);
      for (const [nodeId, narrative] of Object.entries(view.stepNarratives ?? {})) {
        requireString(errors, narrative, `${path}.stepNarratives.${nodeId}`);
        if (!arrayOrEmpty(view?.nodeSequence).includes(nodeId)) errors.push(`${path}.stepNarratives key ${nodeId} must appear in nodeSequence.`);
      }
    }
    if (view?.featured !== undefined) requireBoolean(errors, view.featured, `${path}.featured`);
    if (view?.image !== undefined) {
      requireObject(errors, view.image, `${path}.image`);
      requireString(errors, view.image?.src, `${path}.image.src`);
      requireString(errors, view.image?.alt, `${path}.image.alt`);
    }
    requireObject(errors, view?.settings, `${path}.settings`);
requireStringArray(errors, view?.settings?.edgeTypes, `${path}.settings.edgeTypes`, { nonEmpty: true, unique: true });
    if (view?.settings?.fields !== undefined) requireStringArray(errors, view.settings.fields, `${path}.settings.fields`, { nonEmpty: true, unique: true });
    if (view?.settings?.domains !== undefined) requireStringArray(errors, view.settings.domains, `${path}.settings.domains`, { nonEmpty: true, unique: true });
    const hasDomains = Array.isArray(view?.settings?.domains) && view.settings.domains.length > 0;
    const hasCoreNodes = Array.isArray(view?.coreNodes) && view.coreNodes.length > 0;
    if (hasDomains === hasCoreNodes) errors.push(`${path} must define exactly one of settings.domains or coreNodes.`);
    if (hasDomains && !Array.isArray(view?.settings?.fields)) errors.push(`${path}.settings.fields is required when settings.domains is used.`);
    if (hasCoreNodes && view?.settings?.fields !== undefined) errors.push(`${path}.settings.fields must be omitted when coreNodes is used.`);
    for (const key of ['excludedFields', 'excludedDomains', 'prohibitedDomains']) if (view?.settings?.[key] !== undefined) requireStringArray(errors, view.settings[key], `${path}.settings.${key}`, { unique: true });
    for (const key of ['crossFieldVisibility', 'layout']) requireString(errors, view?.settings?.[key], `${path}.settings.${key}`);
    for (const key of ['edgeLabels', 'junctions', 'edgeZoomActivation', 'showPrimaryOnly', 'hideIsolates']) {
      if (view?.settings?.[key] !== undefined) requireBoolean(errors, view.settings[key], `${path}.settings.${key}`);
    }
    if (view?.settings?.hidePrerequisites !== undefined) requireBoolean(errors, view.settings.hidePrerequisites, `${path}.settings.hidePrerequisites`);
  }

  return errors;
}

import { arrayOrEmpty, requireStringArray } from '../validation-helpers.mjs';

export const name = 'references';

export function validate(context) {
  const {
    graph,
    fields,
    domains,
    edgeTypes,
    sources,
    nodes,
    edges,
    views,
    fieldIds,
    domainIds,
    edgeTypeIds,
    sourceIds,
    nodeIds,
    activeEdgeTypeIds
  } = context;
  const errors = [];

  requireStringArray(errors, graph?.meta?.fieldOrder, 'graph.meta.fieldOrder', { nonEmpty: true, unique: true });
  for (const id of arrayOrEmpty(graph?.meta?.fieldOrder)) if (!fieldIds.has(id)) errors.push(`graph.meta.fieldOrder references unknown field: ${id}`);
  for (const [id] of fields) if (!arrayOrEmpty(graph?.meta?.fieldOrder).includes(id)) errors.push(`Field ${id} is missing from graph.meta.fieldOrder.`);
  if (graph?.meta?.defaultField && !fieldIds.has(graph.meta.defaultField)) errors.push(`graph.meta.defaultField references unknown field: ${graph.meta.defaultField}`);

  requireStringArray(errors, graph?.meta?.domainOrder, 'graph.meta.domainOrder', { nonEmpty: true, unique: true });
  for (const id of arrayOrEmpty(graph?.meta?.domainOrder)) if (!domainIds.has(id)) errors.push(`graph.meta.domainOrder references unknown domain: ${id}`);
  for (const [id] of domains) if (!arrayOrEmpty(graph?.meta?.domainOrder).includes(id)) errors.push(`Domain ${id} is missing from graph.meta.domainOrder.`);

  requireStringArray(errors, graph?.meta?.edgeTypeOrder, 'graph.meta.edgeTypeOrder', { nonEmpty: true, unique: true });
  for (const id of arrayOrEmpty(graph?.meta?.edgeTypeOrder)) if (!edgeTypeIds.has(id)) errors.push(`graph.meta.edgeTypeOrder references unknown edge type: ${id}`);
  for (const [id] of edgeTypes) if (!arrayOrEmpty(graph?.meta?.edgeTypeOrder).includes(id)) errors.push(`Edge type ${id} is missing from graph.meta.edgeTypeOrder.`);

  for (const [id, domain] of domains) if (!fieldIds.has(domain?.field)) errors.push(`graph.domains.${id}.field references unknown field: ${String(domain?.field)}`);

  for (const [index, node] of nodes.entries()) {
    const path = `graph.nodes[${index}]`;
    if (!domainIds.has(node?.primaryDomain)) errors.push(`${path}.primaryDomain references unknown domain: ${String(node?.primaryDomain)}`);
    if (Array.isArray(node?.domains) && !node.domains.includes(node.primaryDomain)) errors.push(`${path}.domains must include primaryDomain ${String(node.primaryDomain)}.`);
    for (const domainId of arrayOrEmpty(node?.domains)) if (!domainIds.has(domainId)) errors.push(`${path}.domains references unknown domain: ${domainId}`);
    const inferredFields = [...new Set(arrayOrEmpty(node?.domains).map((domainId) => graph?.domains?.[domainId]?.field).filter(Boolean))];
    const declaredFields = Array.isArray(node?.fields) ? node.fields : inferredFields;
    for (const fieldId of declaredFields) if (!fieldIds.has(fieldId)) errors.push(`${path}.fields references unknown field: ${fieldId}`);
    const primaryField = node?.primaryField ?? graph?.domains?.[node?.primaryDomain]?.field;
    if (!fieldIds.has(primaryField)) errors.push(`${path}.primaryField could not be resolved to a known field.`);
    if (primaryField && !declaredFields.includes(primaryField)) errors.push(`${path}.fields must include primaryField ${primaryField}.`);
    for (const fieldId of inferredFields) if (!declaredFields.includes(fieldId)) errors.push(`${path}.fields omits field ${fieldId} implied by its domains.`);
    for (const input of arrayOrEmpty(node?.combination?.inputs)) if (!nodeIds.has(input)) errors.push(`${path}.combination.inputs references unknown node: ${input}`);
    if (node?.combination?.output && !nodeIds.has(node.combination.output)) errors.push(`${path}.combination.output references unknown node: ${node.combination.output}`);
  }

  for (const [index, edge] of edges.entries()) {
    const path = `graph.edges[${index}]`;
    if (!nodeIds.has(edge?.source)) errors.push(`${path}.source references unknown node: ${String(edge?.source)}`);
    if (!nodeIds.has(edge?.target)) errors.push(`${path}.target references unknown node: ${String(edge?.target)}`);
    if (!edgeTypeIds.has(edge?.type)) errors.push(`${path}.type references unknown edge type: ${String(edge?.type)}`);
    if (edge?.junctionId !== undefined && !nodeIds.has(edge.junctionId)) errors.push(`${path}.junctionId references unknown node: ${edge.junctionId}`);
    for (const citationId of arrayOrEmpty(edge?.citations)) if (!sourceIds.has(citationId)) errors.push(`${path}.citations references unknown source: ${citationId}`);
  }
  for (const [index, node] of nodes.entries()) {
    for (const citationId of arrayOrEmpty(node?.citations)) if (!sourceIds.has(citationId)) errors.push(`graph.nodes[${index}].citations references unknown source: ${citationId}`);
  }

  const usedEdgeTypeIds = new Set(edges.map((edge) => edge?.type));
  for (const id of activeEdgeTypeIds) if (!usedEdgeTypeIds.has(id)) errors.push(`Active edge type ${id} is not used by any edge.`);

  for (const [index, view] of views.entries()) {
    const path = `views.views[${index}]`;
    for (const nodeId of arrayOrEmpty(view?.coreNodes)) if (!nodeIds.has(nodeId)) errors.push(`${path}.coreNodes references unknown node: ${nodeId}`);
    for (const nodeId of arrayOrEmpty(view?.nodeSequence)) if (!nodeIds.has(nodeId)) errors.push(`${path}.nodeSequence references unknown node: ${nodeId}`);
    for (const nodeId of Object.keys(view?.stepNarratives ?? {})) if (!nodeIds.has(nodeId)) errors.push(`${path}.stepNarratives references unknown node: ${nodeId}`);
    const settings = view?.settings ?? {};
    for (const fieldId of arrayOrEmpty(settings.fields)) if (!fieldIds.has(fieldId)) errors.push(`${path}.settings.fields references unknown field: ${fieldId}`);
    for (const domainId of arrayOrEmpty(settings.domains)) {
      if (!domainIds.has(domainId)) errors.push(`${path}.settings.domains references unknown domain: ${domainId}`);
      const fieldId = graph?.domains?.[domainId]?.field;
      if (fieldId && !arrayOrEmpty(settings.fields).includes(fieldId)) errors.push(`${path}.settings.fields must include ${fieldId}, required by domain ${domainId}.`);
    }
    for (const edgeTypeId of arrayOrEmpty(settings.edgeTypes)) if (!activeEdgeTypeIds.has(edgeTypeId)) errors.push(`${path}.settings.edgeTypes references inactive or unknown edge type: ${edgeTypeId}`);
    for (const fieldId of arrayOrEmpty(settings.excludedFields)) if (!fieldIds.has(fieldId)) errors.push(`${path}.settings.excludedFields references unknown field: ${fieldId}`);
    for (const domainId of arrayOrEmpty(settings.excludedDomains)) if (!domainIds.has(domainId)) errors.push(`${path}.settings.excludedDomains references unknown domain: ${domainId}`);
    for (const domainId of arrayOrEmpty(settings.prohibitedDomains)) if (!domainIds.has(domainId)) errors.push(`${path}.settings.prohibitedDomains references unknown domain: ${domainId}`);
  }

  for (const [id] of sources) {
    const cited = nodes.some((node) => arrayOrEmpty(node?.citations).includes(id)) || edges.some((edge) => arrayOrEmpty(edge?.citations).includes(id));
    if (!cited) errors.push(`Source ${id} is not cited by any node or edge.`);
  }

  return errors;
}

import { arrayOrEmpty } from '../validation-helpers.mjs';
import { authoredLevelErrors } from '../level-model.mjs';

export const name = 'semantic';

function duplicateValueErrors(items, valueOf, label) {
  const errors = [];
  const seen = new Map();
  for (const [index, item] of items.entries()) {
    const value = valueOf(item);
    if (typeof value !== 'string') continue;
    if (seen.has(value)) errors.push(`Duplicate ${label} ${value} at indexes ${seen.get(value)} and ${index}.`);
    else seen.set(value, index);
  }
  return errors;
}

export function validate(context) {
  const { graph, fields, nodes, edges, views, nodeById } = context;
  const errors = [
    ...duplicateValueErrors(nodes, (node) => node?.id, 'node id'),
    ...duplicateValueErrors(edges, (edge) => edge?.id, 'edge id'),
    ...duplicateValueErrors(views, (view) => view?.id, 'view id'),
    ...duplicateValueErrors(views, (view) => view?.title, 'view title')
  ];

  const fieldPaths = new Map();
  for (const [id, field] of fields) {
    if (typeof field?.path !== 'string') continue;
    if (fieldPaths.has(field.path)) errors.push(`Fields ${fieldPaths.get(field.path)} and ${id} use the same path ${field.path}.`);
    else fieldPaths.set(field.path, id);
  }

  const relationSignatures = new Map();
  const incomingByNode = new Map(nodes.map((node) => [node?.id, []]));
  const outgoingByNode = new Map(nodes.map((node) => [node?.id, []]));
  for (const edge of edges) {
    if (edge?.source === edge?.target) errors.push(`Edge ${String(edge?.id)} is a self-loop.`);
    const signature = `${String(edge?.source)}|${String(edge?.target)}|${String(edge?.type)}`;
    if (relationSignatures.has(signature)) errors.push(`Edges ${relationSignatures.get(signature)} and ${String(edge?.id)} duplicate the same relation signature.`);
    else relationSignatures.set(signature, edge?.id);
    incomingByNode.get(edge?.target)?.push(edge);
    outgoingByNode.get(edge?.source)?.push(edge);
  }

  for (const node of nodes) {
    if (node?.kind !== 'junction' || !node?.combination) continue;
    const incoming = incomingByNode.get(node.id) ?? [];
    const outgoing = outgoingByNode.get(node.id) ?? [];
    for (const input of arrayOrEmpty(node.combination.inputs)) {
      if (!incoming.some((edge) => edge?.source === input && edge?.type === 'combine-compatible')) {
        errors.push(`Junction ${node.id} is missing a combine-compatible edge from input ${input}.`);
      }
    }
    const unexpectedInputs = incoming.filter((edge) => !arrayOrEmpty(node.combination.inputs).includes(edge?.source));
    if (unexpectedInputs.length) errors.push(`Junction ${node.id} has unexpected incoming edge(s): ${unexpectedInputs.map((edge) => edge.id).join(', ')}.`);
    const outputEdges = outgoing.filter((edge) => edge?.target === node.combination.output && edge?.type === 'combine-compatible');
    if (outputEdges.length !== 1) errors.push(`Junction ${node.id} must have exactly one combine-compatible edge to ${String(node.combination.output)}.`);
    const unexpectedOutputs = outgoing.filter((edge) => edge?.target !== node.combination.output);
    if (unexpectedOutputs.length) errors.push(`Junction ${node.id} has unexpected outgoing edge(s): ${unexpectedOutputs.map((edge) => edge.id).join(', ')}.`);
  }

  errors.push(...authoredLevelErrors(graph));

  for (const [index, view] of views.entries()) {
    const settings = view?.settings ?? {};
    const coreNodes = new Set(arrayOrEmpty(view?.coreNodes));
    for (const nodeId of arrayOrEmpty(view?.nodeSequence)) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      if (coreNodes.size > 0) {
        if (!coreNodes.has(nodeId)) errors.push(`views.views[${index}].nodeSequence node ${nodeId} must also appear in coreNodes.`);
        continue;
      }
      const nodeDomains = Array.isArray(node.domains) && node.domains.length ? node.domains : [node.primaryDomain];
      const nodeFields = Array.isArray(node.fields) && node.fields.length
        ? node.fields
        : [...new Set(nodeDomains.map((domainId) => graph?.domains?.[domainId]?.field).filter(Boolean))];
      if (!nodeFields.some((fieldId) => arrayOrEmpty(settings.fields).includes(fieldId))
        || !nodeDomains.some((domainId) => arrayOrEmpty(settings.domains).includes(domainId))) {
        errors.push(`views.views[${index}].nodeSequence node ${nodeId} is outside the view's selected taxonomy.`);
      }
    }
  }

  return errors;
}

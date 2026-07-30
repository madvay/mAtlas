import { arrayOrEmpty } from '../validation-helpers.mjs';

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

  for (const edge of edges) {
    if (!['add-data', 'impose-axiom', 'combine-compatible'].includes(edge?.type)) continue;
    const sourceLevel = nodeById.get(edge?.source)?.level;
    const targetLevel = nodeById.get(edge?.target)?.level;
    if (Number.isFinite(sourceLevel) && Number.isFinite(targetLevel) && sourceLevel > targetLevel) {
      errors.push(`Structural edge ${String(edge?.id)} points upward from level ${sourceLevel} to ${targetLevel}.`);
    }
  }

  const downwardPhysicsTypes = new Set([
    'mathematical-limit',
    'controlled-approximation',
    'effective-theory',
    'approximation-method',
    'phenomenological-model',
    'model-realization',
    'theory-extension',
    'composition',
    'field-excitation',
    'binds-forms',
    'emergence'
  ]);
  for (const edge of edges) {
    if (!downwardPhysicsTypes.has(edge?.type)) continue;
    const source = nodeById.get(edge?.source);
    const target = nodeById.get(edge?.target);
    if (!source || !target) continue;
    const sourceField = source.primaryField ?? graph?.domains?.[source.primaryDomain]?.field;
    const targetField = target.primaryField ?? graph?.domains?.[target.primaryDomain]?.field;
    if (sourceField !== 'physics' || targetField !== 'physics') continue;
    if (Number.isFinite(source.level) && Number.isFinite(target.level) && source.level > target.level) {
      errors.push(`Physics ${edge.type} edge ${String(edge.id)} points upward from level ${source.level} to ${target.level}.`);
    }
  }

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

  const structuralTypes = new Set(['add-data', 'impose-axiom', 'combine-compatible']);
  const adjacency = new Map(nodes.map((node) => [node?.id, []]));
  for (const edge of edges) if (structuralTypes.has(edge?.type)) adjacency.get(edge?.source)?.push(edge?.target);
  const visitState = new Map();
  const visitStack = [];
  let structuralCycle = null;
  const visit = (id) => {
    visitState.set(id, 1);
    visitStack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visitState.get(next) === 1) {
        structuralCycle = [...visitStack.slice(visitStack.indexOf(next)), next];
        return true;
      }
      if (!visitState.has(next) && visit(next)) return true;
    }
    visitStack.pop();
    visitState.set(id, 2);
    return false;
  };
  for (const node of nodes) if (typeof node?.id === 'string' && !visitState.has(node.id) && visit(node.id)) break;
  if (structuralCycle) errors.push(`Structural edge cycle detected: ${structuralCycle.join(' -> ')}`);

  return errors;
}

const freezeAnchor = (anchor) => Object.freeze({
  level: anchor.level,
  nodeIds: Object.freeze([...anchor.nodeIds])
});

/**
 * Edge types whose declared source is a strict vertical predecessor of the
 * declared target. Authored levels may contain arbitrary additional spacing,
 * but every one of these edges must increase the level by at least one.
 *
 * Relations such as canonical constructions, quotients, embeddings,
 * equivalences, implications, components, formulations, interactions,
 * transformations, and evidence are intentionally excluded because their
 * declared direction does not consistently mean "more structured/later on the
 * vertical axis".
 */
export const LEVEL_PREDECESSOR_EDGE_TYPES = Object.freeze([
  'add-data',
  'impose-axiom',
  'combine-compatible',
  'framework-specialization',
  'quantization',
  'composition',
  'classification',
  'mathematical-limit',
  'effective-theory',
  'model-realization',
  'emergence',
  'state-description'
]);

/**
 * Hard editorial minima. These are semantic levels before layout.yaml applies
 * any rendered band offsets.
 */
export const DEFAULT_LEVEL_POLICY = Object.freeze({
  predecessorEdgeTypes: LEVEL_PREDECESSOR_EDGE_TYPES,
  globalMinimum: freezeAnchor({ level: 0, nodeIds: ['set'] }),
  primaryFieldMinima: Object.freeze({
    physics: freezeAnchor({ level: 1, nodeIds: ['physical_system', 'physical_theory'] }),
    chemistry: freezeAnchor({ level: 19, nodeIds: ['chemical_matter'] })
  })
});

function primaryField(node, graph) {
  return node?.primaryField ?? graph?.domains?.[node?.primaryDomain]?.field;
}

function sortedInsert(values, value) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle].localeCompare(value) < 0) low = middle + 1;
    else high = middle;
  }
  values.splice(low, 0, value);
}

function cyclePath(adjacency, nodeIds) {
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const edge of adjacency.get(id) ?? []) {
      const next = edge.target;
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of nodeIds) {
    if (state.has(id)) continue;
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
}

function registerFloor(floors, nodeId, level, reason) {
  const current = floors.get(nodeId);
  if (!current || level >= current.level) floors.set(nodeId, { level, reason });
}

function normalizePolicy(graph, policy) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeById = new Map(nodes.map((node) => [node?.id, node]));
  if (nodeById.size !== nodes.length || [...nodeById.keys()].some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Level modeling requires unique, non-empty node ids.');
  }

  const edgeTypeIds = new Set(Object.keys(graph?.edgeTypes ?? {}));
  const predecessorEdgeTypes = new Set(policy?.predecessorEdgeTypes ?? []);
  if (!predecessorEdgeTypes.size) throw new Error('Level policy must define at least one predecessor edge type.');
  for (const type of predecessorEdgeTypes) {
    if (!edgeTypeIds.has(type)) throw new Error(`Level policy references unknown edge type ${type}.`);
  }

  const exactLevels = new Map();
  const floors = new Map();
  const registerExact = (nodeId, level, label) => {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`${label} references unknown node ${nodeId}.`);
    const previous = exactLevels.get(nodeId);
    if (previous !== undefined && previous !== level) {
      throw new Error(`${label} assigns ${nodeId} level ${level}, conflicting with level ${previous}.`);
    }
    exactLevels.set(nodeId, level);
    registerFloor(floors, nodeId, level, label);
  };

  const globalMinimum = policy?.globalMinimum;
  requireInteger(globalMinimum?.level, 'Level policy global minimum level');
  if (!Array.isArray(globalMinimum?.nodeIds) || !globalMinimum.nodeIds.length) {
    throw new Error('Level policy global minimum must name at least one node.');
  }
  const globalIds = new Set(globalMinimum.nodeIds);
  if (globalIds.size !== globalMinimum.nodeIds.length) throw new Error('Level policy global minimum contains duplicate node ids.');
  for (const nodeId of globalIds) registerExact(nodeId, globalMinimum.level, 'global minimum');
  for (const node of nodes) {
    if (!globalIds.has(node.id)) registerFloor(floors, node.id, globalMinimum.level + 1, 'sole global minimum');
  }

  const primaryFieldMinima = policy?.primaryFieldMinima ?? {};
  for (const [fieldId, anchor] of Object.entries(primaryFieldMinima)) {
    if (!graph?.fields?.[fieldId]) throw new Error(`Level policy references unknown primary field ${fieldId}.`);
    requireInteger(anchor?.level, `Level policy ${fieldId} minimum level`);
    if (!Array.isArray(anchor?.nodeIds) || !anchor.nodeIds.length) {
      throw new Error(`Level policy ${fieldId} minimum must name at least one node.`);
    }
    const anchorIds = new Set(anchor.nodeIds);
    if (anchorIds.size !== anchor.nodeIds.length) throw new Error(`Level policy ${fieldId} minimum contains duplicate node ids.`);
    for (const nodeId of anchorIds) {
      const node = nodeById.get(nodeId);
      if (!node) throw new Error(`Level policy ${fieldId} minimum references unknown node ${nodeId}.`);
      if (primaryField(node, graph) !== fieldId) {
        throw new Error(`Level policy ${fieldId} minimum node ${nodeId} is primary in ${String(primaryField(node, graph))}.`);
      }
      registerExact(nodeId, anchor.level, `${fieldId} minimum`);
    }
    for (const node of nodes) {
      if (primaryField(node, graph) === fieldId && !anchorIds.has(node.id)) {
        registerFloor(floors, node.id, anchor.level + 1, `sole ${fieldId} minimum`);
      }
    }
  }

  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const predecessors = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const predecessorEdges = [];
  for (const edge of edges) {
    if (!predecessorEdgeTypes.has(edge?.type)) continue;
    if (!nodeById.has(edge?.source) || !nodeById.has(edge?.target)) {
      throw new Error(`Level predecessor edge ${String(edge?.id)} references an unknown node.`);
    }
    adjacency.get(edge.source).push(edge);
    predecessors.get(edge.target).push(edge);
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    predecessorEdges.push(edge);
  }
  for (const values of adjacency.values()) values.sort((a, b) => a.target.localeCompare(b.target) || String(a.id).localeCompare(String(b.id)));
  for (const values of predecessors.values()) values.sort((a, b) => a.source.localeCompare(b.source) || String(a.id).localeCompare(String(b.id)));

  return {
    graph,
    nodes,
    nodeById,
    predecessorEdgeTypes,
    predecessorEdges,
    exactLevels,
    floors,
    adjacency,
    predecessors,
    indegree,
    globalMinimum,
    primaryFieldMinima
  };
}

function topologicalOrder(model) {
  const indegree = new Map(model.indegree);
  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const edge of model.adjacency.get(id) ?? []) {
      const degree = indegree.get(edge.target) - 1;
      indegree.set(edge.target, degree);
      if (degree === 0) sortedInsert(ready, edge.target);
    }
  }
  if (order.length !== model.nodes.length) {
    const cycle = cyclePath(model.adjacency, model.nodes.map((node) => node.id));
    throw new Error(`Level predecessor edge cycle detected${cycle ? `: ${cycle.join(' -> ')}` : '.'}`);
  }
  return order;
}

function requiredFromPredecessors(model, levels, id) {
  let required = Number.NEGATIVE_INFINITY;
  let cause = null;
  for (const edge of model.predecessors.get(id) ?? []) {
    const candidate = levels.get(edge.source) + 1;
    if (candidate > required || (candidate === required && String(edge.id).localeCompare(String(cause?.edge?.id ?? '')) < 0)) {
      required = candidate;
      cause = { kind: 'predecessor', edge, sourceLevel: levels.get(edge.source), required: candidate };
    }
  }
  return { required, cause };
}

function verifyExactAnchor(model, id, required) {
  const exact = model.exactLevels.get(id);
  if (exact !== undefined && required > exact) {
    throw new Error(`Level anchor ${id} is fixed at ${exact}, but its selected predecessors require at least ${required}.`);
  }
  return exact;
}

/** Compute the minimum levels permitted by the selected predecessor DAG and hard floors. */
export function computeMinimumLevels(graph, policy = DEFAULT_LEVEL_POLICY) {
  const model = normalizePolicy(graph, policy);
  const order = topologicalOrder(model);
  const levels = new Map();
  for (const id of order) {
    const floor = model.floors.get(id);
    const predecessor = requiredFromPredecessors(model, levels, id);
    const required = Math.max(floor?.level ?? Number.NEGATIVE_INFINITY, predecessor.required);
    const exact = verifyExactAnchor(model, id, required);
    levels.set(id, exact ?? required);
  }
  return levels;
}

/**
 * Project authored levels upward to the nearest valid assignment. No ordinary
 * node is ever lowered; only a hard anchor mismatch is rejected.
 */
export function computeMonotonicLevels(graph, policy = DEFAULT_LEVEL_POLICY) {
  const model = normalizePolicy(graph, policy);
  const order = topologicalOrder(model);
  const levels = new Map();
  const causes = new Map();
  const authored = new Map();

  for (const node of model.nodes) {
    requireInteger(node?.level, `Node ${String(node?.id)} level`);
    authored.set(node.id, node.level);
  }

  for (const id of order) {
    const current = authored.get(id);
    const exact = model.exactLevels.get(id);
    if (exact !== undefined && current > exact) {
      throw new Error(`Level anchor ${id} must remain exactly ${exact}; found ${current}. Lowering anchors requires an explicit editorial edit.`);
    }

    const floor = model.floors.get(id);
    const predecessor = requiredFromPredecessors(model, levels, id);
    const structuralRequired = Math.max(floor?.level ?? Number.NEGATIVE_INFINITY, predecessor.required);
    verifyExactAnchor(model, id, structuralRequired);

    let projected = exact ?? Math.max(current, structuralRequired);
    levels.set(id, projected);
    if (projected <= current) continue;

    if (predecessor.required >= (floor?.level ?? Number.NEGATIVE_INFINITY)) {
      causes.set(id, predecessor.cause);
    } else {
      causes.set(id, { kind: 'floor', reason: floor.reason, required: floor.level });
    }
  }

  return { levels, authored, causes, model };
}

export function forcingChain(projection, nodeId) {
  const steps = [];
  const seen = new Set();
  let current = nodeId;
  while (!seen.has(current)) {
    seen.add(current);
    const cause = projection.causes.get(current);
    if (!cause) break;
    if (cause.kind === 'floor') {
      steps.push({ kind: 'floor', nodeId: current, reason: cause.reason, level: cause.required });
      break;
    }
    steps.push({
      kind: 'edge',
      edge: cause.edge,
      sourceId: cause.edge.source,
      targetId: cause.edge.target,
      sourceLevel: projection.levels.get(cause.edge.source),
      targetLevel: projection.levels.get(cause.edge.target)
    });
    current = cause.edge.source;
  }
  return steps.reverse();
}

export function authoredLevelErrors(graph, policy = DEFAULT_LEVEL_POLICY) {
  let projection;
  try {
    projection = computeMonotonicLevels(graph, policy);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const errors = [];
  for (const node of graph?.nodes ?? []) {
    const projected = projection.levels.get(node.id);
    if (projected === node.level) continue;
    const cause = projection.causes.get(node.id);
    if (cause?.kind === 'predecessor') {
      errors.push(`Node ${node.id} has level ${node.level}; selected predecessor ${cause.edge.source} is level ${projection.levels.get(cause.edge.source)} on ${cause.edge.type} edge ${cause.edge.id}, so ${node.id} must be at least ${projected}. Run npm run levels:fix.`);
    } else {
      errors.push(`Node ${node.id} has level ${node.level}; the ${cause?.reason ?? 'level policy'} requires at least ${projected}. Run npm run levels:fix.`);
    }
  }
  return errors;
}

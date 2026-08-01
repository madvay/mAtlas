const LEVEL_ENFORCEMENT_DIRECTIONS = new Set(['incoming', 'outgoing']);

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
    for (const constraint of adjacency.get(id) ?? []) {
      const next = constraint.successor;
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

function normalizeEnforcement(value, label) {
  if (value === undefined || value === null || value === '' || value === 'none') return 'none';
  if (!LEVEL_ENFORCEMENT_DIRECTIONS.has(value)) {
    throw new Error(`${label} must be incoming, outgoing, none, or empty.`);
  }
  return value;
}

function normalizePolicy(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeById = new Map(nodes.map((node) => [node?.id, node]));
  if (nodeById.size !== nodes.length || [...nodeById.keys()].some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Level modeling requires unique, non-empty node ids.');
  }

  const policy = graph?.levelPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Graph levelPolicy must be an object.');
  }

  const edgeTypes = graph?.edgeTypes;
  if (!edgeTypes || typeof edgeTypes !== 'object' || Array.isArray(edgeTypes)) {
    throw new Error('Level modeling requires graph edgeTypes.');
  }
  const enforcementByType = new Map();
  for (const [type, edgeType] of Object.entries(edgeTypes)) {
    enforcementByType.set(type, normalizeEnforcement(edgeType?.enforcePredecessorLevel, `Edge type ${type} enforcePredecessorLevel`));
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

  const globalMinimum = policy.globalMinimum;
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

  const primaryFieldMinima = policy.primaryFieldMinima ?? {};
  if (!primaryFieldMinima || typeof primaryFieldMinima !== 'object' || Array.isArray(primaryFieldMinima)) {
    throw new Error('Level policy primaryFieldMinima must be an object.');
  }
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
  const predecessorConstraints = [];
  for (const edge of edges) {
    if (!enforcementByType.has(edge?.type)) {
      throw new Error(`Level modeling edge ${String(edge?.id)} references unknown edge type ${String(edge?.type)}.`);
    }
    const direction = enforcementByType.get(edge.type);
    if (direction === 'none') continue;
    if (!nodeById.has(edge?.source) || !nodeById.has(edge?.target)) {
      throw new Error(`Level predecessor edge ${String(edge?.id)} references an unknown node.`);
    }
    const predecessor = direction === 'incoming' ? edge.source : edge.target;
    const successor = direction === 'incoming' ? edge.target : edge.source;
    const constraint = { edge, direction, predecessor, successor };
    adjacency.get(predecessor).push(constraint);
    predecessors.get(successor).push(constraint);
    indegree.set(successor, indegree.get(successor) + 1);
    predecessorConstraints.push(constraint);
  }
  for (const values of adjacency.values()) {
    values.sort((a, b) => a.successor.localeCompare(b.successor) || String(a.edge.id).localeCompare(String(b.edge.id)));
  }
  for (const values of predecessors.values()) {
    values.sort((a, b) => a.predecessor.localeCompare(b.predecessor) || String(a.edge.id).localeCompare(String(b.edge.id)));
  }

  return {
    graph,
    nodes,
    nodeById,
    enforcementByType,
    predecessorConstraints,
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
    for (const constraint of model.adjacency.get(id) ?? []) {
      const degree = indegree.get(constraint.successor) - 1;
      indegree.set(constraint.successor, degree);
      if (degree === 0) sortedInsert(ready, constraint.successor);
    }
  }
  if (order.length !== model.nodes.length) {
    const cycle = cyclePath(model.adjacency, model.nodes.map((node) => node.id));
    throw new Error(`Level predecessor edge cycle detected${cycle ? `: ${cycle.join(' -> ')}` : '.'}`);
  }
  return order;
}

/** Build and validate the configured strict-predecessor model for tooling. */
export function createLevelConstraintModel(graph) {
  const model = normalizePolicy(graph);
  topologicalOrder(model);
  return model;
}

/**
 * Return every hard reason a node cannot be lowered to candidateLevel while
 * all other nodes retain the supplied levels.
 */
export function levelLoweringBlockers(model, levels, nodeId, candidateLevel) {
  requireInteger(candidateLevel, `Candidate level for ${String(nodeId)}`);
  if (!model?.nodeById?.has(nodeId)) throw new Error(`Unknown level-model node ${String(nodeId)}.`);
  if (!(levels instanceof Map)) throw new Error('Level lowering requires a Map of current node levels.');

  const exact = model.exactLevels.get(nodeId);
  if (exact !== undefined && candidateLevel !== exact) {
    return [{ kind: 'exact', nodeId, level: exact, reason: 'fixed editorial anchor' }];
  }

  const blockers = [];
  const floor = model.floors.get(nodeId);
  if (floor && candidateLevel < floor.level) {
    blockers.push({ kind: 'floor', nodeId, level: floor.level, reason: floor.reason });
  }
  for (const constraint of model.predecessors.get(nodeId) ?? []) {
    const predecessorLevel = levels.get(constraint.predecessor);
    requireInteger(predecessorLevel, `Current level for predecessor ${constraint.predecessor}`);
    if (candidateLevel <= predecessorLevel) {
      blockers.push({
        kind: 'predecessor',
        nodeId,
        constraint,
        predecessorLevel,
        requiredLevel: predecessorLevel + 1
      });
    }
  }
  return blockers;
}

function requiredFromPredecessors(model, levels, id) {
  let required = Number.NEGATIVE_INFINITY;
  let cause = null;
  for (const constraint of model.predecessors.get(id) ?? []) {
    const candidate = levels.get(constraint.predecessor) + 1;
    if (candidate > required || (candidate === required && String(constraint.edge.id).localeCompare(String(cause?.constraint?.edge?.id ?? '')) < 0)) {
      required = candidate;
      cause = { kind: 'predecessor', constraint, predecessorLevel: levels.get(constraint.predecessor), required: candidate };
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

/** Compute the minimum levels permitted by the configured predecessor DAG and hard floors. */
export function computeMinimumLevels(graph) {
  const model = normalizePolicy(graph);
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
export function computeMonotonicLevels(graph) {
  const model = normalizePolicy(graph);
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

    const projected = exact ?? Math.max(current, structuralRequired);
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
    const { constraint } = cause;
    steps.push({
      kind: 'edge',
      edge: constraint.edge,
      direction: constraint.direction,
      predecessorId: constraint.predecessor,
      successorId: constraint.successor,
      predecessorLevel: projection.levels.get(constraint.predecessor),
      successorLevel: projection.levels.get(constraint.successor)
    });
    current = constraint.predecessor;
  }
  return steps.reverse();
}

export function authoredLevelErrors(graph) {
  let projection;
  try {
    projection = computeMonotonicLevels(graph);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const errors = [];
  for (const node of graph?.nodes ?? []) {
    const projected = projection.levels.get(node.id);
    if (projected === node.level) continue;
    const cause = projection.causes.get(node.id);
    if (cause?.kind === 'predecessor') {
      const { constraint } = cause;
      errors.push(`Node ${node.id} has level ${node.level}; configured predecessor ${constraint.predecessor} is level ${projection.levels.get(constraint.predecessor)} on ${constraint.edge.type} edge ${constraint.edge.id} (${constraint.direction}), so ${node.id} must be at least ${projected}. Run npm run levels:fix.`);
    } else {
      errors.push(`Node ${node.id} has level ${node.level}; the ${cause?.reason ?? 'level policy'} requires at least ${projected}. Run npm run levels:fix.`);
    }
  }
  return errors;
}

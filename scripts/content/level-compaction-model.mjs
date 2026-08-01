import {
  authoredLevelErrors,
  createLevelConstraintModel,
  levelLoweringBlockers
} from './level-model.mjs';

function primaryDomainNodes(graph, domainId) {
  return (graph?.nodes ?? [])
    .filter((node) => node?.primaryDomain === domainId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function firstGap(levels, lowestLevel) {
  const occupied = [...new Set(levels)].sort((a, b) => a - b);
  const highestLevel = occupied.at(-1);
  if (highestLevel === undefined) return null;
  const occupiedSet = new Set(occupied);
  for (let level = lowestLevel + 1; level < highestLevel; level += 1) {
    if (!occupiedSet.has(level)) {
      return {
        level,
        nextOccupiedLevel: occupied.find((candidate) => candidate > level)
      };
    }
  }
  return null;
}

/**
 * Lower a domain's occupied levels without merging two previously occupied levels.
 * The initial lowest occupied level is editorially fixed. At each step, the next
 * cohort above the first gap moves down by one level. A partial cohort move is
 * applied, then compaction stops exactly as requested by the editorial rule.
 */
export function compactDomainLevels(graph, domainId) {
  if (!graph?.domains?.[domainId]) throw new Error(`Unknown domain id ${String(domainId)}.`);

  const validationErrors = authoredLevelErrors(graph);
  if (validationErrors.length) {
    throw new Error(`Cannot compact domain ${domainId} while authored levels violate predecessor constraints:\n- ${validationErrors.join('\n- ')}`);
  }

  const nodes = primaryDomainNodes(graph, domainId);
  if (!nodes.length) throw new Error(`Domain ${domainId} has no primary concepts.`);
  const originalLevels = new Map((graph.nodes ?? []).map((node) => [node.id, node.level]));
  const levels = new Map(originalLevels);
  const editorialLowestLevel = Math.min(...nodes.map((node) => node.level));
  const editorialLowestNodeIds = nodes
    .filter((node) => node.level === editorialLowestLevel)
    .map((node) => node.id);
  const model = createLevelConstraintModel(graph);
  const steps = [];
  let stopped = null;

  while (true) {
    const gap = firstGap(nodes.map((node) => levels.get(node.id)), editorialLowestLevel);
    if (!gap) break;

    const sourceLevel = gap.nextOccupiedLevel;
    const targetLevel = sourceLevel - 1;
    const sourceNodes = nodes.filter((node) => levels.get(node.id) === sourceLevel);
    const movable = [];
    const blocked = [];
    for (const node of sourceNodes) {
      const blockers = levelLoweringBlockers(model, levels, node.id, targetLevel);
      if (blockers.length) blocked.push({ nodeId: node.id, blockers });
      else movable.push(node.id);
    }

    for (const nodeId of movable) levels.set(nodeId, targetLevel);
    const step = {
      gapLevel: gap.level,
      sourceLevel,
      targetLevel,
      candidateNodeIds: sourceNodes.map((node) => node.id),
      movedNodeIds: movable,
      blocked
    };
    steps.push(step);

    if (blocked.length) {
      stopped = step;
      break;
    }
  }

  const changes = nodes
    .map((node) => ({ id: node.id, current: originalLevels.get(node.id), expected: levels.get(node.id) }))
    .filter((change) => change.current !== change.expected)
    .sort((a, b) => a.current - b.current || a.id.localeCompare(b.id));

  return {
    domainId,
    domainLabel: graph.domains[domainId]?.label ?? domainId,
    editorialLowestLevel,
    editorialLowestNodeIds,
    levels,
    changes,
    steps,
    stopped
  };
}

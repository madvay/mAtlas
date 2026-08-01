import { loadSourceContent } from './content/load.mjs';
import { compactDomainLevels } from './content/level-compaction-model.mjs';
import { writeConceptLevels } from './content/write-levels.mjs';

function usage() {
  console.error('Usage: node scripts/levels-tool.mjs compact-domain <domain-id> [--write]');
  console.error('Without --write, the command performs a dry run and reports the proposed changes.');
}

function printBlocker(blocker) {
  if (blocker.kind === 'exact') {
    console.log(`      fixed at level ${blocker.level}: ${blocker.reason}`);
    return;
  }
  if (blocker.kind === 'floor') {
    console.log(`      floor ${blocker.level}: ${blocker.reason}`);
    return;
  }
  const { constraint } = blocker;
  console.log(`      ${constraint.predecessor} (${blocker.predecessorLevel}) --${constraint.edge.type} [${constraint.edge.id}, ${constraint.direction}]--> ${constraint.successor}; requires at least ${blocker.requiredLevel}`);
}

function printCompactDomainResult(result, wrote, changedFileCount) {
  const lowestNodes = result.editorialLowestNodeIds.join(', ');
  console.log(`${result.domainLabel} (${result.domainId}): kept editorial lowest level ${result.editorialLowestLevel} fixed (${lowestNodes}).`);
  for (const step of result.steps) {
    console.log(`- Gap at level ${step.gapLevel}: moved ${step.movedNodeIds.length}/${step.candidateNodeIds.length} concepts from ${step.sourceLevel} to ${step.targetLevel}.`);
  }

  if (!result.changes.length) {
    console.log('No removable empty levels were found, or the first move was blocked for every candidate.');
  } else {
    console.log(`${wrote ? 'Lowered' : 'Would lower'} ${result.changes.length} concept level${result.changes.length === 1 ? '' : 's'}${wrote ? ` in ${changedFileCount} YAML file${changedFileCount === 1 ? '' : 's'}` : ''}:`);
    for (const change of result.changes) console.log(`- ${change.id}: ${change.current} -> ${change.expected}`);
  }

  if (result.stopped) {
    console.log(`Stopped after the partial ${result.stopped.sourceLevel} -> ${result.stopped.targetLevel} move because ${result.stopped.blocked.length} concept${result.stopped.blocked.length === 1 ? '' : 's'} could not move without violating a predecessor constraint:`);
    for (const blocked of result.stopped.blocked) {
      console.log(`- ${blocked.nodeId}`);
      for (const blocker of blocked.blockers) printBlocker(blocker);
    }
  } else {
    console.log('Compaction reached the highest occupied primary-domain level without encountering a partial move.');
  }

  if (!wrote && result.changes.length) console.log('Dry run only; pass --write to update the YAML level scalars.');
}

const rawArgs = process.argv.slice(2);
const write = rawArgs.includes('--write');
const args = rawArgs.filter((argument) => argument !== '--write');
const mode = args.shift();

if (mode !== 'compact-domain' || args.length !== 1) {
  usage();
  process.exit(2);
}

const domainId = args[0];
const content = await loadSourceContent();
const result = compactDomainLevels(content.graph, domainId);
let changedFiles = [];
if (write && result.changes.length) {
  changedFiles = await writeConceptLevels(
    content,
    new Map(result.changes.map((change) => [change.id, change.expected]))
  );
}
printCompactDomainResult(result, write, changedFiles.length);

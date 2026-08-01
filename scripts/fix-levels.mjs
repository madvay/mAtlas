import { readFile, writeFile } from 'node:fs/promises';
import { isMap, isSeq, parseDocument } from 'yaml';
import { loadSourceContent } from './content/load.mjs';
import {
  authoredLevelErrors,
  computeMinimumLevels,
  computeMonotonicLevels,
  forcingChain
} from './content/level-model.mjs';

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');
const minimumReport = process.argv.includes('--minimum-report');
const showAll = process.argv.includes('--all');
if ([write, check, minimumReport].filter(Boolean).length !== 1) {
  console.error('Usage: node scripts/fix-levels.mjs (--write | --check | --minimum-report) [--all]');
  process.exit(2);
}

const content = await loadSourceContent();

if (check) {
  const errors = authoredLevelErrors(content.graph);
  if (errors.length) {
    console.error(`${errors.length} authored concept level${errors.length === 1 ? '' : 's'} violate the strict predecessor model:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  const levels = content.graph.nodes.map((node) => node.level);
  console.log(`All ${content.graph.nodes.length} authored concept levels satisfy the strict predecessor model (range ${Math.min(...levels)}–${Math.max(...levels)}).`);
  process.exit(0);
}

if (minimumReport) {
  const minimum = computeMinimumLevels(content.graph);
  const rows = content.graph.nodes.map((node) => {
    const field = node.primaryField ?? content.graph.domains?.[node.primaryDomain]?.field ?? 'unknown';
    const minimumLevel = minimum.get(node.id);
    return {
      id: node.id,
      field,
      authored: node.level,
      minimum: minimumLevel,
      slack: node.level - minimumLevel
    };
  });
  const fields = [...new Set(rows.map((row) => row.field))].sort();
  console.log('Editorial slack above the minimum strict-predecessor rank:');
  for (const field of fields) {
    const fieldRows = rows.filter((row) => row.field === field);
    const positive = fieldRows.filter((row) => row.slack > 0);
    const negative = fieldRows.filter((row) => row.slack < 0);
    const total = positive.reduce((sum, row) => sum + row.slack, 0);
    const maximum = Math.max(0, ...positive.map((row) => row.slack));
    console.log(`- ${field}: ${positive.length}/${fieldRows.length} nodes above minimum, total slack ${total}, maximum ${maximum}${negative.length ? `, ${negative.length} invalid below minimum` : ''}`);
  }
  const sorted = rows
    .filter((row) => row.slack !== 0)
    .sort((a, b) => b.slack - a.slack || a.field.localeCompare(b.field) || a.id.localeCompare(b.id));
  const visible = showAll ? sorted : sorted.slice(0, 50);
  if (visible.length) {
    console.log('\nslack\tauthored\tminimum\tfield\tconcept');
    for (const row of visible) console.log(`${row.slack}\t${row.authored}\t${row.minimum}\t${row.field}\t${row.id}`);
  }
  if (!showAll && sorted.length > visible.length) {
    console.log(`\nShowing 50 of ${sorted.length} nonzero-slack nodes. Pass --all to show every row.`);
  }
  process.exit(rows.some((row) => row.slack < 0) ? 1 : 0);
}

const projection = computeMonotonicLevels(content.graph);
const changes = content.graph.nodes
  .filter((node) => projection.levels.get(node.id) !== node.level)
  .map((node) => ({ id: node.id, current: node.level, expected: projection.levels.get(node.id) }))
  .sort((a, b) => a.id.localeCompare(b.id));
const changedIds = new Set(changes.map((change) => change.id));
const changedFiles = [];
const conceptRoot = new URL('../content/concepts/', import.meta.url);

for (const domainId of content.graph.meta.domainOrder) {
  const fieldId = content.graph.domains[domainId]?.field;
  const fileUrl = new URL(`${fieldId}/${domainId}.yaml`, conceptRoot);
  const source = await readFile(fileUrl, 'utf8');
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length) throw document.errors[0];
  const nodes = document.get('nodes', true);
  if (!isSeq(nodes)) throw new Error(`${fileUrl.pathname} must contain a nodes sequence.`);
  const replacements = [];
  for (const item of nodes.items) {
    if (!isMap(item)) throw new Error(`${fileUrl.pathname} contains a non-map node entry.`);
    const id = item.get('id');
    if (!changedIds.has(id)) continue;
    const levelNode = item.get('level', true);
    if (!levelNode?.range) throw new Error(`${fileUrl.pathname} node ${String(id)} has no replaceable level scalar.`);
    replacements.push({
      start: levelNode.range[0],
      end: levelNode.range[1],
      text: String(projection.levels.get(id))
    });
  }
  if (!replacements.length) continue;
  changedFiles.push(fileUrl);
  let output = source;
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  await writeFile(fileUrl, output);
}

if (!changes.length) {
  console.log(`No concept levels required repair; all ${content.graph.nodes.length} authored levels already satisfy the strict predecessor model.`);
  process.exit(0);
}

console.log(`Raised ${changes.length} concept level${changes.length === 1 ? '' : 's'} in ${changedFiles.length} YAML file${changedFiles.length === 1 ? '' : 's'}; no authored level was lowered.`);
for (const change of changes) {
  console.log(`- ${change.id}: ${change.current} -> ${change.expected}`);
  for (const step of forcingChain(projection, change.id)) {
    if (step.kind === 'floor') {
      console.log(`    floor ${step.level}: ${step.reason}`);
    } else {
      console.log(`    ${step.sourceId} (${step.sourceLevel}) --${step.edge.type} [${step.edge.id}]--> ${step.targetId} (${step.targetLevel})`);
    }
  }
}

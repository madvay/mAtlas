import { readFile, writeFile } from 'node:fs/promises';
import { isMap, isSeq, parseDocument } from 'yaml';

/** Replace only existing numeric level scalars in concept-domain YAML files. */
export async function writeConceptLevels(content, changedLevels) {
  if (!(changedLevels instanceof Map)) throw new Error('writeConceptLevels requires a Map of node ids to levels.');
  if (!changedLevels.size) return [];

  const changedFiles = [];
  const conceptRoot = new URL('../../content/concepts/', import.meta.url);
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
      if (!changedLevels.has(id)) continue;
      const levelNode = item.get('level', true);
      if (!levelNode?.range) throw new Error(`${fileUrl.pathname} node ${String(id)} has no replaceable level scalar.`);
      replacements.push({
        start: levelNode.range[0],
        end: levelNode.range[1],
        text: String(changedLevels.get(id))
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
  return changedFiles;
}

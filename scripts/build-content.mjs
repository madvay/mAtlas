import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { COMPILED_CONTENT_FILES, CONTENT_BUILD_FORMAT_VERSION } from './content/contract.mjs';
import { loadSourceContent } from './content/load.mjs';
import { compiledContentDirectory } from './content/paths.mjs';
import { validateContent, validationSummary } from './content/validate.mjs';

const digest = (contents) => createHash('sha256').update(contents).digest('hex');
const normalizeJson = (value) => Buffer.from(JSON.stringify(value));

const content = await loadSourceContent();
const failures = validateContent(content).flatMap((result) => result.errors.map((error) => `[${result.name}] ${error}`));
if (failures.length) {
  console.error(`Content compilation stopped with ${failures.length} validation error${failures.length === 1 ? '' : 's'}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const graphBytes = normalizeJson(content.graph);
const schemaBytes = normalizeJson(content.schema);
const viewsBytes = normalizeJson(content.viewsData);
const shareCodecBytes = normalizeJson(content.shareCodec);
const removedDomainsBytes = normalizeJson(content.removedDomains);
const provenance = {
  formatVersion: CONTENT_BUILD_FORMAT_VERSION,
  schemaVersion: content.manifest.schemaVersion,
  contentVersion: content.manifest.contentVersion,
  license: {
    name: 'Creative Commons Attribution-ShareAlike 4.0 International',
    identifier: 'CC-BY-SA-4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: content.graph.meta.attribution
  },
  source: {
    manifest: { path: 'content/manifest.json', sha256: digest(content.manifestBytes) },
    graph: { path: `content/${content.manifest.files.graph}`, sha256: digest(content.graphBytes) },
    schema: { path: `content/${content.manifest.files.schema}`, sha256: digest(content.schemaBytes) },
    views: { path: `content/${content.manifest.files.views}`, sha256: digest(content.viewsBytes) },
    shareCodec: { path: `content/${content.manifest.files.shareCodec}`, sha256: digest(content.shareCodecBytes) }
  },
  compiled: {
    graph: { file: COMPILED_CONTENT_FILES.graph, sha256: digest(graphBytes) },
    schema: { file: COMPILED_CONTENT_FILES.schema, sha256: digest(schemaBytes) },
    views: { file: COMPILED_CONTENT_FILES.views, sha256: digest(viewsBytes) },
    shareCodec: { file: COMPILED_CONTENT_FILES.shareCodec, sha256: digest(shareCodecBytes) },
    removedDomains: { file: COMPILED_CONTENT_FILES.removedDomains, sha256: digest(removedDomainsBytes) }
  }
};
const provenanceBytes = normalizeJson(provenance);

const targetPath = fileURLToPath(compiledContentDirectory);
const temporaryPath = `${targetPath.slice(0, -1)}.tmp-${process.pid}/`;
await rm(temporaryPath, { recursive: true, force: true });
await mkdir(temporaryPath, { recursive: true });
await Promise.all([
  writeFile(new URL(COMPILED_CONTENT_FILES.graph, `file://${temporaryPath}`), graphBytes),
  writeFile(new URL(COMPILED_CONTENT_FILES.schema, `file://${temporaryPath}`), schemaBytes),
  writeFile(new URL(COMPILED_CONTENT_FILES.views, `file://${temporaryPath}`), viewsBytes),
  writeFile(new URL(COMPILED_CONTENT_FILES.shareCodec, `file://${temporaryPath}`), shareCodecBytes),
  writeFile(new URL(COMPILED_CONTENT_FILES.removedDomains, `file://${temporaryPath}`), removedDomainsBytes),
  writeFile(new URL(COMPILED_CONTENT_FILES.provenance, `file://${temporaryPath}`), provenanceBytes)
]);
await rm(compiledContentDirectory, { recursive: true, force: true });
await rename(temporaryPath, targetPath);
console.log(`Compiled ${validationSummary(content)} to .build/content/ (schema ${content.manifest.schemaVersion}, content ${content.manifest.contentVersion}).`);

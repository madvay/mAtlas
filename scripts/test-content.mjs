import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { COMPILED_CONTENT_FILES, SUPPORTED_SCHEMA_VERSIONS } from './content/contract.mjs';
import { compiledContentDirectory } from './content/paths.mjs';
import { loadSourceContent } from './content/load.mjs';

const digest = (contents) => createHash('sha256').update(contents).digest('hex');
const source = await loadSourceContent();
const [graphBytes, schemaBytes, viewsBytes, shareCodecBytes, removedDomainsBytes, provenanceBytes] = await Promise.all([
  readFile(new URL(COMPILED_CONTENT_FILES.graph, compiledContentDirectory)),
  readFile(new URL(COMPILED_CONTENT_FILES.schema, compiledContentDirectory)),
  readFile(new URL(COMPILED_CONTENT_FILES.views, compiledContentDirectory)),
  readFile(new URL(COMPILED_CONTENT_FILES.shareCodec, compiledContentDirectory)),
  readFile(new URL(COMPILED_CONTENT_FILES.removedDomains, compiledContentDirectory)),
  readFile(new URL(COMPILED_CONTENT_FILES.provenance, compiledContentDirectory))
]);
const graph = JSON.parse(graphBytes);
const schema = JSON.parse(schemaBytes);
const views = JSON.parse(viewsBytes);
const shareCodec = JSON.parse(shareCodecBytes);
const removedDomains = JSON.parse(removedDomainsBytes);
const provenance = JSON.parse(provenanceBytes);

assert.deepEqual(graph, source.graph, 'compiled graph must preserve source content');
assert.deepEqual(schema, source.schema, 'compiled schema must preserve source content');
assert.deepEqual(views, source.viewsData, 'compiled views must preserve source content');
assert.deepEqual(shareCodec, source.shareCodec, 'compiled share codec must preserve source content');
assert.deepEqual(removedDomains, source.removedDomains, 'compiled removed-domain redirects must preserve source content');
assert.deepEqual(source.removedDomains, [{ id: 'foundation', path: 'math/foundation', redirectTo: '/math/' }]);
assert.equal(source.graph.domains.foundation, undefined, 'Foundation must not remain an active domain.');
assert.ok(source.graph.nodes.every((node) => node.primaryDomain !== 'foundation' && !node.domains.includes('foundation')), 'No node may retain the removed Foundation domain.');
assert.ok(source.viewsData.views.every((view) => !(view.settings.domains ?? []).includes('foundation') && !(view.settings.excludedDomains ?? []).includes('foundation') && !(view.settings.prohibitedDomains ?? []).includes('foundation')), 'No view may retain the removed Foundation domain.');
assert.equal(provenance.schemaVersion, source.manifest.schemaVersion);
assert.equal(provenance.contentVersion, source.manifest.contentVersion);
assert.ok(SUPPORTED_SCHEMA_VERSIONS.has(provenance.schemaVersion));
assert.equal(provenance.compiled.graph.sha256, digest(graphBytes));
assert.equal(provenance.compiled.schema.sha256, digest(schemaBytes));
assert.equal(provenance.compiled.views.sha256, digest(viewsBytes));
assert.equal(provenance.compiled.shareCodec.sha256, digest(shareCodecBytes));
assert.equal(provenance.compiled.removedDomains.sha256, digest(removedDomainsBytes));
assert.equal(provenance.license.identifier, 'CC-BY-SA-4.0');
const removedChemistryDomains = new Set([
  'materials-polymer-chemistry',
  'biochemistry-chemical-biology',
  'environmental-atmospheric-chemistry',
  'industrial-process-chemistry'
]);
const liveCodecDomains = new Set(shareCodec.domains.flatMap((slot) => slot.id ? [slot.id] : []));
for (const domainId of removedChemistryDomains) {
  assert.equal(liveCodecDomains.has(domainId), false, `removed domain ${domainId} must not remain in the compiled share codec`);
}
assert.deepEqual(Object.keys(shareCodec).sort(), ['domains', 'edgeTypes', 'fields', 'formatVersion']);
assert.equal('booleans' in shareCodec, false, 'display Boolean settings must not live in the compiled share codec');
assert.equal('enums' in shareCodec, false, 'display enum settings must not live in the compiled share codec');
console.log('Verified the compiled content boundary, versions, hashes, license provenance, and share-codec catalog.');

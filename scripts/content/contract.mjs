export const CONTENT_BUILD_FORMAT_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS = new Set(['2.0.0']);
export const COMPILED_CONTENT_FILES = Object.freeze({
  graph: 'atlas.json',
  schema: 'schema.json',
  views: 'views.json',
  shareCodec: 'share-codec.json',
  provenance: 'provenance.json',
  removedDomains: 'removed-domains.json'
});

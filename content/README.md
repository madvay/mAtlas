# mAtlas content source

This directory is the editable source product for the mAtlas knowledge graph and
its editorial navigation. Application and publishing code must not read these
files directly. Run `npm run levels:fix` after changing selected predecessor relations,
then run `npm run content:build` to validate and compile the source into the stable
`.build/content/` contract consumed by the renderer, page generators, and tests.

## Source files

- `concepts/index.yaml`, `concepts/sources.yaml`, and `concepts/<field-id>/<domain-id>.yaml` — split canonical graph, taxonomy, relations, citations, and source metadata. Each edge type independently declares `prerequisiteTraversal` for the dimmed prerequisite closure: `incoming` follows an edge from target to source, `outgoing` follows it from source to target, `both` follows it in either direction, and `none` excludes the edge type from that closure. It also declares `enforcePredecessorLevel` for level constraints: `incoming` requires the declared source to be a lower-level predecessor of the target, `outgoing` requires the declared target to be a lower-level predecessor of the source, and `none` imposes no predecessor-level constraint. The current catalog intentionally aligns many of these values, but the two properties control separate mechanisms. The index-level `levelPolicy` declares the global and primary-field minima. `removedDomains` entries preserve retired domain URLs as build-generated redirects without exposing them in runtime graph JSON.
- `views/index.yaml` and `views/*.yaml` — split curated Story/View object definitions and editorial narratives.
- `share-codec.yaml` — append-only permanent wire-slot registry for the compact `filter=` token only. It contains fields, domains, and edge types; display flags and enums live in software. Never reorder, delete, or reuse its slots; retire identifiers in place.
- `schema.json` — machine-readable graph schema published with the content.
- `manifest.json` — content and schema contract versions plus source file mapping.

## Versioning

`manifest.json` declares two independent versions:

- `schemaVersion` changes according to semantic versioning when the data contract changes.
- `contentVersion` identifies a release of the knowledge and editorial content.

The software-side compatibility declaration lives in
`scripts/content/contract.mjs`. A build fails when this content requests an
unsupported schema version.

## Validation and compilation

```bash
npm run validate:content
npm run content:build
npm run test:content
```

Validation is split into schema/shape, share-codec, reference, semantic, editorial, Chemistry-integrity, and
renderer-compatibility layers. Semantic validation permits editorial spacing but requires every edge configured by `enforcePredecessorLevel` to satisfy its predecessor-level constraint. Raw levels are compared within one vertical band; an edge from an earlier band to a later band is already ordered by `layout.yaml`; and a reverse-band predecessor constraint is rejected instead of being "repaired" by unrelated raw-level changes. Validation also enforces the YAML-declared editorial minima and rejects cycles among same-band predecessor constraints. The Chemistry layer enforces source diversity, evidence-edge orientation, shared-node ownership, and graph-connectivity floors. Compilation writes normalized files, including `share-codec.json`, and a
hash-based `provenance.json` plus build-only `removed-domains.json` to `.build/content/`. Published hashed JSON files
are produced only from that compiled directory and are served under the public
`/content/` namespace; `/data/` is not emitted. YAML sources are assembled into
intermediate JSON during content compilation so the deployed contract remains
the same.

## License

The files in this directory and their compiled or published content derivatives
are licensed under CC BY-SA 4.0. See [LICENSE](LICENSE), the repository
[LICENSE](../LICENSE), and [NOTICE](../NOTICE). Software outside this directory
is licensed under Apache License 2.0 unless otherwise noted.

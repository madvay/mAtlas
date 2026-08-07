# Atlas of Fundamental Concepts (mAtlas)

[![Deploy GitHub Pages](https://github.com/madvay/mAtlas/actions/workflows/pages.yml/badge.svg)](https://github.com/madvay/mAtlas/actions/workflows/pages.yml) 

## https://atlas.madvay.com/
An interactive, source-backed graph connecting concepts across fields of knowledge, combining mathematics, physics, and chemistry. The atlas is designed to support both human exploration and machine consumption. It is built from a single canonical graph dataset with a unified schema, rather than a collection of isolated applications.

The atlas is one graph rather than a collection of isolated applications. Fields overlap on one global vertical scale, while domains occupy horizontal lanes that may be deliberately adjacent across fields; justified cross-field relations connect the resulting structure.

## Public routes

- `/` — global atlas
- `/math/` — mathematics scope
- `/physics/` — physics scope
- `/chemistry/` — chemistry scope
- `/concepts/<id>/` — canonical concept pages with complete static records, typed direct relations, citations, stable relation fragments, and an interactive-graph entry point
- `/concepts/` — HTML/JavaScript compatibility redirect to `/directory/`
- `/views/` — static directory of curated stories and views
- `/views/<id>/` — a static, crawlable Story/View route that opens the interactive atlas with the preset applied
- `/content/atlas.<hash>.json` — content-addressed canonical graph export for the current build
- `/content/schema.<hash>.json` — published graph JSON Schema
- `/content/views.<hash>.json` — content-addressed Story/View definitions for the current build
- `/content/provenance.<hash>.json` — content/schema versions, source paths, SHA-256 hashes, license, and attribution
- `/data/` — indexable dataset landing page with `Dataset`/`DataDownload` JSON-LD and AI-use guidance
- `/data/latest/manifest.json` — current dataset manifest with SHA-256 digests and explicit latest-only retention policy
- `/data/latest/atlas.json` — stable alias for the canonical graph JSON
- `/data/latest/schema.json`, `/data/latest/views.json`, `/data/latest/share-codec.json`, `/data/latest/provenance.json` — stable aliases for the remaining machine-readable artifacts
- `/data/latest/concepts/<id>.json` and `/data/latest/concepts/<id>/relations.json` — small canonical concept and direct-relation records for deterministic retrieval
- `/data/latest/domains/<id>.json` and `/data/latest/relation-types/<id>.json` — small taxonomy and relation-policy records
- `/data/latest/concepts.ndjson`, `/relations.ndjson`, `/sources.ndjson`, `/domains.ndjson`, `/fields.ndjson`, `/relation-types.ndjson` — streamable self-identifying records with content version, license, and attribution metadata
- `/data/latest/matlas.sqlite` — a no-server SQLite export with indexed normalized tables and the canonical graph payload
- `/data/latest/matlas.jsonld` and `/data/latest/matlas.ttl` — secondary RDF/JSON-LD and Turtle graph representations with stable relation vocabulary URLs
- `/vocab/` and `/vocab/relation/<type-id>/` — dereferenceable human/Markdown/JSON-LD definitions for every relation-type URL used by RDF exports
- `/ai/` — static AI integration landing page
- `/ai/sdk/matlas.py` and `/ai/sdk/matlas.mjs` — zero-dependency deterministic Python and ESM graph libraries
- `/ai/matlas-ai-bundle.zip` — uploadable local-agent bundle: data, SDKs, Agent Skill, examples, citation metadata, and license texts
- `/ai/skills/matlas/SKILL.md` — portable Agent Skill instructions with scripts and references
- `/ai/workbench/` — browser-local accessible graph workbench with visible JSON output and progressive WebMCP registration where supported
- `/openapi.json` — static GET-only description of the predictable generated records; it is not a dynamic query API
- `/CITATION.cff`, `/citation.json`, and `/ai/citation-guide.md` — citation metadata and source-chain guidance
- `/CONTENT_LICENSE` — content-specific CC BY-SA 4.0 notice
- `/guide/` — static user guide for new and power users, with real, build-validated permalinks into atlas content and application states
- `/directory/` — static semantic atlas directory with the exact all-in SVG transcluded, crawlable concept links, relation definitions, structured data, and atlas context
- `/static/atlas.svg` — stable standalone all-in SVG export containing every field, domain, concept, junction, and relation
- `/static/concepts/<id>.svg` and `.png` — 900×900 light-theme concept-centered graph images generated for publication builds
- `/llms.txt` — concise AI routing and citation guidance
- `/llms-context.txt` and `/llms-context-full.txt` — generated AI context documents with respectively concept summaries and complete direct relation records
- `index.html.md` beside each major generated HTML page — machine-clean Markdown equivalents, including every canonical concept, field, domain, Story/View, the guide, and the directory

The application reads content-addressed JSON under `/content/`. `/data/latest/` is a separate public integration contract for the current publication only: its files are replaced on each GitHub Pages deployment, and its manifest provides the current content version and hashes. Save the manifest and downloaded artifacts when reproducibility requires a retained snapshot. Agents that need arbitrary graph computation use the bundled local SDKs, SQLite, or browser workbench; a static host cannot provide a remote arbitrary-query API or hosted MCP server.

## Requirements and setup

- Node.js 20 or newer
- npm
- No system browser is required: the pinned Puppeteer development dependency installs the Chromium build used for the all-in SVG export.

```bash
npm install
npm run dev
```

`npm run dev` rebuilds when files under `src/` or `content/` change and serves the result at `http://localhost:4173` by default.

## Build and checks

```bash
npm run validate:content
npm run content:build
npm run test:content
npm run typecheck
npm test
```

`npm run content:build` validates editable source under `content/` and atomically writes the normalized renderer/publisher contract to `.build/content/`. The compiled contract contains `atlas.json`, `schema.json`, `views.json`, `share-codec.json`, and `provenance.json`. Application code, page generators, and tests consume only this compiled boundary.

`npm run build` first rebuilds that content contract, then writes the publishable static site to `dist/`, including the stable `/static/atlas.svg` all-in export, `/directory/` semantic atlas directory, `/guide/` user guide, `/data/` latest-only data exports, per-record JSON, NDJSON, SQLite, RDF/JSON-LD, Turtle, deterministic Python/ESM SDKs, an uploadable AI bundle, an Agent Skill, a local accessible workbench, a static OpenAPI description, citation metadata, Markdown equivalents, and generated AI context files. The build opens the compiled application in headless Chrome/Chromium with every filter enabled and invokes the same `SvgExporter.serializeVisible()` implementation used by the runtime download button; there is no separate SVG renderer. The generated HTML page removes only the standalone XML declaration and transcludes the resulting SVG element byte-for-byte, while adding ordinary HTML concept links, field/domain context, a relation legend, `WebPage`/`ImageObject` structured data, and links to the interactive and machine-readable forms. `npm run build:pages` copies that output unchanged to `.pages/` for GitHub Pages.

Concept-centered images are opt-in for local builds because the complete set is comparatively expensive and adds roughly two files per concept. Run `MATLAS_GENERATE_CONCEPT_IMAGES=1 npm run build` to generate a self-contained 900×900 SVG and a PNG rasterized from that SVG under `/static/concepts/`, add the images to concept pages and structured metadata, and associate the PNGs with concept URLs in the image sitemap. The GitHub Pages workflow enables this variable. Without it, concept pages and all other outputs still build normally without concept-image references. Static SVG/PNG generation reports a progress bar in terminals and periodic percentage updates in CI logs.

Validation is split into schema/shape, share-codec, reference, semantic, editorial, Chemistry-integrity, and renderer-compatibility layers. The complete validator checks contract versions, field/domain membership, node and edge references, citations and source URLs, construction-junction consistency, strict-predecessor level monotonicity and cycles, duplicate relations, source usage, generic detail sections, explicit inline-math markup, every view object's identifiers and settings, Chemistry evidence orientation, shared-node ownership, and minimum cross-domain and cross-field connectivity.

## Additional scripts

- `npm run clean` removes generated build artifacts such as `.build/`, `dist/`, and `.pages/`.
- `npm run validate:content:<layer>` runs one validation layer (`schema`, `share-codec`, `references`, `semantic`, `editorial`, `chemistry`, or `renderer`).
- `npm run test:content` compiles the content contract and verifies normalized output, versions, hashes, and license provenance.
- `npm run preview` serves the contents of `dist/` locally for review after building.
- `npm run benchmark:renderer -- <options>` runs the repeatable Puppeteer renderer benchmark documented in [`docs/renderer-performance-benchmark.md`](docs/renderer-performance-benchmark.md), including selection-interaction scenarios and explicit `--markers on|off` control.
- `npm run math:mark` helps migrate legacy unmarked math to explicit `$...$` delimiters; its changes require editorial review.

## Architecture

```text
content/
  concepts/                 split editable graph dataset (YAML)
  views/                    split Story/View object definitions (YAML)
  share-codec.yaml          append-only filter-token wire registry
  schema.json                published graph schema
  manifest.json              content and schema contract versions
  LICENSE                    content-specific CC BY-SA notice
src/
  index.html                 shared application shell
  styles.css                 application, graph, and field-band styling
  main.ts                    graph renderer, routing, state, details, and SVG export
  types.ts                   graph and application types
  ai/                         shared deterministic graph operations, SDK entry point, Python SDK, and browser workbench
scripts/
  build-content.mjs          validates and compiles content into .build/content/
  validate-content.mjs       layered content validation entry point
  content/                   contract, loader, and validation modules
  build.mjs                  bundles software, publishes compiled content, and assembles dist/
  generate-concept-pages.mjs canonical concept pages, the /concepts/ redirect, and field-scope pages
  generate-view-pages.mjs    view directory and crawlable view routes
  generate-static-atlas-svg.mjs
                              invokes the compiled runtime SVG exporter for /static/atlas.svg
  generate-directory-page.mjs
                              transcludes that exact SVG into the semantic /directory/ page
  generate-data-publication.mjs
                              publishes latest-only data, per-record JSON, NDJSON, SQLite, RDF, and a dataset manifest
  generate-machine-artifacts.mjs
                              derives normalized/local-agent data artifacts and record endpoints from compiled graph content
  generate-matlas-sqlite.py  creates the dependency-free SQLite distribution
  generate-ai-publication.mjs
                              publishes SDKs, AI bundle, Agent Skill, workbench, citation metadata, and static OpenAPI
  zip-archive.mjs            deterministic ZIP writer used for the AI bundle
  generate-markdown-pages.mjs
                              creates Markdown counterparts for major static pages
  generate-seo-assets.mjs    sitemap, robots.txt, llms.txt, and expanded AI context documents
  matlas-render-benchmark.mjs repeatable before/after renderer performance benchmark
  prepare-pages.mjs          root-level GitHub Pages artifact
.build/content/              generated, normalized build contract; never edited directly
```

`content/concepts/index.yaml` (plus split parts under `content/concepts/`) is the canonical graph dataset. `content/views/index.yaml` (plus per-view files under `content/views/`) is a separate editorial/navigation layer: it references graph identifiers but does not duplicate or alter graph content. `content/share-codec.yaml` is the append-only registry that assigns permanent `filter=` wire slots only to fields, domains, and edge types. Display flags and enums are deliberately software-owned and use a separate append-only registry in `src/state/display-token.ts`. `content/manifest.json` declares `schemaVersion` and `contentVersion`; `scripts/content/contract.mjs` declares the schema versions supported by the software. The renderer and publishers read only `.build/content/`, so a later extraction of `content/` into a separately versioned repository does not require an application rewrite.

### Taxonomy

Each domain belongs to one field. Each concept declares:

- `primaryField` and `fields`
- `primaryDomain` and `domains`
- `conceptType`
- `level`, an authored vertical placement that may include editorial spacing but must remain strictly above selected predecessors
- common descriptive fields and optional generic `sections`

Existing mathematics concepts inherit the mathematics field through their domains. Physics and Chemistry concepts use the generalized detail-section model so theories, laws, fields, particles, substances, systems, processes, states, measurements, and phenomena can coexist without forcing them into the mathematics-specific carrier/data/axiom schema.

A concept may belong to several fields. Boundary entities and frameworks—including atoms, ions, molecules, bonds, isotopes, quantum mechanics, spectroscopy, thermodynamics, and crystalline solids—remain single Physics-primary nodes with added Chemistry field and domain memberships. Chemistry-primary concepts represent genuinely chemical organizations, models, measurements, and practices rather than duplicating those entities.

Chemistry's domain order is a stable navigation and lane order, not a claim that each domain derives from the prior one. Chemical foundations, atomic periodicity, and molecular bonding align with atomic and molecular physics; thermodynamic, solution/interfacial, kinetic, and quantum/spectroscopic frameworks overlap as peer cores; inorganic, organic, analytical, electrochemical, and radiochemical work form overlapping branch layers. Historical experiments retain their substantive primary domain and also belong to `chemistry-experiments-evidence`. Layered-layout coordinates and cross-field vertical bands are authored in `content/layout.yaml`, validated during content compilation, and loaded into the graph rather than encoded in the renderer.

### Relations

Each edge type declares how it participates in prerequisite closure. `incoming` means the source is added when the target is already in the closure, `outgoing` means the target is added when the source is already in the closure, and `both` permits either traversal. This metadata is the single definition used by filtering and breadth-first layout root selection.

The original mathematical relation types remain. The multi-field model adds relation types for:

- mathematical formulation
- framework specialization
- quantization
- theory components
- description or governance
- composition
- classification
- field excitation
- interaction mediation
- binding or formation
- limiting approximations
- state descriptions
- transformations and processes

Relations are not treated as one undifferentiated “built from” ordering. This is essential in physics and chemistry: special relativity and quantum mechanics jointly constrain relativistic QFT, while chemical classifications, state descriptions, mechanisms, transformations, measurements, and model realizations carry distinct claims. Classical limits are marked as approximations rather than derivations, and an experimental edge records scoped evidence rather than proof.

`npm run levels:fix` raises only concept levels that violate the strict predecessor relation or a hard editorial floor; it never lowers ordinary authored levels. `npm run levels:check` validates the same constraints, and `npm run levels:minimum-report` reports each concept's slack above the minimum permitted rank. The selected relation uses add-data, impose-axiom, compatible combination, framework specialization, quantization, composition, classification, limiting/effective/model descriptions, emergence, and state/property description. Set is fixed as the sole global minimum; Physical system and Physical theory are the Physics minima; Matter in chemistry is the Chemistry-primary minimum. Other edge types do not impose vertical order.

## User interface and URL state

The left panel contains collapsible field/domain, edge, display, preferences, and data sections. Layered/Compact can be changed either from the toolbar toggle or from the equivalent Display selector. The Display section also contains a **Cross-field links** option:

- `contextual` — show designated overview bridges and reveal local bridges for the selected neighborhood
- `all` — show all admitted cross-field relations
- `hidden` — suppress cross-field relations and their external prerequisite context

The toolbar and each concept Details header expose a unified **Concept Compare** workspace. Its **Overview** tab presents two concepts side by side and derives their direct directed relations, shared adjacent concepts, relation-type profile, shared taxonomy, and shared source records from the authored graph. Its **Connections** tab finds up to three short, deterministic, loopless paths through the currently visible graph, preserves whether each step follows or opposes the authored arrow, fits the selected path, and can copy a Story-ready YAML `nodeSequence`. Both analyses share the same A/B pair and update immediately when relation or visibility filters change.

A complete pair is stored as `compare=<left-id>,<right-id>`. Connection analysis adds `compareMode=connections`, optional `compareDirection=forward`, and optional `comparePath=<zero-based-index>`. These parameters coexist with selection, `filter=`, `disp=`, and Story/View routes.

Bookmarkable state is split between two independently versioned, unpadded Base64URL parameters. `filter=` contains fields, domains, edge types, field/domain exclusions, and prohibited domains using the content-owned append-only registry. Prohibited domains are stored in a length-delimited extension record, so older format-1 decoders can skip the record and newer decoders can retain the permanent domain-slot meanings. `disp=` contains cross-field visibility, display flags, and layout using the software-owned append-only registry. Neither token includes a checksum. Either token may appear alone; the missing half uses the applicable route, view, or application defaults. Legacy explicit query parameters remain readable when neither compact parameter is present and are replaced with both compact parameters on the next location sync. Performance and rendering preferences (resolution, transitions, motion blur, graph animation/refitting, and secondary-domain indicators) are instead restored from local storage and can be reset from the Preferences section; they are never added to URLs.
The defaults enable native-resolution rendering, transitions, automatic refitting, and secondary-domain indicators while disabling graph animation and motion blur. Graph labels and exported SVGs always use lightweight Unicode math rather than KaTeX overlays.

Fields and domains can also be marked **excluded** without clearing the ordinary inclusion filters. Exclusions suppress concepts whose primary field/domain is excluded, including prerequisite-only context, while still allowing a multi-domain concept through when it has an explicitly included, non-excluded secondary domain. Domain suppression is tri-state: allowed, excluded, and **prohibited**. Prohibition always hides concepts whose primary domain is prohibited, including through secondary memberships and prerequisite closure. Exclusions and prohibitions are encoded in `filter=`, while the Display section's **Hide prerequisites** option is encoded in `disp=`; all remain supported by Story/View settings. Local preferences additionally control graph edge-label rendering, whether edges disappear during viewport gestures, and whether prerequisite context is dimmed; these preferences also apply to SVG exports where relevant.

The scoped routes initialize their corresponding field while using the same graph and codebase. Canonical concept URLs are field-independent so a multi-field concept has one durable identity.

### Stories and views

A view object is a named preset in `content/views/index.yaml`, with one YAML file per object under `content/views/`. Publicly, an object without `nodeSequence` is a **View**; one with a nonempty `nodeSequence` is a **Story**. Each object contains editorial copy (`title`, `summary`, `narrative`, and `tags`), an optional image, an edge-type set and display settings, plus exactly one graph scope: either `settings.fields`/`settings.domains` or a `coreNodes` set. For a core-node Story, `nodeSequence` must be a subset of `coreNodes`.

For a Story, the first sequence node is the initial selection. Previous and Next controls advance through the ordered concepts on desktop and mobile; selecting anything else leaves the sequence position unchanged. Sequence nodes receive numbered graph badges, including in SVG exports. A Story or View remains active when its filter/display state changes, with differences encoded as `filter=` and `disp=` URL overrides; it exits only when its required sequence/core nodes would no longer be visible, or when the user explicitly exits it. Core-node objects replace the taxonomy tree with controls for leaving the object directly or converting its scope to the union of the core nodes’ primary domains. The build emits a static directory page and one crawlable application page per object. Routes are included in `sitemap.xml` and represented as `CollectionPage` JSON-LD. In the application, the **Stories & Views** toolbar control opens the same data-driven catalog, while a dismissible first-visit prompt makes the feature discoverable without permanently occupying graph space.

A `/views/<id>/` URL remains active while every required sequence/core node survives the non-prerequisite visibility policy. Selecting concepts, highlighting neighborhoods, searching, and opening details do not leave the route. Filter and display differences are written as independent `filter=` and `disp=` overrides on that route. Browser history restores both the object and its overrides.

The optional **Hide isolates** display state removes nodes with no edge admitted by the current complete visibility policy; it is included in `disp=`.

## Inline mathematics

Math-capable strings use explicit `$...$` LaTeX delimiters in source content:

```json
"body": "Its gauge group is $SU(3)_C \\times SU(2)_L \\times U(1)_Y$."
```

The browser escapes prose and sends only delimited formulas to KaTeX. `npm run math:mark` remains a migration aid for older unmarked text; its changes require editorial review.

## GitHub Pages

`.github/workflows/pages.yml` installs locked dependencies with `npm ci`, runs the complete `npm test` pipeline, prepares `.pages/`, and deploys it. The artifact places the complete atlas at its root, including `/math/`, `/physics/`, `/chemistry/`, `/guide/`, `/directory/`, `/concepts/`, `/views/`, `/data/`, `/ai/`, `/static/atlas.svg`, and the publication-only `/static/concepts/` SVG/PNG pairs.

## License

See [NOTICE](NOTICE), [LICENSE](LICENSE), and the content-specific [content/LICENSE](content/LICENSE) for licensing information. The build publishes the latter as `/CONTENT_LICENSE` and records the content license and attribution in the hashed provenance artifact.

```
mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/

The editable knowledge and editorial source files in `content/`, together
with compiled or published content derived from them (including graph, schema,
guided-view, page, directory, and SVG content), are licensed
under the Creative Commons Attribution-ShareAlike 4.0 International License
(CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/). Attribution
should be given per the first line in this file. See also `content/LICENSE`.

The remainder of mAtlas is licensed under the Apache License 2.0:

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Third-party material, if any, remains subject to its respective license terms.
```

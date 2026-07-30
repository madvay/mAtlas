## Product specification: Structure Map (semantic zoom)

### Product judgment

mAtlas already supports detailed concept-level exploration, filtering, search, layouts, shareable URL state, and authored views/stories. Its largest remaining usability gap is not another way to traverse between individual concepts; it is global orientation.

A user looking at hundreds or thousands of concepts can reduce the graph with filters, but a smaller concept graph still does not directly answer:

- What are the major intellectual regions represented here?
- Which fields or domains are strongly connected?
- Where are the cross-domain bridges?
- Which part of the atlas should I enter first?

The next feature should therefore change the *scale of representation*, not add another concept-level operation.

## Product specification

### Summary

Add a **Structure Map** that aggregates the currently visible atlas into a deterministic field- or domain-level graph. Users can inspect the atlas at a macro scale, see directed relation counts between areas, identify bridge concepts, drill from fields to domains, and then open the chosen scope in the ordinary concept atlas.

This is semantic zoom in the product sense: the representation changes as the user moves between field, domain, and concept scales.

### Target users and value

- **Students:** establish a mental map before confronting detailed concepts.
- **Professors:** demonstrate how disciplines and subdisciplines connect.
- **Researchers:** inspect modeled boundaries, bridges, and unexpectedly sparse or dense relations.
- **Exploratory users:** find an intelligible entry point without knowing the right search term.
- **View/story authors:** identify coherent neighborhoods and bridge concepts before constructing an explanation.

### Goals

1. Provide macro-level orientation within seconds.
2. Preserve the direction and type of authored relations rather than inventing an undirected similarity metric.
3. Support progressive movement from field scale to domain scale to the existing concept graph.
4. Respect the active atlas filters so the map explains the graph the user is actually viewing.
5. Remain deterministic: identical visible data produces identical nodes, edges, rankings, and positions.
6. Avoid changes to content schemas, saved-view formats, or URL codecs.

### Non-goals

- Finding a path from concept A to concept B.
- Creating, saving, or editing user-authored views.
- Pairwise concept comparison.
- Claiming mathematically inferred communities or semantic distances.
- Replacing the concept graph.

### User experience

1. A hub-style toolbar button opens the Structure Map in a modal dialog.
2. The initial scale aggregates visible concepts by field.
3. Each aggregate node reports its visible concept count.
4. Directed aggregate edges report the number of underlying authored relations; width scales with count.
5. Selecting an area opens a details panel with:
   - concept and relation counts;
   - strongest connected areas;
   - bridge concepts that participate in cross-area relations.
6. Double-clicking a field drills into that field's domains.
7. A Back control returns from domain scale to all fields.
8. Opening a field or domain closes the map and focuses the ordinary atlas on that scope using the existing filter and URL machinery.
9. Refresh rebuilds the map from the current visible graph and active relation settings.

### Aggregation semantics

- Every visible structural concept is assigned using its primary domain and field taxonomy.
- Relations retain source-to-target direction.
- Aggregate edges retain counts by underlying edge type.
- Relations whose source and target fall in the same aggregate area contribute to that area's internal-relation count, not a self-loop.
- Construction-junction chains use the application's existing collapsed structural relations rather than exposing implementation artifacts as disciplines.
- Junction-to-junction artifacts are omitted.
- Hidden concepts and disabled relation types do not contribute.
- The existing cross-field relation policy is honored.

### Interpretation limits

The Structure Map visualizes the authored database, not an objective measurement of scientific importance. A high relation count may reflect content density or editorial coverage. Primary-domain assignment necessarily compresses multi-domain membership; the bridge-concept list partly counteracts that loss, but does not eliminate it. These limits should remain explicit in product documentation.

### Acceptance criteria

- Opening the map never modifies the main atlas state.
- Refresh reflects current visibility and relation filters.
- Aggregate edge direction and counts match the underlying graph.
- No edge references an absent aggregate node.
- Rebuilding the same map gives the same order and layout.
- Field drill-down shows only domains belonging to that field.
- Opening a field/domain updates the ordinary atlas through existing filter controls.
- The dialog is keyboard-dismissable and uses dialog/ARIA semantics.
- The production static build remains valid.

### Suggested success measures

- Structure Map opens followed by a field/domain drill-in.
- Median time from initial atlas load to first scoped concept exploration.
- Fraction of new-user sessions using Structure Map before advanced filters.
- Repeat use across sessions, especially for large all-domain graphs.

## Implementation

### New modules

- `src/graph/semantic-map-core.ts`
  - Pure aggregation, ranking, and deterministic layout logic.
  - Separates graph semantics from UI rendering so it is directly testable.
- `src/graph/semantic-map-core.test.mjs`
  - Tests direction-preserving domain aggregation, field folding/internal counts, and deterministic layout.
- `src/ui/semantic-map-controller.ts`
  - Dialog lifecycle, dedicated Cytoscape instance, field/domain scale transitions, details rendering, and handoff to the main atlas.

### Existing modules changed

- `src/index.html`
  - Adds toolbar entry and accessible dialog structure.
- `src/styles.css`
  - Adds responsive Structure Map layout and controls.
- `src/ui/filter-controls.ts`
  - Exposes focused field/domain operations so the map reuses existing filter and URL behavior.
- `src/app/atlas-app.ts`
  - Initializes the controller and integrates contextual help.
- `tsconfig.test.json`
  - Includes the new pure core module in the unit-test compilation.

### Deliberate architectural choices

- **Separate Cytoscape instance:** the macro map does not mutate or relayout the main concept graph.
- **Taxonomy-based deterministic positioning:** avoids unstable force-layout results and makes repeated inspection comparable.
- **Wrapped domain rows:** large fields remain readable instead of producing a single extremely wide strip.
- **Ephemeral state:** no new URL encoding or content schema, reducing coupling with the in-progress views, path, and compare work.
- **Existing routing/filter reuse:** opening a scope behaves exactly like a user changing the corresponding atlas filters.

## Verification

Completed against the supplied repository state:

- TypeScript type checking: passed.
- Unit tests: **140/140 passed**, including three new Structure Map core tests.
- Production build: passed using system Chromium for browser-generated static SVG output.
- Build-output validation: passed.
- Patch integrity: `git apply --check` passed against a fresh extraction of the supplied ZIP; all three new source files were confirmed present after application.

No automated click-through browser test of the modal was completed; the execution environment blocked localhost browser navigation. The production browser-rendered static export did initialize and build the application successfully, while the interaction logic is covered indirectly by type checking and the pure semantic-map unit tests.

## Future extensions

The cleanest later extensions are normalized relation-density display, an option to account for all domain memberships rather than only primary membership, export of the aggregate map, and comparison of atlas versions over time. None is required for the initial feature.

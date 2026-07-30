# Product specification: Connection Explorer

Status: implemented

## Product decision

The next major feature should answer a question the atlas currently makes users answer manually:

> How is concept A connected to concept B in the graph I am looking at?

mAtlas already provides broad exploration, filtering, prerequisite closure, semantic edge types, details and citations, search, stable URLs, SVG export, and curated Stories/Views. Those features make the graph navigable, but they do not synthesize a route between two user-selected concepts. On a graph with more than a thousand nodes, visually tracing a connection is slow, ambiguous, and often impossible without repeatedly changing filters.

Connection Explorer turns the existing graph semantics into a direct inquiry workflow. It is useful to:

- students constructing a conceptual bridge between topics;
- professors preparing an explanation or reading sequence;
- researchers checking how two subfields are linked in the current ontology;
- visual explorers who notice two distant concepts but cannot trace the intervening edges; and
- Story authors who need a defensible node sequence as a starting point.

This is a higher-priority addition than more display controls, favorites, annotations, or an in-browser Story editor because it closes the central reasoning loop of the product: select two ideas, expose the relations between them, inspect the assertions, and share the result.

## Goals

1. Let a user choose two concept endpoints without knowing their identifiers.
2. Return a small number of short, deterministic paths through the graph currently admitted by filters.
3. Preserve the semantic direction of every authored edge, even when the path is traversed backwards.
4. Make the chosen path legible both on the graph and in a linear explanation.
5. Make the result durable and shareable through the URL.
6. Let a Story author copy the resulting node sequence directly into YAML.
7. Keep the operation fast enough to feel immediate on the full atlas.

## Non-goals

- Claiming that the shortest graph path is the best pedagogical, historical, causal, or deductive explanation.
- Inventing inverse relation labels when traversing an edge backwards.
- Searching through nodes or edge types suppressed by the current filter/display policy.
- Automatically changing filters to force a connection.
- Replacing curated Stories or editorial review.
- Weighting paths by an inferred semantic importance score in the first release.

## User experience

### Entry

A **Connect** control appears in the main graph toolbar. Opening it presents:

- a From concept search field;
- a To concept search field;
- a swap-endpoints control; and
- a traversal selector.

When a concept is already selected, it is prefilled as the From endpoint. Inputs accept an exact identifier, a label, a `Label [identifier]` value, or the best normal search match.

### Traversal modes

**Either direction; preserve arrow meaning** is the default. It treats an admitted edge as traversable from either endpoint for route discovery, but each step states whether the route follows or opposes the authored arrow. It does not rewrite or logically invert the relation.

**Follow authored arrows only** permits only source-to-target traversal. This is useful when users are specifically exploring the direction asserted by the dataset.

### Results

The Details panel becomes a linear connection explanation and the graph emphasizes the same route.

The result contains:

- up to three path alternatives;
- relation count for each alternative;
- each concept’s title and summary;
- each relation’s type and authored label;
- an explicit “authored direction” or “opposite the authored arrow” note for every step;
- a method note stating that traversal is not necessarily logical derivation;
- a permalink action;
- a Story-ready `nodeSequence` copy action; and
- an exit action.

Selecting a concept or edge in the explanation exits Connection Explorer and opens the ordinary detail view for that item.

### Graph treatment

For the active path:

- non-path visible elements are dimmed;
- path nodes and edges are emphasized;
- endpoints receive stronger emphasis; and
- the viewport fits the path when a search or alternative-path choice is made.

Changing filters recomputes the result against the new visible graph. It does not silently re-enable hidden content. When an endpoint is hidden, or no path of twelve or fewer relations exists, the Details panel explains the condition and offers the relevant filter action. Forward-only failure also offers a one-click either-direction search.

## Path semantics and ranking

The admissible graph is exactly the Cytoscape graph after the current visibility policy has been applied. This means the search respects:

- field and domain inclusion;
- excluded and prohibited taxonomy states;
- selected edge types;
- prerequisite visibility;
- cross-field-link mode;
- isolate hiding; and
- expanded versus collapsed construction-junction display.

The algorithm returns up to three shortest loopless paths using deterministic Yen search over deterministic breadth-first shortest-path searches.

Ranking is:

1. fewest relations;
2. deterministic edge/traversal signature ordering.

The first release limits paths to twelve relations and bounds each shortest-path search to 100,000 adjacency expansions. These limits prevent pathological searches while covering practical conceptual routes in the current graph.

## URL contract

Connection state uses independent readable query parameters:

- `connectFrom=<node-id>`
- `connectTo=<node-id>`
- `connectDir=forward` when forward-only traversal is selected
- `connectPath=<zero-based-index>` when an alternative path is active

The default direction and first path are omitted. Active connections set `selection=none` and remove ordinary `node`/`edge` selection parameters. Existing `filter=` and `disp=` state remains independent. Location writes preserve active connection parameters, and browser history restores them.

These parameters are deliberately not encoded into `filter=` or `disp=`: a connection is an inquiry/result state, not filter or display configuration.

## Accessibility and responsive behavior

- The Connect control exposes pressed state and dialog semantics.
- Form errors use an alert/live region.
- Alternative paths are ordinary buttons with `aria-pressed`.
- Direction meaning is present in text, not color alone.
- Endpoint inputs and actions are keyboard operable.
- The toolbar label collapses on narrower screens and alternatives stack on phones.
- Existing reduced-motion behavior applies.

## Acceptance criteria

1. A user can initiate a connection from the toolbar and choose two known concepts.
2. A selected concept is prefilled as the source.
3. The default search returns no more than three deterministic loopless paths of no more than twelve edges.
4. The search uses only currently visible nodes and edges.
5. Backwards traversal is visibly identified and does not receive an invented inverse label.
6. Forward mode never traverses an edge target-to-source.
7. The active route is highlighted and fitted on the graph.
8. Filter changes recompute the active connection.
9. The URL restores endpoints, traversal mode, and selected alternative.
10. Ordinary node/edge activation exits connection mode cleanly.
11. The active node sequence can be copied in valid YAML form.
12. Unit, type, content, build, and build-output checks pass.

## Success measures

Once product analytics exist, evaluate:

- percentage of Connect searches that return at least one path;
- median time from opening Connect to inspecting a relation detail;
- alternative-path selection rate;
- permalink and node-sequence copy rate;
- filter changes made from a no-path state; and
- rate at which a copied path becomes a curated Story.

These are behavioral indicators, not measures of mathematical correctness. Editorial review and source quality remain separate.

## Later extensions

- semantic path weighting by relation type and user intent;
- “pedagogical,” “derivational,” “historical,” and “cross-field” route profiles;
- path constraints such as required or forbidden concepts/domains;
- citation aggregation for the whole route;
- direct creation of a draft Story from a chosen path; and
- comparison of paths under two filter/display states.

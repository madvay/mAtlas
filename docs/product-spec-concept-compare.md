# Product spec: Unified Concept Compare

## Product decision

Concept comparison and connection discovery are two views of the same user inquiry: understanding the relationship between concept A and concept B. They therefore use one pair selector, one toolbar entry, one URL state, and one modal workspace.

The standalone Connect control and dialog are removed. Its pathfinding behavior becomes the **Connections** tab inside **Compare**.

## Users and jobs

- A student distinguishes two concepts and then sees how the visible atlas connects them.
- A researcher checks direct assertions, shared context, and alternative routes without maintaining duplicate endpoint state.
- A professor moves between a concise contrast and a teachable relation sequence.
- A Story author copies a selected route as a valid YAML `nodeSequence`.
- An explorer changes filters and sees both pair analyses recompute against the same graph state.

## Entry and pair selection

- The sole toolbar entry is **Compare**.
- Every structure-concept Details header can add that concept to Compare.
- Inputs A and B accept identifiers, exact labels, datalist values, and ranked atlas search.
- Subjects must be distinct structure nodes; construction junctions cannot be endpoints.
- Swap and Clear operate on the shared pair.

## Analysis tabs

### Overview

Overview retains the original Concept Compare behavior:

1. side-by-side summaries, taxonomy, metadata, defining carrier/data/axiom fields, and source counts;
2. shared fields, domains, and citation records;
3. direct authored relations of enabled types, preserving source and target;
4. incident relation counts by type; and
5. shared adjacent structure concepts with endpoint-specific relation wording.

Renderer-only synthetic edges are excluded to avoid double-counting collapsed construction junctions.

### Connections

Connections retains the complete Connection Explorer behavior inside the same workspace:

- up to three shortest deterministic loopless paths;
- a maximum of twelve relations per path;
- either-direction traversal by default, with every backward traversal explicitly labeled;
- forward-only A-to-B traversal using authored source-to-target assertions;
- only nodes and edges visible under the current filters;
- automatic recomputation after filter changes;
- alternative-path selection;
- graph dimming and path emphasis;
- endpoint emphasis and explicit Fit path action;
- concept summaries and relation type/label for every step;
- ordinary concept and edge activation from the route explanation;
- filter actions for hidden endpoints or no-path states;
- one-click fallback from forward-only to either-direction search; and
- Story-ready YAML `nodeSequence` copy.

Path traversal never invents an inverse relation and does not claim that route order is logical derivation.

## Graph behavior

Overview applies distinct A and B outlines, a shared-neighbor outline, and direct-edge emphasis.

Connections replaces those marks with the selected route presentation: non-path visible elements are dimmed, route nodes and edges are emphasized, and endpoints receive stronger emphasis. Switching tabs deterministically replaces one presentation with the other. Ordinary selection and Details navigation remain available without destroying the pair.

## URL contract

Unified state uses:

- `compare=<left-id>,<right-id>`
- `compareMode=connections` when the Connections tab is active
- `compareDirection=forward` for forward-only traversal
- `comparePath=<zero-based-index>` for a non-default alternative

Overview, either-direction traversal, and the first path are defaults and are omitted. Invalid, duplicate, missing, or junction endpoints clear the complete compare state. Compare state coexists with selection, Views/Stories, `filter=`, and `disp=`.

The old standalone `connectFrom`, `connectTo`, `connectDir`, and `connectPath` parameters are removed without a compatibility layer because the product is unpublished.

## Accessibility and responsive behavior

- Compare exposes dialog and pressed states.
- Overview and Connections are ordinary ARIA tabs.
- Traversal meaning is stated in text rather than color.
- Alternative paths use buttons with `aria-pressed`.
- All inputs, tabs, selectors, route links, and actions are keyboard operable.
- On narrow screens, the analysis toolbar stacks and path alternatives become a single column.

## Acceptance criteria

1. No standalone Connect button or dialog remains.
2. One A/B pair drives both Overview and Connections.
3. All prior comparison analysis remains available.
4. All prior path search, direction, alternative, fit, inspection, filter, permalink, and sequence-copy behavior remains available.
5. The active tab and connection options restore from the unified compare URL state.
6. Filter changes recompute the active analysis.
7. Switching tabs replaces graph emphasis cleanly.
8. Unit, type, content, production-build, and generated-output tests pass.

# Product spec: Concept Compare

## Decision

Add a relationship-aware comparison workspace for two concepts.

This is the highest-value addition after excluding in-app Story/View authoring and concept-to-concept pathfinding. The atlas already answers “what is this?” and “what is connected nearby?” It does not answer the equally common question “how are these two concepts alike, different, and related?” Graph proximity alone cannot answer that reliably because layout distance is editorial, domains overlap, and relation types are directional and semantically distinct.

## Users and jobs

- A student distinguishes neighboring concepts that are commonly confused.
- A researcher checks whether two objects share formal context, source material, or adjacent constructions.
- A professor prepares a concise contrast for teaching or discussion.
- An explorer moves from visual proximity to an explicit account of the recorded relationship.
- A Story/View author checks candidate concepts before placing them in a narrative.

## Product behavior

### Entry points

- A Compare toolbar button opens the workspace.
- A Compare action appears in every concept Details header.
- Opening Compare from a concept pins that concept into the first available slot.

### Concept selection

- Two searchable concept inputs are labeled A and B.
- Search accepts a rendered label, graph identifier, taxonomy context, or descriptive text using the atlas search ranking.
- The two concepts must be distinct structure nodes; construction junctions cannot be comparison subjects.
- Users can swap or clear the pair.

### Comparison output

The workspace shows:

1. Side-by-side summaries, taxonomy memberships, type/scale/status metadata, defining carrier/data/axiom fields when present, and source counts.
2. Shared fields and domains.
3. Shared citation records.
4. Every direct authored relation of a currently enabled relation type, preserving source/target direction.
5. Incident relation counts by relation type for each concept.
6. Shared adjacent structure concepts, with the endpoint-specific relationship wording for A and B.

Renderer-only synthetic edges are excluded from analysis so hidden construction junctions are not double-counted.

### Graph integration

- A and B receive distinct graph outlines.
- Shared adjacent concepts receive a third outline.
- Direct relations are emphasized without replacing their semantic edge color.
- Comparison emphasis survives filter, layout, selection, and panel changes.

### URL and sharing

- A complete pair is encoded as `compare=<left-id>,<right-id>`.
- The parameter coexists with concept routes, View/Story routes, selection, `filter=`, and `disp=`.
- Selection and filter rewrites preserve the comparison pair.
- Invalid, duplicate, missing, or junction identifiers are discarded on location normalization.
- Copy comparison link copies the complete current URL.

## Scope boundaries

- No automatic prose claiming conceptual equivalence, superiority, or historical causation.
- No semantic similarity score; the dataset does not support a defensible scalar metric.
- No shortest-path computation.
- No Story/View authoring or conversion of a comparison into a Story.
- No persistence outside the URL.
- No comparison of edges, junctions, or more than two concepts in this iteration.

## Success criteria

- A user can start a comparison from any concept in at most two actions.
- Every directional relation shown matches the authored edge source, target, and endpoint labels.
- Changing relation filters immediately recomputes direct relations, shared neighbors, and counts.
- A copied URL restores the pair and graph emphasis.
- The feature works on desktop and narrow layouts without changing the graph layout.
- Existing content, URL codec, View/Story, selection, layout, and export tests remain green.

## Future extensions

Potential later work includes comparison of more than two concepts, explicit section-by-section schema alignment, citation-kind grouping, export to a teaching handout, and optional comparison blocks inside authored Stories/Views.

#!/usr/bin/env python3
"""Zero-dependency local mAtlas graph library and CLI.

License: https://github.com/madvay/mAtlas/blob/main/LICENSE

The graph data loaded through this module is CC BY-SA 4.0. Attribution:
mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from collections import deque
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote


SITE_ORIGIN = "https://atlas.madvay.com/"
DEFAULT_PATH_DEPTH = 8
DEFAULT_MAX_PATHS = 5
MAX_PATH_EXPANSIONS = 50_000


def _site_url(path: str = "") -> str:
    return f"{SITE_ORIGIN}{path.lstrip('/')}"


def _unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _positive_int(value: int | None, fallback: int, maximum: int) -> int:
    if value is None:
        return fallback
    return min(maximum, max(0, int(value)))


def _normalized(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"\\(?:mathrm|mathbf|mathbb|mathcal|operatorname|text)\b", " ", text)
    text = re.sub(r"\\([A-Za-z]+)", r" \1 ", text)
    text = re.sub(r"[${}_^]", " ", text)
    return " ".join(re.findall(r"[\w]+", text.lower(), flags=re.UNICODE))


class Atlas:
    """An in-memory view of mAtlas data loaded from JSON or the published SQLite file."""

    def __init__(self, data: Mapping[str, Any]) -> None:
        self.data = dict(data)
        self.meta: dict[str, Any] = dict(self.data["meta"])
        self.nodes: list[dict[str, Any]] = list(self.data["nodes"])
        self.edges: list[dict[str, Any]] = list(self.data["edges"])
        self.fields: dict[str, dict[str, Any]] = dict(self.data["fields"])
        self.domains: dict[str, dict[str, Any]] = dict(self.data["domains"])
        self.edge_types: dict[str, dict[str, Any]] = dict(self.data["edgeTypes"])
        self.sources: dict[str, dict[str, Any]] = dict(self.data["sources"])
        self.node_by_id = {node["id"]: node for node in self.nodes}
        self.edge_by_id = {edge["id"]: edge for edge in self.edges}
        self.outgoing: dict[str, list[dict[str, Any]]] = {}
        self.incoming: dict[str, list[dict[str, Any]]] = {}
        for edge in self.edges:
            self.outgoing.setdefault(edge["source"], []).append(edge)
            self.incoming.setdefault(edge["target"], []).append(edge)
        for table in (self.outgoing, self.incoming):
            for entries in table.values():
                entries.sort(key=lambda edge: edge["id"])

    @classmethod
    def from_json(cls, path: str | Path) -> "Atlas":
        with Path(path).open("r", encoding="utf-8") as handle:
            return cls(json.load(handle))

    @classmethod
    def from_sqlite(cls, path: str | Path) -> "Atlas":
        connection = sqlite3.connect(str(path))
        try:
            row = connection.execute(
                "SELECT value FROM metadata WHERE key = 'atlas_json'"
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise ValueError("The SQLite file has no atlas_json metadata record.")
        return cls(json.loads(row[0]))

    def metadata(self) -> dict[str, Any]:
        return {
            "contentVersion": self.meta["version"],
            "canonicalDatasetUrl": _site_url("data/"),
            "license": self.meta.get("license"),
            "attribution": self.meta.get("attribution", ""),
        }

    def search_concepts(
        self, query: str, *, limit: int = 20, include_junctions: bool = False
    ) -> dict[str, Any]:
        normalized = _normalized(query)
        if not normalized:
            return {"query": query, "normalizedQuery": normalized, "total": 0, "matches": []}
        tokens = normalized.split()
        matches: list[dict[str, Any]] = []
        for node in self.nodes:
            if node["kind"] != "structure" and not include_junctions:
                continue
            label = _normalized(node["label"])
            node_id = _normalized(node["id"])
            fields = self._node_fields(node)
            domains = self._node_domains(node)
            taxonomy = _normalized(" ".join(
                [self.fields.get(field, {}).get("label", field) for field in fields]
                + [self.domains.get(domain, {}).get("label", domain) for domain in domains]
            ))
            body = _normalized(self._node_text(node))
            haystack = f"{node_id} {label} {taxonomy} {body}"
            if not all(token in haystack for token in tokens):
                continue
            score = self._search_score(label, node_id, taxonomy, body, normalized, tokens)
            matches.append({
                **self._concept_reference(node),
                "summary": node.get("summary", ""),
                "score": score,
                "fields": fields,
                "domains": domains,
            })
        matches.sort(key=lambda item: (-item["score"], item["label"], item["id"]))
        return {
            "query": query,
            "normalizedQuery": normalized,
            "total": len(matches),
            "matches": matches[:_positive_int(limit, 20, 100)],
        }

    def resolve_concept(self, identifier: str, *, include_junctions: bool = False) -> dict[str, Any] | None:
        node = self.node_by_id.get(identifier)
        if node and (node["kind"] == "structure" or include_junctions):
            return node
        matches = self.search_concepts(identifier, limit=1, include_junctions=include_junctions)["matches"]
        return self.node_by_id.get(matches[0]["id"]) if matches else None

    def get_concept(self, identifier: str) -> dict[str, Any] | None:
        node = self.node_by_id.get(identifier)
        if node is None:
            return None
        return {
            **self._concept_reference(node),
            "contentVersion": self.meta["version"],
            "fields": self._node_fields(node),
            "domains": self._node_domains(node),
            "record": node,
            "citations": self._citation_records(node.get("citations", [])),
        }

    def get_neighbors(
        self,
        identifier: str,
        *,
        direction: str = "either",
        relation_types: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        node = self._require_node(identifier)
        allowed = self._relation_filter(relation_types)
        return {
            "concept": self._concept_reference(node),
            "incoming": [] if direction == "outgoing" else [
                self._relation_record(edge) for edge in self.incoming.get(node["id"], []) if allowed(edge)
            ],
            "outgoing": [] if direction == "incoming" else [
                self._relation_record(edge) for edge in self.outgoing.get(node["id"], []) if allowed(edge)
            ],
        }

    def find_paths(
        self,
        source_id: str,
        target_id: str,
        *,
        direction: str = "either",
        relation_types: Sequence[str] | None = None,
        max_depth: int = DEFAULT_PATH_DEPTH,
        max_paths: int = DEFAULT_MAX_PATHS,
    ) -> dict[str, Any]:
        source = self._require_node(source_id)
        target = self._require_node(target_id)
        max_depth = _positive_int(max_depth, DEFAULT_PATH_DEPTH, 20)
        max_paths = max(1, _positive_int(max_paths, DEFAULT_MAX_PATHS, 25))
        allowed = self._relation_filter(relation_types)
        if source["id"] == target["id"]:
            return {
                "source": self._concept_reference(source), "target": self._concept_reference(target),
                "direction": direction, "paths": [{"nodeIds": [source_id], "nodes": [self._concept_reference(source)], "relations": []}],
                "maxDepth": max_depth, "maxPaths": max_paths, "truncated": False,
            }

        queue: deque[tuple[list[str], list[tuple[dict[str, Any], str]]]] = deque([([source_id], [])])
        paths: list[dict[str, Any]] = []
        found_depth: int | None = None
        expansions = 0
        while queue and len(paths) < max_paths and expansions <= MAX_PATH_EXPANSIONS:
            node_ids, steps = queue.popleft()
            if found_depth is not None and len(steps) >= found_depth:
                continue
            if len(steps) >= max_depth:
                continue
            for edge, next_id, traversed_direction in self._traversed_edges(node_ids[-1], direction, allowed):
                expansions += 1
                if expansions > MAX_PATH_EXPANSIONS:
                    break
                if next_id in node_ids:
                    continue
                next_nodes = [*node_ids, next_id]
                next_steps = [*steps, (edge, traversed_direction)]
                if next_id == target_id:
                    found_depth = found_depth if found_depth is not None else len(next_steps)
                    if len(next_steps) == found_depth:
                        paths.append({
                            "nodeIds": next_nodes,
                            "nodes": [self._concept_reference(self._require_node(node_id)) for node_id in next_nodes],
                            "relations": [
                                {**self._relation_record(path_edge), "traversedDirection": path_direction}
                                for path_edge, path_direction in next_steps
                            ],
                        })
                    if len(paths) >= max_paths:
                        break
                elif found_depth is None:
                    queue.append((next_nodes, next_steps))
        return {
            "source": self._concept_reference(source), "target": self._concept_reference(target),
            "direction": direction, "paths": paths, "maxDepth": max_depth, "maxPaths": max_paths,
            "truncated": expansions > MAX_PATH_EXPANSIONS,
        }

    def get_predecessor_closure(
        self, root_ids: Sequence[str], *, relation_types: Sequence[str] | None = None
    ) -> dict[str, Any]:
        return self._closure(root_ids, "predecessor", relation_types)

    def get_prerequisite_closure(
        self, root_ids: Sequence[str], *, relation_types: Sequence[str] | None = None
    ) -> dict[str, Any]:
        return self._closure(root_ids, "prerequisite", relation_types)

    def connect_concepts(
        self, root_ids: Sequence[str], **options: Any
    ) -> dict[str, Any]:
        requested: list[dict[str, Any]] = []
        unresolved: list[str] = []
        for identifier in _unique(root_ids):
            node = self.node_by_id.get(identifier)
            if node is None:
                unresolved.append(identifier)
            else:
                requested.append(self._concept_reference(node))
        if len(requested) < 2:
            return {"requested": requested, "paths": [], "nodeIds": [item["id"] for item in requested], "edgeIds": [], "unresolved": unresolved}
        connected = [requested[0]]
        paths: list[dict[str, Any]] = []
        node_ids = {requested[0]["id"]}
        edge_ids: set[str] = set()
        path_options = {**options, "max_paths": 1}
        for candidate in requested[1:]:
            candidates = []
            for existing in connected:
                path_set = self.find_paths(candidate["id"], existing["id"], **path_options)["paths"]
                if path_set:
                    candidates.append(path_set[0])
            candidates.sort(key=lambda path: (len(path["relations"]), "\0".join(path["nodeIds"])))
            if not candidates:
                unresolved.append(candidate["id"])
                continue
            path = candidates[0]
            paths.append(path)
            connected.append(candidate)
            node_ids.update(path["nodeIds"])
            edge_ids.update(relation["id"] for relation in path["relations"])
        return {"requested": requested, "paths": paths, "nodeIds": sorted(node_ids), "edgeIds": sorted(edge_ids), "unresolved": unresolved}

    def build_subgraph(
        self,
        root_ids: Sequence[str],
        *,
        hops: int = 1,
        direction: str = "either",
        relation_types: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        roots = [self._require_node(identifier) for identifier in _unique(root_ids)]
        hops = _positive_int(hops, 1, 10)
        allowed = self._relation_filter(relation_types)
        node_ids = {node["id"] for node in roots}
        edge_ids: set[str] = set()
        queue: deque[tuple[str, int]] = deque((node["id"], 0) for node in roots)
        while queue:
            node_id, distance = queue.popleft()
            if distance >= hops:
                continue
            for edge, next_id, _ in self._traversed_edges(node_id, direction, allowed):
                edge_ids.add(edge["id"])
                if next_id in node_ids:
                    continue
                node_ids.add(next_id)
                queue.append((next_id, distance + 1))
        sorted_nodes = sorted(node_ids)
        return {
            "roots": [self._concept_reference(node) for node in roots],
            "nodeIds": sorted_nodes,
            "nodes": [self._concept_reference(self._require_node(node_id)) for node_id in sorted_nodes],
            "relations": [self._relation_record(self.edge_by_id[edge_id]) for edge_id in sorted(edge_ids)],
            "hops": hops,
            "direction": direction,
        }

    def compare_concepts(self, left_id: str, right_id: str) -> dict[str, Any]:
        left = self.get_concept(left_id)
        right = self.get_concept(right_id)
        if left is None or right is None:
            raise ValueError("Both concept IDs must exist in the dataset.")
        left_neighbors = self._neighbor_ids(left_id)
        right_neighbors = self._neighbor_ids(right_id)
        direct = [
            self._relation_record(edge) for edge in self.edges
            if (edge["source"] == left_id and edge["target"] == right_id)
            or (edge["source"] == right_id and edge["target"] == left_id)
        ]
        return {
            "left": left, "right": right,
            "commonFields": self._shared(left["fields"], right["fields"]),
            "commonDomains": self._shared(left["domains"], right["domains"]),
            "commonCitationIds": self._shared(left["record"].get("citations", []), right["record"].get("citations", [])),
            "directRelations": direct,
            "sharedNeighborIds": sorted(left_neighbors.intersection(right_neighbors)),
        }

    def create_permalink(self, identifier: str) -> dict[str, Any]:
        node = self._require_node(identifier)
        reference = self._concept_reference(node)
        return {"concept": reference, "canonicalUrl": reference["canonicalUrl"], "interactiveUrl": reference["interactiveUrl"]}

    def _closure(self, root_ids: Sequence[str], kind: str, relation_types: Sequence[str] | None) -> dict[str, Any]:
        roots = [self._require_node(identifier) for identifier in _unique(root_ids)]
        allowed = self._relation_filter(relation_types)
        adjacency: dict[str, list[tuple[dict[str, Any], str]]] = {}

        def add(from_id: str, edge: dict[str, Any], next_id: str) -> None:
            adjacency.setdefault(from_id, []).append((edge, next_id))

        for edge in self.edges:
            if not allowed(edge):
                continue
            edge_type = self.edge_types.get(edge["type"], {})
            if kind == "predecessor":
                if edge_type.get("enforcePredecessorLevel") == "incoming":
                    add(edge["target"], edge, edge["source"])
                if edge_type.get("enforcePredecessorLevel") == "outgoing":
                    add(edge["source"], edge, edge["target"])
            else:
                traversal = edge_type.get("prerequisiteTraversal")
                if traversal in ("incoming", "both"):
                    add(edge["target"], edge, edge["source"])
                if traversal in ("outgoing", "both"):
                    add(edge["source"], edge, edge["target"])
        for steps in adjacency.values():
            steps.sort(key=lambda item: (item[0]["id"], item[1]))
        node_ids = {node["id"] for node in roots}
        edge_ids: set[str] = set()
        queue: deque[str] = deque(node_ids)
        while queue:
            node_id = queue.popleft()
            for edge, next_id in adjacency.get(node_id, []):
                edge_ids.add(edge["id"])
                if next_id not in node_ids:
                    node_ids.add(next_id)
                    queue.append(next_id)
        sorted_nodes = sorted(node_ids)
        return {
            "kind": kind,
            "roots": [self._concept_reference(node) for node in roots],
            "nodeIds": sorted_nodes,
            "nodes": [self._concept_reference(self._require_node(node_id)) for node_id in sorted_nodes],
            "edgeIds": sorted(edge_ids),
            "relations": [self._relation_record(self.edge_by_id[edge_id]) for edge_id in sorted(edge_ids)],
        }

    def _node_fields(self, node: Mapping[str, Any]) -> list[str]:
        if node.get("fields"):
            return _unique(node["fields"])
        return _unique(
            self.domains.get(domain, {}).get("field")
            for domain in self._node_domains(node)
            if self.domains.get(domain, {}).get("field")
        )

    @staticmethod
    def _node_domains(node: Mapping[str, Any]) -> list[str]:
        return list(node.get("domains") or [node["primaryDomain"]])

    @staticmethod
    def _node_text(node: Mapping[str, Any]) -> str:
        sections = node.get("sections", [])
        return " ".join([
            node.get("summary", ""), *node.get("carriers", []), *node.get("data", []),
            *node.get("axioms", []), *node.get("induces", []), node.get("notes", ""),
            *[
                " ".join([section.get("title", ""), section.get("body", ""), *section.get("items", [])])
                for section in sections
            ],
        ])

    @staticmethod
    def _search_score(label: str, node_id: str, taxonomy: str, body: str, query: str, tokens: Sequence[str]) -> int:
        score = 0
        if label == query:
            score += 4000
        elif node_id == query:
            score += 3800
        elif label.startswith(query):
            score += 2400
        elif node_id.startswith(query):
            score += 2200
        elif query in label:
            score += 1500
        elif query in node_id:
            score += 1300
        elif query in taxonomy:
            score += 500
        elif query in body:
            score += 250
        if all(token in label for token in tokens):
            score += 700
        elif all(token in node_id for token in tokens):
            score += 600
        elif all(token in taxonomy for token in tokens):
            score += 220
        score += max(0, 120 - len(label))
        return score

    def _concept_reference(self, node: Mapping[str, Any]) -> dict[str, Any]:
        canonical = (
            _site_url(f"concepts/{quote(node['id'], safe='')}/")
            if node["kind"] == "structure"
            else _site_url(f"?node={quote(node['id'], safe='')}")
        )
        return {
            "id": node["id"], "label": node["label"], "kind": node["kind"],
            "canonicalUrl": canonical, "interactiveUrl": _site_url(f"?node={quote(node['id'], safe='')}")
        }

    def _citation_records(self, identifiers: Iterable[str]) -> list[dict[str, Any]]:
        return [{"id": identifier, **self.sources[identifier]} for identifier in identifiers if identifier in self.sources]

    def _relation_record(self, edge: Mapping[str, Any]) -> dict[str, Any]:
        edge_type = self.edge_types[edge["type"]]
        source = self._require_node(edge["source"])
        target = self._require_node(edge["target"])
        page_node = target if target["kind"] == "structure" else source if source["kind"] == "structure" else None
        canonical = (
            f"{self._concept_reference(page_node)['canonicalUrl']}#relation-{quote(edge['id'], safe='')}"
            if page_node else _site_url(f"?edge={quote(edge['id'], safe='')}")
        )
        return {
            "id": edge["id"], "source": self._concept_reference(source), "target": self._concept_reference(target),
            "type": {
                "id": edge["type"], "label": edge_type["label"], "description": edge_type["description"],
                "sourceRole": edge_type["endpointLabels"]["source"], "targetRole": edge_type["endpointLabels"]["target"],
                "prerequisiteTraversal": edge_type["prerequisiteTraversal"],
                "enforcePredecessorLevel": edge_type.get("enforcePredecessorLevel"),
            },
            "label": edge["label"], "detail": edge["detail"], "canonicalUrl": canonical,
            "citations": self._citation_records(edge.get("citations", [])),
        }

    @staticmethod
    def _relation_filter(relation_types: Sequence[str] | None):
        allowed = set(relation_types or [])
        return (lambda edge: not allowed or edge["type"] in allowed)

    def _traversed_edges(self, node_id: str, direction: str, allowed):
        steps: list[tuple[dict[str, Any], str, str]] = []
        if direction in ("outgoing", "either"):
            steps.extend((edge, edge["target"], "forward") for edge in self.outgoing.get(node_id, []) if allowed(edge))
        if direction in ("incoming", "either"):
            steps.extend((edge, edge["source"], "reverse") for edge in self.incoming.get(node_id, []) if allowed(edge))
        return sorted(steps, key=lambda item: (item[0]["id"], item[2]))

    def _neighbor_ids(self, node_id: str) -> set[str]:
        return {
            *[edge["target"] for edge in self.outgoing.get(node_id, [])],
            *[edge["source"] for edge in self.incoming.get(node_id, [])],
        }

    @staticmethod
    def _shared(left: Iterable[str], right: Iterable[str]) -> list[str]:
        return sorted(set(left).intersection(right))

    def _require_node(self, identifier: str) -> dict[str, Any]:
        node = self.node_by_id.get(identifier)
        if node is None:
            raise ValueError(f"Unknown mAtlas concept or junction ID: {identifier}.")
        return node


def _load_atlas(arguments: argparse.Namespace) -> Atlas:
    if arguments.sqlite:
        return Atlas.from_sqlite(arguments.sqlite)
    if arguments.json:
        return Atlas.from_json(arguments.json)
    raise ValueError("Pass exactly one of --sqlite PATH or --json PATH.")


def _add_relation_type_option(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--relation-type", action="append", dest="relation_types", default=[], help="Restrict to a relation type ID; repeatable.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Perform deterministic, source-aware local mAtlas graph operations.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--sqlite", help="Path to published matlas.sqlite.")
    source.add_argument("--json", help="Path to published atlas.json.")
    commands = parser.add_subparsers(dest="command", required=True)

    search = commands.add_parser("search", help="Search concepts by ID, name, taxonomy, and authored text.")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--include-junctions", action="store_true")

    get = commands.add_parser("get", help="Return one canonical concept record.")
    get.add_argument("concept_id")

    neighbors = commands.add_parser("neighbors", help="Return direct typed relations.")
    neighbors.add_argument("concept_id")
    neighbors.add_argument("--direction", choices=("incoming", "outgoing", "either"), default="either")
    _add_relation_type_option(neighbors)

    paths = commands.add_parser("paths", help="Find shortest authored paths.")
    paths.add_argument("source_id")
    paths.add_argument("target_id")
    paths.add_argument("--direction", choices=("incoming", "outgoing", "either"), default="either")
    paths.add_argument("--max-depth", type=int, default=DEFAULT_PATH_DEPTH)
    paths.add_argument("--max-paths", type=int, default=DEFAULT_MAX_PATHS)
    _add_relation_type_option(paths)

    closure = commands.add_parser("closure", help="Compute predecessor or prerequisite closure.")
    closure.add_argument("concept_ids", nargs="+")
    closure.add_argument("--traversal", choices=("predecessor", "prerequisite"), default="prerequisite")
    _add_relation_type_option(closure)

    connect = commands.add_parser("connect", help="Connect several concepts using shortest authored paths.")
    connect.add_argument("concept_ids", nargs="+")
    connect.add_argument("--direction", choices=("incoming", "outgoing", "either"), default="either")
    connect.add_argument("--max-depth", type=int, default=DEFAULT_PATH_DEPTH)
    _add_relation_type_option(connect)

    subgraph = commands.add_parser("subgraph", help="Build a bounded direct-neighbor subgraph.")
    subgraph.add_argument("concept_ids", nargs="+")
    subgraph.add_argument("--hops", type=int, default=1)
    subgraph.add_argument("--direction", choices=("incoming", "outgoing", "either"), default="either")
    _add_relation_type_option(subgraph)

    compare = commands.add_parser("compare", help="Compare two canonical concept records.")
    compare.add_argument("left_id")
    compare.add_argument("right_id")

    permalink = commands.add_parser("permalink", help="Return canonical and interactive URLs for a concept.")
    permalink.add_argument("concept_id")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    arguments = parser.parse_args(argv)
    try:
        atlas = _load_atlas(arguments)
        if arguments.command == "search":
            result = atlas.search_concepts(arguments.query, limit=arguments.limit, include_junctions=arguments.include_junctions)
        elif arguments.command == "get":
            result = atlas.get_concept(arguments.concept_id)
            if result is None:
                raise ValueError(f"Unknown mAtlas concept or junction ID: {arguments.concept_id}.")
        elif arguments.command == "neighbors":
            result = atlas.get_neighbors(arguments.concept_id, direction=arguments.direction, relation_types=arguments.relation_types)
        elif arguments.command == "paths":
            result = atlas.find_paths(arguments.source_id, arguments.target_id, direction=arguments.direction, relation_types=arguments.relation_types, max_depth=arguments.max_depth, max_paths=arguments.max_paths)
        elif arguments.command == "closure":
            method = atlas.get_predecessor_closure if arguments.traversal == "predecessor" else atlas.get_prerequisite_closure
            result = method(arguments.concept_ids, relation_types=arguments.relation_types)
        elif arguments.command == "connect":
            result = atlas.connect_concepts(arguments.concept_ids, direction=arguments.direction, relation_types=arguments.relation_types, max_depth=arguments.max_depth)
        elif arguments.command == "subgraph":
            result = atlas.build_subgraph(arguments.concept_ids, hops=arguments.hops, direction=arguments.direction, relation_types=arguments.relation_types)
        elif arguments.command == "compare":
            result = atlas.compare_concepts(arguments.left_id, arguments.right_id)
        else:
            result = atlas.create_permalink(arguments.concept_id)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.error(str(error))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# License: https://github.com/madvay/mAtlas/blob/main/LICENSE
# Graph data: https://creativecommons.org/licenses/by-sa/4.0/
# Attribution: mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/

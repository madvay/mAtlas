#!/usr/bin/env python3
"""Create the portable mAtlas SQLite distribution from the compiled graph.

Software: Apache-2.0. Published mAtlas content is CC BY-SA 4.0; attribution:
mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable


APPLICATION_ID = 0x4D41544C  # "MATL"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def normalized_term(value: str) -> str:
    return " ".join("".join(character.lower() if character.isalnum() else " " for character in value).split())


def node_domains(node: dict[str, Any]) -> list[str]:
    return list(node.get("domains") or [node["primaryDomain"]])


def node_fields(graph: dict[str, Any], node: dict[str, Any]) -> list[str]:
    fields = node.get("fields")
    if fields:
        return list(dict.fromkeys(fields))
    return list(dict.fromkeys(
        graph["domains"].get(domain_id, {}).get("field")
        for domain_id in node_domains(node)
        if graph["domains"].get(domain_id, {}).get("field")
    ))


def alternate_terms(node: dict[str, Any]) -> list[str]:
    values = node.get("alternateTerms") or node.get("alternateLabels") or node.get("aliases") or []
    return list(dict.fromkeys(value.strip() for value in values if isinstance(value, str) and value.strip()))


def executemany(connection: sqlite3.Connection, sql: str, values: Iterable[tuple[Any, ...]]) -> None:
    rows = list(values)
    if rows:
        connection.executemany(sql, rows)


def create_database(output: Path, payload: dict[str, Any]) -> None:
    graph = payload["graphData"]
    views = payload.get("viewsData", {"views": []})
    provenance = payload.get("provenance", {})
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    connection = sqlite3.connect(str(output))
    try:
        connection.executescript(
            f"""
            PRAGMA page_size = 4096;
            PRAGMA auto_vacuum = NONE;
            PRAGMA journal_mode = OFF;
            PRAGMA synchronous = OFF;
            PRAGMA temp_store = MEMORY;
            PRAGMA application_id = {APPLICATION_ID};
            PRAGMA user_version = 1;

            CREATE TABLE metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE fields (
              id TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              short_label TEXT,
              color TEXT NOT NULL,
              sort_order REAL NOT NULL,
              path TEXT NOT NULL,
              description TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE domains (
              id TEXT PRIMARY KEY,
              field_id TEXT NOT NULL,
              label TEXT NOT NULL,
              color TEXT NOT NULL,
              sort_order REAL NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE relation_types (
              id TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              short_label TEXT NOT NULL,
              description TEXT NOT NULL,
              prerequisite_traversal TEXT NOT NULL,
              enforce_predecessor_level TEXT,
              source_role TEXT NOT NULL,
              target_role TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE concepts (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              label TEXT NOT NULL,
              primary_field_id TEXT,
              primary_domain_id TEXT NOT NULL,
              level REAL NOT NULL,
              summary TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE concept_terms (
              concept_id TEXT NOT NULL,
              term TEXT NOT NULL,
              normalized_term TEXT NOT NULL,
              term_kind TEXT NOT NULL,
              PRIMARY KEY (concept_id, term, term_kind)
            ) WITHOUT ROWID;

            CREATE TABLE concept_domains (
              concept_id TEXT NOT NULL,
              domain_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              PRIMARY KEY (concept_id, domain_id)
            ) WITHOUT ROWID;

            CREATE TABLE concept_fields (
              concept_id TEXT NOT NULL,
              field_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              PRIMARY KEY (concept_id, field_id)
            ) WITHOUT ROWID;

            CREATE TABLE sources (
              id TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              title TEXT NOT NULL,
              url TEXT NOT NULL,
              kind TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE concept_sources (
              concept_id TEXT NOT NULL,
              source_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              PRIMARY KEY (concept_id, source_id)
            ) WITHOUT ROWID;

            CREATE TABLE relations (
              id TEXT PRIMARY KEY,
              source_id TEXT NOT NULL,
              target_id TEXT NOT NULL,
              type_id TEXT NOT NULL,
              label TEXT NOT NULL,
              detail TEXT NOT NULL,
              citations_json TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE relation_sources (
              relation_id TEXT NOT NULL,
              source_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              PRIMARY KEY (relation_id, source_id)
            ) WITHOUT ROWID;

            CREATE TABLE views (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              summary TEXT NOT NULL,
              narrative TEXT NOT NULL,
              record_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE view_concepts (
              view_id TEXT NOT NULL,
              concept_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              PRIMARY KEY (view_id, concept_id, ordinal)
            ) WITHOUT ROWID;

            CREATE INDEX concepts_label_idx ON concepts(label);
            CREATE INDEX concept_terms_normalized_term_idx ON concept_terms(normalized_term);
            CREATE INDEX concept_domains_domain_idx ON concept_domains(domain_id);
            CREATE INDEX concept_fields_field_idx ON concept_fields(field_id);
            CREATE INDEX relations_source_idx ON relations(source_id);
            CREATE INDEX relations_target_idx ON relations(target_id);
            CREATE INDEX relations_type_idx ON relations(type_id);
            CREATE INDEX concept_sources_source_idx ON concept_sources(source_id);
            CREATE INDEX relation_sources_source_idx ON relation_sources(source_id);
            """
        )
        metadata = {
            "format_version": "1",
            "content_version": str(provenance.get("contentVersion") or graph["meta"]["version"]),
            "schema_version": str(provenance.get("schemaVersion", "")),
            "license": str(graph["meta"].get("license", "")),
            "license_url": str(graph["meta"].get("licenseUrl", "")),
            "attribution": str(graph["meta"].get("attribution", "")),
            "atlas_json": canonical_json(graph),
            "atlas_sha256": hashlib.sha256(canonical_json(graph).encode("utf-8")).hexdigest(),
        }
        executemany(connection, "INSERT INTO metadata(key, value) VALUES (?, ?)", sorted(metadata.items()))
        executemany(
            connection,
            "INSERT INTO fields VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                (
                    field_id, field["label"], field.get("shortLabel"), field["color"], field["order"],
                    field["path"], field["description"], canonical_json(field)
                )
                for field_id, field in sorted(graph["fields"].items())
            ),
        )
        executemany(
            connection,
            "INSERT INTO domains VALUES (?, ?, ?, ?, ?, ?)",
            (
                (domain_id, domain["field"], domain["label"], domain["color"], domain["order"], canonical_json(domain))
                for domain_id, domain in sorted(graph["domains"].items())
            ),
        )
        executemany(
            connection,
            "INSERT INTO relation_types VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                (
                    type_id, definition["label"], definition["short"], definition["description"],
                    definition["prerequisiteTraversal"], definition.get("enforcePredecessorLevel"),
                    definition["endpointLabels"]["source"], definition["endpointLabels"]["target"], canonical_json(definition)
                )
                for type_id, definition in sorted(graph["edgeTypes"].items())
            ),
        )
        executemany(
            connection,
            "INSERT INTO concepts VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                (
                    node["id"], node["kind"], node["label"], node.get("primaryField"), node["primaryDomain"],
                    node["level"], node["summary"], canonical_json(node)
                )
                for node in sorted(graph["nodes"], key=lambda item: item["id"])
            ),
        )
        term_rows = []
        domain_rows = []
        field_rows = []
        concept_source_rows = []
        for node in sorted(graph["nodes"], key=lambda item: item["id"]):
            term_rows.append((node["id"], node["label"], normalized_term(node["label"]), "canonical"))
            term_rows.extend((node["id"], term, normalized_term(term), "alternate") for term in alternate_terms(node))
            domain_rows.extend((node["id"], domain_id, ordinal) for ordinal, domain_id in enumerate(node_domains(node)))
            field_rows.extend((node["id"], field_id, ordinal) for ordinal, field_id in enumerate(node_fields(graph, node)))
            concept_source_rows.extend((node["id"], source_id, ordinal) for ordinal, source_id in enumerate(dict.fromkeys(node.get("citations", []))))
        executemany(connection, "INSERT INTO concept_terms VALUES (?, ?, ?, ?)", term_rows)
        executemany(connection, "INSERT INTO concept_domains VALUES (?, ?, ?)", domain_rows)
        executemany(connection, "INSERT INTO concept_fields VALUES (?, ?, ?)", field_rows)
        executemany(connection, "INSERT INTO concept_sources VALUES (?, ?, ?)", concept_source_rows)
        executemany(
            connection,
            "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?)",
            (
                (source_id, source["label"], source["title"], source["url"], source["kind"], canonical_json(source))
                for source_id, source in sorted(graph["sources"].items())
            ),
        )
        sorted_edges = sorted(graph["edges"], key=lambda item: item["id"])
        executemany(
            connection,
            "INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                (
                    edge["id"], edge["source"], edge["target"], edge["type"], edge["label"], edge["detail"],
                    canonical_json(edge.get("citations", [])), canonical_json(edge)
                )
                for edge in sorted_edges
            ),
        )
        executemany(
            connection,
            "INSERT INTO relation_sources VALUES (?, ?, ?)",
            (
                (edge["id"], source_id, ordinal)
                for edge in sorted_edges
                for ordinal, source_id in enumerate(dict.fromkeys(edge.get("citations", [])))
            ),
        )
        sorted_views = sorted(views.get("views", []), key=lambda item: item["id"])
        executemany(
            connection,
            "INSERT INTO views VALUES (?, ?, ?, ?, ?)",
            (
                (view["id"], view["title"], view["summary"], view["narrative"], canonical_json(view))
                for view in sorted_views
            ),
        )
        executemany(
            connection,
            "INSERT INTO view_concepts VALUES (?, ?, ?)",
            (
                (view["id"], concept_id, ordinal)
                for view in sorted_views
                for ordinal, concept_id in enumerate(view.get("nodeSequence", []))
            ),
        )
        connection.commit()
        connection.execute("VACUUM")
        connection.execute("PRAGMA optimize")
    finally:
        connection.close()
    os.chmod(output, 0o644)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the mAtlas SQLite data distribution.")
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    payload = json.load(sys.stdin)
    create_database(arguments.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Content license: https://creativecommons.org/licenses/by-sa/4.0/
# Attribution: mAtlas - Copyright (c) 2026 Advay Mengle - https://atlas.madvay.com/

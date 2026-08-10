"""Load the registry out of Postgres and resolve base + tenant overlay.

Resolution rule: walk the version chain from base to overlay and let later
versions override earlier ones, keyed by api_name. An overlay may ADD or RENAME;
it may not REMOVE (V3 §8 decision 2) — removal would break Matrix's own apps
across every client.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import asyncpg

DSN = "postgresql://matrix:matrix@localhost:55432/matrix_ontology_poc"


async def connect(dsn: str = DSN) -> asyncpg.Connection:
    conn = await asyncpg.connect(dsn)
    # asyncpg hands back jsonb as text unless told otherwise.
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(
            typename, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )
    return conn


@dataclass
class Ontology:
    """One tenant's resolved view of the world."""

    tenant_id: str | None
    version_chain: list[str] = field(default_factory=list)
    object_types: dict[str, dict] = field(default_factory=dict)
    # object_type api_name -> property api_name -> definition
    properties: dict[str, dict[str, dict]] = field(default_factory=dict)
    links: dict[str, dict] = field(default_factory=dict)
    actions: dict[str, dict] = field(default_factory=dict)
    bindings: dict[str, dict] = field(default_factory=dict)
    interfaces: dict[str, dict] = field(default_factory=dict)
    impls: dict[str, list[dict]] = field(default_factory=dict)

    def display_name(self, object_type: str) -> str:
        return self.object_types[object_type]["display_name"]

    def property_labels(self, object_type: str) -> dict[str, str]:
        return {
            name: prop["display_name"]
            for name, prop in self.properties.get(object_type, {}).items()
        }

    def implementers(self, interface_name: str) -> list[str]:
        return [i["object_type"] for i in self.impls.get(interface_name, [])]


async def _version_chain(conn: asyncpg.Connection, tenant_id: str | None) -> list[dict]:
    """Base first, then the tenant's overlay if one exists."""
    overlay = None
    if tenant_id is not None:
        overlay = await conn.fetchrow(
            """
            SELECT id::text, parent_id::text, package, semver
              FROM ontology.ontology_version
             WHERE tenant_id = $1::uuid AND status = 'published'
             ORDER BY semver DESC LIMIT 1
            """,
            tenant_id,
        )

    if overlay is not None and overlay["parent_id"]:
        base = await conn.fetchrow(
            "SELECT id::text, parent_id::text, package, semver "
            "FROM ontology.ontology_version WHERE id = $1::uuid",
            overlay["parent_id"],
        )
        return [dict(base), dict(overlay)]

    base = await conn.fetchrow(
        """
        SELECT id::text, parent_id::text, package, semver
          FROM ontology.ontology_version
         WHERE tenant_id IS NULL AND status = 'published'
         ORDER BY semver DESC LIMIT 1
        """
    )
    chain = [dict(base)]
    if overlay is not None:
        chain.append(dict(overlay))
    return chain


async def load(conn: asyncpg.Connection, tenant_id: str | None = None) -> Ontology:
    chain = await _version_chain(conn, tenant_id)
    version_ids = [v["id"] for v in chain]

    onto = Ontology(
        tenant_id=tenant_id,
        version_chain=[f"{v['package']}@{v['semver']}" for v in chain],
    )

    # Applied in chain order so an overlay row overwrites the base row it shadows.
    for vid in version_ids:
        for row in await conn.fetch(
            "SELECT * FROM ontology.object_type WHERE version_id = $1::uuid", vid
        ):
            onto.object_types[row["api_name"]] = dict(row)

        for row in await conn.fetch(
            "SELECT * FROM ontology.property_def WHERE version_id = $1::uuid", vid
        ):
            onto.properties.setdefault(row["object_type"], {})[row["api_name"]] = dict(row)

        for row in await conn.fetch(
            "SELECT * FROM ontology.link_type WHERE version_id = $1::uuid", vid
        ):
            onto.links[row["api_name"]] = dict(row)

        for row in await conn.fetch(
            "SELECT * FROM ontology.action_type WHERE version_id = $1::uuid", vid
        ):
            onto.actions[row["api_name"]] = dict(row)

        for row in await conn.fetch(
            "SELECT * FROM ontology.datasource_binding WHERE version_id = $1::uuid", vid
        ):
            onto.bindings[row["object_type"]] = dict(row)

        for row in await conn.fetch(
            "SELECT * FROM ontology.interface WHERE version_id = $1::uuid", vid
        ):
            onto.interfaces[row["api_name"]] = dict(row)

        for row in await conn.fetch(
            "SELECT * FROM ontology.interface_impl WHERE version_id = $1::uuid", vid
        ):
            onto.impls.setdefault(row["interface_name"], []).append(dict(row))

    return onto


async def set_precondition(
    conn: asyncpg.Connection, version_id_package: str, action: str, rule: dict[str, Any]
) -> None:
    """Rewrite one action's gate. The whole point: this is an UPDATE, not a deploy."""
    await conn.execute(
        """
        UPDATE ontology.action_type a
           SET preconditions = $3::jsonb
          FROM ontology.ontology_version v
         WHERE a.version_id = v.id
           AND v.package = $1
           AND a.api_name = $2
        """,
        version_id_package,
        action,
        # Pass the dict, NOT json.dumps(rule) — a jsonb type codec is registered
        # on this connection, so asyncpg encodes it. Passing a pre-serialised
        # string double-encodes it into a jsonb *scalar string*, which then
        # evaluates as a truthy literal and turns the gate permanently OPEN.
        rule,
    )

"""The generic read path.

Every object read in the PoC goes through here. There is no per-object-type
query code — the SQL is assembled from the registry. That is the property that
makes "a new object type costs a config change, not a deploy" true.

The tenant predicate is injected here and nowhere else. This is the seed of the
policy compiler in V3 Stage 1: today no single function in Matrix answers "may
this caller see this row?" — after this pattern, exactly one does.
"""

from __future__ import annotations

from typing import Any

import asyncpg

from . import jsonlogic
from .registry import Ontology


def qi(identifier: str) -> str:
    """Quote a SQL identifier. Registry values are trusted config, but an
    ontology is edited by humans and eventually by an admin UI — quote anyway."""
    return '"' + identifier.replace('"', '""') + '"'


def _physical_column(onto: Ontology, object_type: str, prop: dict) -> str | None:
    """Where does this property actually live on the backing table?"""
    binding = onto.bindings[object_type]
    mapped = (binding.get("column_map") or {}).get(prop["api_name"])
    if mapped:
        return mapped
    return prop.get("column_name")


def _select_list(onto: Ontology, object_type: str) -> list[str]:
    parts: list[str] = []
    for api_name, prop in onto.properties.get(object_type, {}).items():
        if prop["storage"] == "props_json":
            # overlay-only property: read it out of the jsonb column.
            # column_name names the JSON key, exactly as it names the physical
            # column for storage='column'. Falls back to the api_name.
            key = (prop.get("column_name") or api_name).replace("'", "''")
            parts.append(f"props ->> '{key}' AS {qi(api_name)}")
            continue
        column = _physical_column(onto, object_type, prop)
        if column:
            parts.append(f"{qi(column)} AS {qi(api_name)}")
    return parts


def _decode_values(onto: Ontology, object_type: str, row: dict) -> dict:
    """Translate the client's vocabulary into the base ontology's."""
    value_map = onto.bindings[object_type].get("value_map") or {}
    if not value_map:
        return row
    out = dict(row)
    for prop, mapping in value_map.items():
        if prop in out and out[prop] in mapping:
            out[prop] = mapping[out[prop]]
    return out


async def query_objects(
    conn: asyncpg.Connection,
    onto: Ontology,
    object_type: str,
    tenant_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    binding = onto.bindings[object_type]
    table = f"{qi(binding['schema_name'])}.{qi(binding['table_name'])}"

    sql = f"SELECT {', '.join(_select_list(onto, object_type))} FROM {table}"
    args: list[Any] = []

    # ── the only place a tenant predicate is applied ─────────────────────────
    if binding.get("tenant_column") and tenant_id is not None:
        sql += f" WHERE {qi(binding['tenant_column'])} = $1::uuid"
        args.append(tenant_id)
    elif binding.get("tenant_column") and tenant_id is None:
        # Fail closed. A tenant-scoped type must never be read unscoped.
        raise PermissionError(
            f"{object_type} is tenant-scoped; refusing to query without a tenant_id"
        )

    sql += f" ORDER BY 1 LIMIT {int(limit)}"
    rows = await conn.fetch(sql, *args)
    return [_decode_values(onto, object_type, dict(r)) for r in rows]


async def traverse(
    conn: asyncpg.Connection,
    onto: Ontology,
    link_name: str,
    from_id: Any,
    tenant_id: str | None = None,
) -> list[dict[str, Any]]:
    """Follow a declared link. No hand-written join anywhere in this function."""
    link = onto.links[link_name]
    to_type = link["to_type"]
    binding = onto.bindings[to_type]
    table = f"{qi(binding['schema_name'])}.{qi(binding['table_name'])}"

    sql = (
        f"SELECT {', '.join(_select_list(onto, to_type))} FROM {table} "
        f"WHERE {qi(link['to_column'])} = $1::uuid"
    )
    args: list[Any] = [from_id]

    if binding.get("tenant_column") and tenant_id is not None:
        sql += f" AND {qi(binding['tenant_column'])} = $2::uuid"
        args.append(tenant_id)

    rows = await conn.fetch(sql, *args)
    return [_decode_values(onto, to_type, dict(r)) for r in rows]


async def load_action_context(
    conn: asyncpg.Connection, onto: Ontology, object_type: str, object_id: Any
) -> dict[str, Any]:
    """Fetch the raw backing row a precondition is evaluated against.

    Deliberately the *physical* row, not the mapped object: preconditions in the
    base package are written against base column names, so a client-backed
    object type resolves through value_map first.
    """
    binding = onto.bindings[object_type]
    table = f"{qi(binding['schema_name'])}.{qi(binding['table_name'])}"
    row = await conn.fetchrow(
        f"SELECT * FROM {table} WHERE {qi(binding['pk_column'])}::text = $1", str(object_id)
    )
    if row is None:
        return {}

    data = dict(row)
    # normalise client vocabulary onto base vocabulary before the gate sees it
    value_map = binding.get("value_map") or {}
    column_map = binding.get("column_map") or {}
    for prop_name, mapping in value_map.items():
        physical = column_map.get(prop_name)
        if physical and physical in data and data[physical] in mapping:
            data[physical] = mapping[data[physical]]
        # also expose under the base column name the precondition expects
        base_prop = onto.properties.get(object_type, {}).get(prop_name, {})
        base_column = base_prop.get("column_name")
        if base_column and physical and physical in data:
            data[base_column] = data[physical]
    return data


def evaluate_gate(onto: Ontology, action: str, context: dict[str, Any]) -> tuple[bool, dict]:
    """Evaluate an action's precondition. Returns (passed, the rule applied).

    Fails closed on a malformed rule. A precondition that is not an object is a
    JsonLogic *literal*, and a non-empty literal is truthy — so a corrupted or
    double-encoded rule would otherwise turn the gate permanently open. A gate
    that silently stops gating is the worst failure this component has.
    """
    rule = onto.actions[action]["preconditions"]
    if rule is None or rule == {}:
        return True, rule
    if not isinstance(rule, dict):
        raise ValueError(
            f"precondition for {action!r} is {type(rule).__name__}, expected an object — "
            f"refusing to evaluate (a literal rule would always pass): {rule!r}"
        )
    return bool(jsonlogic.apply(rule, context)), rule

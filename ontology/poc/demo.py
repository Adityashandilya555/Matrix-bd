#!/usr/bin/env python3
"""Five proofs, against real Matrix column definitions.

Run with:  make demo   (or  backend/.venv/bin/python demo.py  from ontology/poc)

Nothing in backend/ or frontend/ is imported or modified. The database is a
throwaway container — never the dev or prod Supabase project.
"""

from __future__ import annotations

import asyncio
import json

from kernel import registry, resolver

TENANT_A = "11111111-1111-1111-1111-111111111111"  # Coffee Chain Co  — base ontology
TENANT_B = "22222222-2222-2222-2222-222222222222"  # QSR Brands Ltd   — overlay
TENANT_C = "33333333-3333-3333-3333-333333333333"  # Franchise Ltd    — own ERP

SITE_A2 = "5171e002-0000-0000-0000-000000000002"   # legal positive, finance pending
SITE_B2 = "5171e005-0000-0000-0000-000000000005"   # legal positive, finance pending

BASE_RULE = {
    "and": [
        {"==": [{"var": "legal_dd_status"}, "positive"]},
        {"==": [{"var": "finance_status"}, "approved"]},
    ]
}
REORDERED_RULE = {"==": [{"var": "legal_dd_status"}, "positive"]}


def head(n: int, title: str) -> None:
    print(f"\n\033[1m{'━' * 74}\033[0m")
    print(f"\033[1m  PROOF {n} — {title}\033[0m")
    print(f"\033[1m{'━' * 74}\033[0m")


def ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


def info(msg: str) -> None:
    print(f"    {msg}")


# ─────────────────────────────────────────────────────────────────────────────
async def proof_flow_reorder(conn) -> None:
    head(3, "Approval flow reorder — requirement #3")
    print("  Today this gate is Python: _assert_design_unlocked, design_service.py:229")
    print("  'site.legal_dd_status == positive AND site.finance_status == approved'\n")

    onto_a = await registry.load(conn, TENANT_A)
    onto_b = await registry.load(conn, TENANT_B)

    ctx_a = await resolver.load_action_context(conn, onto_a, "Site", SITE_A2)
    ctx_b = await resolver.load_action_context(conn, onto_b, "Site", SITE_B2)

    info(f"Tenant A site BLR-002: legal={ctx_a['legal_dd_status']}, finance={ctx_a['finance_status']}")
    info(f"Tenant B site DEL-002: legal={ctx_b['legal_dd_status']}, finance={ctx_b['finance_status']}")
    print("  Identical data. Different flows. Same process, same code:\n")

    passed_a, rule_a = resolver.evaluate_gate(onto_a, "design.open", ctx_a)
    passed_b, rule_b = resolver.evaluate_gate(onto_b, "design.open", ctx_b)

    info(f"A ({onto_a.version_chain[-1]}):  design.open → \033[31m{passed_a}\033[0m   blocked, finance not approved")
    info(f"    rule: {json.dumps(rule_a)}")
    info(f"B ({onto_b.version_chain[-1]}):        design.open → \033[32m{passed_b}\033[0m    unblocked, finance runs AFTER design")
    info(f"    rule: {json.dumps(rule_b)}")

    assert passed_a is False and passed_b is True
    ok("two tenants running different approval orders concurrently")

    # ── now change tenant A's flow at runtime ───────────────────────────────
    print("\n  Now reorder tenant A's flow — an UPDATE, not a deploy:\n")
    await registry.set_precondition(conn, "matrix-retail-base", "design.open", REORDERED_RULE)

    onto_a2 = await registry.load(conn, TENANT_A)
    passed_a2, rule_a2 = resolver.evaluate_gate(onto_a2, "design.open", ctx_a)
    info(f"A: design.open → \033[32m{passed_a2}\033[0m")
    info(f"    rule: {json.dumps(rule_a2)}")

    # A rule that round-trips as anything but an object is a literal, and a
    # truthy literal is an always-open gate. Assert the shape, not just the verdict.
    assert isinstance(rule_a2, dict), f"rule round-tripped as {type(rule_a2).__name__}"
    assert passed_a2 is True
    ok("gate flipped False → True with zero Python changed")

    await registry.set_precondition(conn, "matrix-retail-base", "design.open", BASE_RULE)
    info("(base rule restored so the demo is idempotent)")

    # fail-closed check: a malformed rule must raise, never silently pass
    onto_bad = await registry.load(conn, TENANT_A)
    onto_bad.actions["design.open"]["preconditions"] = '{"==": ["a","a"]}'  # a string
    try:
        resolver.evaluate_gate(onto_bad, "design.open", ctx_a)
    except ValueError:
        ok("a malformed (non-object) rule is refused instead of defaulting to open")
    else:
        raise AssertionError("malformed rule silently evaluated — gate would be always-open")


# ─────────────────────────────────────────────────────────────────────────────
async def proof_rename_and_add(conn) -> None:
    head(4, "Rename fields, add fields — requirement #4")

    onto_a = await registry.load(conn, TENANT_A)
    onto_b = await registry.load(conn, TENANT_B)

    info(f"Tenant A calls it:  {onto_a.display_name('Site')!r}")
    info(f"Tenant B calls it:  {onto_b.display_name('Site')!r}   ← same object type, renamed")

    labels_a = onto_a.property_labels("Site")
    labels_b = onto_b.property_labels("Site")
    info(f"A: expectedRent → {labels_a['expectedRent']!r}")
    info(f"B: expectedRent → {labels_b['expectedRent']!r}   ← renamed")

    added = set(labels_b) - set(labels_a)
    info(f"B adds: {sorted(added)}   ← exists in no base table")

    rows_b = await resolver.query_objects(conn, onto_b, "Site", TENANT_B)
    print()
    for r in rows_b:
        info(
            f"{r['code']}  {r['name']:<24}  rent={r['expectedRent']}  "
            f"royalty={r['franchiseRoyaltyPct']}"
        )

    assert onto_b.display_name("Site") == "Outlet"
    assert labels_b["expectedRent"] == "Base Rent"
    assert "franchiseRoyaltyPct" in added
    assert all(r["franchiseRoyaltyPct"] is not None for r in rows_b)
    ok("renamed type, renamed property, and an added property served by one resolver")


# ─────────────────────────────────────────────────────────────────────────────
async def proof_relationships(conn) -> None:
    head(5, "Relationships captured — requirement #5")

    onto = await registry.load(conn, TENANT_A)
    info(f"declared links: {sorted(onto.links)}")
    for name, link in onto.links.items():
        info(
            f"  {name}: {link['from_type']} → {link['to_type']} "
            f"({link['cardinality']}, {link['from_column']}→{link['to_column']})"
        )
    print()

    legal = await resolver.traverse(conn, onto, "siteLegalDd", SITE_A2)
    budgets = await resolver.traverse(conn, onto, "siteBudgets", SITE_A2, TENANT_A)

    info(f"Site BLR-002 → LegalDD:     verdict={legal[0]['finalVerdict']}, stage={legal[0]['stage']}")
    info(f"Site BLR-002 → SiteBudget:  phase={budgets[0]['phase']}, total={budgets[0]['budgetTotal']}")

    assert legal and budgets
    ok("Site → LegalDD → SiteBudget traversed with no hand-written join")


# ─────────────────────────────────────────────────────────────────────────────
async def proof_client_mapping(conn) -> None:
    head(2, "Client connects their own database — requirement #2")

    onto_c = await registry.load(conn, TENANT_C)
    binding = onto_c.bindings["Site"]
    info(f"Site is backed by: {binding['schema_name']}.{binding['table_name']}  (not public.sites)")
    info(f"pk: {binding['pk_column']!r} (text, not uuid)")
    info(f"column_map: {json.dumps(binding['column_map'])[:88]}…")
    print()

    rows = await resolver.query_objects(conn, onto_c, "Site", TENANT_C)
    for r in rows:
        info(
            f"{r['code']:<9} {r['name']:<22} city={r['city']:<6} "
            f"status={r['status']:<18} legal={r['legalDdStatus']:<10} finance={r['financeStatus']}"
        )

    assert len(rows) == 3
    # their vocabulary ('LIVE'/'CLEARED'/'RELEASED') is normalised to ours
    assert {r["status"] for r in rows} <= {"approved", "details_submitted"}
    assert {r["legalDdStatus"] for r in rows} <= {"positive", "in_review", "negative"}
    ok("client table + client vocabulary resolved into the base Site object type")

    ctx = await resolver.load_action_context(conn, onto_c, "Site", "STR-4472")
    passed, _ = resolver.evaluate_gate(onto_c, "design.open", ctx)
    info(f"and the base gate evaluates against it: design.open → {passed}")
    assert passed is False
    ok("the same precondition runs unmodified over a foreign schema")


# ─────────────────────────────────────────────────────────────────────────────
async def proof_isolation(conn) -> None:
    head(6, "Tenant isolation — the predicate lives in one place")

    onto_a = await registry.load(conn, TENANT_A)
    rows_a = await resolver.query_objects(conn, onto_a, "Site", TENANT_A)
    info(f"tenant A sees {len(rows_a)} sites: {[r['code'] for r in rows_a]}")

    onto_b = await registry.load(conn, TENANT_B)
    rows_b = await resolver.query_objects(conn, onto_b, "Site", TENANT_B)
    info(f"tenant B sees {len(rows_b)} sites: {[r['code'] for r in rows_b]}")

    assert len(rows_a) == 3 and len(rows_b) == 2
    assert not ({r["code"] for r in rows_a} & {r["code"] for r in rows_b})
    ok("no row crosses the tenant boundary")

    try:
        await resolver.query_objects(conn, onto_a, "Site", tenant_id=None)
    except PermissionError as exc:
        ok(f"unscoped read fails closed: {exc}")
    else:
        raise AssertionError("unscoped read should have been refused")


# ─────────────────────────────────────────────────────────────────────────────
async def proof_interfaces(conn) -> None:
    head(7, "Interfaces — the primitive that makes modules cheap (requirement #7)")

    onto = await registry.load(conn, TENANT_A)
    for name in sorted(onto.interfaces):
        impls = onto.implementers(name)
        info(f"{name:<12} implemented by: {impls or '—'}")

    assert set(onto.implementers("Approvable")) == {"Site", "SiteBudget"}
    ok("one approval behaviour, bound to N object types by declaration")
    info("a new module declares implements:[Approvable, Documented] and inherits both")


# ─────────────────────────────────────────────────────────────────────────────
async def main() -> None:
    conn = await registry.connect()
    try:
        onto = await registry.load(conn, TENANT_A)
        print(f"\n  registry loaded — version chain: {' → '.join(onto.version_chain)}")
        print(f"  object types: {sorted(onto.object_types)}")

        await proof_client_mapping(conn)
        await proof_flow_reorder(conn)
        await proof_rename_and_add(conn)
        await proof_relationships(conn)
        await proof_isolation(conn)
        await proof_interfaces(conn)

        print(f"\n\033[1;32m{'━' * 74}\033[0m")
        print("\033[1;32m  ALL PROOFS PASSED\033[0m")
        print(f"\033[1;32m{'━' * 74}\033[0m\n")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())

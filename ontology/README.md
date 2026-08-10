# `ontology/` — experimental platform work

> **This branch is never merged into `main`.** Not by merge, not by PR, not by
> cherry-pick, until explicitly requested.

Experimental work on turning Matrix from a hand-built BD ops app into a
**vertical Palantir**: a pre-configured retail-expansion ontology and base flow
that a client maps their own databases onto, then edits.

## Read in this order

| File | What it is |
|---|---|
| [`Palantir_Evaluation.md`](./Palantir_Evaluation.md) | Foundry's real architecture, and a primitive-by-primitive scorecard of Matrix against it |
| [`Build_Sequence.md`](./Build_Sequence.md) | The roadmap, reordered around your seven requirements |
| [`poc/`](./poc/) | A runnable proof of five of them |
| `../Matrix_V3_Platform_Path.md` | The prior architecture doc — still the reference for the target state |

## Running the PoC

```bash
cd ontology && make up && make demo
```

Requires Docker. On this machine that means `colima start` first. Teardown:

```bash
cd ontology && make down
```

### What it proves

| Proof | Requirement | Claim |
|---|---|---|
| 2 | Client connects their own DB | A foreign table (`client_erp.store_master`) with different column names, a text primary key, and a different vocabulary (`CLEARED` → `positive`) resolves into the base `Site` object type via `column_map` + `value_map` |
| 3 | Approval flow reorder | Two tenants run **different approval orders concurrently** on identical data. Then tenant A's gate flips `False` → `True` via an `UPDATE`, with zero Python changed |
| 4 | Rename + add fields | Tenant B sees `Outlet` / `Base Rent` and an added `franchiseRoyaltyPct` that exists in no base table — one resolver serves both tenants |
| 5 | Relationships | `Site → LegalDD` and `Site → SiteBudget` traversed from declared `link_type` rows, no hand-written join |
| 6 | Tenant isolation | No row crosses the boundary; an unscoped read on a tenant-scoped type **fails closed** |
| 7 | Interfaces | `Approvable` bound to two object types by declaration |

### What it is not

- **Not** wired to the app. Nothing in `backend/` or `frontend/` is imported or modified.
- **Not** pointed at a real database. It runs a throwaway Postgres on `127.0.0.1:55432`, seeded from `poc/sql/`. Never the dev or prod Supabase project.
- **Not** a write path. The PoC proves the *read* and *gate* halves. Matrix's existing `assert_transition → mutate → audit → notify` remains the only writer, and stays.
- **Not** complete on requirement #7. Interfaces are proven; packaging and versioning are not built.
- **Not** RDF. Foundry uses none, and neither does this. See `Palantir_Evaluation.md` §0.

## Layout

```
poc/
├── sql/
│   ├── 01_matrix_subset.sql   sites, legal_dd_checklist, site_budgets — VERBATIM
│   │                          from backend/database/schema.sql, CHECK constraints included
│   ├── 02_registry.sql        the ontology.* registry (V3 §4)
│   ├── 03_seed_data.sql       three tenants, five sites
│   ├── 04_client_schema.sql   a mock client ERP that resembles nothing of ours
│   └── 05_seed_registry.sql   base package + two tenant overlays
├── kernel/
│   ├── jsonlogic.py           ~120 lines, zero dependencies
│   ├── registry.py            load + resolve base/overlay version chain
│   └── resolver.py            generic reads, tenant predicate, link traversal, gates
└── demo.py                    the proofs
```

## One finding worth carrying forward

A precondition that round-trips out of Postgres as a JSON **string** instead of a
JSON object evaluates as a truthy JsonLogic *literal* — turning an approval gate
permanently **open**, while still reporting a pass.

This is the specific hazard of moving gates from code to data: a malformed Python
`if` raises; a malformed rule row just permits. `evaluate_gate()` now fails closed
on any non-object rule, and `demo.py` asserts the rule's shape rather than only
its verdict. Any production implementation needs the same guard plus a CI check
that validates `preconditions` rows before publish. See `Palantir_Evaluation.md` §6.

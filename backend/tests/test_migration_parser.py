"""Regression tests for the startup migration SQL splitter.

A `$$` written inside a `--` comment used to flip the runner's dollar-quote
state and shred every following statement. On production this silently killed
20260814 (its DO block was split into invalid fragments) and 20260815 (the whole
file was swallowed as one unterminated statement, so none of the six columns were
dropped). See _parse_sql_statements in app.main.
"""
import os

from app.main import _MIGRATION_DIR, _parse_sql_statements


def _read(name: str) -> str:
    with open(os.path.join(_MIGRATION_DIR, name), encoding="utf-8") as fh:
        return fh.read()


def _code_only(stmt: str) -> str:
    """Drop `--` comment lines so keyword counts measure real SQL, not prose."""
    return "\n".join(
        l for l in stmt.splitlines() if not l.lstrip().startswith("--")
    )


def test_dollar_dollar_inside_comment_does_not_shred_statements():
    """The exact failure pattern: an odd `$$` in a comment must not corrupt
    detection of the following statements."""
    sql = (
        "-- Runner notes: the runner only recognises `$$` for dollar-quote\n"
        "-- detection, and this comment mentions it once.\n"
        "ALTER TABLE public.t DROP COLUMN IF EXISTS a;\n"
        "ALTER TABLE public.t DROP COLUMN IF EXISTS b;\n"
    )
    stmts = _parse_sql_statements(sql)
    assert len(stmts) == 2
    assert stmts[0].endswith("DROP COLUMN IF EXISTS a;")
    assert stmts[1].endswith("DROP COLUMN IF EXISTS b;")


def test_do_block_survives_a_dollar_dollar_comment():
    """A DO block preceded by a comment that contains `$$` must stay intact,
    not be split at its internal semicolons."""
    sql = (
        "-- note: the runner recognises `$$` for dollar-quote detection\n"
        "ALTER TABLE public.t ADD COLUMN c int;\n"
        "DO $$\n"
        "BEGIN\n"
        "    IF true THEN\n"
        "        RAISE WARNING 'hi';\n"
        "    END IF;\n"
        "END $$;\n"
    )
    stmts = _parse_sql_statements(sql)
    assert len(stmts) == 2
    assert stmts[0].endswith("ADD COLUMN c int;")
    # The DO block is one statement, with its body intact.
    assert stmts[1].count("RAISE WARNING 'hi';") == 1
    assert stmts[1].rstrip().endswith("$$;")


def test_real_20260815_drops_all_six_columns():
    stmts = _parse_sql_statements(_read("20260815_drop_dead_bd_columns.sql"))
    drops = [s for s in stmts if "DROP COLUMN IF EXISTS" in s]
    assert len(drops) == 6
    for col in (
        "address", "notes", "spoc_email", "spoc_phone",
        "onedrive_item_id", "onedrive_synced_at",
    ):
        assert any(col in s for s in drops), f"missing DROP for {col}"


def test_real_20260814_keeps_alters_and_intact_do_block():
    stmts = _parse_sql_statements(_read("20260814_site_delete_cascades.sql"))
    code = "\n".join(_code_only(s) for s in stmts)
    # 5 tables x (DROP CONSTRAINT + ADD CONSTRAINT), each its own statement.
    assert code.count("DROP CONSTRAINT IF EXISTS") == 5
    assert code.count("ADD CONSTRAINT") == 5
    # Exactly one DO block, not shredded into BEGIN/IF/END fragments — the
    # smoking gun of the old bug was fragments like a lone "END IF;" statement.
    do_blocks = [s for s in stmts if "DO $$" in s]
    assert len(do_blocks) == 1
    assert do_blocks[0].count("RAISE WARNING") == 1
    assert "END IF;" in do_blocks[0] and do_blocks[0].rstrip().endswith("$$;")
    assert not any(s.strip() in ("END IF;", "END $$;", "BEGIN") for s in stmts)


def test_normal_do_block_migration_still_parses():
    """20260816 has a DO block and no `$$` in comments — must be unaffected."""
    stmts = _parse_sql_statements(_read("20260816_add_observer_role.sql"))
    assert any("DO $$" in s and s.rstrip().endswith("$$;") for s in stmts)
    assert any(s.lstrip().startswith("ALTER TABLE") for s in stmts)


def test_begin_commit_are_stripped():
    sql = "BEGIN;\nALTER TABLE public.t ADD COLUMN d int;\nCOMMIT;\n"
    stmts = _parse_sql_statements(sql)
    assert stmts == ["ALTER TABLE public.t ADD COLUMN d int;"]

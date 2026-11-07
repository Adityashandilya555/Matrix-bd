"""schema.sql must keep up with the migrations.

No migration creates the core tables, so a blank database can only be built by
loading schema.sql. The startup runner then BASELINES every migration without
running it (app/main.py), so anything schema.sql lacks is simply missing, and
the app fails at runtime: workspace approval on password_reset_requests, vendor
creation on users_role_check.
"""
import re
from pathlib import Path

DATABASE_DIR = Path(__file__).parents[1] / "database"


def _read(path: Path) -> str:
    return re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))


def _schema_tables() -> dict[str, str]:
    """Table name -> body of its CREATE TABLE in schema.sql."""
    found = re.finditer(
        r"CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)\s*\((.*?)\n\);",
        _read(DATABASE_DIR / "schema.sql"),
        re.S,
    )
    return {match[1]: match[2] for match in found}


def _migration_objects() -> tuple[set[str], set[tuple[str, str]]]:
    """Tables and (table, column) pairs that survive every migration, in runner order."""
    tables: set[str] = set()
    columns: set[tuple[str, str]] = set()
    for path in sorted((DATABASE_DIR / "migrations").glob("*.sql")):
        sql = _read(path)
        tables |= set(re.findall(r"CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?\"?(\w+)", sql, re.I))
        tables -= set(re.findall(r"DROP TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?\"?(\w+)", sql, re.I))
        for table, body in re.findall(r"ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)(.*?);", sql, re.S | re.I):
            columns |= {(table, c) for c in re.findall(r"ADD COLUMN\s+(?:IF NOT EXISTS\s+)?\"?(\w+)", body, re.I)}
            columns -= {(table, c) for c in re.findall(r"DROP COLUMN\s+(?:IF EXISTS\s+)?\"?(\w+)", body, re.I)}
    return tables, columns


def test_schema_has_every_table_and_column_the_migrations_add():
    schema = _schema_tables()
    tables, columns = _migration_objects()
    altered_in = set(re.findall(
        r"ALTER TABLE\s+(?:public\.)?(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)",
        _read(DATABASE_DIR / "schema.sql"),
    ))

    missing = sorted(tables - set(schema))
    missing += sorted(
        f"{table}.{column}"
        for table, column in columns - altered_in
        if table in schema and not re.search(rf"^\s*{column}\b", schema[table], re.M)
    )
    assert not missing


def test_schema_checks_admit_the_values_migrations_widened_them_to():
    schema = _schema_tables()
    assert "'vendor'" in schema["users"]
    assert "'quality_audit'" in schema["site_delegations"]

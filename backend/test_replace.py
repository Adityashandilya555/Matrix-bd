from sqlalchemy import text
from sqlalchemy.dialects import postgresql

# This is what main.py actually does:
stmt = "y := (elem->>'year')::int;"
safe_stmt = stmt.replace(":", "\\:")
print("safe_stmt:", repr(safe_stmt))

t = text(safe_stmt)
compiled = t.compile(dialect=postgresql.dialect())
print("COMPILED TEXT:")
print(compiled.string)

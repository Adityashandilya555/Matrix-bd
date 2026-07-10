from sqlalchemy import text
from sqlalchemy.dialects import postgresql

t = text("y \:= (elem->>'year')\:\:int;")
compiled = t.compile(dialect=postgresql.dialect())
print("COMPILED TEXT:")
print(compiled.string)

import os
import re

# Get SQLAlchemy schema
from app.db.models import Base
sqlalchemy_schema = {}
for table_name, table in Base.metadata.tables.items():
    sqlalchemy_schema[table_name] = {}
    for column in table.columns:
        sqlalchemy_schema[table_name][column.name] = str(column.type)

# Read all SQL files
sql_files = ["backend/database/schema.sql"]
migrations_dir = "backend/database/migrations"
for f in sorted(os.listdir(migrations_dir)):
    if f.endswith(".sql"):
        sql_files.append(os.path.join(migrations_dir, f))

# Find columns in SQL
sql_schema = {}
for fpath in sql_files:
    with open(fpath, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    current_table = None
    
    for i, line in enumerate(lines):
        line = line.strip()
        
        # CREATE TABLE
        m = re.match(r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+) \(", line, re.IGNORECASE)
        if m:
            current_table = m.group(1).lower()
            if current_table not in sql_schema:
                sql_schema[current_table] = {}
            continue
            
        if current_table:
            if line.startswith(");"):
                current_table = None
                continue
                
            if not line or line.startswith("--") or line.upper().startswith("CONSTRAINT") or line.upper().startswith("PRIMARY") or line.upper().startswith("FOREIGN") or line.upper().startswith("UNIQUE") or line.upper().startswith("CHECK"):
                continue
                
            # It's a column definition!
            parts = line.split()
            if len(parts) >= 2:
                col_name = parts[0].strip('"').lower()
                col_type = " ".join(parts[1:]).split(',')[0].strip().upper()
                if "CHECK" in col_type:
                    col_type = col_type.split("CHECK")[0].strip()
                sql_schema[current_table][col_name] = col_type

    content = "".join(lines)
    # ALTER TABLE ADD COLUMN
    for match in re.finditer(r"ALTER TABLE (?:public\.)?(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)\s+([^;]+);", content, re.IGNORECASE):
        table_name = match.group(1).lower()
        col_name = match.group(2).lower()
        col_type = match.group(3).strip()
        if table_name not in sql_schema:
            sql_schema[table_name] = {}
        sql_schema[table_name][col_name] = col_type
        
    # ALTER TABLE RENAME TO (Table rename)
    for match in re.finditer(r"ALTER TABLE (?:public\.)?(\w+)\s+RENAME TO (\w+);", content, re.IGNORECASE):
        old_table = match.group(1).lower()
        new_table = match.group(2).lower()
        if old_table in sql_schema:
            sql_schema[new_table] = sql_schema.pop(old_table)
            
    # ALTER TABLE RENAME COLUMN TO
    for match in re.finditer(r"ALTER TABLE (?:public\.)?(\w+)\s+RENAME COLUMN (\w+) TO (\w+);", content, re.IGNORECASE):
        table_name = match.group(1).lower()
        old_col = match.group(2).lower()
        new_col = match.group(3).lower()
        if table_name in sql_schema and old_col in sql_schema[table_name]:
            sql_schema[table_name][new_col] = sql_schema[table_name].pop(old_col)

# Compare
mismatches = []
for table_name in sqlalchemy_schema:
    if table_name not in sql_schema:
        mismatches.append(f"Table '{table_name}' in models.py but NOT in SQL")
        continue
        
    for col_name, alchemy_type in sqlalchemy_schema[table_name].items():
        if col_name not in sql_schema[table_name]:
            mismatches.append(f"Column '{table_name}.{col_name}' in models.py but NOT in SQL")
            
for table_name in sql_schema:
    if table_name not in sqlalchemy_schema:
        if table_name not in ['business_admins', 'module_codes', 'supervisor_invite_codes', 'user_module_memberships', 'workspace_requests', 'password_reset_requests', 'supervisor_executive_requests', 'project_executions']:
            mismatches.append(f"Table '{table_name}' in SQL but NOT in models.py")
        continue

for m in mismatches:
    print(m)

if not mismatches:
    print("All models matched!")

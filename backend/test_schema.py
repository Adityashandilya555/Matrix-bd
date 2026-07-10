import sys
import re

# 1. Parse schema.sql
schema = {}
current_table = None

with open("backend/database/schema.sql", "r") as f:
    for line in f:
        line = line.strip()
        
        # Match table creation
        m_table = re.match(r"CREATE TABLE public\.(\w+)", line)
        if m_table:
            current_table = m_table.group(1)
            schema[current_table] = {}
            continue
            
        if current_table and line and not line.startswith("--") and not line.startswith("CONSTRAINT") and not line.startswith(")") and not line.startswith("CREATE") and not line.startswith("ALTER"):
            # Extract column
            parts = line.split()
            if len(parts) >= 2:
                col_name = parts[0]
                col_type = " ".join(parts[1:]).split(',')[0]
                
                # Strip comments
                if "--" in col_type:
                    col_type = col_type.split("--")[0].strip()
                    
                schema[current_table][col_name] = col_type.lower()

# 2. Get SQLAlchemy metadata
from app.db.models import Base
sqlalchemy_schema = {}
for table_name, table in Base.metadata.tables.items():
    sqlalchemy_schema[table_name] = {}
    for column in table.columns:
        sqlalchemy_schema[table_name][column.name] = str(column.type)

# 3. Compare
mismatches = []
for table_name in sqlalchemy_schema:
    if table_name not in schema:
        mismatches.append(f"Table '{table_name}' in models.py but NOT in schema.sql")
        continue
    
    # Compare columns
    for col_name in sqlalchemy_schema[table_name]:
        if col_name not in schema[table_name]:
            # It might have been added in a migration!
            # Let's check migrations
            mismatches.append(f"Column '{table_name}.{col_name}' in models.py but NOT in schema.sql")
            
for table_name in schema:
    if table_name not in sqlalchemy_schema:
        mismatches.append(f"Table '{table_name}' in schema.sql but NOT in models.py")
        continue
    
    for col_name in schema[table_name]:
        if col_name not in sqlalchemy_schema[table_name]:
            mismatches.append(f"Column '{table_name}.{col_name}' in schema.sql but NOT in models.py")

if mismatches:
    print("Found mismatches between models.py and schema.sql (not accounting for migrations):")
    for m in mismatches:
        print("  - " + m)
else:
    print("No mismatches found between models.py and schema.sql!")


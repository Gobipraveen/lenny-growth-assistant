import os
from sqlalchemy import create_engine, inspect
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL")
if db_url and db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url)
inspector = inspect(engine)

print("Tables:", inspector.get_table_names())

for table in ["chat_sessions", "chat_messages"]:
    print(f"\nTable: {table}")
    columns = inspector.get_columns(table)
    for col in columns:
        print(f"  - {col['name']} ({col['type']})")

    indexes = inspector.get_indexes(table)
    print("  Indexes:")
    for idx in indexes:
        print(f"    - {idx['name']} on {idx['column_names']}")

    fks = inspector.get_foreign_keys(table)
    print("  Foreign Keys:")
    for fk in fks:
        print(f"    - {fk['name']}: {fk['constrained_columns']} -> {fk['referred_table']}.{fk['referred_columns']}")

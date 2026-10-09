import os
import psycopg2
from urllib.parse import urlparse

def check_db():
    from dotenv import load_dotenv
    load_dotenv('.env')
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not found in .env")
        return

    parsed = urlparse(db_url)
    try:
        conn = psycopg2.connect(
            dbname=parsed.path.lstrip('/'),
            user=parsed.username,
            password=parsed.password,
            host=parsed.hostname,
            port=parsed.port
        )
        print("Connection successful! Database and role exist.")
        conn.close()
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    check_db()

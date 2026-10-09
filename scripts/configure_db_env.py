import os
import getpass
import urllib.parse
from pathlib import Path

def main():
    print("=== Database Configuration Helper ===")
    print("This script will securely update your .env file with the database password.")

    password = getpass.getpass("Enter the PostgreSQL password for the 'lenny_app' role: ")
    if not password:
        print("Password cannot be empty. Exiting.")
        return

    # Safely URL-encode the password
    encoded_password = urllib.parse.quote_plus(password)

    # Construct the DATABASE_URL without printing it
    db_url = f"postgresql://lenny_app:{encoded_password}@localhost:5432/lenny_assistant"

    env_path = Path(".env")

    # Read existing .env lines
    lines = []
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    # Update or append DATABASE_URL
    updated = False
    new_lines = []
    for line in lines:
        if line.startswith("DATABASE_URL="):
            new_lines.append(f'DATABASE_URL="{db_url}"\n')
            updated = True
        else:
            new_lines.append(line)

    if not updated:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines[-1] += "\n"
        new_lines.append(f'DATABASE_URL="{db_url}"\n')

    # Write back to .env
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    print("Successfully updated DATABASE_URL in .env securely.")

if __name__ == "__main__":
    main()

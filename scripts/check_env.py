"""Environment verification script for Lenny Growth Assistant.

Runs local checks on installed dependencies and prints operational status.
"""

import sys
import shutil
import subprocess


def check_tool(name: str, cmd: list) -> str:
    path = shutil.which(cmd[0])
    if not path:
        return f"[MISSING] {name} is not found in PATH"
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        version_str = res.stdout.strip().splitlines()[0] if res.stdout else "Available"
        return f"[OK] {name}: {version_str} ({path})"
    except Exception as e:
        return f"[WARN] {name} found at {path} but command failed: {e}"


def main():
    print("=" * 60)
    print("Lenny Growth Assistant - Environment Verification")
    print("=" * 60)
    print(f"[OK] Python: {sys.version.split()[0]} ({sys.executable})")
    print(check_tool("Node.js", ["node", "--version"]))
    print(check_tool("npm", ["npm", "--version"]))
    print(check_tool("Ollama", ["ollama", "--version"]))
    print(check_tool("Docker", ["docker", "--version"]))
    print(check_tool("PostgreSQL (psql)", ["psql", "--version"]))
    print("=" * 60)


if __name__ == "__main__":
    main()

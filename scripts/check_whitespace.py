"""
Script to detect trailing whitespace in project files.
"""
import os
import re

EXCLUDE_DIRS = {'.venv', 'node_modules', 'dist', '.pytest_cache', '.git', '__pycache__'}
EXCLUDE_FILES = {'.env'}

def scan_whitespace():
    found = {}
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f in EXCLUDE_FILES:
                continue
            path = os.path.normpath(os.path.join(root, f))
            # skip binaries
            if path.endswith(('.png', '.ico', '.pdf', '.docx', '.pyc', '.wasm')):
                continue
            try:
                with open(path, 'r', encoding='utf-8') as fp:
                    lines = fp.readlines()
                matches = []
                for idx, line in enumerate(lines, 1):
                    raw = line.rstrip('\r\n')
                    if raw != raw.rstrip(' \t'):
                        matches.append((idx, repr(raw[-10:])))
                if matches:
                    found[path] = matches
            except UnicodeDecodeError:
                pass
    return found

if __name__ == '__main__':
    results = scan_whitespace()
    if not results:
        print("No trailing whitespace found!")
    else:
        print(f"Found trailing whitespace in {len(results)} files:")
        for p, lines in results.items():
            print(f"  {p} ({len(lines)} lines): {[l[0] for l in lines]}")

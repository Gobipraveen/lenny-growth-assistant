import os
import sys

def fix_whitespace():
    # Find files using the existing logic and fix them
    # For brevity, let's just run across the project files
    def get_files():
        ignore_dirs = {'.git', '.venv', 'node_modules', '__pycache__', 'dist', 'build'}
        for root, dirs, files in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            for file in files:
                if not file.endswith(('.py', '.md', '.txt', '.json', '.sql', '.env.example', '.ini', '.mako')):
                    continue
                yield os.path.join(root, file)

    for filepath in get_files():
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            changed = False
            for i, line in enumerate(lines):
                if line.endswith(' \n') or line.endswith('\t\n'):
                    lines[i] = line.rstrip() + '\n'
                    changed = True

            if changed:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.writelines(lines)
                print(f"Fixed {filepath}")
        except Exception as e:
            pass

if __name__ == "__main__":
    fix_whitespace()

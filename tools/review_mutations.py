"""Targeted mutation spot checks in temporary copies; stdlib only."""

import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MUTATIONS = [
    (
        "null-comparison-becomes-true",
        "src/query_forge/engine.py",
        "if left is None or right is None:\n        return None",
        "if left is None or right is None:\n        return True",
    ),
    (
        "hash-join-drops-duplicates",
        "src/query_forge/engine.py",
        "for matching in buckets.get(key, ()):",
        "for matching in buckets.get(key, ())[:1]:",
    ),
    ("count-includes-null", "src/query_forge/engine.py", "+ (value is not None)", "+ 1"),
]


def main():
    results = []
    for name, relative, old, new in MUTATIONS:
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "project"
            shutil.copytree(
                ROOT,
                copied,
                ignore=shutil.ignore_patterns(
                    ".git",
                    ".venv",
                    "__pycache__",
                    "*.egg-info",
                    "artifacts",
                    "dist",
                    "build",
                    "*.db",
                    "*.db-wal",
                    "*.db-shm",
                ),
            )
            target = copied / relative
            source = target.read_text()
            if old not in source:
                raise RuntimeError(f"Mutation target missing: {name}")
            target.write_text(source.replace(old, new))
            run = subprocess.run(
                [sys.executable, "-m", "unittest", "discover", "-s", "conformance", "-q"],
                cwd=copied,
                env=dict(os.environ, PYTHONPATH=str(copied / "src")),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=90,
            )
            results.append(
                {
                    "mutation": name,
                    "tested_source_sha256": hashlib.sha256(source.encode()).hexdigest(),
                    "killed": run.returncode != 0 and ("FAIL:" in run.stdout or "ERROR:" in run.stdout),
                    "returncode": run.returncode,
                    "evidence": run.stdout[-1800:],
                }
            )
    print(
        json.dumps({"method": "temporary source mutations; working source unchanged", "mutations": results}, indent=2)
    )
    if not all(result["killed"] for result in results):
        raise SystemExit("A targeted mutation survived; inspect evidence.")


if __name__ == "__main__":
    main()

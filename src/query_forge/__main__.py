import argparse
import json
from pathlib import Path

from .engine import Engine
from .experiments import catalog, demo, evaluate


def main():
    parser = argparse.ArgumentParser(description="Typed SQL, cost plans and batch execution")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("demo", "evaluate", "query", "explain"):
        command = sub.add_parser(name)
        command.add_argument("--output", type=Path)
        if name in {"query", "explain"}:
            command.add_argument("--sql", required=True)
            command.add_argument("--reference", action="store_true")
            command.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()
    if args.command in {"query", "explain"}:
        engine = Engine(catalog(), batch_size=args.batch_size)
        report = (
            engine.explain(args.sql, optimize=not args.reference)
            if args.command == "explain"
            else engine.execute(args.sql, optimize=not args.reference)
        )
    else:
        report = demo() if args.command == "demo" else evaluate()
    value = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(value)
    else:
        print(value, end="")


if __name__ == "__main__":
    main()

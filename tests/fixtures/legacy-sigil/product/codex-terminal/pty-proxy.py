#!/usr/bin/env python3
"""Compatibility wrapper for the toolkit Agent Terminal PTY proxy."""

import os
import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    target = repo_root / "packages" / "toolkit" / "components" / "agent-terminal" / "pty-proxy.py"
    os.execv(sys.executable, [sys.executable, str(target), *sys.argv[1:]])


if __name__ == "__main__":
    main()

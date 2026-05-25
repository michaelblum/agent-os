#!/usr/bin/env python3

import json
import os
import pathlib
import sqlite3
import subprocess
import sys

NAMESPACE = "aos"


def fail(message, code):
    print(json.dumps({"code": code, "error": message}, indent=2), file=sys.stderr)
    sys.exit(1)


def runtime_mode():
    return "installed" if os.environ.get("AOS_RUNTIME_MODE") == "installed" else "repo"


def state_root():
    return pathlib.Path(os.environ.get("AOS_STATE_ROOT", "~/.config/aos")).expanduser().resolve()


def wiki_root():
    return state_root() / runtime_mode() / "wiki"


def db_path():
    return wiki_root() / "wiki.db"


def aos_path():
    return os.environ.get("AOS_PATH") or str(pathlib.Path.cwd() / "aos")


def parse_args(args):
    options = {"json": False, "fix": False}
    for arg in args:
        if arg == "--json":
            options["json"] = True
        elif arg == "--fix":
            options["fix"] = True
        elif arg.startswith("--"):
            fail(f"Unknown flag: {arg}", "UNKNOWN_FLAG")
        else:
            fail(f"Unexpected argument: {arg}", "UNKNOWN_ARG")
    return options


def ensure_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pages (
            path TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            tags TEXT,
            plugin TEXT,
            modified_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
            source_path TEXT NOT NULL,
            target_path TEXT NOT NULL,
            UNIQUE(source_path, target_path)
        );
        CREATE TABLE IF NOT EXISTS plugins (
            name TEXT PRIMARY KEY,
            version TEXT,
            author TEXT,
            description TEXT,
            triggers TEXT,
            requires TEXT,
            modified_at INTEGER NOT NULL
        );
    """)


def connect():
    root = wiki_root()
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def run_reindex():
    result = subprocess.run(
        [aos_path(), "wiki", "reindex", "--json"],
        cwd=pathlib.Path.cwd(),
        env=os.environ,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        sys.exit(result.returncode)


def rows(conn, sql, params=()):
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def issue(severity, category, path, message):
    return {"severity": severity, "category": category, "path": path, "message": message}


def candidate_dirs(kind):
    root = wiki_root()
    return [rel for rel in [f"{NAMESPACE}/{kind}", kind] if (root / rel).is_dir()]


def resolve_plugin_skill(name):
    root = wiki_root()
    for rel in [f"{NAMESPACE}/plugins/{name}/SKILL.md", f"plugins/{name}/SKILL.md"]:
        if (root / rel).exists():
            return rel
    return None


def lint(options):
    if options["fix"]:
        run_reindex()

    root = wiki_root()
    conn = connect()
    pages = rows(conn, "SELECT path, type, name, description, tags, plugin, modified_at FROM pages ORDER BY name")
    page_paths = {page["path"] for page in pages}
    issues = []

    for page in pages:
        for link in rows(conn, "SELECT source_path, target_path FROM links WHERE source_path = ? ORDER BY target_path", (page["path"],)):
            if link["target_path"] in page_paths:
                continue
            if not (root / link["target_path"]).exists():
                issues.append(issue(
                    "error",
                    "broken_link",
                    page["path"],
                    f"Links to '{link['target_path']}' which does not exist",
                ))

    orphans = rows(
        conn,
        """
        SELECT p.path, p.type, p.name, p.description, p.tags, p.plugin, p.modified_at
        FROM pages p
        LEFT JOIN links l ON l.target_path = p.path
        WHERE l.source_path IS NULL
        ORDER BY p.name
        """,
    )
    for page in orphans:
        if page["path"].endswith("SKILL.md"):
            continue
        issues.append(issue("warning", "orphan", page["path"], "No incoming links (orphan page)"))

    for page in pages:
        if not page["name"]:
            issues.append(issue("error", "missing_frontmatter", page["path"], "Missing 'name' in frontmatter"))

    plugins = rows(conn, "SELECT name, version, author, description, triggers, requires, modified_at FROM plugins ORDER BY name")
    for plugin in plugins:
        skill_path = resolve_plugin_skill(plugin["name"])
        if skill_path is None:
            issues.append(issue(
                "error",
                "malformed_plugin",
                f"{NAMESPACE}/plugins/{plugin['name']}",
                "Plugin directory exists but SKILL.md is missing",
            ))
        if not plugin["description"]:
            issues.append(issue(
                "warning",
                "malformed_plugin",
                skill_path or f"{NAMESPACE}/plugins/{plugin['name']}/SKILL.md",
                "Plugin has no description (will not trigger reliably)",
            ))

    for dir_type in ["entities", "concepts"]:
        for relative_dir in candidate_dirs(dir_type):
            directory = root / relative_dir
            for file_path in sorted(directory.iterdir()):
                if not file_path.is_file() or not file_path.name.endswith(".md") or file_path.name.startswith("."):
                    continue
                relative = f"{relative_dir}/{file_path.name}"
                if relative not in page_paths:
                    issues.append(issue(
                        "warning",
                        "index_drift",
                        relative,
                        "File exists on disk but not in index (run 'aos wiki reindex')",
                    ))

    conn.close()
    return issues


def main():
    options = parse_args(sys.argv[1:])
    issues = lint(options)
    if options["json"]:
        print(json.dumps(issues, indent=2, sort_keys=True))
        return
    if not issues:
        print("Wiki is clean. No issues found.")
        return
    errors = [item for item in issues if item["severity"] == "error"]
    warnings = [item for item in issues if item["severity"] == "warning"]
    for item in issues:
        label = "ERROR" if item["severity"] == "error" else "WARN "
        print(f"{label}  [{item['category']}] {item['path']}: {item['message']}")
    print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")


if __name__ == "__main__":
    main()

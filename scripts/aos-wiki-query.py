#!/usr/bin/env python3

import json
import os
import pathlib
import sqlite3
import sys

NAMESPACE = "aos"


def fail(message, code):
    print(json.dumps({"code": code, "error": message}, indent=2), file=sys.stderr)
    sys.exit(1)


def runtime_mode():
    return "installed" if os.environ.get("AOS_RUNTIME_MODE") == "installed" else "repo"


def wiki_root():
    return pathlib.Path(os.environ.get("AOS_STATE_ROOT", "~/.config/aos")).expanduser().resolve() / runtime_mode() / "wiki"


def db_path():
    return wiki_root() / "wiki.db"


def parse_args(args, value_flags=(), boolean_flags=()):
    options = {"json": False, "positionals": []}
    value_flags = set(value_flags)
    boolean_flags = set(boolean_flags)
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--json":
            options["json"] = True
            i += 1
        elif arg in boolean_flags:
            options[arg[2:].replace("-", "_")] = True
            i += 1
        elif arg in value_flags:
            if i + 1 >= len(args):
                fail(f"{arg} requires a value", "MISSING_ARG")
            options[arg[2:].replace("-", "_")] = args[i + 1]
            i += 2
        elif arg.startswith("--"):
            fail(f"Unknown flag: {arg}", "UNKNOWN_FLAG")
        else:
            options["positionals"].append(arg)
            i += 1
    return options


def connect():
    root = wiki_root()
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


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


def rows_to_dicts(rows):
    out = []
    for row in rows:
        item = dict(row)
        if "tags" in item:
            item["tags"] = json.loads(item["tags"]) if item["tags"] else []
        out.append(item)
    return out


def print_json(value):
    print(json.dumps(value, indent=2, sort_keys=True))


def padded(value, length=10):
    return (value + (" " * length))[:length]


def list_command(args):
    opts = parse_args(args, ["--type", "--plugin", "--links-to", "--links-from"], ["--orphans"])
    conn = connect()

    if opts.get("orphans"):
        sql = """
            SELECT p.path, p.type, p.name, p.description, p.tags, p.plugin, p.modified_at
            FROM pages p
            LEFT JOIN links l ON l.target_path = p.path
            WHERE l.source_path IS NULL
            ORDER BY p.name
        """
        rows = rows_to_dicts(conn.execute(sql).fetchall())
        if opts["json"]:
            print_json(rows)
        elif not rows:
            print("No orphan pages.")
        else:
            for row in rows:
                print(f"{padded(row['type'])} {row['path']}  — {row['name']}")
        return

    if "links_to" in opts:
        rows = rows_to_dicts(conn.execute(
            "SELECT source_path, target_path FROM links WHERE target_path = ? ORDER BY source_path",
            (opts["links_to"],),
        ).fetchall())
        if opts["json"]:
            print_json(rows)
        elif not rows:
            print(f"No pages link to {opts['links_to']}.")
        else:
            for row in rows:
                print(f"  {row['source_path']}")
        return

    if "links_from" in opts:
        rows = rows_to_dicts(conn.execute(
            "SELECT source_path, target_path FROM links WHERE source_path = ? ORDER BY target_path",
            (opts["links_from"],),
        ).fetchall())
        if opts["json"]:
            print_json(rows)
        elif not rows:
            print(f"No outgoing links from {opts['links_from']}.")
        else:
            for row in rows:
                print(f"  {row['target_path']}")
        return

    conditions = []
    params = []
    if "type" in opts:
        conditions.append("type = ?")
        params.append(opts["type"])
    if "plugin" in opts:
        conditions.append("plugin = ?")
        params.append(opts["plugin"])
    sql = "SELECT path, type, name, description, tags, plugin, modified_at FROM pages"
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY name"
    rows = rows_to_dicts(conn.execute(sql, params).fetchall())
    if opts["json"]:
        print_json(rows)
    elif not rows:
        print("Wiki is empty. Run 'aos wiki seed' to get started.")
    else:
        for row in rows:
            desc = f" — {row['description'][:60]}" if row.get("description") else ""
            print(f"{padded(row['type'])} {row['path']}{desc}")


def parse_frontmatter(content):
    if not content.startswith("---\n"):
        return {}, content
    end = content.find("\n---", 4)
    if end < 0:
        return {}, content
    raw = {}
    for line in content[4:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        raw[key.strip()] = value.strip().strip("\"'")
    body = content[end + len("\n---"):].lstrip("\r\n")
    return raw, body


def candidate_dirs(kind):
    root = wiki_root()
    return [rel for rel in [f"{NAMESPACE}/{kind}", kind] if (root / rel).is_dir()]


def file_mtime(path):
    try:
        return int(path.stat().st_mtime)
    except OSError:
        return 0


def search_file_content(query, excluding):
    root = wiki_root()
    lower = query.lower()
    results = []
    seen = set()
    for kind, inferred in [("plugins", "workflow"), ("entities", "entity"), ("concepts", "concept")]:
        for rel_dir in candidate_dirs(kind):
            base = root / rel_dir
            for file in sorted(base.rglob("*.md")):
                rel = f"{rel_dir}/{file.relative_to(base)}"
                if rel in excluding or rel in seen:
                    continue
                seen.add(rel)
                content = file.read_text(encoding="utf-8")
                if lower not in content.lower():
                    continue
                frontmatter, _ = parse_frontmatter(content)
                tags = []
                raw_tags = frontmatter.get("tags", "")
                if raw_tags.startswith("[") and raw_tags.endswith("]"):
                    tags = [item.strip() for item in raw_tags[1:-1].split(",") if item.strip()]
                results.append({
                    "path": rel,
                    "type": frontmatter.get("type") or inferred,
                    "name": frontmatter.get("name") or file.name.removesuffix(".md"),
                    "description": frontmatter.get("description") or None,
                    "tags": tags,
                    "plugin": None,
                    "modified_at": file_mtime(file),
                })
    return results


def search_command(args):
    opts = parse_args(args, ["--type"])
    if not opts["positionals"]:
        fail("wiki search requires a query. Usage: aos wiki search <query> [--type <t>] [--json]", "MISSING_ARG")
    query = opts["positionals"][0]
    pattern = f"%{query}%"
    params = [pattern, pattern]
    sql = """
        SELECT path, type, name, description, tags, plugin, modified_at FROM pages
        WHERE (name LIKE ? OR description LIKE ?)
    """
    if "type" in opts:
        sql += " AND type = ?"
        params.append(opts["type"])
    sql += " ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name"
    params.append(pattern)
    conn = connect()
    rows = rows_to_dicts(conn.execute(sql, params).fetchall())
    rows.extend(search_file_content(query, {row["path"] for row in rows}))
    if opts["json"]:
        print_json(rows)
    elif not rows:
        print(f"No results for '{query}'.")
    else:
        for row in rows:
            desc = f" — {row['description'][:60]}" if row.get("description") else ""
            print(f"{padded(row['type'])} {row['path']}{desc}")


def main():
    if len(sys.argv) < 2:
        fail("Missing wiki query command", "MISSING_SUBCOMMAND")
    command, args = sys.argv[1], sys.argv[2:]
    if command == "list":
        list_command(args)
    elif command == "search":
        search_command(args)
    else:
        fail(f"Unknown wiki query command: {command}", "UNKNOWN_COMMAND")


if __name__ == "__main__":
    main()
